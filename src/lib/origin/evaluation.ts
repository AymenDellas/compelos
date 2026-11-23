import type { Pool } from 'pg';
import { gateNames, POLICY_VERSION } from './policy';
import type { Checkpoint, Decision, Gate, Outcome, Seed } from './policy';
import { modelUsage, runSummary } from './read-model';
import { includedInvestigation } from './store';

export async function evaluate(pool: Pool, runId: string) {
  const run = await runSummary(pool, runId);
  if (!run) return null;
  const hasProviderStatus = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='origin_model_usage'::regclass AND attname='provider_status' AND NOT attisdropped) AS available")).rows[0].available;
  const modelActivity = (await pool.query(`SELECT model,status,${hasProviderStatus ? 'provider_status' : 'NULL AS provider_status'},count(*)::int AS requests,
    sum(provider_tokens)::int AS tokens,sum(reserved_cents)::int AS reserved_cents
    FROM origin_model_usage WHERE run_id=$1 GROUP BY model,status${hasProviderStatus ? ',provider_status' : ''} ORDER BY model,status`, [runId])).rows;
  const hasSearchReceipts = (await pool.query("SELECT to_regclass('origin_search_receipts') IS NOT NULL AS available")).rows[0].available;
  const searchActivity = hasSearchReceipts ? (await pool.query(`SELECT status,count(*)::int AS requests
    FROM origin_search_receipts WHERE run_id=$1 GROUP BY status ORDER BY status`, [runId])).rows : [];
  const { rows } = await pool.query<{ id: string; name: string; domain: string; decision: Decision | null; stage: string; started: boolean; artifacts: number; checkpoint: Checkpoint; seeds: Seed[] }>(`
    SELECT j.id,b.name,b.domain,j.decision,j.stage,j.checkpoint,j.seeds,
    (to_jsonb(j)->>'processing_started_at' IS NOT NULL OR j.stage<>'RESOLVING' OR j.attempts>0) AS started,
    (SELECT count(*)::int FROM origin_artifacts a WHERE a.investigation_id=j.id AND a.image IS NOT NULL) AS artifacts
    FROM origin_investigations j JOIN origin_businesses b ON b.id=j.business_id
    WHERE run_id=$1 AND ${includedInvestigation} ORDER BY b.domain`, [runId]);
  const reportedGates = new Set([...gateNames, ...rows.flatMap(row => row.decision?.gates.map(gate => gate.name) ?? [])]);
  const gates = Object.fromEntries([...reportedGates].map(name => [name, { VERIFIED: 0, UNVERIFIED: 0, CONTRADICTED: 0, STALE: 0 } as Record<Gate['state'], number>]));
  const blockers = new Map<string, { gate: string; state: Gate['state']; reason: string; count: number }>();
  for (const row of rows) for (const gate of row.decision?.gates ?? []) {
    gates[gate.name][gate.state]++;
    if (gate.state === 'VERIFIED') continue;
    const key = `${gate.name}:${gate.state}:${gate.assertion}`;
    const group = blockers.get(key) ?? { gate: gate.name, state: gate.state, reason: gate.assertion, count: 0 };
    group.count++;
    blockers.set(key, group);
  }
  const publisherChecks = [...new Map([...(run.sources ?? []).flatMap(source => source.publisherAudit ?? []), ...rows.flatMap(row => row.checkpoint.publisherAudit ?? [])]
    .map(check => [`${check.url}:${check.code}`, check])).values()];
  const results = rows.map(row => {
    const evidence = row.checkpoint.evidence;
    const journey = row.checkpoint.journey;
    const testedGates = new Set(row.checkpoint.gates.map(gate => gate.name));
    const bookingUrls = new Set(evidence.filter(item => item.method === 'Initial direct booking GET').map(item => item.id));
    const bookingRechecked = evidence.some(item => /^Independent (?:direct booking GET|booking duration recheck|message-form recheck|booking destination (?:render|recheck)|mobile placement recheck|missing-section recheck|published price recheck)$/.test(item.method));
    return { id: row.id, name: row.checkpoint.identityName ?? row.name, domain: row.domain, stage: row.stage, outcome: row.decision?.outcome ?? null,
      policy: row.decision?.version ?? null, discovery: row.seeds.map(seed => ({ adapter: seed.adapter ?? seed.method, url: seed.source })),
      gates: row.decision?.gates.map(gate => ({ name: gate.name, state: testedGates.has(gate.name) ? gate.state : 'NOT_REACHED', reason: gate.assertion,
        sources: [...new Set(evidence.filter(item => gate.evidence.includes(item.id)).map(item => item.url))] })) ?? [],
      identityRead: evidence.filter(item => ['Official entry point', 'Official About page'].includes(item.method)).map(item => ({ url: item.url, status: item.excerpt.split(' · ')[0] })),
      pages: journey.filter(step => !bookingUrls.has(step.evidence)),
      booking: { observations: journey.filter(step => bookingUrls.has(step.evidence)), rechecked: bookingRechecked, observed: row.checkpoint.funnel },
      publicationChecks: row.checkpoint.publisherAudit ?? [], acquisitionRecords: row.checkpoint.acquisitionSources ?? 0,
      ownedCampaigns: row.checkpoint.ownedActivities?.length ?? 0,
      artifacts: row.artifacts,
      blockers: row.decision?.gates.filter(gate => gate.state !== 'VERIFIED') ?? [] };
  });
  const stageWork = Object.fromEntries((['resolve', 'investigate', 'verify'] as const).map(stage => {
    const samples = rows.flatMap(row => row.checkpoint.stageMs?.[stage] === undefined ? [] : [row.checkpoint.stageMs[stage]!]);
    return [stage, { checkpoints: samples.length, elapsedMs: samples.reduce((sum, item) => sum + item, 0) }];
  }));
  return {
    run, gates, publisherChecks, blockers: [...blockers.values()].sort((a, b) => b.count - a.count || a.gate.localeCompare(b.gate)),
    queued: rows.length, investigated: rows.filter(row => row.started).length, completed: rows.filter(row => row.stage === 'COMPLETED').length,
    captures: rows.reduce((sum, row) => sum + row.artifacts, 0), usage: await modelUsage(pool, runId), stageWork, modelActivity, searchActivity,
    investigationCoverage: { businessPagesRead: results.filter(row => row.pages.some(page => page.result === 'READABLE')).length,
      bookingDestinationsRead: results.reduce((count, row) => count + row.booking.observations.length, 0),
      bookingDestinationsRechecked: results.filter(row => row.booking.rechecked).length },
    results,
  };
}

export function scoreFixture(results: NonNullable<Awaited<ReturnType<typeof evaluate>>>['results'], expected: Record<string, Outcome>) {
  const cases = Object.entries(expected).map(([domain, outcome]) => ({ domain, expected: outcome,
    actual: results.find(result => result.domain === domain)?.outcome ?? null }));
  const passed = cases.filter(item => item.expected === item.actual).length;
  return { cases, passed, total: cases.length, unexpected: results.filter(item => !(item.domain in expected)).map(item => item.domain),
    falsePublications: cases.filter(item => item.actual === 'QUALIFIED' && item.expected !== 'QUALIFIED').length,
    withheldQualified: cases.filter(item => item.expected === 'QUALIFIED' && item.actual !== 'QUALIFIED').length };
}

export async function saveEvaluation(pool: Pool, runId: string, kind: 'LIVE' | 'FIXTURE', report: unknown) {
  await pool.query(`INSERT INTO origin_evaluations(run_id,policy_version,kind,report) VALUES($1,$2,$3,$4)
    ON CONFLICT(run_id) DO NOTHING`, [runId, POLICY_VERSION, kind, JSON.stringify(report)]);
}

export async function evaluations(pool: Pool, limit: number) {
  return (await pool.query(`SELECT run_id,policy_version,kind,created_at,report FROM origin_evaluations ORDER BY created_at DESC LIMIT $1`, [limit])).rows;
}
