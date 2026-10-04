import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { pool } from '../pg_setup';

const requestDatabase = new AsyncLocalStorage();
export async function withContentDatabase(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(83472112)');
    await client.query("CREATE TABLE IF NOT EXISTS compel_content_state (id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb, revision INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    await client.query("INSERT INTO compel_content_state(id) VALUES('workspace') ON CONFLICT DO NOTHING");
    const result = await client.query("SELECT data FROM compel_content_state WHERE id='workspace' FOR UPDATE");
    const db = { data: result.rows[0].data, dirty: false };
    const value = await requestDatabase.run(db, work);
    if (value && typeof value.status === 'number' && value.status >= 400) {
      await client.query('ROLLBACK');
      return value;
    }
    if (db.dirty) await client.query("UPDATE compel_content_state SET data=$1,revision=revision+1,updated_at=NOW() WHERE id='workspace'", [JSON.stringify(db.data)]);
    await client.query('COMMIT');
    return value;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

const names = new Set(['posts', 'ideas', 'concepts', 'beliefs', 'settings', 'funnels', 'scoutRuns', 'ideaUsage', 'metrics', 'feedback']);

export function openDatabase() {
  const current = requestDatabase.getStore();
  if (current) return current;
  throw new Error('Create storage must use the shared database.');
}

function table(name) { if (!names.has(name)) throw new Error('Invalid collection'); return name; }
function read(db) {
  if (db.data) return db.data;
  throw new Error('Create storage is unavailable.');
}
function write(db, data) {
  if (db.data) { db.data = data; db.dirty = true; return; }
  throw new Error('Create storage is unavailable.');
}
export function list(db, name) {
  const rows = read(db)[table(name)] || {};
  return Object.values(rows).sort((a,b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}
export function get(db, name, id) { return read(db)[table(name)]?.[id] || null; }
export function put(db, name, value) {
  table(name);
  const data = read(db);
  const rows = data[name] || {};
  const current = value.id ? rows[value.id] : null;
  const now = new Date(Math.max(Date.now(), Date.parse(current?.updatedAt || '') + 1 || 0)).toISOString();
  const next = { ...current, ...value, id:value.id || randomUUID(), createdAt:current?.createdAt || now, updatedAt:now };
  data[name] = { ...rows, [next.id]:next };
  write(db, data);
  return next;
}
export function remove(db, name, id) {
  table(name);
  const data = read(db);
  if (!data[name]?.[id]) return false;
  delete data[name][id];
  if (name === 'posts') data.metrics = Object.fromEntries(Object.entries(data.metrics || {}).filter(([,row]) => row.postId !== id));
  write(db, data);
  return true;
}
export function addMetrics(db, postId, values) { return put(db, 'metrics', {postId, recordedAt:new Date().toISOString(), ...values}); }
export function latestMetrics(db) {
  const latest = new Map();
  for (const row of list(db, 'metrics').sort((a,b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))) {
    if (!latest.has(row.postId)) latest.set(row.postId, row);
  }
  return [...latest.values()];
}
