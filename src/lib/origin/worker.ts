import type { Pool } from 'pg';
import { discoverPublicationPointers, gdeltCredits, publicationAdapter, verifyPublications } from './auto-publishers';
import { activitySearchName, businessSearchCredit, businessSearchName, campaignSearchName, createActivitySearch, createBusinessSearch, createCampaignSearch, createEvidenceFollowUp } from './business-search';
import { discover, feed, niches, wikidata } from './discovery';
import type { Adapter } from './discovery';
import { modelAdvisory } from './model';
import { decide, domain } from './policy';
import type { PublisherPointer, Seed, SourceResult } from './policy';
import { createPublicWeb } from './public-web';
import type { PublicWeb } from './public-web';
import { hasSchema } from './read-model';
import { coachingContracts, procurementAdapter, procurementCredit, tenderAdapter } from './procurement';
import { enrichAcquisition, enrichCommercial, investigate, resolveBusiness, verifyOpportunity } from './research';
import { approvedFeeds } from './sources';
import { claimRun, failStage, finish, migrate, newPublishedBusinesses, nextJob, recentPublisherEvidence, release, runSearch, saveDiscovery, saveStage, sourceHistory, sourceQuality } from './store';
import type { Run, SourceQuality } from './store';

type Limiter = <T>(run: () => Promise<T>) => Promise<T>;

function chooseSource(history: SourceResult[], quality: SourceQuality[], names: string[], explore: boolean) {
  const cutoff = 50;
  return names.map(name => {
    const observations = history.filter(item => item.adapter === name).slice(0, cutoff);
    const verified = quality.find(item => item.adapter === name);
    // Reward qualified dossiers and confirmed offers ahead of identity-only matches.
    const yieldPerSecond = ((verified?.qualified ?? 0) * 8 + (verified?.offers ?? 0) * 3 + (verified?.identities ?? 0)) /
      Math.max(1, observations.reduce((sum, item) => sum + Math.max(500, item.elapsedMs), 0) / 1000);
    return { name, attempts: observations.filter(item => item.status !== 'DEFERRED').length, yieldPerSecond };
  }).sort((a, b) => explore ? a.attempts - b.attempts : b.yieldPerSecond - a.yieldPerSecond || a.attempts - b.attempts)[0]?.name;
}

export function createOriginLane(pool: Pool, limitRequest: Limiter, options: { runId?: string; web?: PublicWeb } = {}) {
  const shutdown = new AbortController();
  const web = options.web ?? createPublicWeb(limitRequest);
  const search = options.web ? undefined : createBusinessSearch();
  const activitySearch = options.web ? undefined : createActivitySearch();
  const campaignSearch = options.web ? undefined : createCampaignSearch();
  const followUp = options.web ? undefined : createEvidenceFollowUp();
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
    const batch = <T,>(name: string, count: number, lookup: (index: number, signal: AbortSignal) => Promise<T[]>,
      reduce: (results: T[][]) => ReturnType<Adapter['run']>) => {
      const previous = history.find(item => item.adapter === name && item.queryIndex !== undefined)?.queryIndex ?? -1;
      const adapter: Adapter = { name, credit: businessSearchCredit, queryIndex: previous + count, retryAt: hold(name), run: async () => {
        const results: T[][] = [];
        for (let start = 1; start <= count && !signal.aborted; start += 3) {
          const keys = Array.from({ length: Math.min(count - start + 1, 3) }, (_, index) => previous + start + index);
          const queries = await Promise.allSettled(keys.map(index => limitRequest(() => runSearch(pool, run, `${name}:${index}`,
            () => lookup(index, perSource(signal, 14_000))))));
          for (const outcome of queries) if (outcome.status === 'fulfilled' && outcome.value) results.push(outcome.value);
          const failure = queries.find(outcome => outcome.status === 'rejected');
          if (failure) {
            if (!results.length) throw failure.reason;
            break;
          }
        }
        adapter.searches = results.length;
        return reduce(results);
      } };
      adapters.push(adapter);
    };
    const ranked = async (groups: Seed[][]) => Array.from({ length: 10 }, (_, index) => groups.flatMap(group => group[index] ? [group[index]] : []))
      .flat();
    if (search) {
      batch(businessSearchName, Math.max(3, Math.ceil(limit / 5)), (index, requestSignal) => search(index, 10, requestSignal), ranked);
    }
    if (campaignSearch) batch(campaignSearchName, Math.max(2, Math.ceil(limit / 12)),
      (index, requestSignal) => campaignSearch(index, run.config.activityDays, requestSignal), ranked);
    if (activitySearch) {
      batch<PublisherPointer>(activitySearchName, 2, (index, requestSignal) => activitySearch(index, run.config.activityDays, requestSignal),
        groups => verifyPublications(web, groups.flat(), run.config.activityDays, perSource(signal, 20_000), 10));
    }
    for (const [index, name] of [['contracts', procurementAdapter], ['tender', tenderAdapter]] as const) {
      const probes = history.filter(item => item.adapter === name && item.status === 'OK').length;
      adapters.push({ name, credit: procurementCredit, retryAt: hold(name),
        run: () => coachingContracts(web, index, (probes % 12) * 6, limit, perSource(signal, 17_000)) });
    }
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
        return seed.publication?.use === 'FACTS_ONLY' && age >= 0 && age < 86_400_000 ? [seed] : [];
      }
      const publisher = feeds.find(item => domain(item.url) === domain(seed.source) && item.permission === seed.permission);
      return publisher ? [{ ...seed, publisher: publisher.publisher ?? domain(publisher.url) }] : [];
    };
    adapters.push({ name: 'Publisher relationships', run: async () => (await newPublishedBusinesses(pool, limit * 2)).flatMap(seed => {
      const date = Date.parse(seed.occurredAt ?? '');
      return date <= Date.now() && date > Date.now() - run.config.activityDays * 86_400_000
        ? publisherObservation(seed).map(item => ({ ...item, adapter: 'Publisher relationships' })) : [];
    }) });
    const latestWikiHold = history.find(item => item.adapter.startsWith('Wikidata') && item.retryAt && Date.parse(item.retryAt) > Date.now())?.retryAt;
    adapters.push({ name: `Wikidata · ${strategy}`, retryAt: latestWikiHold,
      run: () => wikidata(web, Math.min(24, limit * 3), strategy, perSource(signal, 18_000)) });
    const historic = (await recentPublisherEvidence(pool, run.config.activityDays)).flatMap(seed => {
      const occurred = Date.parse(seed.occurredAt ?? '');
      return occurred <= Date.now() && occurred >= Date.now() - run.config.activityDays * 86_400_000 ? publisherObservation(seed) : [];
    });
    // PostgreSQL applies the candidate cap after excluding previously processed businesses.
    const found = await discover(adapters, undefined, historic);
    signal.throwIfAborted();
    await saveDiscovery(pool, run, found.seeds, found.results);
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
      if (!run.sources) {
        try { await discovery(run, signal); }
        catch (error) { if (!signal.aborted) throw error; }
      }
      else {
        const job = await nextJob(pool, run);
        if (!job) await finish(pool, run, run.sources.every(source => source.status !== 'OK' || !source.discovered) &&
          run.sources.some(source => source.status === 'FAILED') ? 'A discovery source was unavailable. See Discovery for its latest status.' : undefined);
        else try {
          const startedAt = Date.now();
          if (job.stage === 'RESOLVING') {
            const { checkpoint, done } = await resolveBusiness(web, job, signal);
            checkpoint.stageMs = { ...checkpoint.stageMs, resolve: Date.now() - startedAt };
            await saveStage(pool, run, job, checkpoint, done ? decide(checkpoint.gates, checkpoint.evidence) : 'INVESTIGATING');
          } else if (job.stage === 'INVESTIGATING') {
            const { checkpoint, artifacts } = await investigate(web, job, run.config, signal, !options.web);
            checkpoint.stageMs = { ...checkpoint.stageMs, investigate: Date.now() - startedAt };
            await saveStage(pool, run, job, checkpoint, checkpoint.gates.some(gate => gate.state === 'CONTRADICTED')
              ? decide(checkpoint.gates, checkpoint.evidence) : 'VERIFYING', artifacts);
          } else {
            const publications = await enrichAcquisition(web, job, run.config, signal);
            const checkpoint = await verifyOpportunity(web, job, signal, run.config.browser);
            await modelAdvisory(pool, run, job, checkpoint, signal);
            const passed = new Set(checkpoint.gates.filter(item => item.state === 'VERIFIED').map(item => item.name));
            const suggestion = checkpoint.advisory?.assessment;
            const purpose = !passed.has('substance') && (suggestion === 'VERIFY_COMMERCIAL_EVIDENCE' || passed.has('opportunity')) ? 'case' :
              !passed.has('acquisition') && (suggestion === 'VERIFY_ACQUISITION_ACTIVITY' || passed.has('substance') || passed.has('contact')) ? 'campaign' : null;
            if (followUp && purpose && !signal.aborted && passed.has('niche') && passed.has('geography')) {
              try {
                const evidenceBudget = perSource(signal, 16_000);
                const urls = await limitRequest(() => runSearch(pool, run, `follow-up:${purpose}:${job.domain}`, () => followUp(job.domain, run.config.activityDays, purpose, evidenceBudget)));
                if (urls?.length && purpose === 'campaign') await enrichAcquisition(web, { ...job, seeds: [...job.seeds, ...publications] }, run.config, evidenceBudget, urls);
                if (urls?.length && purpose === 'case') await enrichCommercial(web, job, urls, evidenceBudget);
              } catch { /* Retain the checkpoint when a bounded follow-up is unavailable. */ }
            }
            checkpoint.stageMs = { ...checkpoint.stageMs, verify: Date.now() - startedAt };
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
