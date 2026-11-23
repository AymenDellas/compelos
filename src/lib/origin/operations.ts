import { setTimeout as delay } from 'node:timers/promises';
import type { Pool } from 'pg';
import { createLimiter } from '../bounded-work.cjs';
import { MAX_RUN_MINUTES } from './policy';
import { runSummary } from './read-model';
import type { RunSummary } from './read-model';
import { createOriginLane } from './worker';
import type { PublicWeb } from './public-web';

export async function notifyAgent(pool: Pool) {
  await pool.query("SELECT pg_notify('compel_engine_wake','origin')");
}

export async function agentOnline(pool: Pool) {
  const exists = (await pool.query("SELECT to_regclass('compel_worker_config') IS NOT NULL AS present")).rows[0].present;
  if (!exists) return false;
  return Boolean((await pool.query(`SELECT COALESCE(supervisor_seen_at>now()-interval '45 seconds',false)
    AND (to_jsonb(compel_worker_config)->'agent_status'->>'stage') IS DISTINCT FROM 'OFFLINE' AS online
    FROM compel_worker_config WHERE id=1`)).rows[0]?.online);
}

const localRuns = (globalThis as typeof globalThis & { compelOriginLocalRuns?: Map<string, { resumed: boolean }> })
  .compelOriginLocalRuns ??= new Map();

export function driveLocalRun(pool: Pool, id: string) {
  const existing = localRuns.get(id);
  if (existing) { existing.resumed = true; return; }
  const running = { resumed: false };
  localRuns.set(id, running);
  const signal = AbortSignal.timeout((MAX_RUN_MINUTES + 3) * 60_000);
  void followRun(pool, id, { drive: true, signal }).catch(() => {
    // The PostgreSQL lease expires if the local host stops or loses its connection.
    console.error(`ORIGIN local run ${id} stopped. Its checkpoints remain in PostgreSQL.`);
  }).finally(() => {
    localRuns.delete(id);
    if (running.resumed) driveLocalRun(pool, id);
  });
}

export async function followRun(pool: Pool, id: string, options: { signal: AbortSignal; drive?: boolean; web?: PublicWeb;
  progress?: (run: RunSummary) => void; replaceAfter?: number }) {
  const limit = createLimiter(3, 96);
  const createLane = () => createOriginLane(pool, limit, { runId: id, web: options.web });
  let lane = options.drive ? createLane() : undefined;
  let nextAgentCheck = 0;
  const stop = () => lane?.stop();
  options.signal.addEventListener('abort', stop, { once: true });
  let last = '';
  let checkpoints = 0;
  try {
    while (true) {
      options.signal.throwIfAborted();
      const run = await runSummary(pool, id);
      if (!run) throw new Error('This run does not exist.');
      const state = JSON.stringify([run.state, run.discovery_pending, run.batch_number, run.qualified_progress, run.counts]);
      if (last !== state) {
        options.progress?.(run);
        last = state;
      }
      if (!['QUEUED', 'RUNNING'].includes(run.state)) return run;
      // Prefer the existing worker as soon as it owns the machine.
      if (options.drive && Date.now() >= nextAgentCheck) {
        const online = await agentOnline(pool);
        if (online) { lane?.stop(); lane = undefined; }
        else lane ??= createLane();
        nextAgentCheck = Date.now() + 3_000;
      }
      if (!lane || !await lane.runOnce()) {
        await delay(1500, undefined, { signal: options.signal });
        lane?.wake();
      } else if (++checkpoints === options.replaceAfter) {
        lane.stop();
        lane = createLane();
      }
    }
  } finally {
    stop();
    options.signal.removeEventListener('abort', stop);
  }
}
