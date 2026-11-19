import { access, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { z } from 'zod';
import { createLimiter } from '../src/lib/bounded-work.cjs';
import { discover, feed, niches, wikidata } from '../src/lib/origin/discovery';
import { discoverPublicationPointers, gdeltCredits, publicationAdapter, verifyPublications } from '../src/lib/origin/auto-publishers';
import { evaluate, evaluations } from '../src/lib/origin/evaluation';
import { readModelConfig } from '../src/lib/origin/model';
import { agentOnline, followRun, notifyAgent } from '../src/lib/origin/operations';
import { defaults, domain, hash, POLICY_VERSION, settingsSchema } from '../src/lib/origin/policy';
import type { Settings } from '../src/lib/origin/policy';
import { coachingContracts, procurementAdapter, procurementCredit, tenderAdapter } from '../src/lib/origin/procurement';
import { createPublicWeb, documentUrl, PublicFailure } from '../src/lib/origin/public-web';
import { artifact, dossier, hasSchema, investigations, listRuns, modelUsage, overview, readyOpportunities, runSummary, sourceReadiness } from '../src/lib/origin/read-model';
import { configuration, control, editPublishers, migrate, patchSettings, sourceHistory, sourceQuality, start } from '../src/lib/origin/store';
import { runBenchmark } from './origin-benchmark';

const connection = { connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8_000, query_timeout: 15_000, max: 1,
  ssl: process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n'), rejectUnauthorized: true } : { rejectUnauthorized: false } };
const format = (value: unknown) => JSON.stringify(value, null, 2);
const print = (value: unknown) => console.log(format(value));
const uuid = z.string().uuid();
const active = ['QUEUED', 'RUNNING', 'PAUSED'];
const commands = {
  help: [], migrate: [], status: [], doctor: ['strict'],
  start: ['limit', 'minutes', 'no-browser', 'qualification'],
  run: ['limit', 'minutes', 'no-browser', 'qualification', 'timeout', 'require-qualified', 'quiet'],
  work: ['timeout', 'require-qualified', 'quiet'], wait: ['timeout', 'require-qualified', 'quiet'],
  pause: [], resume: [], cancel: [], runs: ['limit'], 'show-run': [],
  investigations: ['run', 'outcome', 'limit'], opportunities: ['run', 'limit'], dossier: [], evidence: [], artifact: ['output'],
  settings: [], schedule: [], sources: ['publisher', 'timeout'], usage: ['run'], evaluate: ['output'],
  benchmark: ['limit', 'timeout', 'require-qualified'], evaluations: ['limit'], acceptance: ['limit', 'timeout', 'require-qualified'],
} as const;

const usage = `ORIGIN — public business discovery and qualification
Usage: node origin.cjs <command> [arguments] [options]

  doctor [--strict]                      Report database, worker, browser, source and model readiness
  migrate | status                       Apply additive schema or view the dashboard state
  start [--qualification]                Enqueue a run for the persistent worker
  run [--qualification]                  Start and follow a run, using a foreground lane when the agent is offline
  work <run|active>                       Continue an existing run, using a foreground lane when needed
  wait <run|latest>                       Follow a run without claiming work
  pause | resume | cancel <run|active>    Apply a durable run control
  runs [--limit N] | show-run <run|latest>
  investigations [--run ID] [--outcome QUALIFIED|REJECTED|UNRESOLVED|FAILED] [--limit N]
  opportunities [--run ID] [--limit N]    List current, eligible and unsuppressed dossiers
  dossier | evidence <investigation-id>   Read the full dossier or its evidence ledger
  artifact <investigation-id> <hash> --output <new-file>
  settings show | set <key> <JSON-value> | import <JSON-file>
  schedule show | off | every <minutes>
  sources list | history | probe          Inspect source configuration, history or actual source reachability
  sources add <title> <feed-url> <permission-url> [--publisher <owner>]
  sources remove <feed-url>               Remove a publisher from future runs
  usage [--run ID] | evaluate <run|latest> [--output <new-file>]
  benchmark <fixture|live> [--require-qualified] [--limit N]
                                         Run a private, isolated evaluation and record its summary
  evaluations [--limit N]                 Inspect stored benchmark summaries

Start/run overrides: --limit 1..24 --minutes 2..30 --no-browser.
Run/work/wait options: --timeout seconds --quiet --require-qualified.
Every run discovers its sources automatically and applies the same qualification gates.
Commands emit JSON. Run progress goes to stderr. Ctrl+C leaves saved checkpoints available.`;

class CommandError extends Error {
  constructor(message: string, readonly exitCode = 2) { super(message); }
}

function requireValue(value: string | undefined, label: string) {
  if (!value) throw new CommandError(`Provide ${label}.`);
  return value;
}

function parseNumber(raw: string | undefined, fallback: number, min: number, max: number, label: string) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < min || value > max) throw new CommandError(`${label} must be between ${min} and ${max}.`);
  return value;
}

async function selectRun(pool: Pool, userValue: string | undefined, fallback = 'latest') {
  const ref = userValue ?? fallback;
  if (ref === 'latest' || ref === 'active') {
    const runs = await listRuns(pool, ref === 'active' ? 30 : 1);
    const run = ref === 'active' ? runs.find(item => active.includes(item.state)) : runs[0];
    if (!run) throw new CommandError(ref === 'active' ? 'There is no active ORIGIN run.' : 'There are no ORIGIN runs.');
    return run.id;
  }
  return uuid.parse(ref);
}

async function browserAvailable() {
  try { const { default: puppeteer } = await import('puppeteer'); await access(puppeteer.executablePath()); return true; }
  catch { return false; }
}

async function inspectSources(pool: Pool, signal: AbortSignal) {
  const configured = await sourceReadiness(pool);
  const web = createPublicWeb(createLimiter(3, 96));
  const bounded = () => AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  const history = await sourceHistory(pool);
  const hold = (name: string) => history.find(source => source.adapter === name && source.retryAt && Date.parse(source.retryAt) > Date.now())?.retryAt;
  const found = await discover([
    ...([['contracts', procurementAdapter], ['tender', tenderAdapter]] as const).map(([index, name]) => ({ name, credit: procurementCredit,
      retryAt: hold(name), run: () => coachingContracts(web, index, 0, 4, bounded()) })),
    ...configured.feeds.map(publisher => ({ name: publisher.title, run: () => feed(web, publisher, 12, bounded()) })),
    { name: publicationAdapter, retryAt: hold(publicationAdapter), run: async () => verifyPublications(web,
      await discoverPublicationPointers(web, niches[0], bounded()), defaults.activityDays, bounded()) },
    { name: 'Wikidata', run: () => wikidata(web, 3, niches[0], bounded()) },
  ], 24);
  const overlaps = new Map<string, Set<string>>();
  for (const seed of found.seeds.filter(item => item.occurredAt && item.publisher)) {
    const host = domain(seed.website);
    const owners = overlaps.get(host) ?? new Set<string>();
    owners.add(seed.publisher!);
    overlaps.set(host, owners);
  }
  return { configured, indexCredit: gdeltCredits, results: found.results, candidateOverlap: [...overlaps].filter(([, owners]) => owners.size >= 2).map(([host]) => host),
    observations: found.seeds.map(seed => ({ name: seed.name, website: seed.website, source: seed.source, occurredAt: seed.occurredAt ?? null })) };
}

async function main(argv: string[]) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    help: { type: 'boolean', short: 'h' }, limit: { type: 'string' }, minutes: { type: 'string' }, timeout: { type: 'string' },
    'no-browser': { type: 'boolean' }, qualification: { type: 'boolean' }, quiet: { type: 'boolean' }, strict: { type: 'boolean' },
    'require-qualified': { type: 'boolean' }, run: { type: 'string' }, outcome: { type: 'string' }, output: { type: 'string' }, publisher: { type: 'string' },
  } });
  const [command = 'help', operand, second, third, fourth] = positionals;
  if (values.help || command === 'help') { console.log(usage); return 0; }
  if (!Object.hasOwn(commands, command)) throw new CommandError('Unknown arguments. Run node origin.cjs help.');
  const accepted: readonly string[] = commands[command as keyof typeof commands];
  if (Object.keys(values).some(key => !accepted.includes(key))) throw new CommandError('An option is unsupported for this command. Run node origin.cjs help.');
  const allowedArguments = command === 'sources' ? 4 : command === 'settings' ? 3 : command === 'schedule' || command === 'artifact' ? 2
    : ['work', 'wait', 'pause', 'resume', 'cancel', 'show-run', 'dossier', 'evidence', 'evaluate', 'benchmark'].includes(command) ? 1 : 0;
  if (positionals.length - 1 > allowedArguments) throw new CommandError('Too many arguments. Run node origin.cjs help.');
  if (process.env.VERCEL) throw new CommandError('Run ORIGIN commands on the local worker computer.');
  if (!connection.connectionString) throw new CommandError('The local database connection is missing from runtime configuration.', 4);
  const shutdown = new AbortController();
  const onInterrupt = () => shutdown.abort(new CommandError('Interrupted. Saved checkpoints remain available.', 130));
  process.once('SIGINT', onInterrupt);
  const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(parseNumber(values.timeout, 1980, 1, 3600, 'Timeout') * 1000)]);
  const pool = new Pool(connection);
  const limit = (fallback: number, maximum = 250) => parseNumber(values.limit, fallback, 1, maximum, 'Limit');
  async function complete(id: string, drive: boolean) {
    const run = await followRun(pool, id, { signal, drive, progress: values.quiet ? undefined : item => {
      console.error(`${item.id} ${item.state} ${JSON.stringify(item.counts)}`);
    } });
    const result = (await evaluate(pool, id))!;
    print(result);
    if (run.state !== 'COMPLETED') return 4;
    return values['require-qualified'] && !(await readyOpportunities(pool, 1, id)).length ? 5 : 0;
  }
  try {
    if (command === 'migrate') { await migrate(pool); print({ ready: true }); return 0; }
    if (command === 'doctor') {
      const schema = await hasSchema(pool);
      const sources = schema ? await sourceReadiness(pool) : null;
      const chrome = await browserAvailable();
      const config = schema ? await configuration(pool) : null;
      const ready = Boolean(schema && (!config?.config.browser || chrome));
      const agent = await agentOnline(pool);
      const workerNeedsReload = agent && config?.worker_policy_version !== POLICY_VERSION;
      print({ database: true, schema, agent, chrome, sources, activeWorkerPolicy: config?.worker_policy_version ?? null,
        expectedWorkerPolicy: POLICY_VERSION, workerNeedsReload,
        mode: 'automatic-discovery', agentRouter: { configured: Boolean(readModelConfig()), requestsPerRun: config?.config.modelCalls ?? 0 },
        remediation: !schema ? 'Run node origin.cjs migrate.' : chrome || !config?.config.browser ? null : 'Install the existing Puppeteer Chrome or disable captures in settings.' });
      return values.strict && (!ready || workerNeedsReload) ? 3 : 0;
    }
    if (command === 'benchmark' || command === 'acceptance') {
      const kind = command === 'acceptance' ? 'live' : operand;
      if (kind !== 'fixture' && kind !== 'live') throw new CommandError('Select benchmark fixture or benchmark live.');
      const report = await runBenchmark(pool, connection, kind, limit(12, 24), signal);
      print(report);
      return !report.passed ? 4 : values['require-qualified'] && !report.published ? 5 : 0;
    }
    if (command === 'start' || command === 'run') {
      await migrate(pool);
      const override: Partial<Settings> = {};
      if (values.limit !== undefined) override.candidateLimit = limit(8, 24);
      if (values.minutes !== undefined) override.runMinutes = parseNumber(values.minutes, 10, 2, 30, 'Run minutes');
      if (values['no-browser']) override.browser = false;
      const id = await start(pool, override);
      if (!id) throw new CommandError('An ORIGIN run is already active. Use work active, wait active, or cancel active.');
      await notifyAgent(pool);
      if (command === 'run') {
        if (!values.quiet) console.error('Mode automatic-discovery');
        return await complete(id, true);
      }
      print({ id, state: 'QUEUED', mode: 'automatic-discovery', agentOnline: await agentOnline(pool) });
      return 0;
    }
    if (!await hasSchema(pool)) throw new CommandError('Apply the ORIGIN schema with node origin.cjs migrate.', 3);
    switch (command) {
      case 'status': print(await overview(pool)); break;
      case 'wait': case 'work': return await complete(await selectRun(pool, operand, command === 'work' ? 'active' : 'latest'), command === 'work');
      case 'pause': case 'resume': case 'cancel': {
        const id = await selectRun(pool, operand, 'active');
        if (!await control(pool, id, command)) throw new CommandError('The run state does not allow that action.');
        await notifyAgent(pool);
        print(await runSummary(pool, id));
        break;
      }
      case 'runs': print(await listRuns(pool, limit(20))); break;
      case 'show-run': {
        const run = await runSummary(pool, await selectRun(pool, operand));
        if (!run) throw new CommandError('This run does not exist.');
        print(run);
        break;
      }
      case 'investigations': {
        const outcome = values.outcome?.toUpperCase() ?? null;
        if (outcome && !['QUALIFIED', 'REJECTED', 'UNRESOLVED', 'FAILED'].includes(outcome)) throw new CommandError('Unsupported outcome.');
        print(await investigations(pool, values.run ? await selectRun(pool, values.run) : null, outcome, limit(50)));
        break;
      }
      case 'opportunities': print(await readyOpportunities(pool, limit(100), values.run ? await selectRun(pool, values.run) : null)); break;
      case 'dossier': case 'evidence': {
        const record = await dossier(pool, uuid.parse(operand));
        if (!record) throw new CommandError('This investigation does not exist.');
        print(command === 'evidence' ? { id: record.id, evidence: record.checkpoint.evidence, journey: record.checkpoint.journey, captures: record.artifacts } : record);
        break;
      }
      case 'artifact': {
        const id = uuid.parse(operand);
        const capture = z.string().regex(/^[a-f0-9]{64}$/).parse(second);
        const output = requireValue(values.output, '--output <new-file>');
        const record = await dossier(pool, id);
        const bytes = await artifact(pool, id, capture);
        if (!bytes || !record) throw new CommandError('This capture is unavailable.');
        const digest = hash(bytes);
        if (record.artifacts.find(item => item.id === capture)?.digest !== digest) throw new CommandError('The saved capture failed its hash check.', 4);
        await writeFile(output, bytes, { flag: 'wx' });
        print({ output, bytes: bytes.length, sha256: digest });
        break;
      }
      case 'settings': {
        if ((!operand || operand === 'show') && !second) { const saved = await configuration(pool); print(saved.config); break; }
        let patch: Partial<Settings>;
        if (operand === 'set' && second && Object.hasOwn(defaults, second)) patch = { [second]: JSON.parse(requireValue(third, 'a JSON value')) };
        else if (operand === 'import' && second && !third) patch = settingsSchema.partial().parse(JSON.parse(await readFile(second, 'utf8')));
        else throw new CommandError('Use settings show, settings set <key> <JSON-value>, or settings import <JSON-file>.');
        print(await patchSettings(pool, patch));
        await notifyAgent(pool);
        break;
      }
      case 'schedule': {
        if (operand === 'every' && second) await patchSettings(pool, { intervalMinutes: parseNumber(second, 60, 60, 43_200, 'Schedule interval') });
        else if (operand === 'off' && !second) await patchSettings(pool, { intervalMinutes: null });
        else if ((operand && operand !== 'show') || second) throw new CommandError('Use schedule show, schedule off, or schedule every <minutes>.');
        const saved = await configuration(pool);
        print({ intervalMinutes: saved.config.intervalMinutes, nextRunAt: saved.next_run_at });
        if (operand === 'every' || operand === 'off') await notifyAgent(pool);
        break;
      }
      case 'sources': {
        if ((operand === 'add' && positionals.length !== 5) || (operand === 'remove' && (!second || third)) ||
            (!['add', 'remove'].includes(operand) && second)) throw new CommandError('Check the source command arguments.');
        if (operand === 'history') { print({ history: await sourceHistory(pool), quality: await sourceQuality(pool) }); break; }
        if (operand === 'probe') { print(await inspectSources(pool, signal)); break; }
        if (operand === 'add') {
          await editPublishers(pool, feeds => [...feeds, { title: second, url: third, permission: fourth, publisher: values.publisher }]);
        } else if (operand === 'remove') {
          const url = documentUrl(second).href;
          await editPublishers(pool, feeds => {
            if (!feeds.some(feed => feed.url === url)) throw new CommandError('This publisher feed is absent.');
            return feeds.filter(feed => feed.url !== url);
          });
        } else if (operand && operand !== 'list') throw new CommandError('Use sources list, history, probe, add or remove.');
        print(await sourceReadiness(pool));
        break;
      }
      case 'usage': print(await modelUsage(pool, values.run ? await selectRun(pool, values.run) : null)); break;
      case 'evaluate': {
        const result = await evaluate(pool, await selectRun(pool, operand));
        if (!result) throw new CommandError('This run does not exist.');
        if (values.output) await writeFile(values.output, format(result), { flag: 'wx' });
        print(result);
        break;
      }
      case 'evaluations': print(await evaluations(pool, limit(20))); break;
    }
    return 0;
  } finally { process.removeListener('SIGINT', onInterrupt); await pool.end(); }
}

void main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
  if (error instanceof CommandError) { console.error(error.message); process.exitCode = error.exitCode; return; }
  if (error instanceof z.ZodError || error instanceof SyntaxError || error.code?.startsWith?.('ERR_PARSE_ARGS')) console.error('Invalid arguments or JSON. Run node origin.cjs help.');
  else if (error instanceof PublicFailure) console.error(`ORIGIN source error ${error.code}. Check publisher URLs and permission references.`);
  else if (error instanceof Error && error.name === 'TimeoutError') console.error('Wait timed out. The saved run can be followed or resumed by ID.');
  else if (error.code === 'XX000' && /pool|client|connection/i.test(String(error.message))) console.error('The PostgreSQL pool refused another connection. Try again when a connection is available.');
  else if (error.code === 'EEXIST') console.error('The output file already exists. Choose a new path.');
  else console.error(`ORIGIN could not complete the command${typeof error.code === 'string' && /^[A-Z0-9_]{1,20}$/i.test(error.code) ? ` (${error.code})` : ''}. Check the requested record or local database.`);
  process.exitCode = 4;
});
