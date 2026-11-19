import { load } from 'cheerio';
import { z } from 'zod';
import { domain } from './policy';
import { documentUrl, PublicFailure } from './public-web';
import type { PublicWeb } from './public-web';
import type { PublisherAudit, Seed, SourceResult } from './policy';
import type { PublisherFeed } from './sources';

export const niches = ['executive coach', 'leadership coach', 'business coach', 'career coach'];
export const relevantCoach = /\b(?:executive|leadership|business|career|professional development)(?: (?:and|&) (?:executive|leadership|business|career))?\s+coach(?:es|ing)?\b|\bcoach(?:es|ing)?\s+for (?:[\w-]+ ){0,2}(?:executives|founders|leaders|business owners)\b/i;
const wikidataHost = 'www.wikidata.org';
const wikiUrl = (parameters: Record<string, string>) => `https://${wikidataHost}/w/api.php?${new URLSearchParams({ format: 'json', maxlag: '5', ...parameters })}`;
const qid = z.string().regex(/^Q[1-9]\d{0,14}$/);
const responseSchema = z.object({ query: z.object({ search: z.array(z.object({ title: qid })) }) });
const urlSnak = z.object({ datavalue: z.object({ value: z.string() }).optional() });
const urlClaim = z.object({ rank: z.string(), mainsnak: urlSnak,
  references: z.array(z.object({ snaks: z.object({ P854: z.array(urlSnak).optional() }) })).optional() });
const wikiEntities = z.object({ entities: z.record(z.object({
  labels: z.record(z.object({ value: z.string() })).optional(),
  descriptions: z.record(z.object({ value: z.string() })).optional(),
  claims: z.object({ P856: z.array(urlClaim).optional(), P973: z.array(urlClaim).optional() }).optional(),
  lastrevid: z.number().int().optional(),
})) });

function normalizedSite(value: string) {
  try { return documentUrl(value).href; } catch { return null; }
}
function wikiError(value: unknown) {
  if (z.object({ error: z.object({ code: z.literal('maxlag') }) }).safeParse(value).success) {
    throw new PublicFailure('SOURCE_BUSY', new Date(Date.now() + 3_600_000).toISOString());
  }
}

// P856 is a lead to investigate. Wikidata nationality, language and descriptions do not satisfy market or offer gates.
export async function wikidata(web: PublicWeb, limit: number, strategy: string, signal: AbortSignal): Promise<Seed[]> {
  const search = await web.api(wikiUrl({ action: 'query', list: 'search', srnamespace: '0',
    srsearch: `haswbstatement:P856 "${strategy}"`, srlimit: String(Math.min(24, limit * 2)), srprop: '' }), wikidataHost, signal);
  wikiError(search);
  const ids = responseSchema.parse(search).query.search.map(row => row.title);
  if (!ids.length) return [];
  const details = await web.api(wikiUrl({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|descriptions|claims|info', languages: 'en' }), wikidataHost, signal);
  wikiError(details);
  const { entities } = wikiEntities.parse(details);
  return ids.flatMap(id => {
    const entity = entities[id];
    const name = entity?.labels?.en?.value.trim().slice(0, 120);
    const description = entity?.descriptions?.en?.value ?? '';
    // Search prioritization only. Neither occupation nor demonyms establish a coaching offer or service market.
    const match = Number(relevantCoach.test(description)) * 2 + Number(/\b(?:American|British|Canadian|United States|United Kingdom|Canada)\b/i.test(description));
    const websites = entity?.claims?.P856?.filter(item => item.rank !== 'deprecated') ?? [];
    const urls = websites.map(item => normalizedSite(item.mainsnak.datavalue?.value ?? '')).filter((url): url is string => Boolean(url));
    if (!name || name.length < 3 || !urls.length || /^(?:the )?(?:executive|leadership|business|career|professional development) coach(?:es|ing)?$/i.test(name)) return [];
    const unique = [...new Map(urls.map(url => [domain(url), url])).values()].slice(0, 3);
    const references = [...(entity?.claims?.P973?.filter(item => item.rank !== 'deprecated').map(item => item.mainsnak.datavalue?.value) ?? []),
      ...websites.flatMap(item => item.references?.flatMap(reference => reference.snaks.P854?.map(snak => snak.datavalue?.value) ?? []) ?? [])];
    return unique.map(website => ({ method: 'Wikidata' as const, name, website, sourceKey: `wikidata:${id}`, discoveryPriority: match,
      source: entity.lastrevid ? `https://${wikidataHost}/w/index.php?title=${id}&oldid=${entity.lastrevid}` : `https://${wikidataHost}/wiki/${id}`,
      publisherLinks: [...new Set(references.flatMap(value => {
        const url = value && normalizedSite(value);
        return url && domain(url) !== domain(website) ? [url] : [];
      }))].slice(0, 5),
      excerpt: `${name} lists ${website} as an official site (P856).` }));
  }).slice(0, limit);
}

export async function feed(web: PublicWeb, publisher: PublisherFeed, limit: number, signal: AbortSignal): Promise<Seed[]> {
  const host = domain(publisher.url);
  const response = await web.document(publisher.url, signal, url => domain(url.href) === host);
  if (response.status !== 200 || /text\/html/i.test(response.headers['content-type'] ?? '')) throw new PublicFailure(`FEED_HTTP_${response.status}`);
  const $ = load(response.body.toString('utf8'), { xml: true });
  if (!$('rss,feed').length) throw new PublicFailure('UNREADABLE_FEED');
  return $('item,entry').slice(0, 18).toArray().flatMap(item => {
    const entry = $(item);
    const title = entry.children('title').first().text().trim().replace(/\s+/g, ' ').slice(0, 180);
    const date = Date.parse(entry.children('pubDate,published,updated').first().text());
    const link = entry.children('link').filter((_index, node) => !$(node).attr('rel') || $(node).attr('rel') === 'alternate').first();
    const record = normalizedSite(link.attr('href') || link.text());
    if (!title || !record || domain(record) !== host || !Number.isFinite(date) || date > Date.now() + 86_400_000) return [];
    const content = entry.children('content\\:encoded,content,description,summary').toArray();
    const markup = content.map(node => $(node).children().length ? $(node).html() : $(node).text()).join(' ').slice(0, 20_000);
    const article = load(markup);
    if (!relevantCoach.test(`${title} ${article.text()}`)) return [];
    const speakers = article('a[rel~="author"], [itemprop="performer"] a[href], a[itemprop="performer"]').slice(0, 5).toArray().flatMap(node => {
      const name = article(node).text().trim().replace(/\s+/g, ' ').slice(0, 120);
      const site = normalizedSite(article(node).attr('href') || '');
      return name.length > 3 && site && domain(site) !== host ? [{ name, website: site }] : [];
    });
    return speakers.map((speaker, index): Seed => ({ ...speaker, method: index === 0 ? 'ECHO' : 'CONSTELLATION',
      source: record, sourceKey: `${host}:${title.toLowerCase().replace(/[^a-z\d ]/g, '')}`, occurredAt: new Date(date).toISOString(), permission: publisher.permission,
      publisher: publisher.publisher ?? host, excerpt: `${speaker.name} is explicitly linked to ${title} by ${publisher.title}.`, ...(index ? { parent: speakers[0].website } : {}) }));
  }).slice(0, limit);
}

export type Adapter = { name: string; run: () => Promise<Seed[] | { seeds: Seed[]; audit: PublisherAudit[] }>; retryAt?: string; deferred?: string; credit?: string; queryIndex?: number };

export async function discover(adapters: Adapter[], limit: number, historical: Seed[] = []) {
  const observations = await Promise.all(adapters.map(async (adapter): Promise<{ seeds: Seed[]; status: SourceResult }> => {
    const before = Date.now();
    if (adapter.deferred || adapter.retryAt && Date.parse(adapter.retryAt) > before) {
      return { seeds: [], status: { adapter: adapter.name, status: 'DEFERRED', discovered: 0, elapsedMs: 0,
        retryAt: adapter.retryAt, code: adapter.deferred, credit: adapter.credit } };
    }
    try {
      const content = await adapter.run();
      const found = Array.isArray(content) ? content : content.seeds;
      return { seeds: found.map(seed => ({ ...seed, adapter: seed.adapter ?? adapter.name })), status: {
        adapter: adapter.name, status: 'OK', discovered: found.length, elapsedMs: Date.now() - before,
        publisherAudit: Array.isArray(content) ? undefined : content.audit, credit: adapter.credit, queryIndex: adapter.queryIndex,
      } };
    } catch (error) {
      const code = error instanceof PublicFailure ? error.code : error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'TIMEOUT' : 'SOURCE_UNAVAILABLE';
      return { seeds: [], status: { adapter: adapter.name, status: 'FAILED', discovered: 0, elapsedMs: Date.now() - before,
        code, retryAt: error instanceof PublicFailure ? error.retryAt : undefined, credit: adapter.credit, queryIndex: adapter.queryIndex } };
    }
  }));
  const results = observations.map(observation => observation.status);
  const seeds = observations.flatMap(observation => observation.seeds);
  const groups = new Map<string, Map<string, Seed>>();
  const discoveredHosts = new Set(seeds.map(seed => domain(seed.website)));
  for (const seed of [...seeds, ...historical]) {
    const host = domain(seed.website);
    if (!discoveredHosts.has(host)) continue;
    const group = groups.get(host) ?? new Map<string, Seed>();
    if (!group.has(seed.sourceKey)) group.set(seed.sourceKey, seed);
    groups.set(host, group);
  }
  const priority = (records: Map<string, Seed>) => {
    const seeds = [...records.values()];
    const publishers = new Set(seeds.filter(seed => seed.occurredAt).map(seed => seed.publisher ?? domain(seed.source))).size;
    return publishers * 10 + Math.max(0, ...seeds.map(seed => seed.discoveryPriority ?? 0));
  };
  const selected = [...groups.values()].sort((a, b) => priority(b) - priority(a)).slice(0, limit);
  return { results, seeds: selected.flatMap(group => [...group.values()].slice(0, 30)) };
}
