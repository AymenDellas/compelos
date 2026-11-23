import type { Pool } from 'pg';
import { load } from 'cheerio';
import { relevantCoach } from './discovery';
import { domain } from './policy';
import type { Seed, SourceResult } from './policy';
import { documentUrl, hostedBooking, PublicFailure } from './public-web';
import type { PublicWeb } from './public-web';
import { screenPublicOffer } from './research';
import { existingDiscoveryDomains, runSearch, saveDiscovery, sourceHistory } from './store';
import type { Run } from './store';

export const publicOfferSource = 'Public coaching offers';
const indexHost = 'public-api.wordpress.com';
const tags = ['executive-coaching', 'leadership-coaching', 'business-coaching', 'business-coach', 'leadership-development',
  'entrepreneurship', 'coaching-program', 'group-coaching', 'business-growth', 'leadership-training', 'executive-coach', 'small-business-growth'];
const rounds = 8;
const intent = /\b(?:book|schedule|apply|join|register|enrol+l?|cohort|workshop|masterclass|program(?:me)?|engagement|consultation|investment|pricing)\b/i;
const directIntent = /\b(?:book (?:a|your)|schedule (?:a|your)|register|enrol+l?|applications? (?:are )?open|join (?:the|our|my)|cohort|workshop|coaching program(?:me)?)\b/i;
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
  const window = Math.floor(index / tags.length) % 3;
  const query = new URLSearchParams({ number: '24', fields: 'URL,site_URL,title,date,excerpt' });
  if (window) {
    const before = new Date(Date.now() - window * 14 * 86_400_000).toISOString().slice(0, 10);
    query.set('before', `${before}T00:00:00Z`);
  }
  return `https://${indexHost}/rest/v1.2/read/tags/${tag}/posts?${query}`;
}

function offerSearch(index: number) {
  const country = (['us', 'gb', 'ca'] as const)[index % 3];
  const specialty = ['executive', 'leadership', 'business'][Math.floor(index / 3) % 3];
  const intents = [
    '"investment" "coaching program"',
    '"coaching package" "pricing"',
    '"coaching sessions" "fees"',
    '"investment" "months"',
  ];
  return { country, query: `"${specialty} coaching" ${intents[Math.floor(index / 9) % intents.length]} -site:linkedin.com -site:youtube.com -jobs -certification` };
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
      if (!relevantCoach.test(text) && !hostedBooking(url) || !intent.test(text)) return [];
      return [{ url, date: 0, priority: 1 + Number(relevantCoach.test(title)) * 3 + Number(directIntent.test(text)) * 3 + (18 - index) / 18,
        ...(typeof go === 'string' && new URL(url).pathname === '/' ? { navigation: go } : {}) }];
    } catch { return []; }
  });
}

export async function discoverPublicOffers(pool: Pool, run: Run, web: PublicWeb, signal: AbortSignal) {
  const previous = (await sourceHistory(pool)).find(item => item.adapter === publicOfferSource && item.queryIndex !== undefined);
  const started = Date.now();
  const round = run.discovery_round ?? 0;
  const begin = (previous?.queryIndex ?? -1) + 1;
  const source: SourceResult = { adapter: publicOfferSource, credit: 'Keyless Searchia web results, public WordPress Reader tag index and first-party business pages',
    discovered: 0, elapsedMs: 0, status: 'OK', queryIndex: begin + 2, searches: 0, searchAttempts: 0, screening: {} };
  const count = (reason: string, quantity = 1) => { source.screening![reason] = (source.screening![reason] ?? 0) + quantity; };
  // The public index is shared. Serialize its requests and never retry an index page after an ambiguous response.
  const pointers = new Map<string, Pointer>();
  for (let index = begin; index < begin + 3; index++) {
    signal.throwIfAborted();
    source.searchAttempts!++;
    const reader = index % 3 === 2;
    try {
      const records = await runSearch(pool, run, `public-offers-v7:${index}`, async () => {
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
      for (const item of records) pointers.set(item.url, item);
    } catch (error) {
      const failure = error instanceof PublicFailure ? error.code : 'INDEX_UNAVAILABLE';
      count(`${reader ? 'Reader' : 'Searchia'} ${failure}`);
      if (error instanceof PublicFailure && error.retryAt) {
        source.retryAt = error.retryAt;
      }
    }
  }
  signal.throwIfAborted();
  count('Public offer pointers', pointers.size);
  const excluded = await existingDiscoveryDomains(pool, run.id, [...new Set([...pointers.values()].map(item => domain(item.url)))]);
  const ranked = [...pointers.values()].sort((first, second) => second.priority - first.priority || second.date - first.date);
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
  signal.throwIfAborted();
  source.elapsedMs = Date.now() - started;
  source.discovered = accepted.size;
  if (!source.searches) {
    source.status = source.retryAt ? 'DEFERRED' : 'FAILED';
    source.code = source.retryAt ? 'RATE_LIMITED' : 'PUBLIC_INDEX_UNAVAILABLE';
  } else if (!accepted.size) source.code = 'NO_VERIFIED_PAID_OFFERS';
  const refill = Boolean(source.searches) && round + 1 < rounds && (!run.config.qualifiedTarget || !accepted.size);
  await saveDiscovery(pool, run, [...accepted.values()].sort((a, b) => (b.discoveryPriority ?? 0) - (a.discoveryPriority ?? 0)), [source], refill);
}
