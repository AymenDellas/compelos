import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { defaults, domain, emptyCheckpoint, observe, POLICY_VERSION, settingsSchema } from './policy';
import type { Checkpoint, Decision, Seed, Settings, SourceResult } from './policy';
import { schema } from './schema';
import { approvedFeeds, parseFeeds } from './sources';
import type { PublisherFeed } from './sources';

type DB = Pool | PoolClient;
const json = JSON.stringify;
export { domain };
export type Run = {
  id: string; state: string; config: Settings; sources: SourceResult[] | null; discovery_round: number | null;
  batch_start: number; batch_search_start: number; publisher_feeds: PublisherFeed[] | null;
  lease: string; deadline_at: Date; started_at: Date; control_revision: number;
};
export type Job = {
  id: string; business_id: string; name: string; website: string; domain: string; seeds: Seed[];
  stage: 'RESOLVING' | 'INVESTIGATING' | 'VERIFYING'; checkpoint: Checkpoint;
  signature: Checkpoint['signature']; attempts: number;
};
export type Artifact = { id: string; digest: string; url: string; device: string; image: Buffer };

async function transaction<T>(pool: Pool, run: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await run(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

export function migrate(pool: Pool) {
  return transaction(pool, async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('compelos:origin:schema'))");
    await db.query(schema);
    await db.query('INSERT INTO origin_settings(id,config) VALUES(1,$1) ON CONFLICT DO NOTHING', [json(defaults)]);
  });
}

export const readConfig = (value?: Partial<Settings>) => settingsSchema.parse({ ...defaults, ...value });
type Configuration = { config: Settings; publisher_feeds: PublisherFeed[] | null; next_run_at: Date | null; worker_seen_at: Date | null; worker_policy_version: string | null };
const hasQualifiedTarget = "COALESCE((config->>'qualifiedTarget')::int,0)>0";
const discoveryUnavailable = 'The search sources could not be reached. See Discovery for details.';

export function discoveryError(sources: SourceResult[] | null) {
  return sources?.length && !sources.some(source => source.status === 'OK') ? discoveryUnavailable : undefined;
}

export async function configuration(db: DB) {
  return (await db.query<Configuration>('SELECT config,publisher_feeds,next_run_at,worker_seen_at,worker_policy_version FROM origin_settings WHERE id=1')).rows[0];
}

export function editPublishers(pool: Pool, change: (feeds: PublisherFeed[]) => PublisherFeed[]) {
  return transaction(pool, async db => {
    const { rows: [row] } = await db.query<Configuration>('SELECT publisher_feeds FROM origin_settings WHERE id=1 FOR UPDATE');
    const feeds = parseFeeds(change(approvedFeeds(row.publisher_feeds)));
    await db.query('UPDATE origin_settings SET publisher_feeds=$1 WHERE id=1', [json(feeds)]);
    return feeds;
  });
}

function createRun(db: DB, settings: Settings, feeds: unknown) {
  let supplemental: PublisherFeed[] | null = null;
  try { supplemental = approvedFeeds(feeds); } catch { /* The automatic sources are available even if supplemental input is invalid. */ }
  return db.query<{ id: string }>(`INSERT INTO origin_runs(id,state,config,publisher_feeds) VALUES($1,'QUEUED',$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
    [randomUUID(), json(settings), supplemental === null ? null : json(supplemental)]);
}
export async function start(pool: Pool, override: Partial<Settings> = {}) {
  return transaction(pool, async db => {
    const { rows: [row] } = await db.query<Configuration>('SELECT config,publisher_feeds FROM origin_settings WHERE id=1 FOR UPDATE');
    return (await createRun(db, readConfig({ ...row.config, ...override }), row.publisher_feeds)).rows[0]?.id ?? null;
  });
}
export async function saveSettings(db: DB, config: Settings) {
  await db.query(`UPDATE origin_settings SET config=$1,next_run_at=CASE WHEN $2::int IS NULL THEN NULL
    WHEN config->>'intervalMinutes'=$2::text AND next_run_at IS NOT NULL THEN next_run_at
    ELSE now()+make_interval(mins => $2::int) END WHERE id=1`, [json(settingsSchema.parse(config)), config.intervalMinutes]);
}

export function patchSettings(pool: Pool, patch: Partial<Settings>) {
  return transaction(pool, async db => {
    const { rows: [row] } = await db.query<Configuration>('SELECT config FROM origin_settings WHERE id=1 FOR UPDATE');
    const config = readConfig({ ...row.config, ...patch });
    await saveSettings(db, config);
    return config;
  });
}

export async function control(db: DB, id: string, action: 'pause' | 'resume' | 'cancel') {
  const change = {
    pause: `state='PAUSED',paused_at=now()`,
    resume: `state=CASE WHEN started_at IS NULL THEN 'QUEUED' ELSE 'RUNNING' END,
      deadline_at=CASE WHEN ${hasQualifiedTarget} AND deadline_at<=paused_at THEN now()+make_interval(mins => (config->>'runMinutes')::int)
      ELSE deadline_at+(now()-paused_at) END,paused_at=NULL,error=NULL`,
    cancel: `state='CANCELLED',finished_at=now(),lease=NULL,lease_until=NULL`,
  };
  const states = { pause: ['QUEUED', 'RUNNING'], resume: ['PAUSED'], cancel: ['QUEUED', 'RUNNING', 'PAUSED'] };
  return Boolean((await db.query(`UPDATE origin_runs SET ${change[action]},control_revision=control_revision+1 WHERE id=$1 AND state=ANY($2)`, [id, states[action]])).rowCount);
}

export async function claimRun(pool: Pool, target?: string) {
  return transaction(pool, async db => {
    if (!target) {
      const { rows: [settings] } = await db.query<Configuration & { due: boolean }>(`UPDATE origin_settings SET worker_seen_at=now(),worker_policy_version=$1
        WHERE id=1 RETURNING config,publisher_feeds,next_run_at<=now() AS due`, [POLICY_VERSION]);
      const config = readConfig(settings.config);
      if (settings.due && config.intervalMinutes && (await createRun(db, config, settings.publisher_feeds)).rowCount) {
        await db.query('UPDATE origin_settings SET next_run_at=now()+make_interval(mins => $1) WHERE id=1', [config.intervalMinutes]);
      }
    }
    await db.query(`UPDATE origin_runs SET state=CASE WHEN ${hasQualifiedTarget} THEN 'PAUSED' ELSE 'FAILED' END,
      paused_at=CASE WHEN ${hasQualifiedTarget} THEN now() ELSE NULL END,
      finished_at=CASE WHEN ${hasQualifiedTarget} THEN NULL ELSE now() END,lease=NULL,lease_until=NULL,
      error=CASE WHEN ${hasQualifiedTarget} THEN 'Time budget elapsed. Resume to continue toward this qualified target.'
      ELSE 'Run time budget elapsed.' END
      WHERE state='RUNNING' AND deadline_at<=now() AND (lease_until IS NULL OR lease_until<=now()) AND ($1::uuid IS NULL OR id=$1)`, [target ?? null]);
    const { rows: [run] } = await db.query<Run>(`UPDATE origin_runs SET state='RUNNING',lease=$1,lease_until=now()+interval '95 seconds',
      started_at=COALESCE(started_at,now()),deadline_at=COALESCE(deadline_at,now()+make_interval(mins => (config->>'runMinutes')::int))
      WHERE id=(SELECT id FROM origin_runs WHERE state IN ('QUEUED','RUNNING') AND (lease_until IS NULL OR lease_until<=now())
      AND ($2::uuid IS NULL OR id=$2) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`, [randomUUID(), target ?? null]);
    return run ? { ...run, config: readConfig(run.config) } : null;
  });
}

export async function release(db: DB, run: Run) {
  await db.query('UPDATE origin_runs SET lease=NULL,lease_until=NULL WHERE id=$1 AND lease=$2', [run.id, run.lease]);
}

// Lock the exact lease while committing a stage. Pause invalidates an in-flight stage even if immediately resumed.
export async function fenced<T>(pool: Pool, run: Run, action: (db: PoolClient) => Promise<T>) {
  return transaction(pool, async db => {
    const result = await db.query(`SELECT 1 FROM origin_runs WHERE id=$1 AND lease=$2 AND state='RUNNING' AND lease_until>now() AND deadline_at>now()
      AND control_revision=$3 FOR UPDATE`, [run.id, run.lease, run.control_revision]);
    if (!result.rowCount) return null;
    return action(db);
  });
}

function finishRun(db: PoolClient, id: string, error?: string, qualified?: number) {
  return db.query(`UPDATE origin_runs SET state=$2,finished_at=now(),error=$3,qualified_at_stop=$4,lease=NULL,lease_until=NULL WHERE id=$1`,
    [id, error ? 'FAILED' : 'COMPLETED', error ?? null, qualified ?? null]);
}

export async function finish(pool: Pool, run: Run, error?: string) {
  return fenced(pool, run, db => finishRun(db, run.id, error));
}

export async function suppressionFilter(db: DB) {
  const { rows: [table] } = await db.query("SELECT to_regclass('leads') AS name");
  return table.name ? `EXISTS(SELECT 1 FROM leads l WHERE (to_jsonb(l)->>'do_not_contact')='true'
    AND lower(regexp_replace(substring(btrim(l.website) FROM '^(?:https?://)?(?:www\\.)?([^/:?#]+)'), '\\.$', ''))=b.domain)` : 'false';
}

export const includedInvestigation = `j.checkpoint->>'skippedAsDuplicate' IS DISTINCT FROM 'true'
  AND j.checkpoint->>'skippedAfterTarget' IS DISTINCT FROM 'true'`;

export function qualifiedCountSql(runId: string, suppressed: string) {
  return `(SELECT count(*)::int FROM origin_investigations j JOIN origin_businesses b ON b.id=j.business_id
    WHERE j.run_id=${runId} AND ${includedInvestigation} AND j.outcome='QUALIFIED'
    AND j.decision->>'version'='${POLICY_VERSION}' AND j.expires_at>now() AND NOT (${suppressed}))`;
}

async function qualifiedCount(db: PoolClient, id: string) {
  const suppressed = await suppressionFilter(db);
  return (await db.query<{ total: number }>(`SELECT ${qualifiedCountSql('$1', suppressed)} AS total`, [id])).rows[0].total;
}

async function finishQualifiedTarget(db: PoolClient, id: string, qualified: number) {
  await db.query(`UPDATE origin_investigations j SET checkpoint=jsonb_set(j.checkpoint,'{skippedAfterTarget}','true')
    WHERE j.run_id=$1 AND j.stage NOT IN ('COMPLETED','FAILED') AND ${includedInvestigation}`, [id]);
  await finishRun(db, id, undefined, qualified);
}

export async function advanceQualifiedRun(pool: Pool, run: Run, searches: number) {
  return fenced(pool, run, async db => {
    const qualified = await qualifiedCount(db, run.id);
    if (qualified >= run.config.qualifiedTarget) return finishQualifiedTarget(db, run.id, qualified);
    const { rows: [{ total }] } = await db.query<{ total: number }>(`SELECT count(*)::int AS total FROM origin_investigations j
      WHERE j.run_id=$1 AND ${includedInvestigation}`, [run.id]);
    const error = discoveryError(run.sources);
    if (total <= run.batch_start && error) return finishRun(db, run.id, error, qualified);
    await db.query(`UPDATE origin_runs SET batch_number=batch_number+1,batch_start=$2,batch_search_start=$3,discovery_round=0
      WHERE id=$1`, [run.id, total, searches]);
  });
}

// Earlier schema versions recorded progress through the stage or an attempt count.
const processedEarlier = `EXISTS (SELECT 1 FROM origin_investigations prior
  WHERE prior.business_id=business.id AND prior.run_id<>$1 AND prior.checkpoint->>'skippedAsDuplicate' IS DISTINCT FROM 'true'
    AND (prior.processing_started_at IS NOT NULL OR prior.stage<>'RESOLVING' OR prior.attempts>0))`;

async function processedDomains(db: Pool | PoolClient, runId: string, domains: string[], keys: string[]) {
  const { rows } = await db.query<{ domain: string }>(`SELECT DISTINCT candidate.domain
      FROM unnest($2::text[], $3::text[]) candidate(domain,key)
      LEFT JOIN origin_identity_keys identity ON identity.key=candidate.key
      JOIN origin_businesses business ON business.domain=candidate.domain OR business.id=identity.business_id
      WHERE ${processedEarlier}`, [runId, domains, keys]);
  return new Set(rows.map(row => row.domain));
}

export async function existingDiscoveryDomains(pool: Pool, runId: string, domains: string[]) {
  const excluded = await processedDomains(pool, runId, domains, domains.map(() => ''));
  const { rows } = await pool.query<{ domain: string }>(`SELECT b.domain FROM origin_investigations j
    JOIN origin_businesses b ON b.id=j.business_id WHERE j.run_id=$1 AND b.domain=ANY($2::text[]) AND ${includedInvestigation}`, [runId, domains]);
  for (const row of rows) excluded.add(row.domain);
  return excluded;
}

export async function saveDiscovery(pool: Pool, run: Run, seeds: Seed[], sources: SourceResult[], refill = false) {
  return fenced(pool, run, async db => {
    const candidates = seeds.map(seed => domain(seed.website));
    const processed = await processedDomains(db, run.id, candidates, seeds.map(seed => seed.sourceKey));
    const { rows: queued } = await db.query<{ business_id: string; domain: string; discovery_order: number; stage: string }>(`SELECT j.business_id,b.domain,j.discovery_order,j.stage
      FROM origin_investigations j JOIN origin_businesses b ON b.id=j.business_id
      WHERE j.run_id=$1 AND ${includedInvestigation}`, [run.id]);
    const selected = new Map(queued.map(row => [row.domain, row.business_id]));
    const businessIds = new Set(selected.values());
    const decided = new Set(queued.filter(row => ['COMPLETED', 'FAILED'].includes(row.stage)).map(row => row.business_id));
    const batchLimit = run.batch_start + run.config.candidateLimit;
    let order = Math.max(-1, ...queued.map(row => row.discovery_order)) + 1;
    for (const [position, seed] of seeds.entries()) {
      const host = candidates[position];
      if (processed.has(host)) continue;
      const known = seed.method === 'Wikidata' ? (await db.query<{ business_id: string }>(
        'SELECT business_id FROM origin_identity_keys WHERE key=$1', [seed.sourceKey])).rows[0] : undefined;
      const existing = known?.business_id ?? selected.get(host);
      if (existing && decided.has(existing)) continue;
      if ((!existing || !businessIds.has(existing)) && businessIds.size >= batchLimit) continue;
      // An external record changing its official domain is evidence for re-investigation, never an automatic rename or merge.
      const businessId = existing ?? (await db.query<{ id: string }>(`INSERT INTO origin_businesses(id,domain,name,website,seed)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(domain) DO UPDATE SET domain=EXCLUDED.domain RETURNING id`,
      [randomUUID(), host, seed.name, seed.website, json(seed)])).rows[0].id;
      if (seed.method === 'Wikidata') {
        await db.query(`INSERT INTO origin_identity_keys(key,business_id,provenance) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
          [seed.sourceKey, businessId, json(seed)]);
      }
      await db.query(`INSERT INTO origin_investigations(id,run_id,business_id,seeds,stage,checkpoint,discovery_order)
        VALUES($1,$2,$3,$4,'RESOLVING',$5,$6) ON CONFLICT(run_id,business_id)
        DO UPDATE SET seeds=origin_investigations.seeds || EXCLUDED.seeds
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(origin_investigations.seeds) AS old(seed)
          WHERE old.seed->>'sourceKey'=$7 AND old.seed->>'website'=$8)
        AND jsonb_array_length(origin_investigations.seeds)<30`,
      [randomUUID(), run.id, businessId, json([seed]), json(emptyCheckpoint()), order, seed.sourceKey, seed.website]);
      if (!businessIds.has(businessId)) order++;
      businessIds.add(businessId);
      if (!known) selected.set(host, businessId);
    }
    const combined = new Map(run.sources?.map(source => [source.adapter, source]));
    for (const source of sources) {
      const earlier = combined.get(source.adapter);
      combined.set(source.adapter, earlier ? {
        ...source, status: earlier.status === 'OK' ? 'OK' : source.status,
        discovered: earlier.discovered + source.discovered, elapsedMs: earlier.elapsedMs + source.elapsedMs,
        searches: (earlier.searches ?? 0) + (source.searches ?? 0), queryIndex: source.queryIndex ?? earlier.queryIndex,
        searchAttempts: (earlier.searchAttempts ?? earlier.searches ?? 0) + (source.searchAttempts ?? source.searches ?? 0),
        ...(source.screening ? { screening: Object.fromEntries([...new Set([
          ...Object.keys(earlier.screening ?? {}), ...Object.keys(source.screening),
        ])].map(key => [key, (earlier.screening?.[key] ?? 0) + (source.screening?.[key] ?? 0)])) } : {}),
      } : source);
    }
    const nextRound = refill && businessIds.size < batchLimit ? (run.discovery_round ?? 0) + 1 : null;
    await db.query('UPDATE origin_runs SET sources=$2,discovery_round=$3,error=NULL WHERE id=$1',
      [run.id, json([...combined.values()]), nextRound]);
  });
}

export async function nextJob(pool: Pool, run: Run) {
  const job = await fenced(pool, run, async db => {
    // A run queued before this change can still contain duplicates.
    await db.query(`UPDATE origin_investigations j SET checkpoint=jsonb_set(j.checkpoint,'{skippedAsDuplicate}','true')
      FROM origin_businesses business WHERE j.business_id=business.id AND j.run_id=$1
      AND j.stage NOT IN ('COMPLETED','FAILED') AND ${includedInvestigation} AND ${processedEarlier}`, [run.id]);
    return (await db.query<Job>(`WITH selected AS (
      SELECT j.id FROM origin_investigations j WHERE j.run_id=$1 AND j.stage NOT IN ('COMPLETED','FAILED') AND ${includedInvestigation}
      ORDER BY CASE WHEN j.stage='VERIFYING' THEN 0 WHEN (j.stage='INVESTIGATING')=$2 THEN 1 ELSE 2 END,discovery_order,created_at,id LIMIT 1
    ), started AS (
      UPDATE origin_investigations j SET processing_started_at=COALESCE(j.processing_started_at,now())
      FROM selected WHERE j.id=selected.id RETURNING j.*
    ) SELECT j.*,b.domain,b.name,b.website,b.signature FROM started j JOIN origin_businesses b ON b.id=j.business_id`, [run.id, run.config.qualifiedTarget > 0])).rows[0];
  });
  if (job) {
    const target = job.seeds.filter(seed => seed.method === 'BUSINESS_SEARCH' && domain(seed.website) === job.domain && new URL(seed.website).pathname !== '/')
      .sort((a, b) => (b.discoveryPriority ?? 0) - (a.discoveryPriority ?? 0))[0];
    if (target) job.website = target.website;
  }
  return job ?? undefined;
}

/** Reserve before contacting the prepaid search service. A lost reply never incurs a second charge. */
export async function runSearch<T>(pool: Pool, run: Run, key: string, request: () => Promise<T>): Promise<T | undefined> {
  const receipt = await fenced(pool, run, async db => {
    const prior = (await db.query<{ status: string; result: T }>('SELECT status,result FROM origin_search_receipts WHERE run_id=$1 AND query_key=$2', [run.id, key])).rows[0];
    if (prior) return { fresh: false, result: prior.status === 'COMPLETE' ? prior.result : undefined };
    if (key.startsWith('follow-up:')) {
      const count = await db.query<{ count: number }>("SELECT count(*)::int FROM origin_search_receipts WHERE run_id=$1 AND query_key LIKE 'follow-up:%'", [run.id]);
      if (count.rows[0].count >= 6) return { fresh: false, result: undefined };
    }
    await db.query(`INSERT INTO origin_search_receipts(run_id,query_key,status) VALUES($1,$2,'RESERVED')`, [run.id, key]);
    return { fresh: true, result: undefined };
  });
  if (!receipt?.fresh) return receipt?.result;
  try {
    const result = await request();
    await pool.query(`UPDATE origin_search_receipts SET status='COMPLETE',result=$3 WHERE run_id=$1 AND query_key=$2 AND status='RESERVED'`, [run.id, key, json(result)]);
    return result;
  } catch (error) {
    await pool.query(`UPDATE origin_search_receipts SET status='FAILED' WHERE run_id=$1 AND query_key=$2 AND status='RESERVED'`, [run.id, key]);
    throw error;
  }
}

export async function saveStage(pool: Pool, run: Run, job: Job, checkpoint: Checkpoint,
  next: Job['stage'] | Decision, artifacts: Artifact[] = [], newSeeds: Seed[] = []) {
  return fenced(pool, run, async db => {
    for (const artifact of artifacts) {
      await db.query(`INSERT INTO origin_artifacts(investigation_id,id,digest,url,device,image) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT DO NOTHING`, [job.id, artifact.id, artifact.digest, artifact.url, artifact.device, artifact.image]);
    }
    const decision = typeof next === 'string' ? null : next;
    // A CRM domain that has been suppressed must never appear ready for contact in ORIGIN.
    if (decision?.outcome === 'QUALIFIED' && (await db.query("SELECT to_regclass('leads') AS name")).rows[0].name) {
      const match = await db.query(`SELECT 1 FROM leads l WHERE (to_jsonb(l)->>'do_not_contact')='true'
        AND lower(substring(website FROM '^(?:https?://)?(?:www\.)?([^/:?#]+)'))=$1 LIMIT 1`, [job.domain]);
      if (match.rowCount) {
        const record = observe('source', job.website, 'A matching Compel OS business domain is suppressed.', 'CRM suppression');
        checkpoint.evidence.push(record);
        Object.assign(decision, { outcome: 'REJECTED', expiresAt: null, reason: record.excerpt });
      }
    }
    await db.query(`UPDATE origin_investigations SET stage=$2,checkpoint=$3,decision=$4,outcome=$5,expires_at=$6,seeds=seeds || $7::jsonb,
      updated_at=now(),error=NULL,attempts=0 WHERE id=$1`,
    [job.id, typeof next === 'string' ? next : 'COMPLETED', json(checkpoint), decision ? json(decision) : null, decision?.outcome, decision?.expiresAt,
      json(newSeeds.filter(seed => !job.seeds.some(item => item.sourceKey === seed.sourceKey)))]);
    if (decision) {
      await db.query(`UPDATE origin_businesses SET investigated_at=now(),signature=COALESCE($2,signature) WHERE id=$1`,
        [job.business_id, checkpoint.signature ? json(checkpoint.signature) : null]);
    }
    if (run.config.qualifiedTarget && decision?.outcome === 'QUALIFIED') {
      const qualified = await qualifiedCount(db, run.id);
      if (qualified >= run.config.qualifiedTarget) await finishQualifiedTarget(db, run.id, qualified);
    }
  });
}

export async function failStage(pool: Pool, run: Run, job: Job) {
  return fenced(pool, run, db => db.query(`UPDATE origin_investigations SET attempts=attempts+1,
    stage=CASE WHEN attempts>=1 THEN 'FAILED' ELSE stage END,updated_at=now(),error='Investigation checkpoint failed.' WHERE id=$1`, [job.id]));
}

export async function sourceHistory(db: DB) {
  return (await db.query<{ source: SourceResult }>(`SELECT item AS source FROM
    (SELECT sources,created_at FROM origin_runs WHERE sources IS NOT NULL ORDER BY created_at DESC LIMIT 50) r
    CROSS JOIN LATERAL jsonb_array_elements(r.sources) WITH ORDINALITY a(item,position) ORDER BY r.created_at DESC,a.position`)).rows.map(row => row.source);
}

export async function recentPublisherEvidence(db: DB, activityDays: number) {
  return (await db.query<{ seed: Seed }>(`SELECT DISTINCT ON (seed->>'website',seed->>'sourceKey') seed FROM
    (SELECT seeds FROM origin_investigations WHERE created_at>=now()-make_interval(days => $1)
      ORDER BY created_at DESC LIMIT 400) j CROSS JOIN LATERAL jsonb_array_elements(j.seeds) seed
    WHERE (seed->>'permission' IS NOT NULL OR seed#>>'{publication,use}'='FACTS_ONLY') AND seed->>'occurredAt' IS NOT NULL
    ORDER BY seed->>'website',seed->>'sourceKey',seed->>'occurredAt' DESC LIMIT 1200`, [activityDays])).rows.map(row => row.seed);
}

export async function newPublishedBusinesses(db: DB, limit: number) {
  return (await db.query<{ seed: Seed }>(`SELECT item AS seed FROM
    (SELECT seeds FROM origin_investigations WHERE updated_at>=now()-interval '24 hours' ORDER BY updated_at DESC LIMIT 150) j
    CROSS JOIN LATERAL jsonb_array_elements(j.seeds) item
    WHERE item->>'method'='PUBLICATION' AND item#>>'{publication,use}'='FACTS_ONLY'
    AND NOT EXISTS (SELECT 1 FROM origin_businesses b WHERE b.domain=lower(substring(item->>'website' FROM '^https?://(?:www\.)?([^/:?#]+)')))
    LIMIT $1`, [limit])).rows.map(row => row.seed);
}

export type SourceQuality = { adapter: string; investigated: number; identities: number; offers: number; qualified: number };
export async function sourceQuality(db: DB) {
  return (await db.query<SourceQuality>(`SELECT seed->>'adapter' AS adapter, count(DISTINCT j.id)::int AS investigated,
    count(DISTINCT j.id) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(j.decision->'gates') g
      WHERE g->>'name'='identity' AND g->>'state'='VERIFIED'))::int AS identities,
    count(DISTINCT j.id) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(j.decision->'gates') g
      WHERE g->>'name'='niche' AND g->>'state'='VERIFIED'))::int AS offers,
    count(DISTINCT j.id) FILTER (WHERE j.outcome='QUALIFIED' AND j.decision->>'version'=$1)::int AS qualified
    FROM origin_investigations j CROSS JOIN LATERAL jsonb_array_elements(j.seeds) seed
    WHERE j.run_id IN (SELECT id FROM origin_runs ORDER BY created_at DESC LIMIT 50)
      AND j.decision IS NOT NULL AND seed->>'adapter' IS NOT NULL AND seed->>'method'<>'IGNITION' GROUP BY 1`, [POLICY_VERSION])).rows;
}
