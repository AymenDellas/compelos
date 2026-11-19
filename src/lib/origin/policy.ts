import { createHash } from 'node:crypto';
import { z } from 'zod';

export const POLICY_VERSION = 'origin-v1';
export const gateNames = ['identity', 'niche', 'geography', 'substance', 'acquisition', 'opportunity', 'contact'] as const;
export type GateName = typeof gateNames[number];
export type Outcome = 'QUALIFIED' | 'UNRESOLVED' | 'REJECTED';
export type Method = 'Wikidata' | 'ECHO' | 'CONSTELLATION' | 'IGNITION';

export const settingsSchema = z.object({
  intervalMinutes: z.number().int().min(60).max(43_200).nullable(),
  candidateLimit: z.number().int().min(1).max(24),
  runMinutes: z.number().int().min(2).max(30),
  browser: z.boolean(),
  activityDays: z.number().int().min(30).max(180),
  runBudgetCents: z.number().int().min(0).max(10_000),
  dailyBudgetCents: z.number().int().min(0).max(50_000),
  monthlyBudgetCents: z.number().int().min(0).max(250_000),
  modelCalls: z.number().int().min(0).max(5),
}).strict();
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = {
  intervalMinutes: null, candidateLimit: 8, runMinutes: 10, browser: true, activityDays: 120,
  runBudgetCents: 200, dailyBudgetCents: 600, monthlyBudgetCents: 2500, modelCalls: 0,
};

export type Seed = {
  method: Method;
  name: string;
  website: string;
  source: string;
  sourceKey: string;
  excerpt: string;
  occurredAt?: string;
  parent?: string;
};

export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export type Evidence = {
  id: string;
  url: string;
  kind: 'source' | 'official' | 'external' | 'http' | 'browser' | 'change';
  excerpt: string;
  observedAt: string;
  digest: string;
  method: string;
};
export function observe(kind: Evidence['kind'], url: string, excerpt: string, method: string, bytes?: Buffer): Evidence {
  const observedAt = new Date().toISOString();
  const digest = hash(bytes ?? excerpt);
  return { id: hash(JSON.stringify([kind, url, observedAt, digest, method])), url, kind, excerpt, method, observedAt, digest };
}

export type Gate = {
  name: GateName;
  state: 'VERIFIED' | 'UNVERIFIED' | 'CONTRADICTED' | 'STALE';
  assertion: string;
  evidence: string[];
  expiresAt: string | null;
};

const days = { identity: 60, niche: 14, geography: 30, substance: 60, acquisition: 14, opportunity: 1, contact: 7 };
export function finding(name: GateName, state: Gate['state'], assertion: string, evidence: Evidence[] = []): Gate {
  const oldest = Math.min(...evidence.map(item => Date.parse(item.observedAt)));
  return { name, state, assertion, evidence: evidence.map(item => item.id), expiresAt: Number.isFinite(oldest)
    ? new Date(oldest + days[name] * 86_400_000).toISOString() : null };
}

export function decide(findings: Gate[], evidence: Evidence[], now = Date.now()) {
  const ids = new Set(evidence.map(item => item.id));
  const gates = gateNames.map(name => {
    const matches = findings.filter(item => item.name === name);
    const gate = matches[0];
    if (matches.length !== 1 || !gate.evidence.length || !gate.evidence.every(id => ids.has(id))) {
      return finding(name, 'UNVERIFIED', gate?.state === 'UNVERIFIED' ? gate.assertion : 'Evidence for this requirement is incomplete.');
    }
    if (!gate.expiresAt || Date.parse(gate.expiresAt) <= now) return { ...gate, state: 'STALE' as const };
    return gate;
  });
  const outcome: Outcome = gates.some(gate => gate.state === 'CONTRADICTED') ? 'REJECTED'
    : gates.every(gate => gate.state === 'VERIFIED') ? 'QUALIFIED' : 'UNRESOLVED';
  const expiresAt = outcome === 'QUALIFIED' ? gates.map(gate => gate.expiresAt!).sort()[0] : null;
  return { version: POLICY_VERSION, outcome, gates, expiresAt, decidedAt: new Date(now).toISOString() };
}
export type Decision = ReturnType<typeof decide>;

export type SourceResult = { adapter: string; discovered: number; elapsedMs: number; status: 'OK' | 'FAILED' | 'DEFERRED'; code?: string; retryAt?: string };

export type JourneyStep = { from: string; url: string; label: string; result: string; evidence: string };
export type Checkpoint = {
  evidence: Evidence[];
  gates: Gate[];
  journey: JourneyStep[];
  offer?: string;
  country?: 'US' | 'UK' | 'CA';
  contact?: string;
  signature?: { offer: string; booking: string };
  changes?: string[];
  advisory?: { assessment: string; evidence: string };
  breakage?: { url: string; from: string; label: string; status: number; evidence: string; alternatives: boolean };
  acquisitionSources?: number;
};
export const emptyCheckpoint = (): Checkpoint => ({ evidence: [], gates: [], journey: [] });
