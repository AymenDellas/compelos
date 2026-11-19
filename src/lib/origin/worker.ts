import type { Pool } from 'pg';
import { approvedFeeds, discover, feed, niches, wikidata } from './discovery';
import type { Adapter } from './discovery';
import { modelAdvisory } from './model';
import { decide } from './policy';
import type { SourceResult } from './policy';
import { createPublicWeb } from './public-web';
import { investigate, resolveBusiness, verifyOpportunity } from './research';
import { claimRun, failStage, finish, nextJob, release, revisit, saveDiscovery, saveStage, sourceHistory, sourceQuality } from './store';
import type { Run, SourceQuality } from './store';

type Limiter = <T>(run: () => Promise<T>) => Promise<T>;

function chooseSource(history: SourceResult[], quality: SourceQuality[], names: string[], explore: boolean) {
  const cutoff = 50;
  return names.map(name => {
    const observations = history.filter(item => item.adapter === name).slice(0, cutoff);
    // Prefer independently corroborated official identities per second of source work.
    const yieldPerSecond = (quality.find(item => item.adapter === name)?.identities ?? 0) /
      Math.max(1, observations.reduce((sum, item) => sum + Math.max(500, item.elapsedMs), 0) / 1000);
    return { name, attempts: observations.filter(item => item.status !== 'DEFERRED').length, yieldPerSecond };
  }).sort((a, b) => explore ? a.attempts - b.attempts : b.yieldPerSecond - a.yieldPerSecond || a.attempts - b.attempts)[0]?.name;
}

export function createOriginLane(pool: Pool, limit: Limiter) {
  const shutdown = new AbortController();
  const web = createPublicWeb(limit);
  let nextProbe = 0;
  let ready = false;
  let probeCount = 0;
  const perSource = (signal: AbortSignal, ms: number) => AbortSignal.any([signal, AbortSignal.timeout(ms)]);

  async function discovery(run: Run, signal: AbortSignal) {
    const [history, quality] = await Promise.all([sourceHistory(pool), sourceQuality(pool)]);
    const explore = history.filter(item => item.adapter.startsWith('Wikidata')).length % 3 === 0;
    const selection = chooseSource(history, quality, niches.map(niche => `Wikidata · ${niche}`), explore);
    const strategy = selection?.split(' · ')[1] ?? niches[0];
    const limit = run.config.candidateLimit;
    const hold = (name: string) => history.find(item => item.adapter === name && item.retryAt && Date.parse(item.retryAt) > Date.now())?.retryAt;
    const adapters: Adapter[] = [];
    if (limit >= 3) adapters.push({ name: 'IGNITION', run: () => revisit(pool, Math.floor(limit / 3)) });
    try {
      const feeds = approvedFeeds();
      const preferred = chooseSource(history, quality, feeds.map(item => `ECHO · ${item.title}`), explore);
      // Rotate through publishers, retaining a second independent source where available.
      const chosen = [...feeds].sort((a, b) => Number(`ECHO · ${b.title}` === preferred) - Number(`ECHO · ${a.title}` === preferred)).slice(0, 2);
      for (const item of chosen) {
        const name = `ECHO · ${item.title}`;
        adapters.push({ name, retryAt: hold(name), run: () => feed(web, item, Math.max(1, Math.floor(limit / 2)), perSource(signal, 8_000)) });
      }
    } catch {
      adapters.push({ name: 'ECHO', run: async () => { approvedFeeds(); return []; } });
    }
    const latestWikiHold = history.find(item => item.adapter.startsWith('Wikidata') && item.retryAt && Date.parse(item.retryAt) > Date.now())?.retryAt;
    adapters.push({ name: `Wikidata · ${strategy}`, retryAt: latestWikiHold,
      run: () => wikidata(web, limit, strategy, perSource(signal, 18_000)) });
    const found = await discover(adapters, limit);
    signal.throwIfAborted();
    await saveDiscovery(pool, run, found.seeds, found.results);
  }

  async function runOnce() {
    if (shutdown.signal.aborted || Date.now() < nextProbe) return false;
    if (!ready) {
      ready = Boolean((await pool.query("SELECT to_regclass('origin_settings') AS name")).rows[0].name);
      if (!ready) { nextProbe = Date.now() + 30_000; return false; }
    }
    const run = await claimRun(pool);
    if (++probeCount % 120 === 1) await pool.query(`UPDATE origin_artifacts SET image=NULL WHERE image IS NOT NULL
      AND captured_at<now()-interval '30 days'`);
    if (!run) { nextProbe = Date.now() + 12_000; return false; }
    const signal = perSource(shutdown.signal, Math.max(1, Math.min(74_000, run.deadline_at.getTime() - Date.now())));
    try {
      if (!run.sources) await discovery(run, signal);
      else {
        const job = await nextJob(pool, run);
        if (!job) await finish(pool, run, run.sources.every(source => source.status !== 'OK' || !source.discovered) &&
          run.sources.some(source => source.status !== 'OK') ? 'A discovery source was unavailable. See Discovery for its latest status.' : undefined);
        else try {
          if (job.stage === 'RESOLVING') {
            const { checkpoint, done } = await resolveBusiness(web, job, signal);
            await saveStage(pool, run, job, checkpoint, done ? decide(checkpoint.gates, checkpoint.evidence) : 'INVESTIGATING');
          } else if (job.stage === 'INVESTIGATING') {
            const { checkpoint, artifacts } = await investigate(web, job, run.config, signal);
            await saveStage(pool, run, job, checkpoint, checkpoint.gates.some(gate => gate.state === 'CONTRADICTED')
              ? decide(checkpoint.gates, checkpoint.evidence) : 'VERIFYING', artifacts);
          } else {
            const checkpoint = await verifyOpportunity(web, job, signal);
            await modelAdvisory(pool, run, job, checkpoint, signal);
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
