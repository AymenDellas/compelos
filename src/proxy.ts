import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, sameOrigin, verifySession } from '@/lib/dashboard-session';

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const publicPage = path === '/login' || path === '/api/auth/login' ||
    /^\/portal\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/agreement)?\/?$/i.test(path);
  if (publicPage) return NextResponse.next();
  if (!verifySession(request.cookies.get(SESSION_COOKIE)?.value)) {
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method))
      return NextResponse.json({ error: 'Sign in to your Compel workspace.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    const target = new URL('/login', request.url);
    target.searchParams.set('next', path + request.nextUrl.search);
    return NextResponse.redirect(target);
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
    !sameOrigin(request.headers.get('origin'), request.headers.get('host')))
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|pdf.worker.min.mjs).*)'] };
