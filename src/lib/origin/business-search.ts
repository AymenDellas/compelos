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
const marketQueries = ['("United States" OR Chicago OR Atlanta OR Boston)', '("United Kingdom" OR London OR Manchester OR Edinburgh)',
  '(Canada OR Toronto OR Vancouver OR Calgary)'];
const regionalQueries = [
  marketQueries,
  ['("New York" OR Philadelphia OR Raleigh)', '(Bristol OR Leeds OR Cambridge)', '(Ottawa OR Montreal OR Waterloo)'],
  ['(Seattle OR Denver OR Austin)', '(Birmingham OR Glasgow OR Oxford)', '(Edmonton OR Victoria OR Halifax)'],
  ['("San Francisco" OR "San Diego" OR "Los Angeles")', '(Reading OR Brighton OR Belfast)', '(Winnipeg OR Saskatoon OR Kelowna)'],
  ['(Dallas OR Minneapolis OR Nashville)', '(Liverpool OR Newcastle OR Cardiff)', '(Mississauga OR Hamilton OR Burnaby)'],
];
const specialties = [
  '"executive coaching" ("leadership team" OR "executive team")',
  '("CEO coaching" OR "founder coaching" OR "strategic leadership adviser")',
  '"leadership coaching" ("leadership development" OR "senior leaders")',
  '"business coaching" ("business owners" OR "growth program")',
  '"career coaching" ("senior professionals" OR "executive career")',
];
const excludedDomains = ['linkedin.com', 'facebook.com', 'instagram.com', 'youtube.com', 'reddit.com',
  'wikipedia.org', 'google.com', 'indeed.com', 'glassdoor.com', 'forbes.com', 'clutch.co', 'coachfederation.org', 'coachingfederation.org',
  'podscan.fm', 'listennotes.com', 'feedspot.com', 'player.fm', 'goodpods.com', 'podchaser.com', 'podcasts.apple.com', 'spotify.com',
  'theglobeandmail.com', 'prnewswire.com', 'businesswire.com', 'globenewswire.com'];
const service = /\b(?:coach(?:es|ing)?|leadership development|leadership advis(?:er|or|ory)|executive advis(?:er|or|ory)|CEO mentor)\b/i;
const directory = /\b(?:top \d+|best \d+|find a coach|coach(?:es|ing) directory|certification|training for coaches|job openings)\b/i;
const genericName = /^(?:(?:home|services|programs?|offerings|work with us|about us)$|(?:executive|leadership|career|business|CEO|founder|corporate|team) (?:coaches?|coaching)(?:\s+(?:in|services|programs?)\b.*)?$)/i;

const offer = /\b(?:coaching (?:program(?:me)?s?|services?|packages?|engagements?)|one[- ]on[- ]one|1:1|private coaching|coaching sessions)\b/i;
const commercial = /\b(?:case stud(?:y|ies)|client (?:results|stories|success)|published fee|pricing|\d+[- ]month|\d+ sessions)\b/i;
const action = /\b(?:(?:schedule|book|request) (?:a |your )?(?:discovery |introductory |strategy )?(?:call|consultation)|work with (?:me|us))\b/i;
const promotion = /\b(?:webinars?|workshops?|cohorts?|newsletter|podcast episodes?|masterclasses|register|applications open)\b/i;

export function businessSearchQuery(attempt: number) {
  const marketIndex = attempt % markets.length;
  const specialty = specialties[Math.floor(attempt / markets.length) % specialties.length];
  const intents = ['("book a discovery call" OR "schedule a consultation" OR "book a call")',
    '("client results" OR "case study" OR "leadership coaching program")', '("executive briefing" OR "coaching program" OR "coaching enquiry")',
    '("book a call" OR "schedule a consultation" OR "discovery call") ("client results" OR "case studies" OR "client stories" OR "coaching engagement")'];
  const batch = Math.floor(attempt / (markets.length * specialties.length));
  const regions = regionalQueries[Math.floor(batch / intents.length) % regionalQueries.length];
  const rotation = batch % intents.length;
  const market = batch >= intents.length || rotation === 3 ? regions[marketIndex] : '"' + markets[marketIndex] + '"';
  return `${specialty} ${market} ${intents[rotation]} -jobs -certification -directory -site:linkedin.com -site:indeed.com`;
}

export function businessSearchSeeds(rows: unknown[], limit: number, campaign = false): Seed[] {
  const results = new Map<string, Seed>();
  for (const row of rows.slice(0, 10)) {
    if (!row || typeof row !== 'object') continue;
    const { link, title, snippet } = row as Record<string, unknown>;
    if (typeof link !== 'string' || typeof title !== 'string' || directory.test(title) || /\b(?:frequently asked questions|what it is and when|request for proposals|contract for)\b/i.test(title)) continue;
    const description = typeof snippet === 'string' ? snippet.slice(0, 500) : '';
    const text = `${title} ${description}`;
    if (!service.test(text)) continue;
    let url: URL;
    try { url = documentUrl(link); } catch { continue; }
    const host = domain(url.href);
    const path = url.pathname.replace(/[-_/]/g, ' ');
    if (/\.(?:gov|gov\.uk|edu|university)$/.test(host) || excludedDomains.some(blocked => host === blocked || host.endsWith(`.${blocked}`))) continue;
    if (/\/(?:directory|jobs?|certification|terms(?:[-_]of[-_]use)?|privacy(?:[-_]policy)?|cookies?)(?:\/|$)/i.test(url.pathname)) continue;
    const supportingCase = !campaign && /\b(?:case stud(?:y|ies)|client (?:results|stories|success))\b/i.test(path);
    if (campaign && !promotion.test(`${text} ${path}`)) continue;
    if (!campaign && !supportingCase && /\/(?:blog|news|articles?|library|podcasts?)(?:\/|$)/i.test(url.pathname)) continue;
    const key = campaign || supportingCase ? url.href : host;
    const parts = title.slice(0, 260).split(/\s*(?:\||[–—])\s*|\s+-\s+/).map(item => item.trim());
    const name = parts.find(item => item.length >= 3 && item.length <= 90 && !service.test(item) && !genericName.test(item))
      ?? parts.find(item => item.length >= 3 && item.length <= 90 && !genericName.test(item));
    if (!name) continue;
    const score = (campaign ? 6 : supportingCase ? 4 : 5) + Number(offer.test(text)) * 3 +
      Number(commercial.test(text)) * 2 + Number(action.test(text)) * 3;
    if ((results.get(key)?.discoveryPriority ?? 0) >= score) continue;
    results.set(key, { method: 'BUSINESS_SEARCH', name, website: campaign || supportingCase ? new URL('/', url).href : url.href, source: url.href,
      sourceKey: campaign ? `campaign:${hash(url.href)}` : supportingCase ? `case:${hash(url.href)}` : `business-search:${host}`, discoveryPriority: score,
      ...(campaign ? { activityLinks: [url.href] } : {}),
      ...(supportingCase ? { commercialLinks: [url.href] } : {}),
      excerpt: `Serper indexed this URL under a title identifying ${name}. The business, offer and market require first-party verification.` });
  }
  return [...results.values()].sort((a, b) => (b.discoveryPriority ?? 0) - (a.discoveryPriority ?? 0)).slice(0, limit);
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
    return businessSearchSeeds(await search(campaignSearchQuery(attempt, activityDays), signal), 10, true);
  };
}

export function campaignSearchQuery(attempt: number, activityDays: number) {
  const marketIndex = attempt % markets.length;
  const topic = specialties[attempt % specialties.length].split(' (')[0];
  const since = new Date(Date.now() - activityDays * 86_400_000).toISOString().slice(0, 10);
  const formats = ['("join" OR "register") (webinar OR workshop)', '("newsletter" OR "podcast") ("subscribe" OR "work with me")',
    '("applications open" OR "next cohort" OR "reserve your spot")',
    '(workshop OR webinar OR "upcoming events") ("book a call" OR "schedule a consultation" OR "discovery call")'];
  const format = formats[(attempt % markets.length + Math.floor(attempt / markets.length)) % formats.length];
  const regional = regionalQueries[Math.floor(attempt / 15) % regionalQueries.length];
  const market = attempt < 15 ? '"' + markets[marketIndex] + '"' : regional[marketIndex];
  return `${topic} ${market} ${format} after:${since} -site:linkedin.com -site:youtube.com -site:reddit.com -site:eventbrite.com`;
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
