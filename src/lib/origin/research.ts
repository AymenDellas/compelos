import { load } from 'cheerio';
import { publisherPointer, verifyPublications } from './auto-publishers';
import { createFunnelBrowser } from '../funnel-browser';
import { relevantCoach } from './discovery';
import { emptyCheckpoint, finding, hash, observe } from './policy';
import type { Checkpoint, Evidence, Settings } from './policy';
import { documentUrl, PublicFailure } from './public-web';
import type { PublicWeb } from './public-web';
import { domain } from './store';
import type { Artifact, Job } from './store';

const booking = /^(?:book|schedule|request|apply for)\b.{0,55}\b(?:call|session|consultation|assessment|coaching)\b|^(?:book now|book a time|apply now)$/i;
const offerLink = /\b(?:coaching|program(?:me)?s?|services|work with (?:me|us))\b/i;
const contactLink = /^(?:contact(?: us| me)?|get in touch|work with us)$/i;
const aboutLink = /^(?:about(?: us| me)?|our story|company|meet (?:the )?(?:team|founder|coach))$/i;
const caseLink = /^(?:case stud(?:y|ies)|client stories|client case studies|client results)\b/i;
const mediaPage = /^(?:in the (?:press|media)|as (?:seen|featured) in|press(?: & media)?|media(?: appearances)?|speaking(?: & media)?|interviews|podcasts)$/i;
const appearanceLink = /\b(?:interview|podcast|episode|guest appearance|conference|keynote|webinar|summit|speaker)\b/i;
const challenge = /verify (?:that )?you are human|checking your (?:browser|connection)|enable javascript and cookies to continue|(?:just a moment|access denied|attention required)\b/i;
const squash = (text: string) => text.trim().replace(/\s+/g, ' ');
const normalized = (value: string) => squash(value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ')).toLowerCase();
const containsName = (label: string, name: string) => ` ${normalized(label)} `.includes(` ${normalized(name)} `);

type Link = { url: string; label: string; main: boolean };
type MarketStatement = { country: NonNullable<Checkpoint['country']>; evidence: string };
export type Page = { url: string; state: string; evidence: Evidence; identity: string; canonical: string | null;
  statements: string[]; headings: string[]; links: Link[]; contact: { address: string; context: string } | null;
  contactProhibited: boolean; bookingControl: boolean; markets: MarketStatement[] };

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
        const service = [item.serviceType, item.name].find((label): label is string => typeof label === 'string' && relevantCoach.test(label));
        if (!list(item['@type']).some(type => type === 'Service' || type === 'https://schema.org/Service') ||
          !service) return [];
        const provider = nodes(item.provider)[0];
        const reference = (urlValue: unknown) => typeof urlValue === 'string' ? linkedUrl(urlValue, url) : null;
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
  const canonical = linkedUrl($('link[rel="canonical"]').attr('href') ?? '', url);
  const markets = markedMarkets($, url);
  $('script,style,noscript,template,blockquote,[hidden],[aria-hidden="true"],.testimonial,.review').remove();
  const headings = $('h1,h2,h3').slice(0, 35).toArray().map(node => squash($(node).text()).slice(0, 240));
  const identity = [title, site, ...headings.slice(0, 5)].filter(Boolean).join(' · ').slice(0, 400);
  const statements = $('p,li,h1,h2,h3,address').slice(0, 180).toArray().map(node => squash($(node).text()).slice(0, 450)).filter(Boolean);
  const links = $('a[href]').slice(0, 240).toArray().flatMap(node => {
    const raw = $(node).attr('href') ?? '';
    const label = squash($(node).text() || $(node).attr('aria-label') || $(node).find('img[alt]').first().attr('alt') || '').slice(0, 100);
    const target = linkedUrl(raw, url);
    return label && target && target !== url ? [{ label, url: target, main: !$(node).closest('header,footer,nav,aside').length }] : [];
  });
  const bookingControl = $('button,input[type="submit"],iframe,a[href^="#"],a[href^="javascript:"]').toArray().some(node =>
    booking.test(squash($(node).text() || $(node).attr('value') || $(node).attr('title') || $(node).attr('aria-label') || ''))
    || /calendly|acuityscheduling|cal\.com/i.test($(node).attr('src') ?? '')) || $('form').toArray().some(node => {
    const form = $(node);
    const context = squash([form.attr('aria-label'), form.attr('action'), form.text()].join(' '));
    // Only an explicitly identified newsletter is irrelevant. An unknown form may offer another inquiry path.
    return !/newsletter|mailing list|email updates/i.test(context) || /consultation|strategy call|book|coaching inquiry/i.test(context);
  });
  let contact: Page['contact'] = null;
  const invitation = /\b(?:vendor|supplier|partnership|service provider|business development)\s+(?:enquir(?:ies|y)|inquir(?:ies|y)|proposals?)\b/i;
  const forbidden = /no\s+(?:unsolicited|solicitations?)|do not (?:contact|send|submit).{0,55}(?:sales|marketing|solicitations?)|not accept.{0,25}(?:unsolicited|solicitations?)/i;
  const bodyText = squash($('body').text()).slice(0, 12_000);
  $('main a[href^="mailto:"],article a[href^="mailto:"], address a[href^="mailto:"], a[href^="mailto:"]').each((_i, node) => {
    const a = $(node);
    const address = (a.attr('href') ?? '').slice(7).trim().toLowerCase();
    const context = squash(a.closest('p,li,address,section,div').text()).slice(0, 450);
    if (!forbidden.test(bodyText) && invitation.test(context) && /^(?:hello|info|contact|office|team|partnerships|business|vendors|enquiries|inquiries)@[a-z\d.-]+\.[a-z]{2,}$/i.test(address)
      && address.split('@')[1].replace(/^www\./, '') === domain(url)) contact = { address, context };
  });
  return { identity, canonical, statements, headings, links, contact, bookingControl, markets,
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
    state === 'READABLE' ? `HTTP 200 · ${extraction?.identity ?? ''}` : state.replaceAll('_', ' '), method, state === 'ACCESS_RESTRICTED' ? undefined : payload);
  return { url, state, evidence, identity: '', canonical: null, statements: [], headings: [], links: [], contact: null, contactProhibited: false, bookingControl: false, markets: [],
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
    checkpoint.evidence.push(observe('source', url, 'Publisher use policy supplied in the configured discovery source.', 'Source access policy'));
  }
  let identity = page;
  let candidates = seeds.filter(seed => containsName(identity.identity, seed.name));
  const about = page.links.find(link => domain(link.url) === job.domain && aboutLink.test(link.label));
  if (!candidates.length && about) {
    identity = await inspect(web, about.url, signal, 'Official About page', url => domain(url.href) === job.domain);
    checkpoint.evidence.push(identity.evidence);
    candidates = seeds.filter(seed => containsName(identity.identity, seed.name));
  }
  const multipleDomains = job.seeds.some(seed => domain(seed.website) !== job.domain && seed.method !== 'IGNITION');
  const canonicalConflict = [page, identity].some(item => item.canonical && domain(item.canonical) !== job.domain);
  if (!candidates.length || multipleDomains || canonicalConflict) {
    add(checkpoint, 'identity', 'UNVERIFIED', multipleDomains || canonicalConflict ? 'Sources point to different official domains.'
      : 'The source listing could not be corroborated on the official site.', [identity.evidence, ...provenance.values()]);
    return { checkpoint, done: true };
  }
  const source = candidates.find(seed => seed.method !== 'IGNITION' && provenance.has(seed));
  if (!source) return { checkpoint, done: true };
  const record = provenance.get(source)!;
  checkpoint.identityPage = identity.url;
  checkpoint.identityName = source.name;
  add(checkpoint, 'identity', 'VERIFIED', 'The source-linked website independently identifies the same business or coaching brand.', [record, identity.evidence]);
  const irrelevant = page.headings.find(line => /\b(?:executive search firm|recruitment agency|psychotherapy practice|software platform)\b/i.test(line));
  if (irrelevant && !page.statements.some(line => relevantCoach.test(line))) {
    add(checkpoint, 'niche', 'CONTRADICTED', 'The official site describes a different primary service.', [quote(page, irrelevant, 'Primary service heading')]);
    return { checkpoint, done: true };
  }
  recordMarket(checkpoint, [page]);
  return { checkpoint, done: false };
}

function recordMarket(checkpoint: Checkpoint, pages: Page[]) {
  const region = /\b(?:serve|serves|serving|work with|work across|coaching for|our clients (?:are|include))\b[^.;!?]{0,65}\b(United States\b|United Kingdom\b|Canada\b|U\.S\.|U\.K\.|USA\b|UK\b|US\b)/i;
  const outside = /\b(?:only|exclusively)\s+(?:serve|work with|coach)\b[^.;!?]{0,60}\b(France|Germany|Spain|Italy|Netherlands|Belgium|Switzerland|Australia|New Zealand|India|Singapore|Ireland)\b/i;
  const positive = pages.flatMap(page => page.statements.flatMap(line => {
    if (/\b(?:not|never|except|excludes?)\b/i.test(line)) return [];
    const match = line.match(region);
    if (!match || /^(?:us|uk)$/i.test(match[1]) && match[1] !== match[1].toUpperCase()) return [];
    const country = /Canada/i.test(match[1]) ? 'CA' as const : /Kingdom|U\.?K/i.test(match[1]) ? 'UK' as const : 'US' as const;
    return [{ country, evidence: quote(page, line, 'Explicit market or business base') }];
  }));
  positive.push(...pages.flatMap(page => page.markets.map(market => ({ country: market.country,
    evidence: quote(page, market.evidence, 'Official service area declaration') }))));
  const negative = pages.flatMap(page => page.statements.filter(line => outside.test(line)).map(line => quote(page, line, 'Exclusive market statement')));
  if (positive.length && negative.length) add(checkpoint, 'geography', 'UNVERIFIED', 'The site makes conflicting market statements.', [positive[0].evidence, negative[0]]);
  else if (negative.length) add(checkpoint, 'geography', 'CONTRADICTED', 'The business explicitly limits service to an ineligible market.', [negative[0]]);
  else if (positive.length) {
    checkpoint.country = positive[0].country;
    add(checkpoint, 'geography', 'VERIFIED', 'The official site explicitly states that the business serves an eligible market.', [positive[0].evidence]);
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
    const record = seed.sourceKey.split(':').slice(1).join(':');
    if (!record || organizations.has(organization) || hosts.has(host) || host === job.domain || records.has(record)) continue;
    organizations.add(organization);
    hosts.add(host);
    records.add(record);
    validUntil.push(Math.min(occurred + activityDays * 86_400_000, permissionExpires));
    const reference = seed.publication ? ` · Scoped permission checked at ${seed.publication.permissionPage} · SHA-256 ${seed.publication.digest}` : '';
    evidence.push(observe('external', seed.source, `${seed.occurredAt.slice(0, 10)} · ${seed.excerpt}${reference}`, 'Publisher-linked exposure'));
  }
  checkpoint.acquisitionSources = evidence.length;
  add(checkpoint, 'acquisition', evidence.length >= 2 ? 'VERIFIED' : 'UNVERIFIED', evidence.length >= 2
    ? 'Two distinct publishers document recent exposure related to the coaching specialty.'
    : `Found ${evidence.length} of 2 required independent, recent publisher records.`, evidence);
  const gate = checkpoint.gates.at(-1)!;
  if (gate.expiresAt && validUntil.length) gate.expiresAt = new Date(Math.min(Date.parse(gate.expiresAt), ...validUntil)).toISOString();
}

function publicationLinks(pages: Page[], job: Job, checkpoint: Checkpoint, media = false) {
  const name = checkpoint.identityName ?? job.name;
  for (const page of pages) for (const link of page.links) {
    if (domain(link.url) === job.domain) {
      if (!checkpoint.mediaPage && mediaPage.test(link.label)) checkpoint.mediaPage = link.url;
      continue;
    }
    const url = publisherPointer(link.url);
    if (!url || (!media && !appearanceLink.test(`${link.label} ${new URL(url).pathname.replace(/[-_/]/g, ' ')}`))) continue;
    const pointers = checkpoint.publisherPointers ??= [];
    if (pointers.length < 10 && !pointers.some(item => item.url === url)) pointers.push({ url, name, website: job.website });
  }
}

export async function enrichAcquisition(web: PublicWeb, job: Job, settings: Settings, signal: AbortSignal) {
  const checkpoint = job.checkpoint;
  if (checkpoint.gates.find(gate => gate.name === 'acquisition')?.state === 'VERIFIED' ||
      checkpoint.gates.find(gate => gate.name === 'identity')?.state !== 'VERIFIED') return [];
  if (checkpoint.mediaPage) {
    const page = await inspect(web, checkpoint.mediaPage, signal,
      'Official media links', url => domain(url.href) === job.domain);
    // A timed out source should leave the job resumable under its owner fence.
    addJourney(checkpoint, job.website, page, 'Media appearances');
    if (page.state === 'READABLE') publicationLinks([page], job, checkpoint, true);
  }
  const name = checkpoint.identityName ?? job.name;
  const references = job.seeds.filter(seed => normalized(seed.name) === normalized(name) && domain(seed.website) === job.domain)
    .flatMap(seed => (seed.publisherLinks ?? []).map(url => ({ url, name, website: job.website })));
  const discovered = await verifyPublications(web, [...(checkpoint.publisherPointers ?? []), ...references], settings.activityDays, signal);
  checkpoint.publisherAudit = discovered.audit;
  recordAcquisition({ ...job, seeds: [...job.seeds, ...discovered.seeds] }, checkpoint, settings.activityDays);
  return discovered.seeds;
}

function routeHost(value: string, official: string) {
  const host = domain(value);
  return host === official || /^(?:calendly\.com|cal\.com|app\.acuityscheduling\.com|[a-z\d-]+\.as\.me|savvycal\.com)$/i.test(host);
}

function addJourney(checkpoint: Checkpoint, from: string, page: Page, label: string) {
  checkpoint.evidence.push(page.evidence);
  checkpoint.journey.push({ from, url: page.url, label, result: page.state, evidence: page.evidence.id });
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
  if (page.state !== 'READABLE' || !pages.some(item => job.seeds.some(seed => domain(seed.website) === job.domain && containsName(item.identity, seed.name)))) {
    add(checkpoint, 'identity', 'UNVERIFIED', 'The official entry point could not be corroborated during investigation.', [page.evidence]);
    return { checkpoint, artifacts: [] };
  }
  const targets = page.links.filter(link => own(new URL(link.url)) && !pages.some(item => item.url === link.url));
  const planned = [...new Set([offerLink, contactLink, caseLink].flatMap(pattern => {
    const target = targets.find(link => pattern.test(link.label));
    return target ? [target.url] : [];
  }))];
  for (const url of planned) {
    const detail = await inspect(web, url, signal, 'Official detail page', own);
    addJourney(checkpoint, page.url, detail, targets.find(link => link.url === url)!.label);
    if (detail.state === 'READABLE') pages.push(detail);
  }
  recordMarket(checkpoint, pages);
  recordAcquisition(job, checkpoint, settings.activityDays);
  publicationLinks(pages, job, checkpoint);
  const offer = [...pages].reverse().find(item => item.headings.some(line => relevantCoach.test(line)));
  const line = offer?.headings.find(item => relevantCoach.test(item));
  const scope = offer?.statements.find(item => /\b(?:one.on.one|1:1|coaching sessions?|coaching (?:program|programme|engagement)|coaching for (?:executives|leaders|founders|managers)|(?:3|6|12).month)\b/i.test(item));
  if (offer && line && scope) {
    checkpoint.offer = line;
    add(checkpoint, 'niche', 'VERIFIED', 'The official page describes a specialized coaching engagement.', [quote(offer, line, 'Offer heading'), quote(offer, scope, 'Engagement scope')]);
    const price = offer.statements.find(item => /\b(?:investment|pricing|package|engagement|program(?:me)? fee)\b[^.!?]{0,55}(?:USD|CAD|GBP|[$£])\s*(?:[3-9],?\d{3}|[1-9]\d,?\d{3})\b/i.test(item));
    const substance = pages.flatMap(item => item.statements.map(statement => ({ page: item, statement })))
      .find(item => /\b(?:founded|established|in business)\s+(?:in|since)?\s*(?:19\d\d|20[012]\d)\b/i.test(item.statement)
        && Number(item.statement.match(/\b(?:19\d\d|20[012]\d)\b/)?.[0]) <= new Date().getUTCFullYear() - 3);
    const clientCase = pages.flatMap(item => {
      const client = item.headings.map(text => text.match(/^case study\s*[:–-]\s*([\p{L}\d][\p{L}\d& .'-]{3,80})$/iu)).find(Boolean);
      if (!client) return [];
      const engagement = item.statements.find(text => containsName(text, client[1]) && /\b(?:hired|retained|commissioned|engaged|contracted)\b.{0,90}\b(?:executive|leadership|business) coaching\b/i.test(text));
      return engagement ? [quote(item, `${client[0]} · ${engagement}`, 'Named business engagement case study')] : [];
    })[0];
    const proof = price ? quote(offer, price, 'Published offer price') : clientCase;
    add(checkpoint, 'substance', proof && substance ? 'VERIFIED' : 'UNVERIFIED', proof && substance
      ? price ? 'The business publishes substantial engagement pricing and reports at least three years of operation.'
        : 'The business describes a named commercial coaching engagement and reports at least three years of operation.'
      : 'An established operating history and evidence of a substantial coaching engagement were not both found.',
    [...(proof ? [proof] : []), ...(substance ? [quote(substance.page, substance.statement, 'First-party operating history')] : [])]);
  } else add(checkpoint, 'niche', 'UNVERIFIED', 'A specialized offer and its coaching scope could not be established.');

  const contact = pages.find(item => item.contact);
  if (contact?.contact && !pages.some(item => item.contactProhibited)) {
    checkpoint.contact = contact.contact.address;
    add(checkpoint, 'contact', 'VERIFIED', 'The business explicitly invites partnership or vendor inquiries through a published role address.', [quote(contact, `${contact.contact.address} · ${contact.contact.context}`, 'Published business inquiry route')]);
  } else add(checkpoint, 'contact', 'UNVERIFIED', 'No explicitly invited business development route was found.');

  const artifacts: Artifact[] = [];
  if (!offer || !line || checkpoint.gates.some(gate => gate.state === 'CONTRADICTED')) return { checkpoint, artifacts };
  const calls = offer.links.filter(link => link.main && booking.test(link.label));
  const cta = calls[0];
  checkpoint.signature = { offer: normalized(`${line} ${scope ?? ''}`), booking: cta?.url ?? '' };
  if (job.signature) {
    checkpoint.changes = (['offer', 'booking'] as const).filter(key => job.signature?.[key] !== checkpoint.signature?.[key]);
    if (checkpoint.changes.length) checkpoint.evidence.push(observe('change', offer.url, `Changed since last snapshot: ${checkpoint.changes.join(', ')}.`, 'IGNITION semantic snapshot comparison'));
  }
  if (cta && routeHost(cta.url, job.domain)) {
    const destination = await inspect(web, cta.url, signal, 'Initial direct booking GET', url => routeHost(url.href, job.domain) && domain(url.href) === domain(cta.url));
    addJourney(checkpoint, offer.url, destination, cta.label);
    const status = Number(destination.state.replace('HTTP_', ''));
    const alternatives = hasAlternateRoute(offer, cta.url);
    if ([404, 410].includes(status)) checkpoint.breakage = { url: cta.url, from: offer.url, label: cta.label, status, evidence: destination.evidence.id, alternatives };
  }

  if (settings.browser && pages[0].state === 'READABLE' && !signal.aborted) {
    const browserSignal = AbortSignal.any([signal, AbortSignal.timeout(19_000)]);
    const browser = createFunnelBrowser((url, requestSignal) => web.asset(url, requestSignal, offer.url), browserSignal);
    try {
      const rendered = await browser.render(offer.url, job.id);
      const renderedPage = parseBusinessPage(rendered.html, rendered.url);
      const confirmed = Boolean(cta && !renderedPage.challenged && renderedPage.links.some(link => link.url === cta.url && booking.test(link.label)));
      for (const shot of rendered.screenshots.filter(item => !item.section && !renderedPage.challenged)) {
        const image = Buffer.from(shot.dataUrl.split(',')[1] ?? '', 'base64');
        if (!image.length || image.length > 300_000) continue;
        const artifact = observe('browser', shot.url, `${shot.device} capture. ${confirmed ? 'Booking link present in rendered markup.' : 'Booking link unconfirmed.'}${rendered.incompleteAssets ? ' Some assets were unavailable.' : ''}`, 'Read-only render', image);
        checkpoint.evidence.push(artifact);
        artifacts.push({ id: artifact.id, url: shot.url, digest: artifact.digest, device: shot.device, image });
      }
      if (checkpoint.breakage && (!confirmed || hasAlternateRoute(renderedPage, checkpoint.breakage.url))) checkpoint.breakage.alternatives = true;
    } catch {
      checkpoint.evidence.push(observe('browser', offer.url, 'Chrome did not return a usable capture.', 'Read-only render'));
      if (checkpoint.breakage) checkpoint.breakage.alternatives = true;
    } finally { await browser.close(); }
  }
  return { checkpoint, artifacts };
}

function hasAlternateRoute(page: Pick<Page, 'bookingControl' | 'links'>, target: string) {
  return page.bookingControl || page.links.some(link => link.url !== target &&
    (booking.test(link.label) || /\b(?:schedule|book now|request a call|let.s talk)\b/i.test(link.label)));
}

export async function verifyOpportunity(web: PublicWeb, job: Job, signal: AbortSignal) {
  const checkpoint = job.checkpoint;
  const issue = checkpoint.breakage;
  const original = checkpoint.evidence.find(item => item.id === issue?.evidence);
  if (!issue || !original || issue.alternatives) {
    add(checkpoint, 'opportunity', 'UNVERIFIED', issue?.alternatives
      ? 'A dead destination was observed, but its business impact or alternate booking paths remain unresolved.'
      : 'A material, reproducible booking failure could not be established.', original ? [original] : []);
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
  const confirmed = retry.state === `HTTP_${issue.status}` && retry.url === original.url;
  add(checkpoint, 'opportunity', confirmed ? 'VERIFIED' : 'UNVERIFIED', confirmed
    ? `The offer's direct booking CTA returned HTTP ${issue.status} in two independent requests. Repair or replace the public booking link.`
    : 'The reported HTTP failure did not reproduce under an independent request.', [original, offer.evidence, retry.evidence]);
  return checkpoint;
}
