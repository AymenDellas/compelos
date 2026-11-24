import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { modelAdvisory, readOrReserve } from '../../src/lib/origin/model';
import { decide, defaults, emptyCheckpoint, finding, gateNames, observe } from '../../src/lib/origin/policy';
import { businessSearchName } from '../../src/lib/origin/business-search';
import { publicOfferSource } from '../../src/lib/origin/public-discovery';
import { createPublicWeb, PublicFailure } from '../../src/lib/origin/public-web';
import { artifact, dossier, overview, readyOpportunities, runSummary } from '../../src/lib/origin/read-model';
import { claimRun, control, existingDiscoveryDomains, finish, migrate, nextJob, recentPublisherEvidence, release, runSearch, saveDiscovery, saveSettings, saveStage, start } from '../../src/lib/origin/store';
import { createOriginLane } from '../../src/lib/origin/worker';
import { fixture, official, page, seed, source } from './fixtures';

test('PostgreSQL fences interrupted stages, deduplicates identities, enforces budgets and serves only current qualified opportunities', {
  skip: process.env.ORIGIN_TEST_POSTGRES !== '1', timeout: 120_000,
}, async () => {
  const connection = { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 };
  const admin = new Pool(connection);
  const name = `origin_fixture_${randomBytes(8).toString('hex')}`;
  const pool = new Pool({ ...connection, options: `-c search_path=${name}` });
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA ${name}`);
    created = true;
    await migrate(pool);
    await migrate(pool);
    await pool.query('CREATE TABLE leads (id text PRIMARY KEY, website text, do_not_contact boolean)');
    await saveSettings(pool, { ...defaults, modelCalls: 3, runBudgetCents: 2, intervalMinutes: 180 });
    const [id, duplicate] = await Promise.all([start(pool), start(pool)]);
    assert.equal([id, duplicate].filter(Boolean).length, 1);
    const run = (await claimRun(pool))!;
    assert.ok(run);
    assert.equal(await claimRun(pool), null);
    let searches = 0;
    const search = async () => { searches++; return ['https://coach.test/']; };
    assert.deepEqual(await runSearch(pool, run, 'fixture:1', search), ['https://coach.test/']);
    assert.deepEqual(await runSearch(pool, run, 'fixture:1', search), ['https://coach.test/']);
    await assert.rejects(runSearch(pool, run, 'fixture:2', async () => { searches++; throw new Error('Response lost'); }), /Response lost/);
    assert.equal(await runSearch(pool, run, 'fixture:2', search), undefined);
    assert.equal(searches, 2);
    const wikidata = { ...seed, method: 'Wikidata' as const, sourceKey: 'wikidata:Q12345' };
    const publisher = { ...source('publisher-two.test', 'board development'), permission: 'https://publisher-two.test/terms' };
    await saveDiscovery(pool, run, [wikidata, publisher,
      { ...wikidata, website: 'https://new-cedar.test/' }], [{ adapter: 'fixture', status: 'OK', elapsedMs: 1, discovered: 3 }]);
    const job = await nextJob(pool, run);
    assert.ok(job);
    assert.equal(job.seeds.length, 3);
    assert.deepEqual(await recentPublisherEvidence(pool, 90), [publisher]);
    assert.equal((await pool.query('SELECT 1 FROM origin_businesses')).rowCount, 1);
    assert.equal(await control(pool, run.id, 'pause'), true);
    assert.equal(await control(pool, run.id, 'resume'), true);
    assert.equal(await runSearch(pool, run, 'fixture:3', search), undefined);
    assert.equal(await saveStage(pool, run, job, emptyCheckpoint(), 'INVESTIGATING'), null);
    await pool.query("UPDATE origin_runs SET lease_until=now()-interval '1 second' WHERE id=$1", [run.id]);
    const recovered = (await claimRun(pool))!;
    assert.notEqual(recovered.lease, run.lease);
    await release(pool, run);
    assert.equal(await claimRun(pool), null);
    assert.equal((await nextJob(pool, recovered))?.stage, 'RESOLVING');
    assert.ok(await readOrReserve(pool, recovered, job, 'fixture-model', 2, 'keyA', 30));
    assert.equal(await readOrReserve(pool, recovered, job, 'fixture-model', 1, 'keyB', 30), null);
    await pool.query("UPDATE origin_model_usage SET status='OK', created_at=now()-interval '2 minutes'");
    assert.equal(await readOrReserve(pool, recovered, job, 'fixture-model', 1, 'keyB', 30), null);
    const evidence = observe('official', official, 'Fixture', 'Fixture');
    const checkpoint = { ...emptyCheckpoint(), country: 'UK' as const, offer: 'Executive coaching',
      contact: 'vendors@cedar-leadership.test', acquisitionSources: 2, evidence: [evidence],
      gates: gateNames.map(name => finding(name, 'VERIFIED', 'Fixture qualifying evidence.', [evidence])) };
    const decision = decide(checkpoint.gates, checkpoint.evidence);
    const image = Buffer.from('fixture image bytes');
    await saveStage(pool, recovered, job, checkpoint, decision, [{ id: evidence.id, url: official, device: 'desktop', digest: evidence.digest, image }]);
    assert.equal((await readyOpportunities(pool))[0].business_id, job.business_id);
    assert.equal((await dossier(pool, job.id))?.decision?.outcome, 'QUALIFIED');
    assert.deepEqual(await artifact(pool, job.id, evidence.id), image);
    const { usage, sources, runs, savedOpportunities } = await overview(pool);
    assert.equal(usage.reserved_cents, 2);
    assert.equal(usage.provider_cents, null);
    assert.equal(sources[0].discovered, 3);
    assert.equal(runs[0].counts.QUALIFIED, 1);
    assert.deepEqual(savedOpportunities, []);
    assert.equal((await dossier(pool, job.id))?.evidence_current, true);
    await pool.query('INSERT INTO leads VALUES ($1,$2,TRUE)', ['existing', official]);
    assert.equal((await readyOpportunities(pool)).length, 0);
    assert.equal((await dossier(pool, job.id))?.suppressed, true);
    await pool.query('UPDATE leads SET do_not_contact=false');
    await pool.query("UPDATE origin_investigations SET expires_at=now()-interval '1 second'");
    assert.equal((await readyOpportunities(pool)).length, 0);
    const expired = await overview(pool);
    assert.deepEqual(expired.opportunities, []);
    assert.deepEqual(expired.savedOpportunities.map(item => item.id), [job.id]);
    assert.equal((await dossier(pool, job.id))?.evidence_current, false);
    await pool.query('UPDATE leads SET do_not_contact=true');
    assert.deepEqual((await overview(pool)).savedOpportunities, []);
    await pool.query('UPDATE leads SET do_not_contact=false');
    await finish(pool, recovered);
    assert.equal((await overview(pool)).runs[0].state, 'COMPLETED');

    // Simulate an older decision with no explicit start marker and a stored identity key.
    await pool.query(`UPDATE origin_investigations SET processing_started_at=NULL, updated_at=now()-interval '90 days',
      expires_at=now()+interval '1 hour' WHERE id=$1`, [job.id]);

    await saveSettings(pool, { ...defaults, modelCalls: 3, runBudgetCents: 5 });
    await start(pool, { candidateLimit: 2 });
    const metered = (await claimRun(pool))!;
    const repeat = { ...seed, website: 'https://www.cedar-leadership.test./coaching', sourceKey: 'new-publisher:cedar' };
    const changedSite = { ...wikidata, website: 'https://moved-cedar.test/', source: 'https://www.wikidata.org/wiki/Q12345?oldid=2' };
    const discovered = (host: string) => ({ ...seed, method: 'BUSINESS_SEARCH' as const, website: `https://${host}/`, sourceKey: `search:${host}` });
    const started = discovered('fern-leadership.test');
    const untouched = discovered('maple-leadership.test');
    await saveDiscovery(pool, metered, [repeat, discovered('moved-cedar.test'), changedSite, started, untouched, discovered('overflow.test')], []);
    assert.deepEqual((await runSummary(pool, metered.id)).counts, { RESOLVING: 2 });
    await pool.query(`INSERT INTO origin_investigations(id,run_id,business_id,seeds,stage,checkpoint)
      VALUES($1,$2,$3,'[]','RESOLVING',$4)`, [randomUUID(), metered.id, job.business_id, JSON.stringify(emptyCheckpoint())]);
    const secondJob = await nextJob(pool, metered);
    assert.ok(secondJob);
    assert.equal(secondJob.domain, 'fern-leadership.test');
    assert.deepEqual((await runSummary(pool, metered.id)).counts, { RESOLVING: 2, SKIPPED: 1 });
    assert.equal((await readyOpportunities(pool))[0].id, job.id);
    const advisory = { ...checkpoint, breakage: { url: `${official}booking`, from: official, label: 'Book a call', status: 404, evidence: evidence.id, alternatives: false } };
    const fixtureModel = { config: { apiKey: 'fixture', model: 'fixture-model', baseUrl: 'https://example.test/v1', timeoutMs: 100 }, ceiling: 1 };
    await modelAdvisory(pool, metered, secondJob, advisory, AbortSignal.timeout(3_000), (_, hooks) => async (_system, input) => {
      assert.doesNotMatch(input, /cedar|https|vendors/);
      hooks?.onResponse(402, '60');
      throw new Error('unavailable');
    }, fixtureModel);
    assert.equal((await overview(pool)).usage.last_status, 'QUOTA');
    assert.equal(await readOrReserve(pool, metered, secondJob, 'fixture-model', 1, 'different', 30), null);
    assert.equal(decide(advisory.gates, advisory.evidence).outcome, 'QUALIFIED');

    assert.ok(await control(pool, metered.id, 'cancel'));
    await start(pool, { candidateLimit: 1 });
    const later = (await claimRun(pool))!;
    await saveDiscovery(pool, later, [started, untouched], []);
    assert.deepEqual((await runSummary(pool, later.id)).counts, { RESOLVING: 1 });
    assert.equal((await nextJob(pool, later))?.domain, 'maple-leadership.test');
    assert.ok(await control(pool, later.id, 'cancel'));

    // Two duplicate-only refill batches leave the queue at 66. A later batch
    // must still fill all 72 slots with distinct businesses after a restart.
    const refillId = (await start(pool, { candidateLimit: 72 }))!;
    const limit = async <T>(fn: () => Promise<T>) => fn();
    const requested: number[] = [];
    const web = createPublicWeb(limit, async () => { throw new PublicFailure('FIXTURE_UNAVAILABLE'); });
    const initialHosts = Array.from({ length: 15 }, (_, index) => Array.from({ length: index < 6 ? 5 : 4 },
      (_, position) => `refill-${index}-${position}.test`));
    const finalHosts = Array.from({ length: 3 }, (_, index) => [`last-${index}-one.test`, `last-${index}-two.test`]);
    const laneOptions = { runId: refillId, web, businessSearch: async (index: number) => {
      requested.push(index);
      const fresh = initialHosts[index] ?? finalHosts[index - 21] ?? [];
      return [repeat, started, untouched, ...fresh.map(discovered),
        ...(index >= 15 ? [discovered(initialHosts[0][0])] : []),
        ...(index === 23 ? [discovered('refill-overflow.test')] : [])];
    } };
    const initialLane = createOriginLane(pool, limit, laneOptions);
    assert.equal(await initialLane.runOnce(), true);
    initialLane.stop();
    assert.equal((await runSummary(pool, refillId)).discovery_pending, true);
    assert.deepEqual((await runSummary(pool, refillId)).counts, { RESOLVING: 66 });
    assert.ok(await control(pool, refillId, 'pause'));
    assert.ok(await control(pool, refillId, 'resume'));
    const refillLane = createOriginLane(pool, limit, laneOptions);
    for (let round = 0; round < 2; round++) {
      assert.equal(await refillLane.runOnce(), true);
      const partial = await runSummary(pool, refillId);
      assert.equal(partial.discovery_pending, true);
      assert.deepEqual(partial.counts, { RESOLVING: 66 });
    }
    const interruptedRefill = (await claimRun(pool, refillId))!;
    await runSearch(pool, interruptedRefill, `${businessSearchName}:21`, () => laneOptions.businessSearch(21));
    await release(pool, interruptedRefill);
    assert.equal(await refillLane.runOnce(), true);
    refillLane.stop();
    const refilled = await runSummary(pool, refillId);
    assert.equal(refilled.candidate_target, 72);
    assert.equal(refilled.discovery_pending, false);
    assert.deepEqual(refilled.counts, { RESOLVING: 72 });
    assert.deepEqual(requested.sort((a, b) => a - b), Array.from({ length: 24 }, (_, index) => index));
    assert.equal(refilled.sources?.find(item => item.adapter === businessSearchName)?.searchAttempts, 24);
    const { rows } = await pool.query(`SELECT domain FROM origin_businesses b JOIN origin_investigations j ON b.id=j.business_id
      WHERE j.run_id=$1 ORDER BY j.discovery_order`, [refillId]);
    assert.deepEqual(rows.map(row => row.domain).sort(), [...initialHosts.flat(), ...finalHosts.flat()].sort());
    assert.ok(await control(pool, refillId, 'cancel'));

    // A source with only previous hits uses the bounded allowance and then
    // reports a shortfall without queueing any previously investigated business.
    const exhaustedId = (await start(pool, { candidateLimit: 36 }))!;
    const exhaustedLane = createOriginLane(pool, limit, {
      runId: exhaustedId, web, businessSearch: async () => [repeat, started, untouched],
    });
    for (let round = 0; round < 5; round++) assert.equal(await exhaustedLane.runOnce(), true);
    exhaustedLane.stop();
    const exhausted = await runSummary(pool, exhaustedId);
    assert.equal(exhausted.state, 'COMPLETED');
    assert.equal(exhausted.discovery_pending, false);
    assert.deepEqual(exhausted.counts, {});
    assert.equal(exhausted.sources?.find(item => item.adapter === businessSearchName)?.searchAttempts, 26);
  } finally {
    await pool.end();
    if (created) await admin.query(`DROP SCHEMA ${name} CASCADE`);
    await admin.end();
  }
});

test('resetting review history releases old businesses once and keeps their saved dossiers', {
  skip: process.env.ORIGIN_TEST_POSTGRES !== '1', timeout: 120_000,
}, async () => {
  const connection = { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 };
  const admin = new Pool(connection);
  const name = `origin_reset_${randomBytes(8).toString('hex')}`;
  const pool = new Pool({ ...connection, options: `-c search_path=${name}` });
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA ${name}`);
    created = true;
    await migrate(pool);
    const host = new URL(official).hostname;
    await start(pool, { candidateLimit: 1 });
    const prior = (await claimRun(pool))!;
    await saveDiscovery(pool, prior, [seed], []);
    const oldJob = (await nextJob(pool, prior))!;
    const offer = { ...seed, method: 'PUBLIC_OFFER' as const, website: `${official}new-program`, sourceKey: 'fresh-offer' };
    const evidence = observe('official', offer.website, 'Fixture program', 'Offer heading');
    const qualified = { ...emptyCheckpoint(), country: 'UK' as const, evidence: [evidence],
      gates: gateNames.map(name => finding(name, 'VERIFIED', 'Fixture verified requirement', [evidence])) };
    await saveStage(pool, prior, oldJob, qualified, decide(qualified.gates, qualified.evidence));
    await finish(pool, prior);

    const id = (await start(pool, { candidateLimit: 1 }))!;
    assert.deepEqual(await existingDiscoveryDomains(pool, id, [host]), new Set([host]));
    await pool.query('UPDATE origin_settings SET dedup_reset_at=clock_timestamp() WHERE id=1');
    assert.deepEqual(await existingDiscoveryDomains(pool, id, [host]), new Set());
    const { web } = fixture(page.replace('<title>', '<meta property="og:site_name" content="Cedar Leadership"><title>'));
    const unexpectedIndex = async () => { assert.fail('The first round should use saved first-party offers.'); };
    const lane = createOriginLane(pool, async work => work(), { runId: id, web: { ...web, api: unexpectedIndex, publicSearch: unexpectedIndex } });
    assert.equal(await lane.runOnce(), true);
    assert.equal((await runSummary(pool, id)).sources?.[0].adapter, 'Saved coach offers');
    lane.stop();
    const current = (await claimRun(pool, id))!;
    const newJob = (await nextJob(pool, current))!;
    assert.equal(newJob.business_id, oldJob.business_id);
    assert.equal(newJob.website, offer.website);
    assert.equal(newJob.seeds.length, 1);
    assert.deepEqual(await existingDiscoveryDomains(pool, id, [host]), new Set([host]));
    assert.deepEqual((await readyOpportunities(pool)).map(item => item.id), [oldJob.id]);
    await saveStage(pool, current, newJob, qualified, decide(qualified.gates, qualified.evidence));
    await finish(pool, current);
    assert.equal((await dossier(pool, oldJob.id))?.decision?.outcome, 'QUALIFIED');

    const later = (await start(pool, { candidateLimit: 1 }))!;
    assert.deepEqual(await existingDiscoveryDomains(pool, later, [host]), new Set([host]));
    const next = (await claimRun(pool, later))!;
    await saveDiscovery(pool, next, [offer], []);
    assert.equal(await nextJob(pool, next), undefined);
    await pool.query(`UPDATE origin_investigations SET review_policy='origin-v7',decision=jsonb_set(decision,'{version}','"origin-v7"') WHERE id=$1`, [newJob.id]);
    assert.deepEqual(await existingDiscoveryDomains(pool, later, [host]), new Set());
    assert.deepEqual((await overview(pool)).savedOpportunities.map(item => item.id), [newJob.id]);
  } finally {
    await pool.end();
    if (created) await admin.query(`DROP SCHEMA ${name} CASCADE`);
    await admin.end();
  }
});

test('the qualified target carries across batches and stops on the third current opportunity', {
  skip: process.env.ORIGIN_TEST_POSTGRES !== '1', timeout: 120_000,
}, async () => {
  const connection = { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 };
  const admin = new Pool(connection);
  const name = `origin_target_${randomBytes(8).toString('hex')}`;
  const pool = new Pool({ ...connection, options: `-c search_path=${name}` });
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA ${name}`);
    created = true;
    await migrate(pool);
    await pool.query('CREATE TABLE leads (id text PRIMARY KEY, website text, do_not_contact boolean)');
    const discovered = (label: string) => ({ ...seed, name: label, method: 'BUSINESS_SEARCH' as const,
      website: `https://${label}.test/`, source: `https://${label}.test/`, sourceKey: `search:${label}` });
    const incomplete = discovered('incomplete');
    const suppressed = discovered('suppressed');
    const [first, second, third, unused] = ['one', 'two', 'three', 'four'].map(discovered);
    const historical = discovered('historical');
    const completed = (verified: boolean) => {
      const proof = observe('official', official, 'Fixture evidence', 'Fixture observation');
      return { ...emptyCheckpoint(), evidence: verified ? [proof] : [],
        gates: verified ? gateNames.map(gate => finding(gate, 'VERIFIED', 'Fixture verified requirement', [proof])) : [] };
    };
    const save = async (expected: string, verified: boolean, throughInvestigation = false) => {
      const run = (await claimRun(pool))!;
      const job = (await nextJob(pool, run))!;
      assert.equal(job.domain, new URL(expected).hostname);
      const checkpoint = completed(verified);
      if (throughInvestigation) {
        await saveStage(pool, run, job, emptyCheckpoint(), 'INVESTIGATING');
        assert.equal((await nextJob(pool, run))?.id, job.id);
      }
      await saveStage(pool, run, job, checkpoint, decide(checkpoint.gates, checkpoint.evidence));
      await release(pool, run);
    };

    await start(pool, { candidateLimit: 1 });
    const prior = (await claimRun(pool))!;
    await saveDiscovery(pool, prior, [historical], []);
    await release(pool, prior);
    await save(historical.website, true);
    const priorFinish = (await claimRun(pool))!;
    await finish(pool, priorFinish);
    await pool.query('INSERT INTO leads VALUES ($1,$2,TRUE)', ['fixture-suppression', suppressed.website]);

    const id = (await start(pool, { candidateLimit: 2, qualifiedTarget: 3 }))!;
    const limit = async <T>(fn: () => Promise<T>) => fn();
    const web = createPublicWeb(limit, async () => { throw new PublicFailure('FIXTURE_UNAVAILABLE'); });
    const issued: number[] = [];
    const options = { runId: id, web, businessSearch: async (index: number) => {
      issued.push(index);
      if (index < 3) return [historical, incomplete, suppressed];
      if (index < 6) return [incomplete, first, second];
      return [first, third, unused];
    } };
    const lane = createOriginLane(pool, limit, options);
    assert.equal(await lane.runOnce(), true);
    assert.equal((await runSummary(pool, id)).qualified_progress, 0);
    await save(incomplete.website, false, true);
    await save(suppressed.website, true);
    assert.deepEqual((await runSummary(pool, id)).counts, { UNRESOLVED: 1, REJECTED: 1 });
    assert.equal(await lane.runOnce(), true);
    assert.equal((await runSummary(pool, id)).batch_number, 2);
    assert.equal((await runSummary(pool, id)).discovery_pending, true);
    assert.ok(await control(pool, id, 'pause'));
    assert.ok(await control(pool, id, 'resume'));
    lane.stop();

    const restarted = createOriginLane(pool, limit, options);
    assert.equal(await restarted.runOnce(), true);
    await save(first.website, true, true);
    await save(second.website, true);
    assert.equal((await runSummary(pool, id)).qualified_progress, 2);
    await pool.query("UPDATE origin_runs SET deadline_at=now()-interval '1 second' WHERE id=$1", [id]);
    const elapsed = await runSummary(pool, id);
    assert.equal(elapsed.state, 'PAUSED');
    assert.equal(elapsed.qualified_progress, 2);
    assert.match(elapsed.error ?? '', /Time budget elapsed/);
    assert.equal((await pool.query('SELECT state FROM origin_runs WHERE id=$1', [id])).rows[0].state, 'RUNNING');
    assert.ok(await control(pool, id, 'resume'));
    const renewed = await claimRun(pool, id);
    assert.ok(renewed && renewed.deadline_at.getTime() > Date.now());
    assert.equal(renewed.config.qualifiedTarget, 3);
    assert.equal((await runSummary(pool, id)).error, null);
    await release(pool, renewed);
    assert.equal(await restarted.runOnce(), true);
    assert.equal((await runSummary(pool, id)).batch_number, 3);
    const emptyBatch = (await claimRun(pool, id))!;
    await saveDiscovery(pool, emptyBatch, [], [{ adapter: businessSearchName, status: 'OK', discovered: 0,
      elapsedMs: 1, queryIndex: 8, searches: 3, searchAttempts: 3 }]);
    await release(pool, emptyBatch);
    assert.equal(await restarted.runOnce(), true);
    const continuing = await runSummary(pool, id);
    assert.equal(continuing.state, 'RUNNING');
    assert.equal(continuing.batch_number, 3);
    assert.equal(continuing.qualified_progress, 2);
    assert.equal(continuing.discovery_pending, true);
    assert.equal(await restarted.runOnce(), true);
    await save(third.website, true);
    const final = await runSummary(pool, id);
    assert.equal(final.state, 'COMPLETED');
    assert.equal(final.qualified_progress, 3);
    assert.deepEqual(final.counts, { UNRESOLVED: 1, REJECTED: 1, QUALIFIED: 3, SKIPPED: 1 });
    assert.equal((await readyOpportunities(pool, 10, id)).length, 3);
    assert.deepEqual(issued.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 9, 10, 11]);
    assert.equal(await restarted.runOnce(), false);
    restarted.stop();

    const laterId = (await start(pool, { candidateLimit: 1 }))!;
    const later = (await claimRun(pool, laterId))!;
    await saveDiscovery(pool, later, [first, unused], []);
    assert.equal((await nextJob(pool, later))?.domain, 'four.test');
    assert.ok(await control(pool, laterId, 'cancel'));

    const emptyId = (await start(pool, { qualifiedTarget: 3 }))!;
    const emptyLane = createOriginLane(pool, limit, { runId: emptyId, web });
    assert.equal(await emptyLane.runOnce(), true);
    assert.equal((await runSummary(pool, emptyId)).discovery_pending, true);
    assert.equal(await emptyLane.runOnce(), true);
    assert.equal(await emptyLane.runOnce(), true);
    emptyLane.stop();
    const outage = await runSummary(pool, emptyId);
    assert.equal(outage.state, 'FAILED');
    assert.equal(outage.qualified_progress, 0);
    assert.equal(outage.sources?.[0].searchAttempts, 6);
    assert.match(outage.error ?? '', /search sources could not be reached/);

    const shortfallId = (await start(pool, { qualifiedTarget: 1 }))!;
    const shortfallRun = (await claimRun(pool, shortfallId))!;
    await saveDiscovery(pool, shortfallRun, [], [{ adapter: publicOfferSource, status: 'OK', discovered: 0,
      elapsedMs: 1, queryIndex: 80, searchAttempts: 24, searches: 24 }]);
    await release(pool, shortfallRun);
    const cedar = fixture(page.replace('<title>', '<meta property="og:site_name" content="Cedar Leadership"><title>'));
    const queries: string[] = [];
    const readerPages: string[] = [];
    const publicWeb = { ...cedar.web,
      async publicSearch(query: string) {
        queries.push(query);
        return { results: { web: { results: [{ url: official, title: 'Cedar Leadership executive coaching program' }] } } };
      },
      async api(url: string) {
        readerPages.push(url);
        return { posts: [] };
      },
    };
    const shortfallLane = createOriginLane(pool, limit, { runId: shortfallId, web: publicWeb });
    assert.equal(await shortfallLane.runOnce(), true);
    const shortfall = await runSummary(pool, shortfallId);
    assert.equal(shortfall.state, 'RUNNING');
    assert.equal(shortfall.batch_number, 1);
    assert.equal(shortfall.qualified_progress, 0);
    assert.equal(shortfall.error, null);
    assert.equal(await shortfallLane.runOnce(), true);
    assert.equal(await shortfallLane.runOnce(), true);
    assert.equal(await shortfallLane.runOnce(), true);
    assert.equal(await shortfallLane.runOnce(), false);
    shortfallLane.stop();
    assert.equal((await runSummary(pool, shortfallId)).qualified_progress, 1);
    assert.equal((await runSummary(pool, shortfallId)).state, 'COMPLETED');
    assert.equal((await readyOpportunities(pool, 10, shortfallId))[0]?.name, 'Jamie Cedar');
    assert.deepEqual(queries.map(query => query.match(/"(Chicago|London)"/)?.[1]), ['Chicago', 'London']);
    assert.equal(readerPages.length, 1);
    assert.ok(new URL(readerPages[0]).searchParams.has('before'));

    await pool.query("UPDATE origin_runs SET state='FAILED',error=$2,qualified_at_stop=0 WHERE id=$1", [shortfallId,
      'Search sources returned no new businesses before the qualified target was reached.']);
    const historicalShortfall = await runSummary(pool, shortfallId);
    assert.equal(historicalShortfall.state, 'COMPLETED');
    assert.equal(historicalShortfall.error, null);

  } finally {
    await pool.end();
    if (created) await admin.query(`DROP SCHEMA ${name} CASCADE`);
    await admin.end();
  }
});
