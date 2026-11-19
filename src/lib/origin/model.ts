import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { createAgentRouterCompletion } from '../copy-studio/server/agentrouter-client';
import type { AgentRouterRequestPolicy } from '../copy-studio/server/agentrouter-relay';
import { AgentRouterModelUnavailable, AppError } from '../copy-studio/server/errors';
import type { ProviderConfig } from '../copy-studio/server/provider';
import { agentRouterHeaders, readResponsesPayload } from '../content-create/responses-stream.js';
import { hash, observe } from './policy';
import type { Checkpoint } from './policy';
import { retryAt } from './public-web';
import { fenced } from './store';
import type { Job, Run } from './store';

const outputTokens = 4096;
const maxInputBytes = 8192;
type ModelSetup = { config: ProviderConfig; ceiling: number; checkPrice?: boolean };
const nextChecks = {
  VERIFY_MARKET: 'geography',
  VERIFY_COMMERCIAL_EVIDENCE: 'substance',
  VERIFY_ACQUISITION_ACTIVITY: 'acquisition',
  VERIFY_BOOKING_JOURNEY: 'opportunity',
  VERIFY_INQUIRY_ROUTE: 'contact',
} as const;
const advisorySchema = z.object({ assessment: z.enum(['REPAIR_BOOKING_LINK', 'CHECK_FOR_ALTERNATE_FLOW', 'INSUFFICIENT_CONTEXT',
  'VERIFY_MARKET', 'VERIFY_COMMERCIAL_EVIDENCE', 'VERIFY_ACQUISITION_ACTIVITY', 'VERIFY_BOOKING_JOURNEY', 'VERIFY_INQUIRY_ROUTE']) }).strict();
const tokenSchema = z.object({ usage: z.object({ total_tokens: z.number().int().nonnegative().max(1_000_000) }) });
type Advisory = z.infer<typeof advisorySchema>;
const promptRevision = 'origin-evidence-review-v3';

export function readModelConfig(): ModelSetup | null {
  const model = process.env.ORIGIN_AGENTROUTER_MODEL?.trim() || 'gpt-6.1-sol';
  const baseUrl = process.env.AGENTROUTER_BASE_URL || 'https://agentrouter.org/v1';
  const ceiling = Number(process.env.ORIGIN_AGENTROUTER_MAX_CENTS || 50);
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || !['agentrouter.org', 'www.agentrouter.org'].includes(url.hostname)) return null;
    // Reuse the application's proven Responses credential only at its configured provider endpoint.
    const copyEndpoint = (process.env.COPY_STUDIO_BASE_URL || baseUrl).replace(/\/$/, '');
    const responsesKey = /^(?:openai\/)?gpt-/i.test(model) && copyEndpoint === url.href.replace(/\/$/, '')
      ? process.env.COPY_STUDIO_API_KEY?.trim() : undefined;
    const apiKey = process.env.ORIGIN_AGENTROUTER_API_KEY?.trim() || responsesKey || process.env.AGENTROUTER_API_KEY?.trim();
    if (model && apiKey && Number.isInteger(ceiling) && ceiling > 0 && ceiling <= 200) {
      return { config: { apiKey, baseUrl: url.href, model, timeoutMs: 60_000 }, ceiling, checkPrice: true };
    }
  } catch { /* unavailable provider configuration */ }
  return null;
}

const pricingModel = z.object({ model_name: z.string(), model_ratio: z.number().positive(), completion_ratio: z.number().positive(), quota_type: z.literal(0) });
const pricingCatalog = z.object({ success: z.literal(true), data: z.array(z.unknown()), group_ratio: z.record(z.number().nonnegative()) });
let pricing: { url: string; expires: number; value: z.infer<typeof pricingCatalog> } | undefined;

export function reserveCents(catalog: z.infer<typeof pricingCatalog>, model: string) {
  const rates = catalog.data.flatMap(item => { const parsed = pricingModel.safeParse(item); return parsed.success ? [parsed.data] : []; });
  const rate = rates.find(item => item.model_name === model);
  if (!rate || !(catalog.group_ratio.default > 0)) return null;
  const group = Math.max(...Object.values(catalog.group_ratio));
  // Tokenization has an upper bound of one token per byte before framing. Include framing and a margin for group adjustments.
  return Math.max(1, Math.ceil((maxInputBytes + 1024 + outputTokens * rate.completion_ratio) * rate.model_ratio * group * 2 / 5_000));
}

async function price(setup: ModelSetup, signal: AbortSignal) {
  if (!setup.checkPrice) return setup.ceiling;
  const url = new URL('/api/pricing', setup.config.baseUrl).href;
  try {
    if (!pricing || pricing.url !== url || pricing.expires < Date.now()) {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]) });
      if (!response.ok) { await response.body?.cancel(); return null; }
      const value = pricingCatalog.parse(await response.json());
      pricing = { url, value, expires: Date.now() + 10 * 60_000 };
    }
    const quote = reserveCents(pricing.value, setup.config.model);
    return quote !== null && quote <= setup.ceiling ? quote : null;
  } catch { return null; }
}

function createResearchCompletion(config: ProviderConfig, hooks?: AgentRouterRequestPolicy) {
  if (!/^(?:openai\/)?gpt-/i.test(config.model)) return createAgentRouterCompletion(config, hooks);
  return async (system: string, prompt: string, signal: AbortSignal, maxTokens = outputTokens) => {
    if (Buffer.byteLength(system + prompt) > maxInputBytes) throw new Error('Research context exceeds the bounded request.');
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]);
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST', headers: agentRouterHeaders(config.apiKey), redirect: 'error', signal: requestSignal,
      body: JSON.stringify({ model: config.model, instructions: `${system}\nDo not call tools.`, input: `Return a JSON object.\n${prompt}`, stream: true, store: false,
        text: { format: { type: 'json_object' } }, max_output_tokens: Math.min(maxTokens, outputTokens), reasoning: { effort: 'low' } }),
    });
    hooks?.onResponse(response.status, response.headers.get('retry-after'));
    if (!response.ok) { await response.body?.cancel(); throw new AppError(response.status, 'AgentRouter rejected the research request.'); }
    const payload = await readResponsesPayload(response, requestSignal);
    hooks?.onFrame(payload);
    if (payload?.status !== 'completed') throw new SyntaxError('AgentRouter did not return a completed research response.');
    const result = z.object({ output: z.array(z.object({ type: z.string(), role: z.string().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })) }).parse(payload);
    return result.output.filter(item => item.type === 'message' && item.role === 'assistant')
      .flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text ?? '').join('\n');
  };
}

export function classifyModelError(error: unknown, status?: number) {
  if (status === 401 || status === 403) return { code: 'AUTH_REQUIRED', cooldownMs: 24 * 60 * 60_000 };
  if (status === 402 || (error instanceof AppError && /quota|balance|credits/i.test(error.message))) return { code: 'QUOTA', cooldownMs: 24 * 60 * 60_000 };
  if (status === 429 || (error instanceof AppError && error.status === 429)) return { code: 'RATE_LIMIT', cooldownMs: 60_000 };
  if (status === 400 || status === 422) return { code: 'REQUEST_REJECTED', cooldownMs: 15 * 60_000 };
  if (status === 404) return { code: 'ENDPOINT_UNAVAILABLE', cooldownMs: 15 * 60_000 };
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
  make = createResearchCompletion, setup = readModelConfig()) {
  if (!run.config.modelCalls || !setup || checkpoint.gates.some(item => item.state === 'CONTRADICTED')) return;
  const identity = checkpoint.gates.find(item => item.name === 'identity' && item.state === 'VERIFIED');
  const niche = checkpoint.gates.find(item => item.name === 'niche' && item.state === 'VERIFIED');
  if (!identity || !niche) return;
  // Send code-derived evidence types and coverage, avoiding page copy and contact data.
  const gate = checkpoint.gates.find(item => item.name === 'opportunity' && item.state === 'VERIFIED');
  const broken = gate && checkpoint.breakage;
  const options = Object.entries(nextChecks).filter(([, name]) => checkpoint.gates.find(item => item.name === name)?.state !== 'VERIFIED')
    .map(([check]) => check);
  if (!gate && !checkpoint.gates.some(item => ['geography', 'substance', 'acquisition'].includes(item.name) && item.state === 'VERIFIED')) return;
  const facts = { service: 'coaching', booking: checkpoint.funnel, contradictionReproduced: Boolean(gate && (checkpoint.bookingMismatch || checkpoint.inquiryMismatch)),
    ...(broken ? { observedStatus: broken.status, observations: 2, alternateRouteObserved: false } : {}),
    recentIndependentPublications: checkpoint.acquisitionSources ?? 0,
    scope: checkpoint.gates.map(item => ({ gate: item.name, state: item.state, supportingObservations: checkpoint.evidence
      .filter(observation => item.evidence.includes(observation.id)).map(observation => ({ kind: observation.kind, method: observation.method })).slice(0, 4) })),
    permittedAssessments: [...options, ...(broken ? ['REPAIR_BOOKING_LINK'] : []), ...(gate ? ['CHECK_FOR_ALTERNATE_FLOW'] : []), 'INSUFFICIENT_CONTEXT'] };
  const input = JSON.stringify(facts);
  const { config } = setup;
  const ceiling = await price(setup, signal);
  if (ceiling === null || signal.aborted) return;
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
        'Independently review the evidence coverage for a verified coaching business. Choose the follow-up with the most bearing on eligibility or a reproducible booking issue. Mark insufficient context when nothing is actionable. Use only supplied structured observations. Return a JSON object with only assessment, one value from permittedAssessments. Do not infer traffic, commercial performance, or facts about unseen pages.',
        input, signal, outputTokens);
      result = advisorySchema.parse(JSON.parse(response));
      if (!facts.permittedAssessments.includes(result.assessment)) {
        result = undefined;
        throw new SyntaxError('Assessment outside the permitted verification options.');
      }
    } catch (error) { failure = classifyModelError(error, status); }
    finally {
      await pool.query(`UPDATE origin_model_usage SET status=$2,result=$3,provider_tokens=$4,retry_at=$5,provider_status=$6 WHERE id=$1 AND status='RESERVED'`,
        [reservation.id, failure?.code ?? 'OK', result ? JSON.stringify(result) : null, tokens,
          failure ? retryAt(header ?? undefined, failure.cooldownMs + Math.floor(Math.random() * 5_000)) : null, status ?? null]);
    }
  }
  if (result && result.assessment !== 'INSUFFICIENT_CONTEXT') {
    const target = nextChecks[result.assessment as keyof typeof nextChecks];
    const proof = checkpoint.gates.find(item => item.name === target)?.evidence[0] ?? gate?.evidence[0] ?? niche.evidence[0];
    if (proof) checkpoint.advisory = { ...result, evidence: proof };
  }
}
