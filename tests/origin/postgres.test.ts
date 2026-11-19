import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { modelAdvisory, readOrReserve } from '../../src/lib/origin/model';
import { decide, defaults, emptyCheckpoint, finding, gateNames, observe } from '../../src/lib/origin/policy';
import { artifact, dossier, overview, readyOpportunities } from '../../src/lib/origin/read-model';
import { claimRun, control, finish, migrate, nextJob, recentPublisherEvidence, release, revisit, runSearch, saveDiscovery, saveSettings, saveStage, start } from '../../src/lib/origin/store';
import { official, seed, source } from './fixtures';

test('PostgreSQL fences interrupted stages, deduplicates identities, enforces budgets and serves only current qualified opportunities', {
  skip: process.env.ORIGIN_TEST_POSTGRES !== '1', timeout: 75_000,
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
    assert.equal((await nextJob(pool, recovered)).stage, 'RESOLVING');
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
    const { usage, sources, runs } = await overview(pool);
    assert.equal(usage.reserved_cents, 2);
    assert.equal(usage.provider_cents, null);
    assert.equal(sources[0].discovered, 3);
    assert.equal(runs[0].counts.QUALIFIED, 1);
    await pool.query('INSERT INTO leads VALUES ($1,$2,TRUE)', ['existing', official]);
    assert.equal((await readyOpportunities(pool)).length, 0);
    assert.equal((await dossier(pool, job.id))?.suppressed, true);
    await pool.query('UPDATE leads SET do_not_contact=false');
    await pool.query("UPDATE origin_investigations SET expires_at=now()-interval '1 second'");
    assert.equal((await readyOpportunities(pool)).length, 0);
    await finish(pool, recovered);
    assert.equal((await overview(pool)).runs[0].state, 'COMPLETED');

    await saveSettings(pool, { ...defaults, modelCalls: 3, runBudgetCents: 5 });
    await start(pool);
    const metered = (await claimRun(pool))!;
    await saveDiscovery(pool, metered, [seed], []);
    const secondJob = await nextJob(pool, metered);
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

    const needsIntake = { ...checkpoint, funnel: { found: 1, tested: 1, interactive: true },
      gates: checkpoint.gates.map(gate => gate.name === 'opportunity' ? finding('opportunity', 'UNVERIFIED', 'Intake evidence missing.') : gate) };
    await saveStage(pool, metered, secondJob, needsIntake, decide(needsIntake.gates, needsIntake.evidence));
    assert.equal((await revisit(pool, 2)).find(record => record.method === 'IGNITION')?.discoveryPriority, 9);
    await pool.query("UPDATE origin_investigations SET checkpoint=jsonb_set(checkpoint,'{funnel,intakeVersion}','1') WHERE id=$1", [secondJob.id]);
    assert.deepEqual(await revisit(pool, 2), []);
  } finally {
    await pool.end();
    if (created) await admin.query(`DROP SCHEMA ${name} CASCADE`);
    await admin.end();
  }
});
