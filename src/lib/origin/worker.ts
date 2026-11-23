import type { Pool } from 'pg';
import { businessSearchName } from './business-search';
import type { createBusinessSearch } from './business-search';
import { discover } from './discovery';
import type { Adapter } from './discovery';
import { decide } from './policy';
import type { Seed, SourceResult } from './policy';
import { discoverPublicOffers, publicOfferSource } from './public-discovery';
import { createPublicWeb } from './public-web';
import type { PublicWeb } from './public-web';
import { hasSchema } from './read-model';
import { investigate, resolveBusiness } from './research';
import { advanceQualifiedRun, claimRun, failStage, finish, includedInvestigation, migrate, nextJob, release, runSearch, saveDiscovery, saveStage, sourceHistory } from './store';
import type { Run } from './store';

type Limiter = <T>(run: () => Promise<T>) => Promise<T>;
const REFILL_SEARCH_ALLOWANCE = 18;

function targetSearchAttempts(sources: SourceResult[]) {
  return sources.filter(source => source.adapter === businessSearchName || source.adapter === publicOfferSource)
    .reduce((total, source) => total + (source.searchAttempts ?? source.searches ?? 0), 0);
}

export function createOriginLane(pool: Pool, limitRequest: Limiter, options: {
  runId?: string; web?: PublicWeb; businessSearch?: ReturnType<typeof createBusinessSearch>;
} = {}) {
  const shutdown = new AbortController();
  const web = options.web ?? createPublicWeb(limitRequest);
  let nextProbe = 0;
  let ready = false;
  let probeCount = 0;
  const perSource = (signal: AbortSignal, ms: number) => AbortSignal.any([signal, AbortSignal.timeout(ms)]);

  async function discovery(run: Run, signal: AbortSignal) {
    const search = options.businessSearch;
    if (!search) return discoverPublicOffers(pool, run, web, signal);

    const history = await sourceHistory(pool);
    const previous = history.find(item => item.adapter === businessSearchName && item.queryIndex !== undefined)?.queryIndex ?? -1;
    const limit = run.config.candidateLimit;
    const initial = Math.max(3, Math.ceil(limit / 5));
    const remaining = initial + REFILL_SEARCH_ALLOWANCE + run.batch_search_start - targetSearchAttempts(run.sources ?? []);
    const { rows: [{ queued }] } = await pool.query<{ queued: number }>(
      'SELECT count(*)::int AS queued FROM origin_investigations j WHERE run_id=$1 AND ' + includedInvestigation, [run.id]);
    const gap = Math.max(0, run.batch_start + limit - queued);
    const count = (run.discovery_round ?? 0) > 0 ? Math.min(6, Math.ceil(gap / 2), remaining) : initial;
    const adapter: Adapter = { name: businessSearchName, run: async () => {
      const groups: Seed[][] = [];
      for (let start = 1; start <= count; start += 3) {
        signal.throwIfAborted();
        const keys = Array.from({ length: Math.min(count - start + 1, 3) }, (_, offset) => previous + start + offset);
        const results = await Promise.allSettled(keys.map(index => limitRequest(() => runSearch(pool, run,
          businessSearchName + ':' + index, () => search(index, 10, perSource(signal, 14_000))))));
        adapter.queryIndex = keys[keys.length - 1];
        adapter.searchAttempts = (adapter.searchAttempts ?? 0) + keys.length;
        for (const result of results) if (result.status === 'fulfilled' && result.value) groups.push(result.value);
      }
      adapter.searches = groups.length;
      return Array.from({ length: 10 }, (_, index) => groups.flatMap(group => group[index] ? [group[index]] : [])).flat();
    } };
    const found = await discover(count > 0 ? [adapter] : []);
    signal.throwIfAborted();
    await saveDiscovery(pool, run, found.seeds, found.results, count > 0 && count < remaining);
  }

  async function runOnce() {
    if (shutdown.signal.aborted || Date.now() < nextProbe) return false;
    if (!ready) {
      if (!await hasSchema(pool)) { nextProbe = Date.now() + 30_000; return false; }
      await migrate(pool);
      ready = true;
    }
    const run = await claimRun(pool, options.runId);
    if (++probeCount % 120 === 1) await pool.query(`UPDATE origin_artifacts SET image=NULL WHERE image IS NOT NULL
      AND captured_at<now()-interval '30 days'`);
    if (!run) { nextProbe = Date.now() + 12_000; return false; }
    const signal = perSource(shutdown.signal, Math.max(1, Math.min(74_000, run.deadline_at.getTime() - Date.now())));
    try {
      if (!run.sources || run.discovery_round !== null) {
        try { await discovery(run, signal); }
        catch (error) { if (!signal.aborted) throw error; }
      }
      else {
        const job = await nextJob(pool, run);
        if (!job && run.config.qualifiedTarget) await advanceQualifiedRun(pool, run, targetSearchAttempts(run.sources));
        else if (!job) await finish(pool, run, run.sources.every(source => source.status !== 'OK' || !source.discovered) &&
          run.sources.some(source => source.status === 'FAILED') ? 'A discovery source was unavailable. See Discovery for its latest status.' : undefined);
        else try {
          const startedAt = Date.now();
          if (job.stage === 'RESOLVING') {
            const { checkpoint, done } = await resolveBusiness(web, job, signal);
            checkpoint.stageMs = { ...checkpoint.stageMs, resolve: Date.now() - startedAt };
            await saveStage(pool, run, job, checkpoint, done ? decide(checkpoint.gates, checkpoint.evidence) : 'INVESTIGATING');
          } else {
            const { checkpoint } = await investigate(web, job, run.config, signal, { qualificationOnly: true });
            checkpoint.stageMs = { ...checkpoint.stageMs, investigate: Date.now() - startedAt };
            await saveStage(pool, run, job, checkpoint, decide(checkpoint.gates, checkpoint.evidence));
          }
        } catch (error) {
          if (!signal.aborted) {
            await failStage(pool, run, job);
            console.warn('[ORIGIN]', run.id, job.id, 'checkpoint retry', error instanceof Error ? error.name : 'Error');
          }
        }
      }
      return true;
    } finally { await release(pool, run); }
  }
  return { runOnce, wake() { nextProbe = 0; }, stop() { shutdown.abort(); } };
}
