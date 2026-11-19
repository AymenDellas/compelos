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
const directorySites = /(?:^|\.)(?:apple\.com|spotify\.com|wikipedia\.org|wikidata\.org|imdb\.com|amazon\.com|goodreads\.com|about\.me|therapyden\.com|psychologytoday\.com)$/i;
const accessWarning = /\b(?:verify (?:that )?you are human|checking your browser|just a moment|access denied|captcha)\b/i;
const automated = String.raw`(?:scrap(?:e|ing|ers?)|crawl(?:ers?|ing)?|spiders?|robots?|bots?|automated (?:access|means|systems?|collection)|(?:data|information) (?:mining|extraction|harvesting)|lead generation|prospect(?:ing| collection))`;
const denied = String.raw`(?:shall not|may not|must not|do not|cannot|agree not to|prohibit(?:ed|s)?|forbid(?:den|s)?|without (?:our |prior |express )?(?:written )?permission)`;
const restrictedUse = new RegExp(String.raw`\b${denied}\b[^.!?]{0,135}\b${automated}\b|\b${automated}\b[^.!?]{0,105}\b(?:prohibited|forbidden|not (?:allowed|permitted)|requires? (?:prior |written )?consent)\b|\b(?:use of (?:this|our|the) (?:site|website|service|data)|(?:use|access) (?:this|our|the) (?:site|website|service|data))\b[^.!?]{0,75}\b(?:non[- ]commercial|personal use only|commercial (?:use|purposes) (?:is |are )?(?:prohibited|forbidden|not permitted))\b|\b(?:you (?:may|can) not|you must not|you agree not to) (?:access|use) (?:this|our|the) (?:site|website|service|data) for (?:any )?commercial purposes\b`, 'i');
const termLink = /^(?:terms(?: (?:and|&) conditions| of (?:use|service))?|legal(?: terms)?|website terms|acceptable use(?: policy)?)$/i;
const publisherTypes = /^(?:Organization|NewsMediaOrganization|Corporation|EducationalOrganization|ProfessionalService|PodcastSeries)$/i;
const recordTypes = /^(?:Article|NewsArticle|BlogPosting|Interview|PodcastEpisode|SocialMediaPosting|Event|BusinessEvent|EducationEvent|WebPage)$/i;
const appearanceTypes = /^(?:Interview|PodcastEpisode|Event|BusinessEvent|EducationEvent)$/i;
const appearance = /\b(?:interview|podcast|episode|guest|speaker|conference|keynote|webinar|summit|panel discussion|fireside chat)\b/i;
type RecordNode = Record<string, unknown>;
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
export const normalizedName = (value: string) => clean(value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[’']/gu, '').replace(/[^\p{L}\p{N}]/gu, ' ')).toLowerCase();
const namesMatch = (a: string, b: string) => Boolean(b) && ` ${normalizedName(a)} `.includes(` ${normalizedName(b)} `);

function blocksFactRead(text: string) {
  // A prohibition on automated registration applies to creating an account.
  const accountRegistration = /\baccounts? (?:registered|created|opened) by\b[^.!?]{0,165}\b(?:not (?:permitted|allowed)|prohibited|forbidden)\b/i;
  return restrictedUse.test(text.replace(accountRegistration, ''));
}

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
  const samePage = (value: unknown) => {
    const link = publicLink(value, url);
    if (!link || domain(link) !== domain(url)) return false;
    return new URL(link).pathname.replace(/\/$/, '') === new URL(url).pathname.replace(/\/$/, '');
  };
  const records = graph.filter(node => typeOf(node, recordTypes));
  const scoped = records.filter(node =>
    [node.url, node['@id'], node.mainEntityOfPage, ...objects(node.mainEntityOfPage).map(item => item['@id'] ?? item.url)]
      .some(samePage));
  const articleTitle = clean($('main h1,article h1,h1').first().text());
  const matching = records.filter(node => typeOf(node, /^(?:Article|NewsArticle|BlogPosting|Interview|PodcastEpisode|Event|BusinessEvent|EducationEvent)$/i) &&
    !node.url && !node.mainEntityOfPage && normalizedName(string(node.headline ?? node.name)) === normalizedName(articleTitle));
  if (!scoped.length && canonical && samePage(canonical) && articleTitle && matching.length === 1) scoped.push(matching[0]);
  const declaredLicenses = [...$('head link[rel~="license"]').toArray().map(node => $(node).attr('href')),
    ...$('article a[rel~="license"]').toArray().flatMap(node => {
      const context = clean($(node).closest('p').text());
      return /\bthis (?:article|work|post|episode) is (?:made available|licensed) under\b/i.test(context) ? [$(node).attr('href')] : [];
    }),
    ...scoped.flatMap(node => typeof node.license === 'string' ? [node.license] : objects(node.license).map(license => license.url ?? license['@id']))];
  const licenses = declaredLicenses.map(cleanLicense);
  const license = licenses.length && licenses.every(Boolean) ? licenses[0] : null;
  const publisherNames = [...scoped.flatMap(node => [...objects(node.publisher), ...objects(node.organizer), ...objects(node.partOfSeries)]),
    ...graph.filter(node => typeOf(node, publisherTypes))]
    .filter(node => typeOf(node, publisherTypes) && [node.url, node['@id']].some(value => {
      const site = publicLink(value, url);
      return site && domain(site) === domain(url);
    })).map(node => clean(string(node.name)));
  const siteName = clean(string($('head meta[property="og:site_name"]').first().attr('content')));
  const masthead = $('header a[href], a[rel~="home"], a[class*="site-title"]').slice(0, 40).toArray().some(node => {
    const link = publicLink($(node).attr('href'), url);
    const label = clean($(node).text() || $(node).attr('aria-label') || $(node).find('img[alt]').first().attr('alt') || '');
    return link && new URL(link).pathname === '/' && domain(link) === domain(url) && normalizedName(label) === normalizedName(siteName);
  });
  const verifiedNames = [...new Map(publisherNames.filter(name => name.length >= 3 && name.length <= 100).map(name => [normalizedName(name), name])).values()];
  const publisher = verifiedNames.length === 1 ? verifiedNames[0] : !verifiedNames.length && masthead && siteName.length >= 3 && siteName.length <= 100 ? siteName : null;
  const title = clean(string($('head meta[property="og:title"]').attr('content')) || string(scoped[0]?.headline) || $('main h1, article h1, h1').first().text()).slice(0, 220);
  const explicit = (role: string) => scoped.flatMap(node => objects(node[role]).filter(person => typeOf(person, /^(?:Person|Organization|ProfessionalService)$/i)));
  const guests = [...explicit('performer'), ...explicit('guest'), ...scoped.filter(node => typeOf(node, /^PodcastEpisode$/i)).flatMap(node => objects(node.actor))];
  const people = guests.map(person => ({ name: clean(string(person.name)), site: publisherPointer(string(person.url)), job: string(person.jobTitle) }));
  for (const node of $('main a[itemprop~="performer"], article a[itemprop~="performer"], main a[rel~="author"], article a[rel~="author"]').slice(0, 8).toArray()) {
    const context = clean($(node).closest('p,li').text());
    const target = publicLink($(node).attr('href'), url);
    if (target && relevantCoach.test(context)) people.push({ name: clean($(node).text()), site: publisherPointer(target), job: context });
  }
  const isEvent = scoped.some(node => typeOf(node, /Event$/i));
  const markupDates = $('article time[itemprop="datePublished"][datetime], main time[itemprop="datePublished"][datetime], article header time[datetime], article time.published[datetime], main time.published[datetime]').slice(0, 6).toArray().map(node => $(node).attr('datetime'));
  const dates = (isEvent ? scoped.filter(node => typeOf(node, /Event$/i)).map(node => node.startDate) : [
    ...scoped.map(node => node.datePublished), $('head meta[property="article:published_time"]').first().attr('content'), ...markupDates,
  ]).map(textDate).filter((date): date is number => date !== null);
  const links = $('a[href]').toArray();
  const terms = [...new Set([...$('head link[rel~="terms-of-service"]').toArray(),
    ...links.filter(node => (($(node).attr('rel') ?? '').split(/\s+/).includes('terms-of-service') || termLink.test(clean($(node).text()))))]
    .map(node => publicLink($(node).attr('href'), url)).filter((value): value is string => Boolean(value && value !== url)))].slice(0, 3);
  const out = links.flatMap(node => {
    const target = publicLink($(node).attr('href'), url);
    if (!target || $(node).closest('footer,nav,aside,header').length) return [];
    return [{ url: target, label: clean($(node).text()).slice(0, 120), context: clean($(node).closest('p,li,figcaption').text()).slice(0, 360) }];
  });
  for (const link of out) {
    if (!/^(?:\p{Lu}[\p{L}’'\-]{1,30} ?){2,5}$/u.test(link.label) || !relevantCoach.test(link.context)) continue;
    const directDescription = link.context.startsWith(`${link.label},`) ||
      /\b(?:interviewed|featured|speaker|guest|joined by|coach)\b/i.test(link.context.slice(0, Math.max(0, link.context.indexOf(link.label))));
    const site = publisherPointer(link.url);
    if (site && directDescription) people.push({ name: link.label, site, job: link.context });
  }
  $('script,style,template,[hidden],aside,nav').remove();
  const keyText = clean($('main,article').first().text() || $('body').text()).slice(0, 18_000);
  const topical = relevantCoach.test(title) || (appearance.test(title) && relevantCoach.test(keyText)) ||
    (scoped.some(node => typeOf(node, appearanceTypes)) && relevantCoach.test(keyText));
  const agents = $('head meta[name="robots" i], head meta[name="compel-origin" i]').toArray().map(node => $(node).attr('content')).join(' ');
  const subjects = $('main h1, article h1, article header, main p, article p').slice(0, 100).toArray().map(node => clean($(node).text()).slice(0, 500));
  const rss = publicLink($('head link[rel~="alternate"][type="application/rss+xml"]').first().attr('href'), url);
  const headings = $('h1,h2').slice(0, 4).toArray().map(node => normalizedName($(node).text()));
  return { canonical, license, publisher, title, people, dates, terms, out, topical, subjects, rss, headings, text: keyText,
    restricted: /\b(?:nofollow|none)\b/i.test(agents) || scoped.some(node => node.isAccessibleForFree === false || node.isAccessibleForFree === 'false'),
    challenge: accessWarning.test(`${$('title').first().text()} ${keyText.slice(0, 400)}`) };
}

function buzzsproutFeed(page: string, feed: string | null) {
  const origin = new URL(page);
  const id = origin.pathname.match(/^\/(\d{1,12})\/episodes\/\d+(?:-[^/]+)?\/?$/)?.[1];
  if (!id || !/^[a-z\d-]+\.buzzsprout\.com$/.test(origin.hostname) ||
    feed !== `https://feeds.buzzsprout.com/${id}.rss`) return null;
  return feed;
}

async function episodeFact(web: PublicWeb, episode: string, feed: string, headings: string[], signal: AbortSignal) {
  const alternate = new URL(new URL(feed).pathname, 'https://rss.buzzsprout.com').href;
  const response = await web.document(feed, signal, url => url.href === feed || url.href === alternate);
  if (response.status !== 200 || response.body.length > 1_500_000 || !/\bxml\b/i.test(response.headers['content-type'] ?? '') ||
    /\b(?:nofollow|none)\b/i.test(response.headers['x-robots-tag'] ?? '')) return null;
  const xml = load(response.body.toString('utf8'), { xml: true });
  const channel = xml('rss > channel').first();
  const publisher = clean(channel.children('title').first().text());
  if (publisher.length < 3 || publisher.length > 100 || !headings.includes(normalizedName(publisher))) return null;
  const episodeId = new URL(episode).pathname.match(/\/episodes\/(\d+)/)?.[1];
  const channelUrl = publicLink(channel.children('link').first().text());
  const sameChannel = channelUrl && domain(channelUrl) === domain(episode);
  const item = channel.children('item').slice(0, 60).toArray().find(node => {
    const link = publicLink(xml(node).children('link').text());
    if (!link) return Boolean(sameChannel && episodeId && xml(node).children('guid').text().trim() === `Buzzsprout-${episodeId}`);
    if (!relatedPublisherHosts(domain(link), 'buzzsprout.com')) return false;
    return new URL(link).pathname.match(/\/episodes\/(\d+)/)?.[1] === episodeId && buzzsproutFeed(link, feed) !== null;
  });
  const date = item ? Date.parse(xml(item).children('pubDate').text()) : NaN;
  return Number.isFinite(date) ? { publisher, date } : null;
}

async function readPublisher(web: PublicWeb, pointer: PublisherPointer, activityDays: number, signal: AbortSignal) {
  let inspected = pointer.url;
  const checkedTerms: string[] = [];
  const audit = (code: string, records = 0, license?: string | null, publisher?: string | null): PublisherAudit => ({
    url: inspected, code, records, ...(license ? { license } : {}), ...(publisher ? { publisher } : {}),
    ...(records ? { use: 'FACTS_ONLY' as const } : {}), ...(checkedTerms.length ? { checkedTerms } : {}),
  });
  try {
    const host = domain(pointer.url);
    const own = (url: URL) => domain(url.href) === host && url.protocol === 'https:';
    const response = await web.document(pointer.url, signal, own);
    inspected = response.url;
    if (response.status !== 200) return { audit: audit(`HTTP_${response.status}`), seeds: [] };
    if (!/(?:text\/html|application\/xhtml\+xml)/i.test(response.headers['content-type'] ?? '')) return { audit: audit('NOT_HTML'), seeds: [] };
    const meta = pageMetadata(response.body.toString('utf8'), inspected);
    if (meta.challenge || meta.restricted || /\b(?:nofollow|none)\b/i.test(response.headers['x-robots-tag'] ?? '')) return { audit: audit('RESTRICTED'), seeds: [] };
    if (meta.canonical && domain(meta.canonical) !== host) return { audit: audit('SYNDICATED'), seeds: [] };
    if (blocksFactRead(meta.text)) return { audit: audit('TERMS_RESTRICTED'), seeds: [] };
    const feed = buzzsproutFeed(inspected, meta.rss);
    let termsReceipt = inspected;
    const listed = new Set([...meta.terms, ...(feed ? ['https://www.buzzsprout.com/tos'] : [])]);
    const permitTerms = (url: URL) => url.protocol === 'https:' && (relatedPublisherHosts(domain(url.href), host) ||
      Boolean(feed && url.hostname === 'www.buzzsprout.com' && /^\/tos\/?$/.test(url.pathname)));
    for (const terms of listed) {
      if (!permitTerms(new URL(terms))) return { audit: audit('TERMS_UNVERIFIED'), seeds: [] };
      const permission = await web.document(terms, signal, permitTerms);
      const text = clean(load(permission.body.toString('utf8')).text());
      if (permission.status !== 200 || !text || accessWarning.test(text.slice(0, 400))) return { audit: audit('TERMS_UNVERIFIED'), seeds: [] };
      checkedTerms.push(permission.url);
      if (blocksFactRead(text)) return { audit: audit('TERMS_RESTRICTED'), seeds: [] };
      termsReceipt = permission.url;
    }
    let feedFact: Awaited<ReturnType<typeof episodeFact>> = null;
    if (feed && !meta.publisher) {
      feedFact = await episodeFact(web, inspected, feed, meta.headings, signal).catch(() => null);
      if (!feedFact) return { audit: audit('PODCAST_RECORD_UNVERIFIED', 0, meta.license), seeds: [] };
    }
    const publisher = meta.publisher ?? feedFact?.publisher;
    if (!publisher) return { audit: audit('PUBLISHER_UNVERIFIED', 0, meta.license), seeds: [] };
    // Ambiguous publication timestamps and recent re-indexing cannot prove recent appearances.
    const now = Date.now();
    const observedDates = feedFact ? [...meta.dates, feedFact.date] : meta.dates;
    const date = observedDates[0];
    const dates = [...new Set(observedDates.map(value => new Date(value).toISOString().slice(0, 10)))];
    if (!meta.topical || !meta.title) return { audit: audit('TOPIC_UNVERIFIED', 0, meta.license, publisher), seeds: [] };
    if (dates.length !== 1 || date > now || date < now - activityDays * 86_400_000) {
      return { audit: audit('ACTIVITY_UNVERIFIED', 0, meta.license, publisher), seeds: [] };
    }
    const people = meta.people.filter(person => person.site && relevantCoach.test(person.job));
    const { name: expectedName, website: expectedSite } = pointer;
    if (expectedName && expectedSite && (namesMatch(meta.title, expectedName) || meta.people.some(person => namesMatch(person.name, expectedName)) ||
      meta.subjects.some(subject => namesMatch(subject, expectedName) && relevantCoach.test(subject)))) {
      const identityLink = meta.out.some(link => domain(link.url) === domain(expectedSite) && (namesMatch(link.label, expectedName) || namesMatch(link.context, expectedName)));
      const guest = meta.people.some(person => person.site && domain(person.site) === domain(expectedSite) && namesMatch(person.name, expectedName));
      const subject = pointer.viaOfficial && namesMatch(meta.title, expectedName) && meta.subjects.some(text => namesMatch(text, expectedName) && relevantCoach.test(text));
      if (identityLink || guest || subject) people.push({ name: expectedName, site: expectedSite, job: '' });
    }
    const seeds: Seed[] = [...new Map(people.flatMap(person => {
      const website = person.site;
      if (!website || relatedPublisherHosts(domain(website), host) || person.name.length < 3 || person.name.length > 120) return [];
      const seed: Seed = { method: 'PUBLICATION', adapter: publicationAdapter, name: person.name, website,
        source: inspected, sourceKey: `${host}:${hash(normalizedName(meta.title))}`, publisher: `organization:${normalizedName(publisher)}`,
        ...(meta.license ? { permission: meta.license } : {}),
        publication: { checkedAt: new Date(now).toISOString(), permissionPage: termsReceipt, digest: hash(response.body), use: 'FACTS_ONLY',
          ...(feedFact && feed ? { recordUrl: feed } : {}) },
        occurredAt: new Date(date).toISOString(), excerpt: `${publisher} published an appearance or contribution by ${person.name} related to the coaching specialty.` };
      return [[`${domain(website)}:${normalizedName(person.name)}`, seed] as const];
    })).values()];
    return { audit: audit(seeds.length ? 'ADMITTED' : 'OFFICIAL_LINK_UNVERIFIED', seeds.length, meta.license, publisher), seeds };
  } catch (error) {
    return { audit: audit(error instanceof PublicFailure ? error.code : signal.aborted ? 'TIMEOUT' : 'SOURCE_UNAVAILABLE'), seeds: [] };
  }
}

export async function verifyPublications(web: PublicWeb, pointers: PublisherPointer[], activityDays: number, signal: AbortSignal, limit = 5) {
  const unique = [...new Map(pointers.flatMap(pointer => {
    const url = publisherPointer(pointer.url);
    return url ? [[url, { ...pointer, url }] as const] : [];
  })).values()].slice(0, limit);
  const records: Awaited<ReturnType<typeof readPublisher>>[] = [];
  for (let offset = 0; offset < unique.length && !signal.aborted; offset += 3) {
    records.push(...await Promise.all(unique.slice(offset, offset + 3).map(pointer => readPublisher(web, pointer, activityDays,
      AbortSignal.any([signal, AbortSignal.timeout(8_000)])))));
  }
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
