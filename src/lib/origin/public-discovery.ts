import type { Pool } from 'pg';
import { load } from 'cheerio';
import { coachingEditorial, relevantCoach } from './discovery';
import { domain } from './policy';
import type { Seed, SourceResult } from './policy';
import { documentUrl, hostedBooking, PublicFailure } from './public-web';
import type { PublicWeb } from './public-web';
import { screenPublicOffer } from './research';
import { existingDiscoveryDomains, runSearch, savedOfferPointers, saveDiscovery, sourceHistory } from './store';
import type { Run } from './store';

export const publicOfferSource = 'Public coaching offers';
const savedOfferSource = 'Saved coach offers';
const indexHost = 'public-api.wordpress.com';
const tags = ['executive-coaching', 'leadership-coaching', 'business-coaching', 'business-coach', 'leadership-development',
  'entrepreneurship', 'coaching-program', 'group-coaching', 'business-growth', 'leadership-training', 'executive-coach', 'small-business-growth'];
const markets = [
  { country: 'us', cities: ['Chicago', 'Atlanta', 'Boston', 'New York', 'Philadelphia', 'Seattle', 'Denver', 'Austin', 'San Francisco', 'Minneapolis', 'Raleigh', 'Nashville'] },
  { country: 'gb', cities: ['London', 'Manchester', 'Edinburgh', 'Bristol', 'Leeds', 'Cambridge', 'Birmingham', 'Glasgow', 'Oxford', 'Brighton', 'Liverpool', 'Cardiff'] },
  { country: 'ca', cities: ['Toronto', 'Vancouver', 'Calgary', 'Ottawa', 'Montreal', 'Waterloo', 'Edmonton', 'Victoria', 'Halifax', 'Winnipeg', 'Hamilton', 'Kelowna'] },
] as const;
const rounds = 8;
const intent = /\b(?:book|schedule|apply|join|register|enrol+l?|cohort|workshop|masterclass|program(?:me)?|engagement|consultation|investment|pricing)\b/i;
const directIntent = /\b(?:work with me|I coach|my coaching|private coaching|one[- ]on[- ]one|1:1 coaching|book (?:a|your)|schedule (?:a|your)|coaching services)\b/i;
const excludedIndexRecord = /\b(?:Wikipedia|SEO agency|marketing agency|best coach in|certification training|job opening)\b/i;
type Pointer = { url: string; date: number; priority: number; navigation?: string };

export function publicOfferPointers(payload: unknown): Pointer[] {
  if (!payload || typeof payload !== 'object' || !('posts' in payload) || !Array.isArray(payload.posts)) throw new PublicFailure('UNREADABLE_INDEX');
  return payload.posts.slice(0, 24).flatMap((row: unknown) => {
    if (!row || typeof row !== 'object') return [];
    const { URL: value, title, excerpt, date } = row as Record<string, unknown>;
    if (typeof value !== 'string' || typeof title !== 'string') return [];
    const time = typeof date === 'string' ? Date.parse(date) : 0;
    const label = load(title.slice(0, 400)).text();
    const text = `${label} ${typeof excerpt === 'string' ? load(excerpt.slice(0, 4000)).text() : ''}`;
    if ((!intent.test(text) && !relevantCoach.test(text)) || excludedIndexRecord.test(label)) return [];
    try {
      const url = documentUrl(value).href;
    const priority = Number(relevantCoach.test(text)) * 3 + Number(directIntent.test(text)) * 3 + Number(intent.test(label)) * 2;
      return [{ url, date: Number.isFinite(time) ? time : 0, priority }];
    } catch { return []; }
  });
}

function indexPage(index: number) {
  const tag = tags[index % tags.length];
  const window = Math.floor(index / tags.length) % 26;
  const query = new URLSearchParams({ number: '24', fields: 'URL,site_URL,title,date,excerpt' });
  if (window) {
    const before = new Date(Date.now() - window * 14 * 86_400_000).toISOString().slice(0, 10);
    query.set('before', `${before}T00:00:00Z`);
  }
  return `https://${indexHost}/rest/v1.2/read/tags/${tag}/posts?${query}`;
}

function offerSearch(index: number) {
  const market = markets[index % markets.length];
  const specialties = ['executive', 'leadership', 'business'];
  const specialtyIndex = Math.floor(index / markets.length);
  const specialty = specialties[specialtyIndex % specialties.length];
  const intents = [
    '"work with me"',
    '"my coaching"',
    '"I coach"',
    '"private coaching"',
    '"1:1 coaching"',
    '"about me"',
  ];
  const intentIndex = Math.floor(specialtyIndex / specialties.length);
  const region = Math.floor(intentIndex / intents.length) % (market.cities.length + 1);
  const location = region ? ` "${market.cities[region - 1]}"` : '';
  return { country: market.country, query: `"${specialty} coaching" ${intents[intentIndex % intents.length]}${location} -site:linkedin.com -site:youtube.com -jobs -certification` };
}

export function searchPromotionPointers(payload: unknown): Pointer[] {
  const hits = (payload as { results?: { web?: { results?: unknown[] } } } | null)?.results?.web?.results;
  if (!Array.isArray(hits)) throw new PublicFailure('UNREADABLE_INDEX');
  return hits.slice(0, 18).flatMap((hit: unknown, index) => {
    if (!hit || typeof hit !== 'object') return [];
    const { url: value, title, description, go } = hit as Record<string, unknown>;
    if (typeof value !== 'string' || typeof title !== 'string' || excludedIndexRecord.test(title) ||
      /\b(?:find a coach|coaching directory|university|certification|credential|college|job vacancies)\b/i.test(title)) return [];
    try {
      const url = documentUrl(value).href;
      const host = domain(url);
      if (/\.(?:edu|gov|gov\.uk|ac\.uk)$/.test(host) || /\.(?:pdf|xml|rss)$/i.test(new URL(url).pathname)) return [];
      const text = `${load(title.slice(0, 400)).text()} ${typeof description === 'string' ? load(description.slice(0, 1800)).text() : ''}`;
      if (!relevantCoach.test(text) && !hostedBooking(url) || !intent.test(text) && !directIntent.test(text) && !relevantCoach.test(title)) return [];
      return [{ url, date: 0, priority: 1 + Number(relevantCoach.test(title)) * 3 + Number(directIntent.test(text)) * 5 -
        Number(coachingEditorial.test(title)) * 3 + (18 - index) / 18,
        ...(typeof go === 'string' && new URL(url).pathname === '/' ? { navigation: go } : {}) }];
    } catch { return []; }
  });
}

export async function discoverPublicOffers(pool: Pool, run: Run, web: PublicWeb, signal: AbortSignal) {
  const history = await sourceHistory(pool);
  const previous = history.find(item => item.adapter === publicOfferSource && item.queryIndex !== undefined);
  const started = Date.now();
  const round = run.discovery_round ?? 0;
  if (round % 2 === 0) {
    const previousSaved = history.find(item => item.adapter === savedOfferSource);
    const savedOffset = (previousSaved?.queryIndex ?? -1) + 1;
    const saved = await savedOfferPointers(pool, savedOffset, 9);
    if (saved.length) {
      const source: SourceResult = { adapter: savedOfferSource, credit: 'Previously recorded public pages, read again before use',
        status: 'OK', discovered: 0, elapsedMs: 0, queryIndex: savedOffset + saved.length - 1, screening: {} };
      const pointers = saved.map((url, index) => ({ url, priority: saved.length - index, date: 0 }));
      const accepted = await screenPointers(pool, run, web, signal, pointers, started, source);
      signal.throwIfAborted();
      source.elapsedMs = Date.now() - started;
      source.discovered = accepted.length;
      if (!accepted.length) source.code = 'NO_VERIFIED_INDIVIDUAL_OFFERS';
      await saveDiscovery(pool, run, accepted, [source], round + 1 < rounds);
      return;
    }
  }
  const begin = (previous?.queryIndex ?? -1) + 1;
  const source: SourceResult = { adapter: publicOfferSource, credit: 'Keyless Searchia web results, public WordPress Reader tag index and first-party business pages',
    discovered: 0, elapsedMs: 0, status: 'OK', queryIndex: begin + 2, searches: 0, searchAttempts: 0, screening: {} };
  const count = (reason: string, quantity = 1) => { source.screening![reason] = (source.screening![reason] ?? 0) + quantity; };
  // Serialize Searchia requests. Reader is independent and can run alongside them.
  const pointers = new Map<string, Pointer>();
  async function readIndexes(indexes: number[]) {
    for (const index of indexes) {
      if (signal.aborted) return;
      source.searchAttempts!++;
      const reader = index % 3 === 2;
      try {
        const records = await runSearch(pool, run, `solo-coaching-offers:${index}`, async () => {
          const budget = AbortSignal.any([signal, AbortSignal.timeout(9500)]);
          if (reader) return publicOfferPointers(await web.api(indexPage(Math.floor(index / 3)), indexHost, budget));
          const search = offerSearch(index - Math.floor(index / 3));
          const candidates = searchPromotionPointers(await web.publicSearch(search.query, search.country, budget))
            .sort((a, b) => b.priority - a.priority).slice(0, 7);
          const navigationBudget = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
          return Promise.all(candidates.map(async ({ navigation, ...pointer }, position) => {
            if (!navigation || position >= 4) return pointer;
            try {
              const url = await web.publicSearchDestination(navigation, pointer.url, navigationBudget);
              if (url !== pointer.url) count('Exact public offer links');
              return { ...pointer, url };
            } catch { return pointer; }
          }));
        });
        if (!records) continue;
        source.searches!++;
        count(reader ? 'Reader pointers' : 'Searchia pointers', records.length);
        for (const item of records) {
          if ((pointers.get(item.url)?.priority ?? -Infinity) < item.priority) pointers.set(item.url, item);
        }
      } catch (error) {
        const failure = error instanceof PublicFailure ? error.code : 'INDEX_UNAVAILABLE';
        count(`${reader ? 'Reader' : 'Searchia'} ${failure}`);
        if (error instanceof PublicFailure && error.retryAt && (!source.retryAt || error.retryAt > source.retryAt)) {
          source.retryAt = error.retryAt;
        }
      }
    }
  }
  const indexes = [begin, begin + 1, begin + 2];
  await Promise.all([readIndexes(indexes.filter(index => index % 3 !== 2)), readIndexes(indexes.filter(index => index % 3 === 2))]);
  signal.throwIfAborted();
  count('Public offer pointers', pointers.size);
  const accepted = await screenPointers(pool, run, web, signal, [...pointers.values()], started, source);
  signal.throwIfAborted();
  source.elapsedMs = Date.now() - started;
  source.discovered = accepted.length;
  if (!source.searches) {
    source.status = source.retryAt ? 'DEFERRED' : 'FAILED';
    source.code = source.retryAt ? 'RATE_LIMITED' : 'PUBLIC_INDEX_UNAVAILABLE';
  } else if (!accepted.length) source.code = 'NO_VERIFIED_INDIVIDUAL_OFFERS';
  const previousCode = run.sources?.find(item => item.adapter === publicOfferSource)?.code;
  // An unavailable group can be transient. Try the next group within the same search budget.
  const canContinue = source.status === 'OK' || source.status === 'FAILED' && previousCode !== 'PUBLIC_INDEX_UNAVAILABLE';
  await saveDiscovery(pool, run, accepted, [source], canContinue && round + 1 < rounds);
}

async function screenPointers(pool: Pool, run: Run, web: PublicWeb, signal: AbortSignal, pointers: Pointer[], started: number,
  source: SourceResult) {
  const count = (reason: string, quantity = 1) => { source.screening![reason] = (source.screening?.[reason] ?? 0) + quantity; };
  const safe = pointers.filter(item => {
    try { documentUrl(item.url); return true; } catch { count('Unsupported public page'); return false; }
  });
  const excluded = await existingDiscoveryDomains(pool, run.id, [...new Set(safe.map(item => domain(item.url)))]);
  const ranked = safe.sort((first, second) => second.priority - first.priority || second.date - first.date || first.url.localeCompare(second.url));
  const fresh = ranked.filter(item => !excluded.has(domain(item.url)) || hostedBooking(item.url));
  count('Previously queued or investigated', ranked.length - fresh.length);
  const perHost = new Map<string, number>();
  const shortlist = fresh.filter(item => {
    const host = domain(item.url);
    const seen = perHost.get(host) ?? 0;
    perHost.set(host, seen + 1);
    return seen < (hostedBooking(item.url) ? 4 : 2);
  }).slice(0, 9);
  const accepted = new Map<string, Seed>();
  for (let offset = 0; offset < shortlist.length && Date.now() - started < 52_000; offset += 3) {
    signal.throwIfAborted();
    const group = await Promise.all(shortlist.slice(offset, offset + 3).map(item => screenPublicOffer(web, item.url,
      AbortSignal.any([signal, AbortSignal.timeout(12_500)]), excluded)
      .catch(() => ({ reason: 'Screening read timed out or failed' }))));
    for (const result of group) {
      if ('reason' in result) count(result.reason);
      else {
        const key = domain(result.seed.website);
        if (!accepted.has(key)) accepted.set(key, { ...result.seed, adapter: publicOfferSource });
      }
    }
  }
  return [...accepted.values()];
}
