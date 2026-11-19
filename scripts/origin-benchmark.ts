import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type { PoolConfig } from 'pg';
import { endToEndFixture } from '../tests/origin/end-to-end-fixture';
import { defaults, hash } from '../src/lib/origin/policy';
import { evaluate, saveEvaluation, scoreFixture } from '../src/lib/origin/evaluation';
import { artifact, dossier, readyOpportunities, sourceReadiness } from '../src/lib/origin/read-model';
import type { RunSummary } from '../src/lib/origin/read-model';
import { editPublishers, migrate, saveSettings, start } from '../src/lib/origin/store';
import { followRun } from '../src/lib/origin/operations';

export async function runBenchmark(admin: Pool, connection: PoolConfig, kind: 'fixture' | 'live', limit: number, signal: AbortSignal) {
  const name = `origin_cli_${randomBytes(8).toString('hex')}`;
  await migrate(admin);
  const configuredFeeds = (await sourceReadiness(admin)).feeds;
  await admin.query(`CREATE SCHEMA ${name}`);
  const pool = new Pool({ ...connection, options: `-c search_path=${name}`, max: 1 });
  const fixture = kind === 'fixture' ? endToEndFixture() : null;
  try {
    await migrate(pool);
    await editPublishers(pool, () => fixture ? [] : configuredFeeds);
    await saveSettings(pool, { ...defaults, candidateLimit: fixture ? Object.keys(fixture.expected).length : limit });
    if (fixture) {
      await pool.query('CREATE TABLE leads (website text, do_not_contact boolean)');
      await pool.query('INSERT INTO leads(website,do_not_contact) VALUES($1,true)', [`https://${fixture.suppressedDomain}/`]);
    }
    const id = (await start(pool))!;
    const clock = Date.now();
    const stages: Pick<RunSummary, 'state' | 'counts'>[] = [];
    const run = await followRun(pool, id, { signal, drive: true, web: fixture?.web, replaceAfter: 2,
      progress: snapshot => { stages.push({ state: snapshot.state, counts: snapshot.counts }); } });
    const evaluation = (await evaluate(pool, id))!;
    const ready = await readyOpportunities(pool);
    const score = fixture ? scoreFixture(evaluation.results, fixture.expected) : null;
    const directory = resolve('data/engine-v2/origin-cli', `${kind}-${id}`);
    await mkdir(directory, { recursive: true });
    let verifiedCaptures = 0;
    const evidence = [];
    for (const result of evaluation.results) {
      const record = (await dossier(pool, result.id))!;
      evidence.push(record);
      for (const capture of record.artifacts.filter(item => item.available)) {
        const image = await artifact(pool, result.id, capture.id);
        if (!image || hash(image) !== capture.digest) continue;
        await writeFile(resolve(directory, `${capture.id}.jpg`), image, { flag: 'wx' });
        verifiedCaptures++;
      }
    }
    const operational = run.state === 'COMPLETED' && evaluation.investigated > 0 && evaluation.captures === verifiedCaptures;
    const deliveryTargetMet = kind === 'live' ? ready.length >= 3 : null;
    const report = { kind, run: id, state: run.state, counts: run.counts, investigated: evaluation.investigated,
      published: ready.length, captures: evaluation.captures, verifiedCaptures, usage: evaluation.usage, sources: run.sources,
      gates: evaluation.gates, publisherChecks: evaluation.publisherChecks, seconds: Math.round((Date.now() - clock) / 1000), score, directory,
      operational, deliveryTargetMet,
      passed: operational && (score ? score.total === score.passed && score.unexpected.length === 0 && ready.length === 2 && verifiedCaptures >= 4
        : deliveryTargetMet === true) };
    await writeFile(resolve(directory, 'report.json'), JSON.stringify({ report, evaluation, stages, evidence }, null, 2), { flag: 'wx' });
    await saveEvaluation(admin, id, kind === 'fixture' ? 'FIXTURE' : 'LIVE', report);
    return report;
  } finally {
    await pool.end();
    // This schema was created and owned by this invocation for benchmark data.
    await admin.query(`DROP SCHEMA ${name} CASCADE`);
  }
}
