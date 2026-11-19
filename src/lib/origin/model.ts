import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { createAgentRouterCompletion } from '../copy-studio/server/agentrouter-client';
import type { AgentRouterRequestPolicy } from '../copy-studio/server/agentrouter-relay';
import { AgentRouterModelUnavailable, AppError } from '../copy-studio/server/errors';
import type { ProviderConfig } from '../copy-studio/server/provider';
import { hash, observe } from './policy';
import type { Checkpoint } from './policy';
import { retryAt } from './public-web';
import { fenced } from './store';
import type { Job, Run } from './store';

const outputTokens = 512;
const maxInputBytes = 4096;
const advisorySchema = z.object({ assessment: z.enum(['REPAIR_BOOKING_LINK', 'CHECK_FOR_ALTERNATE_FLOW', 'INSUFFICIENT_CONTEXT']) }).strict();
const tokenSchema = z.object({ usage: z.object({ total_tokens: z.number().int().nonnegative().max(1_000_000) }) });
type Advisory = z.infer<typeof advisorySchema>;
const promptRevision = 'origin-cta-advisory-v1';

export function readModelConfig() {
  const model = process.env.AGENTROUTER_MODEL?.trim();
  const baseUrl = process.env.AGENTROUTER_BASE_URL || 'https://agentrouter.org/v1';
  const apiKey = process.env.AGENTROUTER_API_KEY?.trim();
  const ceiling = Number(process.env.ORIGIN_AGENTROUTER_MAX_CENTS);
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || !['agentrouter.org', 'www.agentrouter.org'].includes(url.hostname)) return null;
    if (model && apiKey && Number.isInteger(ceiling) && ceiling > 0 && ceiling <= 200) {
      return { config: { apiKey, baseUrl: url.href, model, timeoutMs: 12_000 }, ceiling };
    }
  } catch { /* unavailable provider configuration */ }
  return null;
}

export function classifyModelError(error: unknown, status?: number) {
  if (status === 401 || status === 403) return { code: 'AUTH_REQUIRED', cooldownMs: 24 * 60 * 60_000 };
  if (status === 402 || (error instanceof AppError && /quota|balance|credits/i.test(error.message))) return { code: 'QUOTA', cooldownMs: 24 * 60 * 60_000 };
  if (status === 429 || (error instanceof AppError && error.status === 429)) return { code: 'RATE_LIMIT', cooldownMs: 60_000 };
  if (error instanceof AgentRouterModelUnavailable || status === 503) return { code: 'MODEL_UNAVAILABLE', cooldownMs: 15 * 60_000 };
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return { code: 'TIMEOUT', cooldownMs: 60_000 };
  if (error instanceof SyntaxError || error instanceof z.ZodError) return { code: 'INVALID_RESPONSE', cooldownMs: 60_000 };
  return { code: 'TRANSPORT', cooldownMs: 60_000 };
}

export async function readOrReserve(pool: Pool, run: Run, job: Job, model: string, cost: number, key: string, bytes: number) {
  return fenced(pool, run, async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('compelos:origin:model'))");
    const cache = await db.query<{ result: Advisory }>(`SELECT result FROM origin_model_usage WHERE cache_key=$1 AND model=$2 AND status='OK'
      AND created_at>now()-interval '14 days' ORDER BY created_at DESC LIMIT 1`, [key, model]);
    if (cache.rows[0]) return { result: cache.rows[0].result };
    const { rows: [usage] } = await db.query<{ run: number; day: number; month: number; calls: number; blocked: boolean; active: boolean; duplicate: boolean }>(`
      SELECT COALESCE(sum(reserved_cents) FILTER (WHERE run_id=$1),0)::int AS run,
        COALESCE(sum(reserved_cents) FILTER (WHERE created_at>=date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::int AS day,
        COALESCE(sum(reserved_cents) FILTER (WHERE created_at>=date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::int AS month,
        count(*) FILTER (WHERE run_id=$1)::int AS calls,
        COALESCE(bool_or(retry_at>now() OR created_at>now()-interval '1 minute'),false) AS blocked,
        COALESCE(bool_or(status='RESERVED' AND created_at>now()-interval '2 minutes'),false) AS active,
        COALESCE(bool_or(investigation_id=$2 AND cache_key=$3),false) AS duplicate
      FROM origin_model_usage WHERE created_at>=now()-interval '32 days' OR run_id=$1`, [run.id, job.id, key]);
    const settings = run.config;
    if (usage.blocked || usage.active || usage.duplicate || usage.calls >= settings.modelCalls ||
        usage.run + cost > settings.runBudgetCents || usage.day + cost > settings.dailyBudgetCents || usage.month + cost > settings.monthlyBudgetCents) return null;
    const id = randomUUID();
    await db.query(`INSERT INTO origin_model_usage(id,run_id,investigation_id,cache_key,model,reserved_cents,input_bytes,output_limit)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, run.id, job.id, key, model, cost, bytes, outputTokens]);
    return { id };
  });
}

export async function modelAdvisory(pool: Pool, run: Run, job: Job, checkpoint: Checkpoint, signal: AbortSignal,
  make = createAgentRouterCompletion, setup: { config: ProviderConfig; ceiling: number } | null = readModelConfig()) {
  // Model output is advisory. Send only structured observations derived by code, with no page text or addresses.
  const gate = checkpoint.gates.find(item => item.name === 'opportunity' && item.state === 'VERIFIED');
  if (!run.config.modelCalls || !setup || !gate || !checkpoint.breakage) return;
  const facts = { ctaType: 'direct booking link', observedStatus: checkpoint.breakage.status,
    observations: 2, alternateRouteObserved: false, service: 'coaching' };
  const input = JSON.stringify(facts);
  const { config, ceiling } = setup;
  const reservation = await readOrReserve(pool, run, job, config.model, ceiling, hash(`${promptRevision}:${input}`), Buffer.byteLength(input));
  if (!reservation) return;
  let result = reservation.result;
  if (reservation.id) {
    let status: number | undefined;
    let header: string | null = null;
    let tokens: number | null = null;
    const hooks: AgentRouterRequestPolicy = {
      maxInputBytes,
      onResponse(code, retryAfter) { status = code; header = retryAfter; },
      onFrame(payload) {
        const parsed = tokenSchema.safeParse(payload);
        if (parsed.success) tokens = parsed.data.usage.total_tokens;
      },
    };
    let failure: ReturnType<typeof classifyModelError> | undefined;
    try {
      signal.throwIfAborted();
      const response = await make(config, hooks)(
        'Review structured facts for a coaching booking journey. Return a JSON object containing only assessment, with one of REPAIR_BOOKING_LINK, CHECK_FOR_ALTERNATE_FLOW, INSUFFICIENT_CONTEXT. Do not infer traffic, results, or causality.',
        input, signal, outputTokens);
      result = advisorySchema.parse(JSON.parse(response));
    } catch (error) { failure = classifyModelError(error, status); }
    finally {
      await pool.query(`UPDATE origin_model_usage SET status=$2,result=$3,provider_tokens=$4,retry_at=$5 WHERE id=$1 AND status='RESERVED'`,
        [reservation.id, failure?.code ?? 'OK', result ? JSON.stringify(result) : null, tokens,
          failure ? retryAt(header ?? undefined, failure.cooldownMs + Math.floor(Math.random() * 5_000)) : null]);
    }
  }
  if (result) checkpoint.advisory = { ...result, evidence: gate.evidence[0] };
}
