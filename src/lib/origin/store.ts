import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { decide, defaults, domain, emptyCheckpoint, finding, observe, POLICY_VERSION, settingsSchema } from './policy';
import type { Checkpoint, Decision, Seed, Settings, SourceResult } from './policy';
import { schema } from './schema';
import { approvedFeeds, parseFeeds } from './sources';
import type { PublisherFeed } from './sources';

type DB = Pool | PoolClient;
const json = JSON.stringify;
export { domain };
export type Run = { id: string; state: string; config: Settings; sources: SourceResult[] | null; publisher_feeds: PublisherFeed[] | null; lease: string; deadline_at: Date; started_at: Date; control_revision: number };
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

export const readConfig = (value?: Settings) => settingsSchema.parse({ ...defaults, ...value });
type Configuration = { config: Settings; publisher_feeds: PublisherFeed[] | null; next_run_at: Date | null; worker_seen_at: Date | null; worker_policy_version: string | null };

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
    resume: `state=CASE WHEN started_at IS NULL THEN 'QUEUED' ELSE 'RUNNING' END,deadline_at=deadline_at+(now()-paused_at),paused_at=NULL`,
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
    await db.query(`UPDATE origin_runs SET state='FAILED',finished_at=now(),error='Run time budget elapsed.',lease=NULL,lease_until=NULL
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

export async function finish(pool: Pool, run: Run, error?: string) {
  return fenced(pool, run, db => db.query(`UPDATE origin_runs SET state=$2,finished_at=now(),error=$3,lease=NULL,lease_until=NULL WHERE id=$1`,
    [run.id, error ? 'FAILED' : 'COMPLETED', error ?? null]));
}

export async function saveDiscovery(pool: Pool, run: Run, seeds: Seed[], sources: SourceResult[]) {
  return fenced(pool, run, async db => {
    for (const [position, seed] of seeds.entries()) {
      const host = domain(seed.website);
      const { rows: [known] } = await db.query<{ business_id: string }>('SELECT business_id FROM origin_identity_keys WHERE key=$1', [seed.sourceKey]);
      // An external record changing its official domain is evidence for re-investigation, never an automatic rename or merge.
      const businessId = known?.business_id ?? (await db.query<{ id: string }>(`INSERT INTO origin_businesses(id,domain,name,website,seed)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(domain) DO UPDATE SET domain=EXCLUDED.domain RETURNING id`,
      [randomUUID(), host, seed.name, seed.website, json(seed)])).rows[0].id;
      if (seed.method === 'Wikidata') {
        await db.query(`INSERT INTO origin_identity_keys(key,business_id,provenance) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
          [seed.sourceKey, businessId, json(seed)]);
      }
      await db.query(`INSERT INTO origin_investigations(id,run_id,business_id,seeds,stage,checkpoint,discovery_order)
        VALUES($1,$2,$3,$4,'RESOLVING',$5,$6) ON CONFLICT(run_id,business_id)
        DO UPDATE SET seeds=origin_investigations.seeds || EXCLUDED.seeds`,
      [randomUUID(), run.id, businessId, json([seed]), json(emptyCheckpoint()), position]);
    }
    await db.query('UPDATE origin_runs SET sources=$2,error=NULL WHERE id=$1', [run.id, json(sources)]);
  });
}

export async function nextJob(db: DB, run: Run) {
  const job = (await db.query<Job>(`SELECT j.*, b.domain,b.name,b.website,b.signature FROM origin_investigations j JOIN origin_businesses b ON b.id=j.business_id
    WHERE j.run_id=$1 AND j.stage NOT IN ('COMPLETED','FAILED') ORDER BY
    CASE j.stage WHEN 'VERIFYING' THEN 0 WHEN 'RESOLVING' THEN 1 ELSE 2 END,j.discovery_order,j.created_at,j.id LIMIT 1`, [run.id])).rows[0];
  if (job) {
    const target = job.seeds.find(seed => seed.method === 'BUSINESS_SEARCH' && domain(seed.website) === job.domain && new URL(seed.website).pathname !== '/');
    if (target) job.website = target.website;
  }
  return job;
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
        checkpoint.gates = checkpoint.gates.filter(gate => gate.name !== 'contact').concat(finding('contact', 'CONTRADICTED', record.excerpt, [record]));
        Object.assign(decision, decide(checkpoint.gates, checkpoint.evidence));
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

export async function recentWikiPointers(db: DB) {
  return (await db.query<{ source: string }>(`SELECT DISTINCT seed->>'source' AS source FROM
    (SELECT seeds FROM origin_investigations WHERE stage='COMPLETED' AND decision->>'version'=$1 AND updated_at>=now()-interval '72 hours'
      ORDER BY updated_at DESC LIMIT 300) j CROSS JOIN LATERAL jsonb_array_elements(j.seeds) seed
    WHERE seed->>'method'='Wikidata'`, [POLICY_VERSION])).rows.map(row => row.source);
}

export async function recentSearchDomains(db: DB) {
  return (await db.query<{ domain: string }>(`SELECT DISTINCT b.domain FROM origin_investigations j
    JOIN origin_businesses b ON b.id=j.business_id
    WHERE j.stage='COMPLETED' AND j.decision->>'version'=$1 AND j.updated_at>=now()-interval '72 hours'`,
    [POLICY_VERSION])).rows.map(row => row.domain);
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

export async function revisit(db: DB, limit: number) {
  return (await db.query<{ seed: Seed; seeds: Seed[] }>(`SELECT b.seed,j.seeds FROM origin_businesses b
    JOIN LATERAL (SELECT seeds,outcome,expires_at FROM origin_investigations WHERE business_id=b.id
    ORDER BY created_at DESC LIMIT 1) j ON true
    WHERE (j.outcome='QUALIFIED' AND j.expires_at<=now()+interval '4 hours')
       OR (j.outcome='UNRESOLVED' AND b.investigated_at<now()-interval '7 days')
    ORDER BY j.expires_at ASC NULLS LAST,b.investigated_at LIMIT $1`, [limit])).rows.flatMap(({ seed, seeds }) => {
    const visit: Seed = { ...seed, method: 'IGNITION', sourceKey: `revisit:${seed.sourceKey}`, occurredAt: undefined };
    return [...seeds.filter(item => item.method !== 'IGNITION'), visit];
  });
}
