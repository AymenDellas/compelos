import type { Pool } from 'pg';
import { discoverPublicationPointers, gdeltCredits, publicationAdapter, verifyPublications } from './auto-publishers';
import { discover, feed, niches, wikidata } from './discovery';
import type { Adapter } from './discovery';
import { modelAdvisory } from './model';
import { decide, domain } from './policy';
import type { SourceResult } from './policy';
import { createPublicWeb } from './public-web';
import type { PublicWeb } from './public-web';
import { hasSchema } from './read-model';
import { enrichAcquisition, investigate, resolveBusiness, verifyOpportunity } from './research';
import { approvedFeeds } from './sources';
import { claimRun, failStage, finish, nextJob, recentPublisherEvidence, recentWikiPointers, release, revisit, saveDiscovery, saveStage, sourceHistory, sourceQuality } from './store';
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

export function createOriginLane(pool: Pool, limit: Limiter, options: { runId?: string; web?: PublicWeb } = {}) {
  const shutdown = new AbortController();
  const web = options.web ?? createPublicWeb(limit);
  let nextProbe = 0;
  let ready = false;
  let probeCount = 0;
  const perSource = (signal: AbortSignal, ms: number) => AbortSignal.any([signal, AbortSignal.timeout(ms)]);

  async function discovery(run: Run, signal: AbortSignal) {
    const history = await sourceHistory(pool);
    const quality = await sourceQuality(pool);
    const explore = history.filter(item => item.adapter.startsWith('Wikidata')).length % 3 === 0;
    const previous = history.find(item => item.adapter.startsWith('Wikidata') && item.status === 'OK')?.adapter;
    const selection = chooseSource(history, quality, niches.map(niche => `Wikidata · ${niche}`).filter(name => name !== previous), explore);
    const strategy = selection?.split(' · ')[1] ?? niches[0];
    const limit = run.config.candidateLimit;
    const hold = (name: string) => history.find(item => item.adapter === name && item.retryAt && Date.parse(item.retryAt) > Date.now())?.retryAt;
    const adapters: Adapter[] = [];
    let feeds: ReturnType<typeof approvedFeeds> = [];
    try {
      feeds = approvedFeeds(run.publisher_feeds);
      const preferred = chooseSource(history, quality, feeds.map(item => `ECHO · ${item.title}`), explore);
      // Rotate through publishers, retaining a second independent source where available.
      const first = feeds.find(item => `ECHO · ${item.title}` === preferred);
      const other = first && feeds.find(item => domain(item.url) !== domain(first.url) &&
        (item.publisher ?? domain(item.url)) !== (first.publisher ?? domain(first.url)));
      const chosen = [first, other].filter(item => item !== undefined);
      for (const item of chosen) {
        const name = `ECHO · ${item.title}`;
        adapters.push({ name, retryAt: hold(name), run: () => feed(web, item, Math.min(24, limit * 2), perSource(signal, 8_000)) });
      }
    } catch {
      adapters.push({ name: 'ECHO supplemental feeds', deferred: 'INVALID_FEED_CONFIGURATION', run: async () => [] });
    }
    adapters.push({ name: publicationAdapter, credit: gdeltCredits, retryAt: hold(publicationAdapter), run: async () => {
      // Leave time for the index to return a rate-limit response and its retry instructions.
      const indexSignal = perSource(signal, 21_000);
      const pointers = await discoverPublicationPointers(web, strategy, indexSignal);
      return verifyPublications(web, pointers, run.config.activityDays, perSource(signal, 12_000));
    } });
    const publisherObservation = (seed: Awaited<ReturnType<typeof recentPublisherEvidence>>[number]) => {
      if (seed.method === 'PUBLICATION') {
        const age = Date.now() - Date.parse(seed.publication?.checkedAt ?? '');
        return age >= 0 && age < 86_400_000 ? [seed] : [];
      }
      const publisher = feeds.find(item => domain(item.url) === domain(seed.source) && item.permission === seed.permission);
      return publisher ? [{ ...seed, publisher: publisher.publisher ?? domain(publisher.url) }] : [];
    };
    if (limit >= 3) adapters.push({ name: 'IGNITION', run: async () => (await revisit(pool, Math.floor(limit / 3)))
      .flatMap(seed => seed.occurredAt ? publisherObservation(seed) : [seed]) });
    const latestWikiHold = history.find(item => item.adapter.startsWith('Wikidata') && item.retryAt && Date.parse(item.retryAt) > Date.now())?.retryAt;
    const recent = new Set(await recentWikiPointers(pool));
    adapters.push({ name: `Wikidata · ${strategy}`, retryAt: latestWikiHold,
      run: async () => (await wikidata(web, Math.min(24, limit * 3), strategy, perSource(signal, 18_000))).filter(seed => !recent.has(seed.source)) });
    const historic = (await recentPublisherEvidence(pool, run.config.activityDays)).flatMap(seed => {
      const occurred = Date.parse(seed.occurredAt ?? '');
      return occurred <= Date.now() && occurred >= Date.now() - run.config.activityDays * 86_400_000 ? publisherObservation(seed) : [];
    });
    const found = await discover(adapters, limit, historic);
    signal.throwIfAborted();
    await saveDiscovery(pool, run, found.seeds, found.results);
  }

  async function runOnce() {
    if (shutdown.signal.aborted || Date.now() < nextProbe) return false;
    if (!ready) {
      ready = await hasSchema(pool);
      if (!ready) { nextProbe = Date.now() + 30_000; return false; }
    }
    const run = await claimRun(pool, options.runId);
    if (++probeCount % 120 === 1) await pool.query(`UPDATE origin_artifacts SET image=NULL WHERE image IS NOT NULL
      AND captured_at<now()-interval '30 days'`);
    if (!run) { nextProbe = Date.now() + 12_000; return false; }
    const signal = perSource(shutdown.signal, Math.max(1, Math.min(74_000, run.deadline_at.getTime() - Date.now())));
    try {
      if (!run.sources) await discovery(run, signal);
      else {
        const job = await nextJob(pool, run);
        if (!job) await finish(pool, run, run.sources.every(source => source.status !== 'OK' || !source.discovered) &&
          run.sources.some(source => source.status === 'FAILED') ? 'A discovery source was unavailable. See Discovery for its latest status.' : undefined);
        else try {
          if (job.stage === 'RESOLVING') {
            const { checkpoint, done } = await resolveBusiness(web, job, signal);
            await saveStage(pool, run, job, checkpoint, done ? decide(checkpoint.gates, checkpoint.evidence) : 'INVESTIGATING');
          } else if (job.stage === 'INVESTIGATING') {
            const { checkpoint, artifacts } = await investigate(web, job, run.config, signal);
            await saveStage(pool, run, job, checkpoint, checkpoint.gates.some(gate => gate.state === 'CONTRADICTED')
              ? decide(checkpoint.gates, checkpoint.evidence) : 'VERIFYING', artifacts);
          } else {
            const publications = await enrichAcquisition(web, job, run.config, signal);
            const checkpoint = await verifyOpportunity(web, job, signal);
            await modelAdvisory(pool, run, job, checkpoint, signal);
            await saveStage(pool, run, job, checkpoint, decide(checkpoint.gates, checkpoint.evidence), [], publications);
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
