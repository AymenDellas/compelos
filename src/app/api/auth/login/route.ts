import { createHmac } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/pg_setup';
import { ensureAuthSchema } from '@/lib/dashboard-auth';
import { createSession, SESSION_COOKIE, SESSION_SECONDS, sameOrigin, verifyPassword } from '@/lib/dashboard-session';

export const dynamic = 'force-dynamic';
const answer = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers.get('origin'), request.headers.get('host'))) return answer('Invalid request origin.', 403);
  if (!process.env.DASHBOARD_PASSWORD_HASH || !process.env.DASHBOARD_SESSION_SECRET) return answer('Workspace login is being configured. Please try again shortly.', 503);
  if (!request.headers.get('content-type')?.includes('application/json') || Number(request.headers.get('content-length') || 0) > 512) return answer('Invalid login request.', 400);
  let password: unknown;
  try {
    const body = await request.text();
    if (body.length > 512) return answer('Invalid login request.', 400);
    password = JSON.parse(body).password;
  } catch { return answer('Enter your workspace password.', 400); }
  if (typeof password !== 'string' || !password || password.length > 128) return answer('Enter your workspace password.', 400);
  try {
    await ensureAuthSchema();
    // Vercel supplies this trusted header. Do not trust arbitrary forwarded IPs.
    const ip = process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown' : 'local';
    const bucket = createHmac('sha256', process.env.DASHBOARD_SESSION_SECRET).update(ip).digest('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, maximum] of [[bucket, 5], ['all-logins', 100]] as const) {
        const result = await client.query(`INSERT INTO compel_login_limits(bucket,attempts,expires_at) VALUES($1,1,NOW()+INTERVAL '15 minutes')
          ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN compel_login_limits.expires_at <= NOW() THEN 1 ELSE compel_login_limits.attempts+1 END,
          expires_at=CASE WHEN compel_login_limits.expires_at <= NOW() THEN NOW()+INTERVAL '15 minutes' ELSE compel_login_limits.expires_at END RETURNING attempts`, [key]);
        if (result.rows[0].attempts > maximum) { await client.query('COMMIT'); return answer('Too many attempts. Please try again in 15 minutes.', 429); }
      }
      if (!verifyPassword(password)) { await client.query('COMMIT'); return answer('That password is incorrect.', 401); }
      const { session, token } = createSession();
      await client.query('INSERT INTO compel_admin_sessions(id,expires_at) VALUES($1,to_timestamp($2))', [session.id, session.expires]);
      await client.query('DELETE FROM compel_login_limits WHERE bucket=$1 OR expires_at <= NOW()', [bucket]);
      await client.query('DELETE FROM compel_admin_sessions WHERE expires_at <= NOW()');
      await client.query('COMMIT');
      const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
      response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'strict', path: '/', maxAge: SESSION_SECONDS });
      return response;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } catch { return answer('Could not sign in right now. Please try again.', 503); }
}
