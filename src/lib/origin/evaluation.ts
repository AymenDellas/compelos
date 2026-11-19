import type { Pool } from 'pg';
import { gateNames, POLICY_VERSION } from './policy';
import type { Decision, Gate, Outcome, PublisherAudit } from './policy';
import { modelUsage, runSummary } from './read-model';

export async function evaluate(pool: Pool, runId: string) {
  const run = await runSummary(pool, runId);
  if (!run) return null;
  const { rows } = await pool.query<{ id: string; name: string; domain: string; decision: Decision | null; stage: string; artifacts: number; publisher_audit: PublisherAudit[] | null }>(`
    SELECT j.id,b.name,b.domain,j.decision,j.stage,j.checkpoint->'publisherAudit' AS publisher_audit,
    (SELECT count(*)::int FROM origin_artifacts a WHERE a.investigation_id=j.id AND a.image IS NOT NULL) AS artifacts
    FROM origin_investigations j JOIN origin_businesses b ON b.id=j.business_id WHERE run_id=$1 ORDER BY b.domain`, [runId]);
  const gates = Object.fromEntries(gateNames.map(name => [name, { VERIFIED: 0, UNVERIFIED: 0, CONTRADICTED: 0, STALE: 0 } as Record<Gate['state'], number>]));
  const blockers = new Map<string, { gate: string; state: Gate['state']; reason: string; count: number }>();
  for (const row of rows) for (const gate of row.decision?.gates ?? []) {
    gates[gate.name][gate.state]++;
    if (gate.state === 'VERIFIED') continue;
    const key = `${gate.name}:${gate.state}:${gate.assertion}`;
    const group = blockers.get(key) ?? { gate: gate.name, state: gate.state, reason: gate.assertion, count: 0 };
    group.count++;
    blockers.set(key, group);
  }
  const publisherChecks = [...new Map([...(run.sources ?? []).flatMap(source => source.publisherAudit ?? []), ...rows.flatMap(row => row.publisher_audit ?? [])]
    .map(check => [`${check.url}:${check.code}`, check])).values()];
  return {
    run, gates, publisherChecks, blockers: [...blockers.values()].sort((a, b) => b.count - a.count || a.gate.localeCompare(b.gate)),
    investigated: rows.length, captures: rows.reduce((sum, row) => sum + row.artifacts, 0), usage: await modelUsage(pool, runId),
    results: rows.map(row => ({ id: row.id, name: row.name, domain: row.domain, stage: row.stage, outcome: row.decision?.outcome ?? null,
      policy: row.decision?.version ?? null, blockers: row.decision?.gates.filter(gate => gate.state !== 'VERIFIED') ?? [] })),
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
