import 'server-only';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { pool } from './pg_setup';
import { SESSION_COOKIE, sameOrigin, verifySession } from './dashboard-session';

export const AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS compel_admin_sessions (id UUID PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS compel_login_limits (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
`;
export async function ensureAuthSchema() { await pool.query(AUTH_SCHEMA); }

export const adminSession = cache(async () => {
  const session = verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const result = await pool.query('SELECT id FROM compel_admin_sessions WHERE id=$1 AND expires_at > NOW()', [session.id]);
  return result.rows.length ? session : null;
});

// Every internal action checks this even when called through a public portal URL.
export async function requireAdmin() {
  if (!await adminSession()) throw new Error('Sign in to your Compel workspace to continue.');
  const requestHeaders = await headers();
  const origin = requestHeaders.get('origin');
  if (origin && !sameOrigin(origin, requestHeaders.get('host')))
    throw new Error('This request must come from your Compel workspace.');
}
