import { load } from 'cheerio';
import { z } from 'zod';
import { relevantCoach } from './discovery';
import { domain, hash } from './policy';
import type { PublisherAudit, PublisherPointer, Seed } from './policy';
import { documentUrl, PublicFailure } from './public-web';
import type { PublicWeb } from './public-web';

export const publicationAdapter = 'ECHO · Public publisher discovery';
export const gdeltCredits = 'The GDELT Project · https://www.gdeltproject.org/';
const gdelt = 'api.gdeltproject.org';
const directorySites = /(?:^|\.)(?:apple\.com|spotify\.com|wikipedia\.org|wikidata\.org|imdb\.com|amazon\.com|goodreads\.com)$/i;
const accessWarning = /\b(?:verify (?:that )?you are human|checking your browser|just a moment|access denied|captcha)\b/i;
const restrictedUse = /\b(?:may not|must not|do not|agree not to|prohibit(?:ed|s)?|forbid(?:den|s)?|without (?:our |prior |express )?(?:written )?permission)\b[^.!?]{0,135}\b(?:scrap(?:e|ing)|crawl(?:ers?|ing)?|spiders?|bots?|automated (?:access|means)|data (?:mining|extraction)|commercial use|commercial purposes)|\bnon[- ]commercial (?:use|purposes) only\b|\bpersonal(?:,| and)?\s+(?:solely )?non[- ]commercial\b|\b(?:scraping|crawling|automated (?:access|means)|commercial (?:use|purposes))\b[^.!?]{0,105}\b(?:prohibited|forbidden|not permitted|requires? (?:prior |written )?consent)\b/i;
const termLink = /^(?:terms(?: and conditions| of (?:use|service))?|legal terms|website terms)$/i;
const publisherTypes = /^(?:Organization|NewsMediaOrganization|Corporation|EducationalOrganization|ProfessionalService)$/i;
const recordTypes = /^(?:Article|NewsArticle|BlogPosting|Interview|PodcastEpisode|SocialMediaPosting|Event|BusinessEvent|EducationEvent|WebPage)$/i;
const appearanceTypes = /^(?:Interview|PodcastEpisode|Event|BusinessEvent|EducationEvent)$/i;
const appearance = /\b(?:interview|podcast|episode|guest|speaker|conference|keynote|webinar|summit|panel discussion|fireside chat)\b/i;
type RecordNode = Record<string, unknown>;
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
export const normalizedName = (value: string) => clean(value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, ' ')).toLowerCase();
const namesMatch = (a: string, b: string) => Boolean(b) && ` ${normalizedName(a)} `.includes(` ${normalizedName(b)} `);

export function relatedPublisherHosts(first: string, second: string) {
  return first === second || first.endsWith(`.${second}`) || second.endsWith(`.${first}`);
}

function objects(value: unknown): RecordNode[] {
  return (Array.isArray(value) ? value : [value]).filter((entry): entry is RecordNode => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)));
}

function typeOf(node: RecordNode, test: RegExp) {
  return (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).some(value => test.test(string(value).replace(/^https?:\/\/schema\.org\//i, '')));
}

function publicLink(value: unknown, from?: string) {
  try {
    const raw = string(value);
    if (!raw || !from && !/^https?:\/\//i.test(raw)) return null;
    return documentUrl(new URL(raw, from).href).href;
  } catch { return null; }
}

export function publisherPointer(url: string) {
  const safe = publicLink(url);
  if (!safe || directorySites.test(domain(safe))) return null;
  const path = new URL(safe).pathname;
  return /\.(?:pdf|zip|docx?|xlsx?|png|jpe?g|webp|mp[34]|wav|ics)$/i.test(path) ? null : safe;
}

function cleanLicense(value: unknown) {
  try {
    const url = new URL(string(value));
    if (url.hostname !== 'creativecommons.org' || !/^https?:$/.test(url.protocol) || url.port || url.username || url.password || url.search || url.hash) return null;
    const match = url.pathname.match(/^\/(licenses\/by\/4\.0|publicdomain\/zero\/1\.0)(?:\/(?:deed(?:\.[a-z_-]+)?|legalcode(?:\.[a-z_-]+)?))?\/?$/i);
    return match ? `https://creativecommons.org/${match[1].toLowerCase()}/` : null;
  } catch { return null; }
}

function textDate(value: unknown) {
  const raw = string(value);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/i.test(raw)) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && new Date(Date.parse(raw.slice(0, 10))).toISOString().slice(0, 10) === raw.slice(0, 10) ? ms : null;
}

function pageMetadata(html: string, url: string) {
  const $ = load(html);
  const graph = $('script[type="application/ld+json"]').slice(0, 12).toArray().flatMap(node => {
    const payload = $(node).text();
    if (payload.length > 80_000) return [];
    try { return objects(JSON.parse(payload)).flatMap(item => [item, ...objects(item['@graph']).slice(0, 30)]); }
    catch { return []; }
  });
  const canonical = publicLink($('head link[rel~="canonical"]').first().attr('href'), url);
  const scoped = graph.filter(node => typeOf(node, recordTypes) &&
    [node.url, node['@id'], node.mainEntityOfPage, ...objects(node.mainEntityOfPage).map(item => item['@id'] ?? item.url)]
      .some(value => publicLink(value, url) === url));
  const declaredLicenses = [...$('head link[rel~="license"]').toArray().map(node => $(node).attr('href')),
    ...$('article a[rel~="license"]').toArray().flatMap(node => {
      const context = clean($(node).closest('p').text());
      return /\bthis (?:article|work|post|episode) is (?:made available|licensed) under\b/i.test(context) ? [$(node).attr('href')] : [];
    }),
    ...scoped.flatMap(node => typeof node.license === 'string' ? [node.license] : objects(node.license).map(license => license.url ?? license['@id']))];
  const licenses = declaredLicenses.map(cleanLicense);
  const license = licenses.length && licenses.every(Boolean) ? licenses[0] : null;
  const publisherNames = [...scoped.flatMap(node => objects(node.publisher)), ...graph.filter(node => typeOf(node, publisherTypes))]
    .filter(node => typeOf(node, publisherTypes) && [node.url, node['@id']].some(value => {
      const site = publicLink(value);
      return site && domain(site) === domain(url);
    })).map(node => clean(string(node.name)));
  const verifiedNames = [...new Map(publisherNames.filter(name => name.length >= 3 && name.length <= 100).map(name => [normalizedName(name), name])).values()];
  // These assertions refer to the item itself. A site-wide social display name cannot establish a publisher's ownership.
  const publisher = verifiedNames.length === 1 ? verifiedNames[0] : null;
  const title = clean(string($('head meta[property="og:title"]').attr('content')) || string(scoped[0]?.headline) || $('main h1, article h1, h1').first().text()).slice(0, 220);
  const explicit = (role: string) => scoped.flatMap(node => objects(node[role]).filter(person => typeOf(person, /^Person$/i)));
  const guests = [...explicit('performer'), ...explicit('guest'), ...scoped.filter(node => typeOf(node, /^PodcastEpisode$/i)).flatMap(node => objects(node.actor))];
  const people = guests.map(person => ({ name: clean(string(person.name)), site: publisherPointer(string(person.url)), job: string(person.jobTitle) }));
  for (const node of $('main a[itemprop~="performer"], article a[itemprop~="performer"], main a[rel~="author"], article a[rel~="author"]').slice(0, 8).toArray()) {
    const context = clean($(node).closest('p,li').text());
    const target = publicLink($(node).attr('href'), url);
    if (target && relevantCoach.test(context)) people.push({ name: clean($(node).text()), site: publisherPointer(target), job: context });
  }
  const dates = [...scoped.map(node => typeOf(node, /Event$/i) ? node.startDate : node.datePublished),
    $('head meta[property="article:published_time"]').first().attr('content')].map(textDate).filter((date): date is number => date !== null);
  const links = $('a[href]').toArray();
  const terms = [...new Set([...$('head link[rel~="terms-of-service"]').toArray(),
    ...links.filter(node => (($(node).attr('rel') ?? '').split(/\s+/).includes('terms-of-service') || termLink.test(clean($(node).text()))))]
    .map(node => publicLink($(node).attr('href'), url)).filter((value): value is string => Boolean(value && value !== url)))].slice(0, 3);
  const out = links.flatMap(node => {
    const target = publicLink($(node).attr('href'), url);
    return target ? [{ url: target, label: clean($(node).text()).slice(0, 120) }] : [];
  });
  const keyText = clean($('main,article').first().text() || $('body').text()).slice(0, 18_000);
  const topical = relevantCoach.test(title) || (appearance.test(title) && relevantCoach.test(keyText)) ||
    (scoped.some(node => typeOf(node, appearanceTypes)) && relevantCoach.test(keyText));
  const agents = $('head meta[name="robots" i], head meta[name="compel-origin" i]').toArray().map(node => $(node).attr('content')).join(' ');
  return { canonical, license, publisher, title, people, dates, terms, out, topical, text: keyText, restricted: /\b(?:noarchive|nofollow|none)\b/i.test(agents),
    challenge: accessWarning.test(`${$('title').first().text()} ${keyText.slice(0, 400)}`) };
}

async function readPublisher(web: PublicWeb, pointer: PublisherPointer, activityDays: number, signal: AbortSignal) {
  let inspected = pointer.url;
  const audit = (code: string, records = 0, license?: string, publisher?: string): PublisherAudit => ({ url: inspected, code, records, license, publisher });
  try {
    const host = domain(pointer.url);
    const own = (url: URL) => domain(url.href) === host && url.protocol === 'https:';
    const response = await web.document(pointer.url, signal, own);
    inspected = response.url;
    if (response.status !== 200) return { audit: audit(`HTTP_${response.status}`), seeds: [] };
    if (!/(?:text\/html|application\/xhtml\+xml)/i.test(response.headers['content-type'] ?? '')) return { audit: audit('NOT_HTML'), seeds: [] };
    const meta = pageMetadata(response.body.toString('utf8'), inspected);
    if (meta.challenge || meta.restricted || /\b(?:noarchive|nofollow|none)\b/i.test(response.headers['x-robots-tag'] ?? '')) return { audit: audit('RESTRICTED'), seeds: [] };
    if (meta.canonical && domain(meta.canonical) !== host) return { audit: audit('SYNDICATED'), seeds: [] };
    if (restrictedUse.test(meta.text)) return { audit: audit('TERMS_RESTRICTED'), seeds: [] };
    if (!meta.license) return { audit: audit('PERMISSION_UNVERIFIED'), seeds: [] };
    if (!meta.publisher) return { audit: audit('PUBLISHER_UNVERIFIED', 0, meta.license), seeds: [] };
    let termsReceipt = inspected;
    for (const terms of meta.terms) {
      if (!own(new URL(terms))) return { audit: audit('TERMS_UNVERIFIED'), seeds: [] };
      const permission = await web.document(terms, signal, own);
      const text = clean(load(permission.body.toString('utf8')).text());
      if (permission.status !== 200 || !text || accessWarning.test(text.slice(0, 400))) return { audit: audit('TERMS_UNVERIFIED'), seeds: [] };
      if (restrictedUse.test(text)) return { audit: audit('TERMS_RESTRICTED'), seeds: [] };
      termsReceipt = permission.url;
    }
    // Ambiguous publication timestamps and recent re-indexing cannot prove recent appearances.
    const now = Date.now();
    const dates = [...new Set(meta.dates.map(date => new Date(date).toISOString().slice(0, 10)))];
    if (!meta.topical || !meta.title || dates.length !== 1 || meta.dates[0] > now || meta.dates[0] < now - activityDays * 86_400_000) {
      return { audit: audit('ACTIVITY_UNVERIFIED', 0, meta.license, meta.publisher), seeds: [] };
    }
    const people = meta.people.filter(person => person.site && relevantCoach.test(person.job));
    const { name: expectedName, website: expectedSite } = pointer;
    if (expectedName && expectedSite && (namesMatch(meta.title, expectedName) || meta.people.some(person => namesMatch(person.name, expectedName)))) {
      const identityLink = meta.out.some(link => domain(link.url) === domain(expectedSite) && namesMatch(link.label, expectedName));
      const guest = meta.people.some(person => person.site && domain(person.site) === domain(expectedSite) && namesMatch(person.name, expectedName));
      if (identityLink || guest) people.push({ name: expectedName, site: expectedSite, job: '' });
    }
    const seeds: Seed[] = [...new Map(people.flatMap(person => {
      const website = person.site;
      if (!website || relatedPublisherHosts(domain(website), host) || person.name.length < 3 || person.name.length > 120) return [];
      const title = meta.title;
      const seed: Seed = { method: 'PUBLICATION', adapter: publicationAdapter, name: person.name, website,
        source: inspected, sourceKey: `${host}:${normalizedName(title)}`, publisher: `organization:${normalizedName(meta.publisher!)}`,
        permission: meta.license!, publication: { checkedAt: new Date(now).toISOString(), permissionPage: termsReceipt, title, digest: hash(response.body) },
        occurredAt: new Date(meta.dates[0]).toISOString(), excerpt: `${meta.publisher} · ${title} · featured coach: ${person.name} · ${meta.license}` };
      return [[`${domain(website)}:${normalizedName(person.name)}`, seed] as const];
    })).values()];
    return { audit: audit(seeds.length ? 'ADMITTED' : 'OFFICIAL_LINK_UNVERIFIED', seeds.length, meta.license, meta.publisher), seeds };
  } catch (error) {
    return { audit: audit(error instanceof PublicFailure ? error.code : signal.aborted ? 'TIMEOUT' : 'SOURCE_UNAVAILABLE'), seeds: [] };
  }
}

export async function verifyPublications(web: PublicWeb, pointers: PublisherPointer[], activityDays: number, signal: AbortSignal, limit = 5) {
  const unique = [...new Map(pointers.flatMap(pointer => {
    const url = publisherPointer(pointer.url);
    return url ? [[url, { ...pointer, url }] as const] : [];
  })).values()].slice(0, limit);
  const records = await Promise.all(unique.map(pointer => readPublisher(web, pointer, activityDays,
    AbortSignal.any([signal, AbortSignal.timeout(7_500)]))));
  return { seeds: records.flatMap(record => record.seeds), audit: records.map(record => record.audit) };
}

export async function discoverPublicationPointers(web: PublicWeb, niche: string, signal: AbortSignal): Promise<PublisherPointer[]> {
  const parameters = new URLSearchParams({ query: `"${niche}" (podcast OR webinar OR interview OR conference) sourcelang:english`,
    mode: 'ArtList', format: 'json', maxrecords: '12', timespan: '3months' });
  const response = await web.api(`https://${gdelt}/api/v2/doc/doc?${parameters}`, gdelt, signal);
  const parsed = z.object({ articles: z.array(z.object({ url: z.string(), title: z.string().optional() })).max(24) }).safeParse(response);
  if (!parsed.success) throw new PublicFailure('UNREADABLE_SOURCE');
  return parsed.data.articles.flatMap(article => {
    const url = publisherPointer(article.url);
    return url ? [{ url }] : [];
  });
}
