import { pool } from './pg_setup';
export async function savedRuns() {
  await pool.query("CREATE TABLE IF NOT EXISTS compel_saved_runs (filename TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  return pool;
}
