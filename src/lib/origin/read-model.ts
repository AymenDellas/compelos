import type { Pool, PoolClient } from 'pg';
import { readModelConfig } from './model';
import { defaults, POLICY_VERSION } from './policy';
import type { Checkpoint, Decision, Outcome, Settings, SourceResult } from './policy';
import { configuration, sourceHistory, sourceQuality } from './store';
import type { SourceQuality } from './store';
import { approvedFeeds, independentFeedCount } from './sources';

type DB = Pool | PoolClient;

export type RunSummary = {
  id: string; state: string; created_at: string; started_at: string | null; finished_at: string | null;
  sources: SourceResult[] | null; error: string | null; counts: Record<string, number>;
};
export type Opportunity = {
  id: string; business_id: string; name: string; website: string; offer: string; country: string;
  opportunity: string; contact: string; updated_at: string; expires_at: string | null; acquisition_sources: number;
};
export type Finding = { id: string; name: string; stage: string; outcome: Outcome | null; reason: string | null; updated_at: string };
type GateProgress = { name: string; reached: number; verified: number; held: number; contradicted: number };
export type Dossier = {
  id: string; business_id: string; name: string; website: string; stage: string; updated_at: string;
  checkpoint: Checkpoint; decision: Decision | null; error: string | null; suppressed: boolean; evidence_current: boolean;
  artifacts: { id: string; device: string; url: string; digest: string; available: boolean }[];
};

export async function hasSchema(pool: DB) {
  return Boolean((await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('origin_settings')
    AND attname='worker_policy_version' AND NOT attisdropped) AS ready`)).rows[0].ready);
}

async function suppressionFilter(pool: DB) {
  const { rows: [table] } = await pool.query("SELECT to_regclass('leads') AS name");
  return table.name ? `EXISTS(SELECT 1 FROM leads l WHERE (to_jsonb(l)->>'do_not_contact')='true'
    AND lower(regexp_replace(substring(btrim(l.website) FROM '^(?:https?://)?(?:www\\.)?([^/:?#]+)'), '\\.$', ''))=b.domain)` : 'false';
}

const currentEvidence = `COALESCE(j.decision->>'version'=$2 AND j.expires_at>now(),false)`;

async function qualifiedOpportunities(pool: DB, limit: number, run: string | null, view: 'ready' | 'saved') {
  const suppressed = await suppressionFilter(pool);
  return (await pool.query<Opportunity>(`SELECT j.id,b.id AS business_id,COALESCE(j.checkpoint->>'identityName',b.name) AS name,b.website,j.updated_at,j.expires_at,
    j.checkpoint->>'offer' AS offer,j.checkpoint->>'country' AS country,j.checkpoint->>'contact' AS contact,
    (SELECT jsonb_array_length(g->'evidence') FROM jsonb_array_elements(j.decision->'gates') g WHERE g->>'name'='acquisition') AS acquisition_sources,
    (SELECT g->>'assertion' FROM jsonb_array_elements(j.decision->'gates') g WHERE g->>'name'='opportunity') AS opportunity
    FROM origin_businesses b JOIN LATERAL (SELECT * FROM origin_investigations WHERE business_id=b.id
      AND checkpoint->>'skippedAsDuplicate' IS DISTINCT FROM 'true'
      ORDER BY created_at DESC,id DESC LIMIT 1) j ON true
    WHERE j.outcome='QUALIFIED' AND ${view === 'ready' ? currentEvidence : `NOT ${currentEvidence}`}
      AND NOT (${suppressed}) AND ($3::uuid IS NULL OR j.run_id=$3)
    ORDER BY acquisition_sources DESC,j.updated_at DESC,b.name,b.id LIMIT $1`, [limit, POLICY_VERSION, run])).rows;
}

export function readyOpportunities(pool: DB, limit = 100, run: string | null = null) {
  return qualifiedOpportunities(pool, limit, run, 'ready');
}

const empty = { config: defaults, next_run_at: null, worker_seen_at: null, online: false };
const noUsage = { calls: 0, reserved_cents: 0, provider_cents: null, tokens: null, last_status: null };
type Usage = { calls: number; reserved_cents: number; provider_cents: number | null; tokens: number | null; last_status: string | null };

export async function sourceReadiness(db: DB) {
  try {
    const feeds = approvedFeeds((await configuration(db))?.publisher_feeds);
    const independent = independentFeedCount(feeds);
    return { feeds, independent, automaticDiscovery: true, error: null };
  } catch (error) {
    if (!(error instanceof Error && error.message === 'INVALID_FEED_CONFIGURATION')) throw error;
    return { feeds: [], independent: 0, automaticDiscovery: true, error: 'Invalid supplemental publisher feed configuration.' };
  }
}

const summarySql = `SELECT r.id,r.state,r.created_at,r.started_at,r.finished_at,r.error,r.sources,
  COALESCE((SELECT jsonb_object_agg(key,n) FROM (SELECT CASE WHEN checkpoint->>'skippedAsDuplicate'='true' THEN 'SKIPPED' ELSE COALESCE(outcome,stage) END AS key,count(*)::int AS n
    FROM origin_investigations WHERE run_id=r.id GROUP BY 1) c),'{}') AS counts FROM origin_runs r`;

export async function runSummary(db: DB, id: string) {
  return (await db.query<RunSummary>(`${summarySql} WHERE r.id=$1`, [id])).rows[0];
}

export async function listRuns(db: DB, limit = 12) {
  return (await db.query<RunSummary>(`${summarySql} ORDER BY r.created_at DESC LIMIT $1`, [limit])).rows;
}

export async function investigations(db: DB, run: string | null, outcome: string | null, limit: number) {
  return (await db.query<Finding & { business_id: string; run_id: string; website: string }>(`SELECT j.id,b.id AS business_id,j.run_id,COALESCE(j.checkpoint->>'identityName',b.name) AS name,b.website,j.stage,j.outcome,j.updated_at,
    COALESCE(j.error,(SELECT g->>'assertion' FROM jsonb_array_elements(j.decision->'gates') g WHERE g->>'state'<>'VERIFIED'
      ORDER BY (g->>'state'='CONTRADICTED') DESC LIMIT 1)) AS reason
    FROM origin_investigations j JOIN origin_businesses b ON b.id=j.business_id
    WHERE j.checkpoint->>'skippedAsDuplicate' IS DISTINCT FROM 'true' AND ($1::uuid IS NULL OR j.run_id=$1) AND ($2::text IS NULL OR COALESCE(j.outcome,j.stage)=$2)
    ORDER BY j.updated_at DESC,j.id LIMIT $3`, [run, outcome, limit])).rows;
}

export async function modelUsage(db: DB, run: string | null = null) {
  return (await db.query<Usage>(`SELECT count(*)::int AS calls,COALESCE(sum(reserved_cents),0)::int AS reserved_cents,
    sum(provider_cents)::float8 AS provider_cents,sum(provider_tokens)::float8 AS tokens,
    (SELECT status FROM origin_model_usage WHERE ($1::uuid IS NULL OR run_id=$1) ORDER BY created_at DESC LIMIT 1) AS last_status
    FROM origin_model_usage WHERE ($1::uuid IS NOT NULL AND run_id=$1) OR ($1::uuid IS NULL AND
      created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`, [run])).rows[0];
}

export async function overview(pool: Pool) {
  const configured = Boolean(readModelConfig());
  if (!await hasSchema(pool)) return { ...empty, configured, ready: false, runs: [] as RunSummary[], opportunities: [] as Opportunity[],
    savedOpportunities: [] as Opportunity[],
    findings: [] as Finding[], sources: [] as SourceResult[], quality: [] as SourceQuality[], usage: noUsage,
    independentPublishers: 0, gateProgress: [] as GateProgress[] };
  // A dashboard refresh should use one checked-out connection on the shared pooler.
  const db = await pool.connect();
  try {
    const config = await configuration(db);
    const sourceConfig = await sourceReadiness(db);
    const runs = await listRuns(db);
    const gateProgress = runs[0] ? (await db.query<GateProgress>(`SELECT g->>'name' AS name,count(*)::int AS reached,
      count(*) FILTER (WHERE g->>'state'='VERIFIED')::int AS verified,
      count(*) FILTER (WHERE g->>'state' IN ('UNVERIFIED','STALE'))::int AS held,
      count(*) FILTER (WHERE g->>'state'='CONTRADICTED')::int AS contradicted
      FROM origin_investigations j CROSS JOIN LATERAL jsonb_array_elements(j.checkpoint->'gates') g
      WHERE j.run_id=$1 AND j.checkpoint->>'skippedAsDuplicate' IS DISTINCT FROM 'true' GROUP BY 1 ORDER BY 1`, [runs[0].id])).rows : [];
    const ready = await readyOpportunities(db);
    const savedOpportunities = await qualifiedOpportunities(db, 100, null, 'saved');
    const needsRecheck = new Set(savedOpportunities.map(item => item.business_id));
    const opportunities = ready.filter(item => !needsRecheck.has(item.business_id));
    const findings = (await db.query<Finding>(`SELECT j.id,COALESCE(j.checkpoint->>'identityName',b.name) AS name,j.stage,j.outcome,j.updated_at,
      COALESCE(j.error,(SELECT g->>'assertion' FROM jsonb_array_elements(j.decision->'gates') g WHERE g->>'state'<>'VERIFIED'
        ORDER BY (g->>'state'='CONTRADICTED') DESC LIMIT 1)) AS reason
      FROM origin_investigations j JOIN origin_businesses b ON b.id=j.business_id WHERE j.outcome IS DISTINCT FROM 'QUALIFIED'
      AND j.checkpoint->>'skippedAsDuplicate' IS DISTINCT FROM 'true'
      ORDER BY j.updated_at DESC LIMIT 75`)).rows;
    const sources = await sourceHistory(db);
    const quality = await sourceQuality(db);
    const usage = await modelUsage(db);
    return { config: config.config, next_run_at: config.next_run_at?.toISOString() ?? null, worker_seen_at: config.worker_seen_at?.toISOString() ?? null,
      online: Boolean(config.worker_seen_at && Date.now() - config.worker_seen_at.getTime() < 115_000), configured, ready: true, runs,
      opportunities, savedOpportunities, findings, sources, quality, usage, gateProgress, independentPublishers: sourceConfig.independent };
  } finally { db.release(); }
}
export type Overview = Awaited<ReturnType<typeof overview>>;

export async function dossier(pool: Pool, id: string) {
  const suppressed = await suppressionFilter(pool);
  const { rows: [record] } = await pool.query<Omit<Dossier, 'artifacts'>>(`SELECT j.id,j.business_id,COALESCE(j.checkpoint->>'identityName',b.name) AS name,b.website,j.stage,j.updated_at,j.checkpoint,j.decision,j.error,${suppressed} AS suppressed,
    ${currentEvidence} AS evidence_current FROM origin_investigations j JOIN origin_businesses b ON b.id=j.business_id WHERE j.id=$1`, [id, POLICY_VERSION]);
  if (!record) return null;
  const images = await pool.query<Dossier['artifacts'][number]>(`SELECT id,device,url,digest,image IS NOT NULL AS available FROM origin_artifacts
    WHERE investigation_id=$1 ORDER BY device,id`, [id]);
  return { ...record, artifacts: images.rows };
}

export async function artifact(pool: Pool, id: string, image: string) {
  return (await pool.query<{ image: Buffer }>(`SELECT image FROM origin_artifacts WHERE investigation_id=$1 AND id=$2 AND image IS NOT NULL`, [id, image])).rows[0]?.image;
}
