import { createSerperSearcher } from '../dorkEngine';
import { publisherPointer } from './auto-publishers';
import { domain } from './policy';
import type { Seed } from './policy';
import { documentUrl, PublicFailure, retryAt } from './public-web';

export const businessSearchName = 'Serper · Business search';
export const activitySearchName = 'Serper · Publisher search';
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
  return `${specialty} "${market}" ("work with" OR "book a consultation" OR "case studies") -jobs -certification -directory -site:linkedin.com -site:indeed.com`;
}

export function businessSearchSeeds(rows: unknown[], limit: number): Seed[] {
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
    if (results.has(host) || /\.(?:gov|gov\.uk|edu)$/.test(host) || excludedDomains.some(blocked => host === blocked || host.endsWith(`.${blocked}`))) continue;
    if (/\/(?:blog|news|articles?|directory|podcast|jobs?|certification)(?:\/|$)/i.test(url.pathname)) continue;
    const parts = title.slice(0, 260).split(/\s*(?:\||[–—])\s*|\s+-\s+/).map(item => item.trim());
    const name = parts.find(item => item.length >= 3 && item.length <= 90 && !service.test(item) && !genericName.test(item))
      ?? parts.find(item => item.length >= 3 && item.length <= 90 && !genericName.test(item));
    if (!name) continue;
    results.set(host, { method: 'BUSINESS_SEARCH', name, website: url.href, source: url.href,
      sourceKey: `business-search:${host}`, discoveryPriority: 5,
      excerpt: `Serper indexed this URL under a title identifying ${name}. The business, offer and market require first-party verification.` });
    if (results.size >= limit) break;
  }
  return [...results.values()];
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
