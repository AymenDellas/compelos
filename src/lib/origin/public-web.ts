import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { funnelUrl } from '../funnel-browser';
import { fetchPublicPage } from '../prospect-research.cjs';
import { domain } from './policy';

export const userAgent = 'Compel-Origin/0.1 (public business research; https://github.com/AymenDellas/compelos)';
const excluded = /(?:^|\.)(?:linkedin\.com|licdn\.com|facebook\.com|instagram\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|tiktok\.com|linktr\.ee|bit\.ly|wixsite\.com|wordpress\.com|blogspot\.com)$/i;
const actionPath = /(?:^|\/)(?:wp-admin|wp-login\.php|login|sign-?in|logout|register|submit|api|admin|cart|pay|payment|checkout|unsubscribe|confirm|cancel|reschedule)(?:\/|$)/i;
export const redirectCodes = [301, 302, 303, 307, 308];

function indexUrl(value: string, host: string) {
  const url = funnelUrl(value);
  const wordpress = host === 'public-api.wordpress.com' && /^\/rest\/v1\.2\/read\/tags\/[a-z-]{3,35}\/posts$/.test(url.pathname) &&
    [...url.searchParams].every(([key, item]) => key === 'number' && item === '24' ||
      key === 'fields' && item === 'URL,site_URL,title,date,excerpt' || key === 'before' && /^\d{4}-\d\d-\d\dT00:00:00Z$/.test(item));
  const matches = host === 'api.gdeltproject.org' && url.pathname === '/api/v2/doc/doc' || host === 'www.wikidata.org' && url.pathname === '/w/api.php' ||
    host === 'www.find-tender.service.gov.uk' && /^\/api\/1\.0\/ocdsReleasePackages(?:\/\d{6}-\d{4})?$/.test(url.pathname) ||
    host === 'www.contractsfinder.service.gov.uk' && url.pathname === '/Published/Notices/OCDS/Search';
  if (!(matches || wordpress) || url.protocol !== 'https:' || url.host !== host) throw new PublicFailure('UNVERIFIED_SOURCE');
  return url;
}

export function websiteUrl(value: string) {
  const url = funnelUrl(value);
  const hostname = url.hostname.replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!hostname.includes('.') || isIP(hostname) || excluded.test(hostname) || actionPath.test(decodeURIComponent(url.pathname))) {
    throw new Error('Unsupported public business destination.');
  }
  return url;
}

export function documentUrl(value: string) {
  const url = websiteUrl(value);
  const acuity = url.protocol === 'https:' && /^(?:[a-z\d-]+\.as\.me|app\.acuityscheduling\.com)$/i.test(url.hostname) &&
    /^(?:\/schedule\.php|\/schedule\/[a-z\d]+(?:\/(?:appointment|calendar)\/\d+){0,2}|\/*)$/i.test(url.pathname);
  for (const [key, value] of [...url.searchParams]) {
    if (/^(?:utm_[a-z]+|gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
    else if (!acuity || !/^(?:owner|appointmentType|calendarID|calendarIds)$/.test(key) ||
      !/^\d{1,12}(?:,\d{1,12}){0,4}$/.test(value) || url.searchParams.getAll(key).length !== 1)
      throw new Error('A parameterized public action was skipped.');
  }
  return url;
}

export function hostedBooking(url: string) {
  return /(?:^|\.)(?:eventbrite\.(?:com|ca|co\.uk)|lu\.ma|luma\.com|calendly\.com|acuityscheduling\.com|as\.me|cal\.com|koalendar\.com|youcanbook\.me|savvycal\.com|meetup\.com|zoom\.us|zoom\.com|jotform\.com|typeform\.com|booking\.page|square\.site|tally\.so|bookwhen\.com|tickettailor\.com|sessions\.us|simplybook\.me|eventcreate\.com|outlook\.office(?:365)?\.com)$/i.test(domain(url));
}

export function robotsAllows(text: string, path: string) {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let group: typeof groups[number] | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.split('#', 1)[0].match(/^\s*(user-agent|allow|disallow)\s*:\s*(.*?)\s*$/i);
    if (!match) continue;
    const [, field, value] = match;
    if (field.toLowerCase() === 'user-agent') {
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group); }
      group.agents.push(value.toLowerCase());
    } else if (group) group.rules.push({ allow: field.toLowerCase() === 'allow', path: value });
  }
  const exact = groups.filter(item => item.agents.includes('compel-origin'));
  const rules = (exact.length ? exact : groups.filter(item => item.agents.includes('*'))).flatMap(item => item.rules);
  const matches = rules.filter(rule => {
    if (!rule.path || !rule.path.startsWith('/')) return false;
    // Encode both sides consistently and compare RFC 9309 wildcards and end anchor.
    const normalized = (value: string) => encodeURI(value).replace(/%25([\da-f]{2})/gi, (_all, hex: string) => {
      const character = String.fromCharCode(parseInt(hex, 16));
      return /[a-z\d._~-]/i.test(character) ? character : `%${hex.toUpperCase()}`;
    });
    const terminal = rule.path.endsWith('$');
    const pattern = normalized(terminal ? rule.path.slice(0, -1) : rule.path).split('*')
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}${terminal ? '$' : ''}`).test(normalized(path));
  }).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return matches[0]?.allow ?? true;
}

export class PublicFailure extends Error {
  constructor(readonly code: string, readonly retryAt?: string) { super(code); }
}
export function retryAt(header: string | undefined, fallbackMs: number) {
  const time = header && (/^\d+$/.test(header) ? Date.now() + Number(header) * 1000 : Date.parse(header));
  return new Date(Math.min(Date.now() + 7 * 86_400_000, Math.max(Date.now() + fallbackMs, Number(time) || 0))).toISOString();
}

type Resource = Awaited<ReturnType<typeof fetchResource>>;
function fetchResource(url: string, signal: AbortSignal, jsonBody?: string) {
  return fetchPublicPage(url, { resource: true, followRedirects: false, signal, userAgent, jsonBody });
}

export function createPublicWeb(limit: <T>(run: () => Promise<T>) => Promise<T>, transport = fetchResource) {
  const robots = new Map<string, { expires: number; rules: Promise<string> }>();
  const cooldowns = new Map<string, number>();
  const lastDocument = new Map<string, number>();
  async function get(url: URL, signal: AbortSignal, jsonBody?: string) {
    const host = domain(url.href);
    const wait = cooldowns.get(host) ?? 0;
    if (wait > Date.now()) throw new PublicFailure('RATE_LIMITED', new Date(wait).toISOString());
    const response = await limit(() => transport(url.href, signal, jsonBody));
    if (response.status === 429 || (response.status === 503 && response.headers['retry-after'])) {
      const restore = retryAt(response.headers['retry-after'], 60 * 60_000);
      cooldowns.set(host, Date.parse(restore));
      throw new PublicFailure('RATE_LIMITED', restore);
    }
    return response;
  }
  async function getRobots(origin: string, signal: AbortSignal) {
    let url = new URL('/robots.txt', origin);
    for (let hop = 0; hop < 4; hop++) {
      const response = await get(url, signal);
      if (response.status === 404 || response.status === 410) return '';
      if (redirectCodes.includes(response.status) && response.headers.location) {
        url = websiteUrl(new URL(response.headers.location, url).href);
        if (domain(url.href) !== domain(origin)) break;
        continue;
      }
      if (response.status !== 200 || response.body.length > 512_000 || /text\/html/i.test(response.headers['content-type'] ?? '')) break;
      return response.body.toString('utf8');
    }
    throw new PublicFailure('ROBOTS_UNAVAILABLE');
  }
  async function admit(url: URL, signal: AbortSignal) {
    let entry = robots.get(url.origin);
    if (!entry || entry.expires <= Date.now()) {
      entry = { expires: Date.now() + 3_600_000, rules: getRobots(url.origin, signal).catch(error => { robots.delete(url.origin); throw error; }) };
      robots.set(url.origin, entry);
      for (const [host, saved] of robots) if (saved.expires <= Date.now()) robots.delete(host);
      for (const [host, at] of lastDocument) if (at < Date.now() - 3_600_000) lastDocument.delete(host);
      for (const [host, at] of cooldowns) if (at < Date.now()) cooldowns.delete(host);
    }
    if (!robotsAllows(await entry.rules, url.pathname + url.search)) throw new PublicFailure('ROBOTS_DISALLOWED');
  }
  async function readDocument(value: string, signal: AbortSignal, permit: (url: URL) => boolean) {
    let url = documentUrl(value);
    for (let hop = 0; hop < 5; hop++) {
      if (!permit(url)) throw new PublicFailure('UNVERIFIED_REDIRECT');
      await admit(url, signal);
      const host = domain(url.href);
      const now = Date.now();
      const slot = Math.max(now, (lastDocument.get(host) ?? 0) + 750);
      lastDocument.set(host, slot);
      const gap = slot - now;
      if (gap > 0) await delay(gap, undefined, { signal });
      const response = await get(url, signal);
      if (!permit(websiteUrl(response.url))) throw new PublicFailure('UNVERIFIED_REDIRECT');
      if (!redirectCodes.includes(response.status)) return response;
      if (!response.headers.location) break;
      url = documentUrl(new URL(response.headers.location, url).href);
    }
    throw new PublicFailure('UNVERIFIED_REDIRECT');
  }
  async function readIndex(url: URL, signal: AbortSignal, body?: string) {
    const response = await get(url, signal, body);
    if (response.url !== url.href || response.status !== 200) throw new PublicFailure(`HTTP_${response.status}`);
    if (!/json/i.test(response.headers['content-type'] ?? '')) throw new PublicFailure('UNREADABLE_SOURCE');
    try { return JSON.parse(response.body.toString('utf8')) as unknown; }
    catch { throw new PublicFailure('UNREADABLE_SOURCE'); }
  }
  return {
    document: readDocument,
    async asset(value: string, signal: AbortSignal, document: string): Promise<Resource> {
      const url = websiteUrl(value);
      if (domain(url.href) !== domain(document)) throw new PublicFailure('UNVERIFIED_REDIRECT');
      if (url.href !== document && (!/\.(?:css|js|mjs|png|jpe?g|webp|avif|gif|svg|ico|woff2?)$/i.test(url.pathname) ||
        [...url.searchParams].some(([key, value]) => !/^(?:v|ver|version)$/.test(key) || !/^[a-z\d._-]{1,30}$/i.test(value)))) {
        throw new PublicFailure('UNSUPPORTED_ASSET');
      }
      await admit(url, signal);
      return get(url, signal);
    },
    async api(value: string, host: string, signal: AbortSignal) {
      return readIndex(indexUrl(value, host), signal);
    },
    async publicSearch(query: string, country: 'us' | 'gb' | 'ca', signal: AbortSignal) {
      if (query.length > 240 || !query.trim() || !['us', 'gb', 'ca'].includes(country)) throw new PublicFailure('UNVERIFIED_SOURCE');
      return readIndex(new URL('https://www.searchia.com/api'), signal, JSON.stringify({ query, type: 'web', page: 0, country }));
    },
    async publicSearchDestination(link: string, result: string, signal: AbortSignal) {
      if (!/^\/go\/v1\/[a-z\d_-]{24,800}\?/i.test(link)) return result;
      const redirect = new URL(link, 'https://www.searchia.com');
      const host = domain(result);
      const expected = redirect.searchParams.get('h')?.toLowerCase().replace(/^www\./, '');
      if (expected !== host || redirect.searchParams.size !== 2 || !/^[a-z\d_-]{12,200}$/i.test(redirect.searchParams.get('s') ?? '')) return result;
      const response = await get(redirect, signal);
      if (!redirectCodes.includes(response.status) || !response.headers.location) return result;
      const destination = documentUrl(response.headers.location);
      return domain(destination.href) === host ? destination.href : result;
    },
  };
}
export type PublicWeb = ReturnType<typeof createPublicWeb>;
