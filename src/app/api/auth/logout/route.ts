import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/dashboard-auth';
import { pool } from '@/lib/pg_setup';
import { SESSION_COOKIE, verifySession } from '@/lib/dashboard-session';
export async function POST(request: NextRequest) {
  await requireAdmin();
  const session = verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) await pool.query('DELETE FROM compel_admin_sessions WHERE id=$1', [session.id]);
  const response = NextResponse.redirect(new URL('/login', request.url), 303);
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
