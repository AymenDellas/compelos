import { load } from 'cheerio';
import { normalizedName, publisherPointer, relatedPublisherHosts, verifyPublications } from './auto-publishers';
import { createFunnelBrowser } from '../funnel-browser';
import { relevantCoach } from './discovery';
import { emptyCheckpoint, finding, hash, observe } from './policy';
import type { Checkpoint, Evidence, Settings } from './policy';
import { documentUrl, PublicFailure } from './public-web';
import type { PublicWeb } from './public-web';
import { domain } from './store';
import type { Artifact, Job } from './store';

const booking = /^(?:book|schedule|request|apply for)\b.{0,55}\b(?:call|session|consultation|assessment|coaching|meeting)\b|^(?:book now|book a time|apply now)$/i;
const offerLink = /\b(?:coaching|program(?:me)?s?|services|work with (?:me|us)|for (?:organisations|organizations|leaders|executives))\b/i;
const contactLink = /^(?:contact(?: us| me)?|get in touch|connect|inquir(?:e|ies)|enquir(?:e|ies))\b/i;
const aboutLink = /^(?:about\b|our story|company|meet (?:the )?(?:team|founder|coach)|the team)/i;
const caseLink = /^(?:case stud(?:y|ies)|(?:client|customer) (?:stories|case studies|results|success stories)|our clients)\b/i;
const mediaPage = /^(?:in the (?:press|media)|as (?:seen|featured) in|press(?: (?:&|and) media)?|media(?: (?:coverage|appearances))?|speaking(?: (?:&|and) media)?|interviews|podcasts)$/i;
const mediaPath = /^(?:press|media|media-appearances|media-coverage|appearances|interviews|podcast-appearances|press-and-media)$/i;
const appearanceLink = /\b(?:interview|podcast|episode|guest appearance|conference|keynote|webinar|summit|speaker)\b/i;
const activityLink = /\b(?:webinars?|workshops?|events?|cohorts?)\b/i;
const activityAction = /\b(?:register|reserve (?:a|your) (?:seat|place|spot)|join (?:the|this|our) (?:webinar|workshop|cohort)|enroll|enrol)\b/i;
const challenge = /verify (?:that )?you are human|checking your (?:browser|connection)|enable javascript and cookies to continue|(?:just a moment|access denied|attention required)\b/i;
const squash = (text: string) => text.trim().replace(/\s+/g, ' ');
const normalized = normalizedName;
const citedName = (label: string, name: string) => Boolean(name && ` ${normalized(label)} `.includes(` ${normalized(name)} `));
const containsName = (label: string, name: string) => {
  if (citedName(label, name)) return true;
  const tradeName = name.replace(/\s+(?:ltd|limited|llp|plc|llc|inc|cic)\.?$/i, '');
  if (tradeName !== name && normalized(tradeName).split(' ').length >= 2 && citedName(label, tradeName)) return true;
  const parts = normalized(name).split(' ');
  if (parts.length !== 2 || !parts.every(part => /^[\p{L}]{2,}$/u.test(part))) return false;
  // A displayed middle initial can differ from a source's omission of that initial.
  return new RegExp(`(?:^| )${parts[0]} \\p{L} ${parts[1]}(?: |$)`, 'u').test(normalized(label));
};
const scope = /\b(?:one[- ]on[- ]one|1\s*[:\-]\s*1|(?:individual|team) coaching|(?:regular |weekly |monthly )?coaching sessions?|coaching (?:program(?:me)?|engagement|package)|coaching for (?:[\w-]+ ){0,3}(?:executives|leaders|founders|managers|business owners)|(?:3|6|12)[- ]month)\b/i;
const navigationOnly = /\b(?:privacy|cookie|legal|terms|policies|newsletters?|archives?|login)\b/i;

type Link = { url: string; label: string; main: boolean; appearanceContext: boolean };
type MarketStatement = { country: NonNullable<Checkpoint['country']>; evidence: string };
export type Page = { url: string; state: string; evidence: Evidence; identity: string; brand?: string; canonical: string | null;
  statements: string[]; headings: string[]; title: string; links: Link[]; contact: { address: string; context: string } | null;
  contactProhibited: boolean; bookingControl: boolean; markets: MarketStatement[]; missingPage: boolean; activityDates: string[]; activityAction?: string };

function linkedUrl(value: string, current: string) {
  try {
    if (!value || value.startsWith('#')) return null;
    return documentUrl(new URL(value, current).href).href;
  } catch { return null; }
}

function markedMarkets(html: ReturnType<typeof load>, url: string): MarketStatement[] {
  type Node = Record<string, unknown>;
  const list = (value: unknown) => Array.isArray(value) ? value : [value];
  const nodes = (value: unknown) => list(value).filter((item): item is Node => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
  const country = (value: string, typedCountry: boolean): MarketStatement['country'] | null => {
    if (/^(?:Canada)$/i.test(value) || typedCountry && value === 'CA') return 'CA';
    if (/^(?:United States(?: of America)?|USA|U\.S\.)$/i.test(value) || value === 'US') return 'US';
    if (/^(?:United Kingdom|U\.K\.)$/i.test(value) || value === 'UK' || typedCountry && value === 'GB') return 'UK';
    return null;
  };
  return html('script[type="application/ld+json"]').slice(0, 10).toArray().flatMap(script => {
    const value = html(script).text();
    if (value.length > 60_000) return [];
    try {
      return nodes(JSON.parse(value)).flatMap(item => [item, ...nodes(item['@graph']).slice(0, 30)]).flatMap(item => {
        const types = list(item['@type']).map(type => typeof type === 'string' ? type.replace(/^https?:\/\/schema\.org\//, '') : '');
        const reference = (urlValue: unknown) => typeof urlValue === 'string' ? linkedUrl(urlValue, url) : null;
        const official = reference(item.url);
        if (official && domain(official) === domain(url) && types.some(type => /^(?:Organization|LocalBusiness|ProfessionalService|Corporation)$/.test(type))) {
          return nodes(item.address).flatMap(address => {
            if (typeof address.addressLocality !== 'string' || typeof address.postalCode !== 'string') return [];
            const label = typeof address.addressCountry === 'string' ? address.addressCountry.trim() : '';
            const market = country(label, true);
            return market ? [{ country: market, evidence: `Official business address: ${address.addressLocality}, ${address.postalCode}, ${label}` }] : [];
          });
        }
        const service = [item.serviceType, item.name].find((label): label is string => typeof label === 'string' && relevantCoach.test(label));
        if (!types.includes('Service') || !service) return [];
        const provider = nodes(item.provider)[0];
        const subject = reference(item.provider ? provider?.url ?? provider?.['@id'] ?? item.provider : item.url);
        if (!subject || domain(subject) !== domain(url)) return [];
        return list(item.areaServed).flatMap(area => {
          const node = nodes(area)[0];
          const typed = Boolean(node && list(node['@type']).some(type => type === 'Country' || type === 'https://schema.org/Country'));
          const label = typeof area === 'string' ? area.trim() : typed && typeof node.name === 'string' ? node.name.trim() : '';
          const market = country(label, typed);
          return market ? [{ country: market, evidence: `Service.areaServed: ${label} · ${service.slice(0, 140)}` }] : [];
        });
      });
    } catch { return []; }
  });
}

export function parseBusinessPage(html: string, url: string) {
  const $ = load(html);
  const title = squash($('title').first().text());
  const site = $('meta[property="og:site_name"]').attr('content') ?? '';
  const logo = $('header a[href="/"] img[alt], header a[href="/"][aria-label]').first();
  const copyright = squash($('footer').text()).match(/(?:Copyright\s*)?©\s*20\d{2}\s*([^.!?]{3,95})\.?\s+All rights reserved/i)?.[1];
  const brand = [site, copyright, logo.attr('alt'), logo.attr('aria-label')].flatMap(value => {
    const label = squash(value ?? '').replace(/\s+logo$/i, '');
    return label.length >= 3 && label.length <= 100 && !/[_/]|\.(?:png|jpe?g|svg|webp)$|^(?:home|homepage|official website|logo|site logo|coaching|executive coaching)$/i.test(label) ? [label] : [];
  })[0];
  const canonical = linkedUrl($('link[rel="canonical"]').attr('href') ?? '', url);
  const markets = markedMarkets($, url);
  const postalMarkets = [
    { country: 'UK', countryName: /\bUnited Kingdom\b/i, postalCode: /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i },
    { country: 'CA', countryName: /\bCanada\b/i, postalCode: /\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/i },
    { country: 'US', countryName: /\b(?:United States|USA)\b/i, postalCode: /\b\d{5}(?:-\d{4})?\b/ },
  ] as const;
  $('address,[itemprop="address"],a[href^="https://maps.app.goo.gl/"]').slice(0, 12).each((_index, element) => {
    const address = squash($(element).text()).slice(0, 250);
    const market = postalMarkets.find(item => item.countryName.test(address) && item.postalCode.test(address));
    if (market) markets.push({ country: market.country, evidence: `Published business address: ${address}` });
  });
  $('script,style,noscript,template,blockquote,[hidden],[aria-hidden="true"],.testimonial,.review').remove();
  $('br').replaceWith(' ');
  const content = $('main,[role="main"]').first();
  const read = (selector: string) => content.length ? content.find(selector) : $(selector).filter((_i, node) => !$(node).closest('nav,footer,aside').length);
  const headings = read('h1,h2,h3').slice(0, 50).toArray().map(node => squash($(node).text()).slice(0, 240));
  const activityDates = read('time[datetime]').slice(0, 12).toArray().map(node => $(node).attr('datetime') ?? '');
  activityDates.push($('meta[property="article:published_time"]').attr('content') ?? '');
  const eventAction = read('a[href],button').slice(0, 80).toArray().map(node => squash($(node).text()).slice(0, 100))
    .find(text => text.length <= 80 && activityAction.test(text));
  const identity = [title, site, ...headings.slice(0, 5)].filter(Boolean).join(' · ').slice(0, 400);
  const statements = read('p,li,h1,h2,h3,address,dl').filter((_i, node) => !$(node).closest('nav,footer,aside').length)
    .slice(0, 220).toArray().map(node => squash($(node).text()).slice(0, 450)).filter(Boolean);
  const links = $('a[href]').slice(0, 240).toArray().flatMap(node => {
    const raw = $(node).attr('href') ?? '';
    const label = squash($(node).text() || $(node).attr('aria-label') || $(node).find('img[alt]').first().attr('alt') || '').slice(0, 100);
    const target = linkedUrl(raw, url);
    if (!label || !target || target === url) return [];
    const main = !$(node).closest('header,footer,nav,aside').length;
    const context = squash($(node).closest('article,li,p,figure').text()).slice(0, 350);
    return [{ label, url: target, main, appearanceContext: main && appearanceLink.test(context) }];
  });
  const bookingControl = read('button,input[type="submit"],iframe,a[href^="#"],a[href^="javascript:"]').toArray().some(node =>
    booking.test(squash($(node).text() || $(node).attr('value') || $(node).attr('title') || $(node).attr('aria-label') || ''))
    || /calendly|acuityscheduling|cal\.com/i.test($(node).attr('src') ?? '')) || read('form').toArray().some(node => {
    const form = $(node);
    const context = squash([form.attr('aria-label'), form.attr('action'), form.text()].join(' '));
    // Only an explicitly identified newsletter is irrelevant. An unknown form may offer another inquiry path.
    return !/newsletter|mailing list|email updates/i.test(context) || /consultation|strategy call|book|coaching inquiry/i.test(context);
  });
  let contact: Page['contact'] = null;
  const invitation = /\b(?:vendor|supplier|partnership|service provider|business development|business|general)\s+(?:enquir(?:ies|y)|inquir(?:ies|y)|proposals?)\b/i;
  const forbidden = /no\s+(?:unsolicited|solicitations?)|do not (?:contact|send|submit).{0,55}(?:sales|marketing|solicitations?)|not accept.{0,25}(?:unsolicited|solicitations?)/i;
  const bodyText = squash($('body').text()).slice(0, 12_000);
  const contactPage = [headings[0], title].some(value => value && contactLink.test(value));
  $('main a[href^="mailto:"],article a[href^="mailto:"], address a[href^="mailto:"], a[href^="mailto:"]').each((_i, node) => {
    const a = $(node);
    const address = (a.attr('href') ?? '').slice(7).trim().toLowerCase();
    const context = squash(a.closest('p,li,address,section,div').text()).slice(0, 450);
    if (!forbidden.test(bodyText) && (invitation.test(context) || contactPage || a.closest('address,footer').length > 0) && /^(?:hello|info|contact|office|team|partnerships|business|vendors|enquiries|inquiries)@[a-z\d.-]+\.[a-z]{2,}$/i.test(address)
      && address.split('@')[1].replace(/^www\./, '') === domain(url)) contact = { address, context };
  });
  if (!contact && contactPage && !forbidden.test(bodyText)) {
    const inquiry = read('form').toArray().find(node => {
      const form = $(node);
      const text = squash(form.text());
      return form.find('input[type="email"]').length && form.find('textarea').length &&
        !/\b(?:newsletter|subscribe|apply for coaching|book a (?:call|session)|existing clients only|support requests only)\b/i.test(text);
    });
    if (inquiry) contact = { address: url, context: 'Official contact page with a public email and message form.' };
  }
  const missingPage = [title, ...headings.slice(0, 2)].some(item => /^(?:404(?:\s*[-:·|]\s*)?(?:error|page not found)?|(?:sorry[, ]+)?(?:the )?page (?:was )?not found)(?:\s*[-:·|].*)?$/i.test(item));
  return { identity, brand, canonical, statements, headings, title, links, contact, bookingControl, markets, missingPage, activityDates, activityAction: eventAction,
    contactProhibited: forbidden.test(bodyText), challenged: challenge.test(`${title} ${bodyText.slice(0, 850)}`) };
}

export async function inspect(web: PublicWeb, value: string, signal: AbortSignal, method: string, permit: (url: URL) => boolean): Promise<Page> {
  let url = value;
  let state: string;
  let extraction: ReturnType<typeof parseBusinessPage> | undefined;
  let payload: Buffer | undefined;
  try {
    const response = await web.document(value, AbortSignal.any([signal, AbortSignal.timeout(10_000)]), permit);
    url = response.url;
    payload = response.body;
    const html = /(?:text\/html|application\/xhtml\+xml)/i.test(response.headers['content-type'] ?? '');
    if (html) extraction = parseBusinessPage(response.body.toString('utf8'), url);
    const header = `${response.headers['x-robots-tag'] ?? ''} ${response.headers['cf-mitigated'] ?? ''}`;
    const blocked = [401, 403, 429, 451, 999].includes(response.status) || /noarchive|challenge/i.test(header) || extraction?.challenged;
    state = blocked ? 'ACCESS_RESTRICTED' : response.status === 200 && extraction ? 'READABLE' : `HTTP_${response.status}`;
  } catch (error) {
    signal.throwIfAborted();
    state = error instanceof PublicFailure ? error.code : 'UNAVAILABLE';
  }
  const evidence = observe(state === 'READABLE' ? 'official' : 'http', url,
    state === 'READABLE' ? 'HTTP 200 · Public HTML read' : state.replaceAll('_', ' '), method, state === 'ACCESS_RESTRICTED' ? undefined : payload);
  return { url, state, evidence, identity: '', canonical: null, statements: [], headings: [], title: '', links: [], contact: null, contactProhibited: false, bookingControl: false, markets: [], missingPage: false, activityDates: [],
    ...(state === 'READABLE' ? extraction : {}) };
}

function add(checkpoint: Checkpoint, name: Parameters<typeof finding>[0], state: Parameters<typeof finding>[1], assertion: string, evidence: Evidence[] = []) {
  for (const item of evidence) {
    if (!checkpoint.evidence.some(known => known.id === item.id)) checkpoint.evidence.push(item);
  }
  checkpoint.gates = checkpoint.gates.filter(gate => gate.name !== name).concat(finding(name, state, assertion, evidence));
}

function quote(page: Page, value: string, method: string) {
  return { ...page.evidence, id: hash(`${page.evidence.id}:${method}:${value}`), excerpt: value.slice(0, 450), method };
}

export async function resolveBusiness(web: PublicWeb, job: Job, signal: AbortSignal) {
  const checkpoint = emptyCheckpoint();
  const seeds = job.seeds.filter(seed => domain(seed.website) === job.domain);
  const page = await inspect(web, job.website, signal, 'Official entry point', url => domain(url.href) === job.domain);
  checkpoint.evidence.push(page.evidence);
  const provenance = new Map(job.seeds.slice(0, 30).map(seed => [seed, observe('source', seed.source,
    seed.parent ? `${seed.excerpt} The same record links ${seed.parent}.` : seed.excerpt, `${seed.method} record`)]));
  checkpoint.evidence.push(...provenance.values());
  for (const url of new Set(job.seeds.flatMap(seed => seed.permission ? [seed.permission] : []))) {
    checkpoint.evidence.push(observe('source', url, 'Applicable declaration recorded by the discovery source.', 'Source access policy'));
  }
  let identity = page;
  const matches = (item: Page) => seeds.filter(seed => seed.method === 'BUSINESS_SEARCH'
    ? Boolean(item.brand) : containsName(item.identity, seed.name));
  let candidates = matches(identity);
  const homepage = new URL('/', page.url).href;
  if (!candidates.length && seeds.some(seed => seed.method === 'BUSINESS_SEARCH') && page.state === 'READABLE' && homepage !== page.url) {
    identity = await inspect(web, homepage, signal, 'Official site branding', url => domain(url.href) === job.domain);
    checkpoint.evidence.push(identity.evidence);
    candidates = matches(identity);
  }
  const about = page.links.filter(link => domain(link.url) === job.domain && !navigationOnly.test(link.label) &&
    (aboutLink.test(link.label) || /\/(?:about(?:-us|-me)?|our-team|team|our-story)\/?$/i.test(new URL(link.url).pathname))).slice(0, 2);
  for (const link of about) {
    if (candidates.length) break;
    identity = await inspect(web, link.url, signal, 'Official About page', url => domain(url.href) === job.domain);
    checkpoint.evidence.push(identity.evidence);
    candidates = matches(identity);
  }
  const multipleDomains = job.seeds.some(seed => domain(seed.website) !== job.domain && seed.method !== 'IGNITION');
  const canonicalConflict = [page, identity].some(item => item.canonical && domain(item.canonical) !== job.domain);
  if (!candidates.length || multipleDomains || canonicalConflict) {
    add(checkpoint, 'identity', 'UNVERIFIED', multipleDomains || canonicalConflict ? 'Sources point to different official domains.'
      : page.state !== 'READABLE' ? `The official site could not be read (${page.state}).`
      : 'The source listing could not be corroborated on the official site or About pages.', [identity.evidence, ...provenance.values()]);
    return { checkpoint, done: true };
  }
  const source = candidates.find(seed => seed.method !== 'IGNITION' && provenance.has(seed));
  if (!source) return { checkpoint, done: true };
  const record = provenance.get(source)!;
  checkpoint.identityPage = identity.url;
  checkpoint.identityName = source.method === 'BUSINESS_SEARCH' ? identity.brand : source.name;
  add(checkpoint, 'identity', 'VERIFIED', source.method === 'BUSINESS_SEARCH'
    ? 'The indexed domain identifies its business through first-party site branding.'
    : 'The source-linked website independently identifies the same business or coaching brand.',
    [record, quote(identity, `The first-party page identifies ${checkpoint.identityName}.`, 'Official name corroboration')]);
  const irrelevant = page.headings.find(line => /\b(?:executive search firm|recruitment agency|psychotherapy practice|software platform)\b/i.test(line));
  if (irrelevant && !page.statements.some(line => relevantCoach.test(line))) {
    add(checkpoint, 'niche', 'CONTRADICTED', 'The official site describes a different primary service.', [quote(page, irrelevant, 'Primary service heading')]);
    return { checkpoint, done: true };
  }
  recordMarket(checkpoint, [page]);
  return { checkpoint, done: false };
}

function recordMarket(checkpoint: Checkpoint, pages: Page[]) {
  delete checkpoint.country;
  const region = /\b(?:serve|serves|serving|work with|work across|coaching (?:for|across|in)|our clients (?:are|include)|clients (?:based|located) in|(?:we are|our (?:practice|business|office) is|our headquarters (?:is|are)) based in)\b[^.;!?]{0,65}\b(United States\b|United Kingdom\b|Canada\b|U\.S\.|U\.K\.|USA\b|UK\b|US\b)/i;
  const outside = /\b(?:only|exclusively)\s+(?:serve|work with|coach)\b[^.;!?]{0,60}\b(France|Germany|Spain|Italy|Netherlands|Belgium|Switzerland|Australia|New Zealand|India|Singapore|Ireland)\b/i;
  const positive = pages.flatMap(page => [...page.statements, page.title].flatMap(line => {
    if (/\b(?:not|never|except|excludes?)\b/i.test(line)) return [];
    const match = line.match(region);
    if (!match || /^(?:us|uk)$/i.test(match[1]) && match[1] !== match[1].toUpperCase()) return [];
    const country = /Canada/i.test(match[1]) ? 'CA' as const : /Kingdom|U\.?K/i.test(match[1]) ? 'UK' as const : 'US' as const;
    return [{ country, evidence: quote(page, line, 'Explicit market or business base') }];
  }));
  positive.push(...pages.flatMap(page => page.markets.map(market => ({ country: market.country,
    evidence: quote(page, market.evidence, 'Official service area or operating address') }))));
  const negative = pages.flatMap(page => page.statements.filter(line => outside.test(line)).map(line => quote(page, line, 'Exclusive market statement')));
  if (positive.length && negative.length) add(checkpoint, 'geography', 'UNVERIFIED', 'The site makes conflicting market statements.', [positive[0].evidence, negative[0]]);
  else if (negative.length) add(checkpoint, 'geography', 'CONTRADICTED', 'The business explicitly limits service to an ineligible market.', [negative[0]]);
  else if (positive.length) {
    checkpoint.country = positive[0].country;
    add(checkpoint, 'geography', 'VERIFIED', 'Official service or operating-address evidence establishes an eligible market.', [positive[0].evidence]);
  } else add(checkpoint, 'geography', 'UNVERIFIED', 'The public site did not establish an eligible business market.');
}

function recordAcquisition(job: Job, checkpoint: Checkpoint, activityDays: number) {
  const now = Date.now();
  const organizations = new Set<string>();
  const hosts = new Set<string>();
  const records = new Set<string>();
  const evidence: Evidence[] = [];
  const validUntil: number[] = [];
  for (const seed of job.seeds) {
    if (!seed.occurredAt || seed.method === 'IGNITION' || normalized(seed.name) !== normalized(checkpoint.identityName ?? job.name)) continue;
    const occurred = Date.parse(seed.occurredAt);
    const permissionExpires = seed.method === 'PUBLICATION' ? Date.parse(seed.publication?.checkedAt ?? '') + 86_400_000 : Infinity;
    if (!Number.isFinite(occurred) || occurred > now || occurred < now - activityDays * 86_400_000 || !(permissionExpires > now)) continue;
    const host = domain(seed.source);
    const organization = seed.publisher ?? host;
    const key = seed.sourceKey.split(':').slice(1).join(':');
    const record = /^[a-f0-9]{64}$/.test(key) ? key : key ? hash(normalizedName(key)) : '';
    if (!record || organizations.has(organization) || relatedPublisherHosts(host, job.domain) ||
      [...hosts].some(known => relatedPublisherHosts(known, host)) || records.has(record)) continue;
    organizations.add(organization);
    hosts.add(host);
    records.add(record);
    validUntil.push(Math.min(occurred + activityDays * 86_400_000, permissionExpires));
    const reference = seed.publication ? ` · ${seed.publication.use === 'FACTS_ONLY' ? 'Public facts only. Source conditions checked at' : 'Scoped permission checked at'} ${seed.publication.permissionPage} · SHA-256 ${seed.publication.digest}${seed.publication.recordUrl ? ` · Publication date verified via ${seed.publication.recordUrl}` : ''}` : '';
    evidence.push(observe('external', seed.source, `${seed.occurredAt.slice(0, 10)} · ${seed.excerpt}${reference}`, 'Publisher-linked exposure'));
  }
  const independent = evidence.length;
  const activityDates = new Set<string>();
  const activityUrls = new Set<string>();
  for (const { date, evidence: item } of checkpoint.ownedActivities ?? []) {
    const day = date.slice(0, 10);
    const occurred = Date.parse(date);
    const end = occurred + activityDays * 86_400_000;
    if (activityDates.has(day) || activityUrls.has(item.url) || !(end > now) || occurred > now + 60 * 86_400_000) continue;
    activityDates.add(day);
    activityUrls.add(item.url);
    validUntil.push(end);
    evidence.push(item);
  }
  checkpoint.acquisitionSources = independent;
  const verified = evidence.length >= 2;
  add(checkpoint, 'acquisition', verified ? 'VERIFIED' : 'UNVERIFIED',
    `${independent} independent publisher record(s) and ${activityDates.size} dated first-party coaching campaign(s) ${verified ? 'establish recent acquisition activity' : 'were verified. More activity evidence is needed'}.`, evidence);
  const gate = checkpoint.gates.at(-1)!;
  if (gate.expiresAt && validUntil.length) gate.expiresAt = new Date(Math.min(Date.parse(gate.expiresAt), ...validUntil)).toISOString();
}

function ownedActivity(page: Page) {
  const heading = page.headings[0] || page.title;
  if (!activityLink.test(heading) || !page.activityAction || !relevantCoach.test([heading, ...page.statements.slice(0, 12)].join(' '))) return [];
  const days = [...new Set(page.activityDates.filter(value => /^\d{4}-\d\d-\d\d(?:T|$)/.test(value) && Number.isFinite(Date.parse(value)))
    .map(value => value.slice(0, 10)))];
  if (days.length !== 1) return [];
  return [{ date: days[0], evidence: quote(page, `${days[0]} · ${heading} · ${page.activityAction}`, 'Dated first-party coaching campaign') }];
}

function publicationLinks(pages: Page[], job: Job, checkpoint: Checkpoint) {
  const name = checkpoint.identityName ?? job.name;
  for (const page of pages) for (const link of page.links) {
    if (domain(link.url) === job.domain) {
      if (!checkpoint.mediaPage && (mediaPage.test(link.label) || mediaPath.test(new URL(link.url).pathname.split('/').filter(Boolean).at(-1) ?? ''))) {
        checkpoint.mediaPage = link.url;
      }
      continue;
    }
    const url = publisherPointer(link.url);
    if (!url || !link.main || relatedPublisherHosts(domain(url), job.domain)) continue;
    const path = new URL(url).pathname;
    if (path === '/' || (!link.appearanceContext && !appearanceLink.test(`${link.label} ${path.replace(/[-_/]/g, ' ')}`))) continue;
    const pointers = checkpoint.publisherPointers ??= [];
    if (pointers.length < 10 && !pointers.some(item => item.url === url)) pointers.push({ url, name, website: job.website, viaOfficial: true });
  }
}

async function sitemapMediaPage(web: PublicWeb, job: Job, signal: AbortSignal) {
  const own = (url: URL) => url.protocol === 'https:' && domain(url.href) === job.domain;
  const budget = AbortSignal.any([signal, AbortSignal.timeout(5_500)]);
  const entries = async (url: string, selector: string) => {
    try {
      const response = await web.document(url, budget, own);
      if (response.status !== 200 || response.body.length > 512_000 || !/\bxml\b/i.test(response.headers['content-type'] ?? '') ||
        /\b(?:noarchive|nofollow|none)\b/i.test(response.headers['x-robots-tag'] ?? '')) return [];
      const xml = load(response.body.toString('utf8'), { xml: true });
      return xml(selector).slice(0, 600).toArray().flatMap(node => {
        const url = linkedUrl(xml(node).text().trim(), response.url);
        return url && own(new URL(url)) ? [url] : [];
      });
    } catch { signal.throwIfAborted(); return []; }
  };
  const root = new URL('/sitemap.xml', job.website);
  if (!own(root)) return undefined;
  const locations = await entries(root.href, 'urlset > url > loc, sitemapindex > sitemap > loc');
  const match = (url: string) => mediaPath.test(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '');
  const page = locations.find(match);
  if (page) return page;
  const nested = locations.find(url => /\/(?:pages?-sitemap|sitemap-pages?)(?:-?\d+)?\.xml$/i.test(new URL(url).pathname));
  return nested ? (await entries(nested, 'urlset > url > loc')).find(match) : undefined;
}

export async function enrichAcquisition(web: PublicWeb, job: Job, settings: Settings, signal: AbortSignal) {
  const checkpoint = job.checkpoint;
  if (checkpoint.gates.find(gate => gate.name === 'acquisition')?.state === 'VERIFIED' ||
      checkpoint.gates.find(gate => gate.name === 'identity')?.state !== 'VERIFIED') return [];
  checkpoint.mediaPage ??= await sitemapMediaPage(web, job, signal);
  if (checkpoint.mediaPage) {
    const page = await inspect(web, checkpoint.mediaPage, signal,
      'Official media links', url => domain(url.href) === job.domain);
    // A timed out source should leave the job resumable under its owner fence.
    addJourney(checkpoint, job.website, page, 'Media appearances');
    if (page.state === 'READABLE') publicationLinks([page], job, checkpoint);
  }
  const name = checkpoint.identityName ?? job.name;
  const references = job.seeds.filter(seed => normalized(seed.name) === normalized(name) && domain(seed.website) === job.domain)
    .flatMap(seed => (seed.publisherLinks ?? []).map(url => ({ url, name, website: job.website })));
  const discovered = await verifyPublications(web, [...(checkpoint.publisherPointers ?? []), ...references], settings.activityDays, signal, 8);
  checkpoint.publisherAudit = discovered.audit;
  recordAcquisition({ ...job, seeds: [...job.seeds, ...discovered.seeds] }, checkpoint, settings.activityDays);
  return discovered.seeds;
}

function routeHost(value: string, official: string) {
  const host = domain(value);
  return host === official || ['book.', 'booking.', 'schedule.'].some(prefix => host === `${prefix}${official}`) ||
    /^(?:calendly\.com|cal\.com|app\.acuityscheduling\.com|[a-z\d-]+\.as\.me|savvycal\.com)$/i.test(host);
}

function addJourney(checkpoint: Checkpoint, from: string, page: Page, label: string) {
  checkpoint.evidence.push(page.evidence);
  checkpoint.journey.push({ from, url: page.url, label, result: page.state, evidence: page.evidence.id });
}

function bookingDuration(text: string) {
  const mentions = [...text.matchAll(/\b(\d{1,3})\s*[-–]?\s*min(?:ute)?s?\b/gi)];
  const duration = mentions.length === 1 ? Number(mentions[0][1]) : 0;
  return duration >= 5 && duration <= 120 ? duration : null;
}

function durationMismatch(from: Page, link: Link, destination: Page) {
  if (!link.main || destination.state !== 'READABLE' || destination.missingPage) return;
  const promised = bookingDuration(link.label);
  if (!promised) return;
  const statements = [destination.title, ...destination.headings.slice(0, 4), ...destination.statements.slice(0, 12)]
    .filter(text => /\b(?:duration|call|consultation|session|appointment)\b/i.test(text));
  const durations = statements.flatMap(text => {
    const listed = bookingDuration(text);
    return listed ? [{ listed, text }] : [];
  });
  const first = durations[0];
  if (!first || Math.abs(first.listed - promised) < 10 || Math.max(first.listed, promised) / Math.min(first.listed, promised) < 1.5
    || durations.some(item => item.listed !== first.listed)) return;
  return { promised, listed: first.listed, evidence: [quote(from, link.label, 'Offer CTA duration'),
    quote(destination, first.text, 'Booking page duration')] };
}

function offerOn(page: Page) {
  const specialty = /\b(?:(?:strategic )?leadership advis(?:ory|er|or)|CEO mentor(?:ing|ship)?|founder advis(?:ory|er|or)|executive development)\b/i;
  const line = [page.headings[0], page.title, ...page.headings].find(value => value && (relevantCoach.test(value) || specialty.test(value)) &&
    !/^(?:why|how|what|do|does|should|the .* questions)\b/i.test(value));
  if (!line) return null;
  const detail = page.statements.find(value => scope.test(value) && (relevantCoach.test(line) || /\bcoach(?:ing|es)?\b/i.test(value)) &&
    !/^(?:“|"|one of my (?:previous|former)|my (?:former |previous )?employer|when i hired|i highly recommend)/i.test(value));
  return { page, line, detail };
}

function detailPages(pages: Page[], own: (url: URL) => boolean) {
  const targets = [...new Map(pages.flatMap(page => page.links).filter(link => own(new URL(link.url)) &&
    !navigationOnly.test(link.label) && !pages.some(page => page.url === link.url)).map(link => [link.url, link])).values()];
  const ranked = targets.map(link => {
    const label = `${link.label} ${new URL(link.url).pathname.replace(/[-_/]/g, ' ')}`;
    const score = Number(relevantCoach.test(label)) * 6 + Number(offerLink.test(label)) * 2 + Number(link.main) -
      Number(/\b(?:podcast|blog|articles|news|speaking|free training)\b/i.test(label)) * 6;
    return { link, score };
  });
  const offers = ranked.filter(value => value.score >= 2).sort((a, b) => b.score - a.score).slice(0, 2).map(value => value.link);
  const other = [caseLink, contactLink, aboutLink, activityLink].flatMap(pattern => {
    const best = targets.find(link => pattern.test(link.label));
    return best ? [best] : [];
  });
  return [...new Map([...offers, ...other].map(link => [link.url, link])).values()];
}

export async function investigate(web: PublicWeb, job: Job, settings: Settings, signal: AbortSignal) {
  const checkpoint = job.checkpoint;
  const own = (url: URL) => domain(url.href) === job.domain;
  const page = await inspect(web, job.website, signal, 'Offer investigation entry', own);
  addJourney(checkpoint, job.website, page, 'Official site');
  const pages = [page];
  if (checkpoint.identityPage && checkpoint.identityPage !== page.url) {
    const identity = await inspect(web, checkpoint.identityPage, signal, 'Official identity recheck', own);
    addJourney(checkpoint, page.url, identity, 'Identity recheck');
    if (identity.state === 'READABLE') pages.push(identity);
  }
  if (page.state !== 'READABLE' || !pages.some(item => item.brand === checkpoint.identityName && Boolean(item.brand) ||
    containsName(item.identity, checkpoint.identityName ?? job.name))) {
    add(checkpoint, 'identity', 'UNVERIFIED', 'The official entry point could not be corroborated during investigation.', [page.evidence]);
    return { checkpoint, artifacts: [] };
  }
  const planned = detailPages(pages, own);
  const details = await Promise.all(planned.map(link => inspect(web, link.url, signal, 'Official detail page', own)));
  for (const [index, detail] of details.entries()) {
    addJourney(checkpoint, page.url, detail, planned[index].label);
    if (detail.state === 'READABLE') pages.push(detail);
  }
  recordMarket(checkpoint, pages);
  checkpoint.ownedActivities = pages.flatMap(ownedActivity);
  recordAcquisition(job, checkpoint, settings.activityDays);
  publicationLinks(pages, job, checkpoint);
  const observed = pages.flatMap(item => { const candidate = offerOn(item); return candidate ? [candidate] : []; });
  const selected = observed.find(item => item.detail && item.page.url !== page.url) ?? observed.find(item => item.detail) ?? observed[0];
  const offer = selected?.page;
  const line = selected?.line;
  const engagement = selected?.detail;
  if (offer && line && engagement) {
    checkpoint.offer = line;
    add(checkpoint, 'niche', 'VERIFIED', 'The official page describes a specialized coaching engagement.', [quote(offer, line, 'Offer heading'), quote(offer, engagement, 'Engagement scope')]);
    const price = offer.statements.find(item => !/\b(?:revenue|sales|per (?:hour|session|month)|\/hour)\b/i.test(item) &&
      /\b(?:investment|pricing|package|engagement|program(?:me)? fee)\b[^.!?]{0,55}(?:USD|CAD|GBP|[$£])\s*(?:[3-9],?\d{3}|[1-9]\d,?\d{3})\b/i.test(item));
    const substance = pages.flatMap(item => item.statements.map(statement => ({ page: item, statement })))
      .find(item => {
        const since = item.statement.match(/\b(?:founded|established|in business|(?:providing|offering|delivering) (?:executive |leadership |business )?coaching)\s+(?:in\s+|since\s+)?(19\d{2}|20\d{2})\b/i);
        return Boolean(since && Number(since[1]) <= new Date().getUTCFullYear() - 3);
      });
    const clientCase = pages.flatMap(item => {
      const client = item.headings.map(text => text.match(/^case study\s*[:–-]\s*([\p{L}\d][\p{L}\d& .'-]{3,80})$/iu)).find(Boolean);
      if (!client) return [];
      const engagement = item.statements.find(text => containsName(text, client[1]) && /\b(?:hired|retained|commissioned|engaged|contracted)\b.{0,90}\b(?:executive|leadership|business) coaching\b/i.test(text));
      return engagement ? [quote(item, `${client[0]} · ${engagement}`, 'Named business engagement case study')] : [];
    })[0];
    const procurement = job.seeds.find(seed => seed.method === 'PROCUREMENT' && seed.contract &&
      normalized(seed.name) === normalized(checkpoint.identityName ?? job.name) && domain(seed.website) === job.domain);
    const proof = price ? quote(offer, price, 'Published offer price') : clientCase ?? (procurement?.contract ? observe('external', procurement.source,
      `${procurement.contract.buyer} recorded a coaching award to ${procurement.name} on ${procurement.contract.awardedOn.slice(0, 10)}. Value GBP ${procurement.contract.amountGbp}. Open Government Licence v3.0.`, 'Public contract award') : undefined);
    const program = offer.statements.find(item => /\b(?:(?:[3-9]|1[0-9])[- ]month|(?:[6-9]|[1-9]\d) (?:private |individual |executive |leadership )?coaching sessions)\b/i.test(item)
      && /\b(?:coaching|engagement|program(?:me)?)\b/i.test(item) && !/\b(?:free|may offer|might offer|formerly)\b/i.test(item));
    const commercial = [proof, substance && quote(substance.page, substance.statement, 'First-party operating history'),
      program && quote(offer, program, 'Published coaching program scope')].filter((item): item is Evidence => Boolean(item));
    add(checkpoint, 'substance', commercial.length >= 2 ? 'VERIFIED' : 'UNVERIFIED', commercial.length >= 2
      ? 'Multiple documented measures establish commercial substance for the scoped coaching offer.'
      : 'Commercial substance needs two supporting signals across a substantial program, a price or client engagement, and operating history.', commercial);
  } else {
    add(checkpoint, 'niche', 'UNVERIFIED', line ? 'A specialized offer was visible, but the provider did not establish its coaching scope.' : 'A specialized coaching offer was not established.');
    add(checkpoint, 'substance', 'UNVERIFIED', 'A matching scoped coaching engagement is needed before commercial proof can qualify.');
  }

  const contact = pages.find(item => item.contact);
  const termsLink = contact && !pages.some(item => item.contactProhibited) ? pages.flatMap(item => item.links)
    .find(link => own(new URL(link.url)) && /^(?:website |site )?terms(?: (?:of (?:use|service)|and conditions))?$/i.test(link.label)) : undefined;
  const terms = termsLink ? await inspect(web, termsLink.url, signal, 'Official contact restrictions', own) : undefined;
  const restricted = [...pages, ...(terms ? [terms] : [])].find(item => item.contactProhibited);
  delete checkpoint.contact;
  if (contact?.contact && !restricted) {
    checkpoint.contact = contact.contact.address;
    add(checkpoint, 'contact', 'VERIFIED', 'The official site publishes a general business inquiry route.', [quote(contact, `${contact.contact.address} · ${contact.contact.context}`, 'Published business inquiry route')]);
  } else add(checkpoint, 'contact', 'UNVERIFIED', restricted
    ? 'The site publishes restrictions on unsolicited inquiries.' : 'No suitable public business inquiry route was found.', restricted ? [restricted.evidence] : []);

  const artifacts: Artifact[] = [];
  if (checkpoint.gates.some(gate => gate.state === 'CONTRADICTED')) return { checkpoint, artifacts };
  const prioritized = offer ? [offer, ...pages.filter(item => item !== offer)] : pages;
  const routesByUrl = new Map<string, { from: Page; link: Link }>();
  for (const from of prioritized) for (const link of [...from.links].sort((a, b) => Number(b.main) - Number(a.main))) {
    if (booking.test(link.label) && !routesByUrl.has(link.url)) routesByUrl.set(link.url, { from, link });
  }
  const routes = [...routesByUrl.values()].filter(({ link }) => routeHost(link.url, job.domain)).slice(0, 3);
  const cta = routes[0]?.link;
  checkpoint.funnel = { found: routesByUrl.size, tested: 0, interactive: prioritized.some(item => item.bookingControl) };
  checkpoint.signature = { offer: hash(normalized(`${line ?? ''} ${engagement ?? ''}`)), booking: cta?.url ?? '' };
  if (job.signature) {
    const previousOffer = /^[a-f0-9]{64}$/.test(job.signature.offer) ? job.signature.offer : hash(job.signature.offer);
    checkpoint.changes = (['offer', 'booking'] as const).filter(key => (key === 'offer' ? previousOffer : job.signature?.booking) !== checkpoint.signature?.[key]);
    if (checkpoint.changes.length) checkpoint.evidence.push(observe('change', offer?.url ?? page.url, `Changed since last snapshot: ${checkpoint.changes.join(', ')}.`, 'IGNITION semantic snapshot comparison'));
  }
  const probes = await Promise.all(routes.map(({ link }) => inspect(web, link.url, signal, 'Initial direct booking GET', url => domain(url.href) === domain(link.url))));
  for (const [index, destination] of probes.entries()) {
    const { link, from } = routes[index];
    addJourney(checkpoint, from.url, destination, link.label);
    checkpoint.funnel.tested++;
    const soft = destination.state === 'READABLE' && destination.missingPage && !destination.bookingControl;
    const status = soft ? 200 : Number(destination.state.replace('HTTP_', ''));
    if (index === 0 && link.main && (soft || [404, 410].includes(status))) {
      const alternatives = prioritized.some(item => hasAlternateRoute(item, link.url));
      checkpoint.breakage = { url: link.url, from: from.url, label: link.label, status, evidence: destination.evidence.id, alternatives,
        ...(soft ? { soft: true } : {}) };
    }
    if (index === 0 && offer === from) {
      const mismatch = durationMismatch(from, link, destination);
      if (mismatch) {
        checkpoint.evidence.push(...mismatch.evidence);
        checkpoint.bookingMismatch = { from: from.url, url: link.url, destination: destination.url,
          promised: mismatch.promised, listed: mismatch.listed, evidence: mismatch.evidence.map(item => item.id) };
      }
    }
  }

  const renderPage = routes[0]?.from ?? offer ?? page;
  if (settings.browser && (offer || cta) && pages[0].state === 'READABLE' && !signal.aborted) {
    const browserSignal = AbortSignal.any([signal, AbortSignal.timeout(19_000)]);
    const browser = createFunnelBrowser((url, requestSignal) => web.asset(url, requestSignal, renderPage.url), browserSignal, { inspectBookingDialogs: true });
    try {
      const rendered = await browser.render(renderPage.url, job.id);
      const renderedPage = parseBusinessPage(rendered.html, rendered.url);
      const confirmed = Boolean(cta && !renderedPage.challenged && renderedPage.links.some(link => link.url === cta.url && booking.test(link.label)));
      if (!renderedPage.challenged) for (const dialog of rendered.bookingDialogs ?? []) {
        const evidence = observe('browser', rendered.url, `${dialog.device} · ${dialog.label}${dialog.heading ? ` opened ${dialog.heading}` : ' opened a dialog'}.${dialog.hasForm ? ' A form was visible.' : ''}`,
          'Read-only booking dialog');
        checkpoint.evidence.push(evidence);
        checkpoint.journey.push({ from: rendered.url, url: rendered.url, label: dialog.label, result: 'BOOKING_DIALOG_OPENED', evidence: evidence.id });
        checkpoint.funnel.interactive = true;
      }
      for (const shot of rendered.screenshots.filter(item => !item.section && !renderedPage.challenged)) {
        const image = Buffer.from(shot.dataUrl.split(',')[1] ?? '', 'base64');
        if (!image.length || image.length > 300_000) continue;
        const artifact = observe('browser', shot.url, `${shot.device} capture. ${confirmed ? 'Booking link present in rendered markup.' : 'Booking link unconfirmed.'}${rendered.incompleteAssets ? ' Some assets were unavailable.' : ''}`, 'Read-only render', image);
        checkpoint.evidence.push(artifact);
        artifacts.push({ id: artifact.id, url: shot.url, digest: artifact.digest, device: shot.device, image });
      }
      if (checkpoint.breakage && (!confirmed || hasAlternateRoute(renderedPage, checkpoint.breakage.url))) checkpoint.breakage.alternatives = true;
    } catch {
      checkpoint.evidence.push(observe('browser', renderPage.url, 'Chrome did not return a usable capture.', 'Read-only render'));
      if (checkpoint.breakage) checkpoint.breakage.alternatives = true;
    } finally { await browser.close(); }
  }
  return { checkpoint, artifacts };
}

function hasAlternateRoute(page: Pick<Page, 'bookingControl' | 'links'>, target: string) {
  return page.bookingControl || page.links.some(link => link.url !== target &&
    (booking.test(link.label) || /\b(?:schedule|book now|request a call|let.s talk)\b/i.test(link.label)));
}

export async function verifyOpportunity(web: PublicWeb, job: Job, signal: AbortSignal, browserEnabled = false) {
  const checkpoint = job.checkpoint;
  const issue = checkpoint.breakage;
  const original = checkpoint.evidence.find(item => item.id === issue?.evidence);
  const mismatch = checkpoint.bookingMismatch;
  if (!issue && mismatch) {
    const offer = await inspect(web, mismatch.from, signal, 'Independent offer recheck', url => domain(url.href) === job.domain);
    const link = offer.links.find(item => item.url === mismatch.url && item.main && booking.test(item.label));
    const originalEvidence = checkpoint.evidence.filter(item => mismatch.evidence.includes(item.id));
    if (link) {
      const destination = await inspect(web, link.url, signal, 'Independent booking duration recheck', url => domain(url.href) === domain(link.url));
      addJourney(checkpoint, offer.url, destination, link.label);
      const repeated = durationMismatch(offer, link, destination);
      if (destination.url === mismatch.destination && originalEvidence.length === 2 && repeated?.promised === mismatch.promised && repeated.listed === mismatch.listed) {
        add(checkpoint, 'opportunity', 'VERIFIED',
          `The primary offer CTA says ${repeated.promised} minutes and the linked booking page says ${repeated.listed} minutes. Both descriptions reproduced. Align the CTA and booking-page description so visitors can make an informed commitment.`,
          [...originalEvidence, ...repeated.evidence]);
        return checkpoint;
      }
    }
    add(checkpoint, 'opportunity', 'UNVERIFIED', 'The booking-duration mismatch did not reproduce.', [...originalEvidence, offer.evidence]);
    return checkpoint;
  }
  if (!issue || !original || issue.alternatives) {
    const funnel = checkpoint.funnel;
    add(checkpoint, 'opportunity', 'UNVERIFIED', issue?.alternatives
      ? 'A dead destination was observed, but its business impact or alternate booking paths remain unresolved.'
      : funnel?.tested ? `Checked ${funnel.tested} direct booking destination(s). A material, reproducible failure was not established.`
      : funnel?.found ? 'The public booking destination was outside supported read-only routes.'
      : funnel?.interactive ? 'Only an interactive booking or inquiry control was visible. Submission was outside this investigation.'
      : 'No explicit public booking destination was found.', original ? [original] : []);
    return checkpoint;
  }
  const offer = await inspect(web, issue.from, signal, 'Independent offer recheck', url => domain(url.href) === job.domain);
  const stillLinked = offer.links.some(link => link.main && link.url === issue.url && booking.test(link.label));
  const alternate = hasAlternateRoute(offer, issue.url);
  if (!stillLinked || alternate) {
    add(checkpoint, 'opportunity', 'UNVERIFIED', 'The original CTA structure did not reproduce.', [original, offer.evidence]);
    return checkpoint;
  }
  const retry = await inspect(web, issue.url, signal, 'Independent direct booking GET', url => domain(url.href) === domain(issue.url));
  addJourney(checkpoint, offer.url, retry, issue.label);
  let confirmed = retry.url === original.url && (issue.soft ? retry.state === 'READABLE' && retry.missingPage && !retry.bookingControl
    : retry.state === `HTTP_${issue.status}`);
  const proof = [original, offer.evidence, retry.evidence];
  if (confirmed && issue.soft && !browserEnabled) confirmed = false;
  if (confirmed && issue.soft) {
    const budget = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
    const browser = createFunnelBrowser((url, requestSignal) => web.asset(url, requestSignal, retry.url), budget);
    try {
      const rendered = await browser.render(retry.url, job.id);
      const page = parseBusinessPage(rendered.html, rendered.url);
      confirmed = rendered.url === retry.url && !rendered.incompleteAssets && !page.challenged && page.missingPage && !page.bookingControl;
      proof.push(observe('browser', rendered.url, confirmed ? 'Rendered destination shows an explicit page-not-found screen.'
        : 'The rendered destination did not corroborate the page-not-found screen.', 'Independent destination render', Buffer.from(rendered.html)));
    } catch { confirmed = false; }
    finally { await browser.close(); }
  }
  add(checkpoint, 'opportunity', confirmed ? 'VERIFIED' : 'UNVERIFIED', confirmed
    ? `The direct booking CTA returned ${issue.soft ? 'an explicit page-not-found screen' : `HTTP ${issue.status}`} in two independent requests. Repair or replace the public booking link.`
    : 'The reported destination failure did not reproduce under independent verification.', proof);
  return checkpoint;
}
