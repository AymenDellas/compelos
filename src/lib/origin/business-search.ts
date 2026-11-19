import { createSerperSearcher } from '../dorkEngine';
import { publisherPointer } from './auto-publishers';
import { domain, hash } from './policy';
import type { Seed } from './policy';
import { documentUrl, PublicFailure, retryAt } from './public-web';

export const businessSearchName = 'Serper · Business search';
export const activitySearchName = 'Serper · Publisher search';
export const campaignSearchName = 'Serper · Coaching campaigns';
export const businessSearchCredit = 'Serper organic search, discovery pointers only';

const markets = ['United States', 'United Kingdom', 'Canada'];
const specialties = [
  '"executive coaching" ("leadership team" OR "executive team")',
  '("CEO coaching" OR "founder coaching" OR "strategic leadership adviser")',
  '"leadership coaching" ("leadership development" OR "senior leaders")',
  '"business coaching" ("business owners" OR "growth program")',
  '"career coaching" ("senior professionals" OR "executive career")',
];
const excludedDomains = ['linkedin.com', 'facebook.com', 'instagram.com', 'youtube.com', 'reddit.com',
  'wikipedia.org', 'google.com', 'indeed.com', 'glassdoor.com', 'forbes.com', 'clutch.co', 'coachfederation.org', 'coachingfederation.org'];
const service = /\b(?:coach(?:es|ing)?|leadership development|leadership advis(?:er|or|ory)|executive advis(?:er|or|ory)|CEO mentor)\b/i;
const directory = /\b(?:top \d+|best \d+|find a coach|coach(?:es|ing) directory|certification|training for coaches|job openings)\b/i;
const genericName = /^(?:(?:home|services|programs?|offerings|work with us|about us)$|(?:executive|leadership|career|business|CEO|founder|corporate|team) (?:coaches?|coaching)(?:\s+(?:in|services|programs?)\b.*)?$)/i;

export function businessSearchQuery(attempt: number) {
  const market = markets[attempt % markets.length];
  const specialty = specialties[Math.floor(attempt / markets.length) % specialties.length];
  const intent = ['("book a discovery call" OR "schedule a consultation" OR "book a call")', '("client results" OR "case study" OR "leadership coaching program")', '("executive briefing" OR "coaching program" OR "coaching enquiry")'][Math.floor(attempt / (markets.length * specialties.length)) % 3];
  return `${specialty} "${market}" ${intent} -jobs -certification -directory -site:linkedin.com -site:indeed.com`;
}

export function businessSearchSeeds(rows: unknown[], limit: number, campaign = false): Seed[] {
  const results = new Map<string, Seed>();
  for (const row of rows.slice(0, 10)) {
    if (!row || typeof row !== 'object') continue;
    const { link, title, snippet } = row as Record<string, unknown>;
    if (typeof link !== 'string' || typeof title !== 'string' || directory.test(title) || /\b(?:frequently asked questions|what it is and when|request for proposals|contract for)\b/i.test(title)) continue;
    const description = typeof snippet === 'string' ? snippet.slice(0, 500) : '';
    if (!service.test(`${title} ${description}`)) continue;
    let url: URL;
    try { url = documentUrl(link); } catch { continue; }
    const host = domain(url.href);
    const key = campaign ? url.href : host;
    if (results.has(key) || /\.(?:gov|gov\.uk|edu)$/.test(host) || excludedDomains.some(blocked => host === blocked || host.endsWith(`.${blocked}`))) continue;
    if (/\/(?:directory|jobs?|certification)(?:\/|$)/i.test(url.pathname) || (!campaign && /\/(?:blog|news|articles?|podcast)(?:\/|$)/i.test(url.pathname))) continue;
    const parts = title.slice(0, 260).split(/\s*(?:\||[–—])\s*|\s+-\s+/).map(item => item.trim());
    const name = parts.find(item => item.length >= 3 && item.length <= 90 && !service.test(item) && !genericName.test(item))
      ?? parts.find(item => item.length >= 3 && item.length <= 90 && !genericName.test(item));
    if (!name) continue;
    results.set(key, { method: 'BUSINESS_SEARCH', name, website: campaign ? new URL('/', url).href : url.href, source: url.href,
      sourceKey: campaign ? `campaign:${hash(url.href)}` : `business-search:${host}`, discoveryPriority: campaign ? 7 : 5,
      ...(campaign ? { activityLinks: [url.href] } : {}),
      excerpt: `Serper indexed this URL under a title identifying ${name}. The business, offer and market require first-party verification.` });
    if (results.size >= limit) break;
  }
  return [...results.values()];
}

export function createEvidenceFollowUp() {
  const search = createBoundedSearch();
  if (search) return async (host: string, activityDays: number, purpose: 'campaign' | 'case', signal: AbortSignal) => {
    const since = new Date(Date.now() - activityDays * 86_400_000).toISOString().slice(0, 10);
    const query = purpose === 'campaign' ? `(webinar OR workshop OR cohort OR "podcast episode" OR "newsletter") after:${since}` :
      '("case study" OR "client stories" OR "client results") ("executive coaching" OR "business coaching" OR "coaching sessions")';
    const organic = await search(`site:${host} ${query}`, signal);
    return activitySearchPointers(organic).map(pointer => pointer.url).filter(url => domain(url) === host).slice(0, 3);
  };
}

function createBoundedSearch() {
  const key = [process.env.SERPER_API_KEY, ...Array.from({ length: 8 }, (_, index) => process.env[`SERPER_API_KEY_${index + 1}`])]
    .find(value => value?.trim());
  if (!key) return undefined;
  const search = createSerperSearcher(key);
  return async (query: string, signal: AbortSignal) => {
    let dispatched = false;
    try {
      return await search(query, 1, () => {
        if (dispatched) throw new PublicFailure('SEARCH_RETRY_DEFERRED', retryAt(undefined, 15 * 60_000));
        dispatched = true;
      }, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof PublicFailure) throw error;
      throw new PublicFailure('SEARCH_UNAVAILABLE', retryAt(undefined, 60 * 60_000));
    }
  };
}

export function createBusinessSearch() {
  const search = createBoundedSearch();
  if (search) return async (attempt: number, count: number, signal: AbortSignal) =>
    businessSearchSeeds(await search(businessSearchQuery(attempt), signal), count);
}

export function createCampaignSearch() {
  const search = createBoundedSearch();
  if (search) return async (attempt: number, activityDays: number, signal: AbortSignal) => {
    const market = markets[attempt % markets.length];
    const topic = specialties[attempt % specialties.length].split(' (')[0];
    const since = new Date(Date.now() - activityDays * 86_400_000).toISOString().slice(0, 10);
    const formats = ['("join" OR "register") (webinar OR workshop)', '("newsletter" OR "podcast") ("subscribe" OR "work with me")', '("applications open" OR "next cohort" OR "reserve your spot")'];
    const format = formats[(attempt % markets.length + Math.floor(attempt / markets.length)) % formats.length];
    const query = `${topic} "${market}" ${format} after:${since} -site:linkedin.com -site:youtube.com -site:reddit.com -site:eventbrite.com`;
    return businessSearchSeeds(await search(query, signal), 10, true);
  };
}

export function activitySearchPointers(rows: unknown[]) {
  const links = new Set<string>();
  for (const row of rows.slice(0, 10)) {
    if (!row || typeof row !== 'object' || !('link' in row) || typeof row.link !== 'string') continue;
    const url = publisherPointer(row.link);
    if (url) links.add(url);
  }
  return [...links].map(url => ({ url }));
}

export function createActivitySearch() {
  const search = createBoundedSearch();
  if (search) return async (attempt: number, activityDays: number, signal: AbortSignal) => {
    const topics = ['executive', 'leadership', 'business', 'career'];
    const topic = topics[attempt % topics.length];
    const since = new Date(Date.now() - activityDays * 86_400_000).toISOString().slice(0, 10);
    const query = `"${topic} coaching" ("podcast guest" OR "episode" OR "conference speaker" OR "guest interview") after:${since} -site:linkedin.com -site:youtube.com -site:reddit.com`;
    return activitySearchPointers(await search(query, signal));
  };
}
