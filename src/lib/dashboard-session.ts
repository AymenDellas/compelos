import { createHmac, randomUUID, timingSafeEqual, scryptSync } from 'node:crypto';

export const SESSION_COOKIE = 'compel_session';
export const SESSION_SECONDS = 8 * 60 * 60;
type Session = { id: string; expires: number; version: string };

function signingKey() {
  const key = process.env.DASHBOARD_SESSION_SECRET;
  if (!key || key.length < 32 || !process.env.DASHBOARD_PASSWORD_HASH) return null;
  return key;
}
function version(key: string) {
  return createHmac('sha256', key).update(process.env.DASHBOARD_PASSWORD_HASH!).digest('hex').slice(0, 16);
}
export function createSession(now = Date.now()) {
  const key = signingKey();
  if (!key) throw new Error('Dashboard login is not configured.');
  const session: Session = { id: randomUUID(), expires: Math.floor(now / 1000) + SESSION_SECONDS, version: version(key) };
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return { session, token: `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}` };
}
export function verifySession(token: string | undefined, now = Date.now()): Session | null {
  const key = signingKey();
  if (!key || !token || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    const actual = Buffer.from(parts[1], 'base64url');
    const expected = createHmac('sha256', key).update(parts[0]).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const session = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as Session;
    const seconds = Math.floor(now / 1000);
    if (!/^[0-9a-f-]{36}$/.test(session.id) || !Number.isSafeInteger(session.expires) ||
      session.expires <= seconds || session.expires > seconds + SESSION_SECONDS || session.version !== version(key)) return null;
    return session;
  } catch { return null; }
}
export function verifyPassword(password: string) {
  const stored = process.env.DASHBOARD_PASSWORD_HASH;
  if (!stored || password.length > 128) return false;
  const [algorithm, salt, hash] = stored.split(':');
  if (algorithm !== 'scrypt' || !/^[0-9a-f]{32}$/.test(salt || '') || !/^[0-9a-f]{128}$/.test(hash || '')) return false;
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
export function sameOrigin(origin: string | null, host: string | null) {
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
