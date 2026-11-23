import { load } from 'cheerio';
import { normalizedName, publisherPointer, relatedPublisherHosts, verifyPublications } from './auto-publishers';
import { createFunnelBrowser, type RenderedPage } from '../funnel-browser';
import { coachingEditorial, relevantCoach } from './discovery';
import { emptyCheckpoint, finding, gateNames, hash, observe } from './policy';
import type { Checkpoint, Evidence, Settings } from './policy';
import { documentUrl, hostedBooking, PublicFailure } from './public-web';
import type { Seed } from './policy';
import type { PublicWeb } from './public-web';
import { domain } from './store';
import type { Artifact, Job } from './store';

const booking = /^(?:book|schedule|request|apply for)\b.{0,55}\b(?:call|session|consult(?:ation)?|assessment|coaching|meeting)\b|^(?:book now|book a time|apply now)$/i;
const offerLink = /\b(?:coach(?:ing)?|program(?:me)?s?|services|work with (?:me|us)|for (?:organisations|organizations|leaders|executives))\b/i;
const contactLink = /^(?:contact(?: us| me)?|get in touch|connect|inquir(?:e|ies)|enquir(?:e|ies))\b/i;
const aboutLink = /^(?:about\b|our story|company|meet (?:the )?(?:team|founder|coach)|the team)/i;
const caseLink = /^(?:case stud(?:y|ies)|(?:client|customer) (?:stories|case studies|results|success stories)|our clients|(?:client |coaching )?testimonials|(?:see |read )?(?:more |our )?reviews)\b/i;
const caseDetailPath = /\/(?:case-study|case-studies|client-results|client-stories)\/[^/]+/i;
const offerPath = /\/(?:services?|coaching|coaching-services|programs?|(?:executive|leadership|career|business|ceo)-coaching)(?:\/|$)/i;
const pricingLink = /^(?:packages (?:and|&) pric(?:es|ing)|coaching (?:packages|fees|pricing)|program(?:me)? pricing)$/i;
const mediaPage = /^(?:in the (?:press|media)|as (?:seen|featured) in|press(?: (?:&|and) media)?|media(?: (?:coverage|appearances))?|speaking(?: (?:&|and) media)?|interviews|podcasts)$/i;
const mediaPath = /^(?:press|media|media-appearances|media-coverage|appearances|interviews|podcast-appearances|press-and-media)$/i;
const appearanceLink = /\b(?:interview|podcast|episode|guest appearance|conference|keynote|webinar|summit|speaker)\b/i;
const activityLink = /\b(?:webinars?|workshops?|events?|cohorts?|podcasts?|newsletters?|episodes?)\b/i;
const publicationIndex = /^(?:(?:our |the )?blog|(?:news (?:and|&) )?insights|newsletter(?: archive)?|articles)$/i;
const publicationPath = /\/(?:blog|articles|insights|news-insights|newsletters?)\/[^/]+/i;
const activityAction = /\b(?:register|reserve (?:a|your) (?:seat|place|spot)|join (?:the|this|our|my) (?:webinar|workshop|cohort|newsletter|mailing list)|enroll|enrol|subscribe|listen (?:now|on (?:spotify|apple|your)|to (?:the|this) episode)|watch the (?:episode|webinar))\b/i;
const activityAudience = /\b(?:senior (?:leaders|managers|executives|professionals)|executives?|founders?|CEOs?|leadership teams?|business owners|career transition)\b/i;
const monthLabel = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const preciseDate = new RegExp(`\\b(?:(?<monthFirst>${monthLabel})\\s+(?<dayAfter>\\d{1,2})|(?<dayFirst>\\d{1,2})\\s+(?<monthAfter>${monthLabel})),?\\s+(?<year>20\\d{2})\\b`, 'gi');
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
const scope = /\b(?:one[- ](?:on|to)[- ]one|1\s*[:\-x]\s*1|(?:individual|team|group) coaching|(?:regular |weekly |monthly )?coaching sessions?|coaching (?:program(?:me)?|engagement|package)|coaching for (?:[\w-]+ ){0,3}(?:executives|leaders|founders|managers|business owners)|(?:3|6|12)[- ]month)\b/i;
const navigationOnly = /\b(?:privacy|cookie|legal|terms|policies|newsletters?|archives?|login)\b/i;

type Link = { url: string; label: string; main: boolean; appearanceContext: boolean };
type MarketStatement = { country: NonNullable<Checkpoint['country']>; evidence: string };
export type Page = { url: string; state: string; evidence: Evidence; identity: string; brand?: string; canonical: string | null;
  statements: string[]; headings: string[]; title: string; links: Link[]; contact: { address: string; context: string } | null;
  contactProhibited: boolean; bookingControl: boolean; markets: MarketStatement[]; missingPage: boolean; activityDates: string[]; activityAction?: string;
  publicationDates?: string[]; organizerSites?: string[];
  testimonials?: string[]; clientAccounts?: { organization: string; excerpt: string }[]; genericInquiry?: string; consultationIntake?: string[]; informedIntake?: boolean;
  scheduling?: boolean; schedulerProblem?: string; feedUrl?: string; embeddedInquiry?: string; hostedInquiry?: string };

const intakeDisclosure = /\b(?:(?:request|apply for) (?:an? |the |your )?(?:call|consultation|session|appointment)|application form|(?:we|I|our team)(?: will|['’]ll) (?:be in touch|get in touch|contact you|reach out|respond|reply|follow up|get back to you)|(?:after|once) you submit|subject to (?:review|approval))\b/i;
const callArrangement = /\b(?:we|I|our team)(?: will|['’]ll)? (?:arrange|set up) (?:an? |the |your )?(?:(?:no[- ]obligation|free|initial|introductory|brief|phone|video) ){0,3}(?:call|consultation|appointment|meeting)\b/i;
const ukStreetAddress = /^(?:[^,]{2,70},\s*)?\d{1,5}\s+[\p{L}.'’ -]{3,65},(?:\s*[^,]{2,50},){1,2}\s*(?!(?:GY|JE|IM|BX)\d)[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/iu;

function linkedOfferHost(url: URL, host: string) {
  return url.protocol === 'https:' && ['landing', 'go', 'offers', 'coaching'].some(prefix => url.hostname === prefix + '.' + host);
}

function offerRecheckScope(url: URL, source: string, host: string) {
  return domain(url.href) === host || url.href === source && linkedOfferHost(url, host);
}

function linkedUrl(value: string, current: string) {
  try {
    if (!value || value.startsWith('#')) return null;
    return documentUrl(new URL(value, current).href).href;
  } catch { return null; }
}

function publicInquiryWidget(url: string) {
  return /^https:\/\/api\.leadconnectorhq\.com\/widget\/form\/[a-z\d]{10,50}\/?$/i.test(url);
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
  const canonical = linkedUrl($('link[rel="canonical"]').attr('href') ?? '', url);
  const generator = $('meta[name="generator"]').attr('content') ?? '';
  const defaultFeed = /\bWordPress\b/i.test(generator) ? '/feed/' : /\bWix\.com Website Builder\b/i.test(generator) ? '/blog-feed.xml' : '';
  const feedUrl = linkedUrl($('head link[rel="alternate"][type="application/rss+xml"],head link[rel="alternate"][type="application/atom+xml"]').first().attr('href') ??
    defaultFeed, url);
  const datedRecords: string[] = [];
  const publicationDates: string[] = [];
  const organizerSites = new Set<string>();
  const names: string[] = [];
  $('script[type="application/ld+json"]').slice(0, 12).each((_index, node) => {
    const raw = $(node).text();
    if (raw.length > 60_000) return;
    try {
      const data = JSON.parse(raw);
      const entries = (Array.isArray(data) ? data : data?.['@graph'] ?? [data]);
      if (!Array.isArray(entries)) return;
      for (const item of entries.slice(0, 30)) {
        const type = String(item?.['@type'] ?? '');
        const record = typeof item?.url === 'string' ? linkedUrl(item.url, url) : null;
        if (record && domain(record) === domain(url) && typeof item?.name === 'string' &&
            (/(?:Organization|LocalBusiness|ProfessionalService|Corporation|WebSite)$/i.test(type) || /Person$/i.test(type) && relevantCoach.test(String(item.jobTitle ?? '')))) names.push(item.name);
        if (record && record !== url && record !== canonical) continue;
        const isPublication = /(?:Article|BlogPosting|PodcastEpisode)$/i.test(type);
        if (hostedBooking(url) && /(?:^|\/)Event$/i.test(type)) {
          const organizer = typeof item.organizer?.url === 'string' ? linkedUrl(item.organizer.url, url) : null;
          if (organizer && domain(organizer) !== domain(url) && !hostedBooking(organizer)) organizerSites.add(organizer);
        }
        const date = /(?:Event|CourseInstance)$/i.test(type) ? item?.startDate : isPublication ? item?.datePublished : null;
        if (typeof date === 'string') datedRecords.push(date);
        if (isPublication && typeof date === 'string') publicationDates.push(date);
      }
    } catch { /* malformed optional metadata */ }
  });
  const hostName = domain(url).split('.')[0].replace(/[^a-z\d]/g, '');
  const titleBrand = title.split(/\s*\|\s*|\s+-\s+/).find(part => hostName.length >= 6 && normalized(part).replace(/\s/g, '') === hostName);
  const namedCoach = $('main p,article p,p').slice(0, 120).toArray().map(node => squash($(node).text()).match(
    /^([\p{Lu}][\p{L}.'’-]+ [\p{Lu}][\p{L}.'’-]+) is (?:an? )?[^.!?]{0,50}\bcoach\b/u)?.[1]).find(value => {
    const parts = normalized(value ?? '').split(' ');
    return parts.length === 2 && parts[0].length >= 3 && parts[1].length >= 3 &&
      (hostName === parts.join('') || hostName.length === parts.join('').length + 1 &&
        hostName.startsWith(parts[0]) && hostName.endsWith(parts[1]));
  });
  const brand = [site, ...names, copyright, logo.attr('alt'), logo.attr('aria-label'), titleBrand, namedCoach].flatMap(value => {
    const label = squash(value ?? '').replace(/\s+logo$/i, '');
    return label.length >= 3 && label.length <= 100 && !/[_/]|\.(?:png|jpe?g|svg|webp)$|^(?:home|homepage|official website|logo|site logo|coaching|executive coaching)$/i.test(label) ? [label] : [];
  })[0];
  const testimonials: string[] = [];
  const clientAccounts: NonNullable<Page['clientAccounts']> = [];
  $('article blockquote,main blockquote,figure blockquote,[itemprop="review"],.testimonial').slice(0, 40).each((_index, node) => {
    const block = $(node);
    const author = squash(block.find('cite,figcaption,[itemprop="author"]').first().text() || block.closest('figure').find('figcaption').first().text());
    const text = squash(block.text());
    if (/^[\p{L}][\p{L}.'’-]+\s+[\p{L}][\p{L} .,'’&()\-]{3,90}$/u.test(author) &&
        /\b(?:I|we|our team)\b/i.test(text) && /\b(?:coach|coaching)\b/i.test(text) && /\b(?:worked with|sessions|engagement|helped|coached|program(?:me)?)\b/i.test(text)) {
      testimonials.push(`${author} · ${text.slice(0, 320)}`);
    }
  });
  const markets = markedMarkets($, url);
  if (/\/privacy(?:-policy|-notice)?\/?$/i.test(new URL(url).pathname)) {
    const main = $('main,article').first();
    const notice = (main.length ? main : $('body').first()).clone();
    notice.find('script,style,noscript,template,[hidden],[aria-hidden="true"]').remove();
    notice.find('p,div,li,address,br,h1,h2,h3').after(' ');
    const policy = squash(notice.text());
    const address = policy.match(/\b(?:contact us by post at|postal address (?:is|at))\b.{0,180}?,\s*([A-Z]{2}\s+\d{5}(?:-\d{4})?)\b.{0,85}?\bUnited States\b/u);
    if (address) markets.push({ country: 'US', evidence: `Published U.S. postal contact for the business: ${address[1]}` });
  }
  $('footer').slice(0, 4).each((_index, footer) => {
    const section = $(footer);
    if (!section.find('a[href^="mailto:"]').length) return;
    const telephone = section.find('a[href^="tel:"]').length;
    for (const paragraph of section.find('p,address').slice(0, 45).toArray()) {
      const block = $(paragraph).clone();
      block.find('br').replaceWith(' ');
      const location = squash(block.text());
      if (ukStreetAddress.test(location)) {
        markets.push({ country: 'UK', evidence: `Published UK postal contact: ${location}` });
        continue;
      }
      const market = location.match(/^[\p{L} .'-]{2,45},\s*[\p{L} .'-]{2,45},\s*(United Kingdom|United States|Canada)\s*$/iu)?.[1];
      if (market && telephone) markets.push({ country: /Canada/i.test(market) ? 'CA' : /Kingdom/i.test(market) ? 'UK' : 'US', evidence: `Published business contact location: ${location}` });
    }
  });
  const postalMarkets = [
    { country: 'UK', countryName: /\bUnited Kingdom\b/i, postalCode: /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i },
    { country: 'CA', countryName: /\bCanada\b/i, postalCode: /\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/i },
    { country: 'US', countryName: /\b(?:United States|USA)\b/i, postalCode: /\b\d{5}(?:-\d{4})?\b/ },
  ] as const;
  const states = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
  $('address,[itemprop="address"],a[href^="https://maps.app.goo.gl/"]').slice(0, 12).each((_index, element) => {
    const address = squash($(element).text()).slice(0, 250);
    const market = postalMarkets.find(item => item.countryName.test(address) && item.postalCode.test(address));
    if (market) markets.push({ country: market.country, evidence: `Published business address: ${address}` });
    else if (/^.{0,96}\b\d+\s+[\p{L} .'-]+\b/u.test(address)) {
      const state = address.match(/,?\s+([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/)?.[1];
      const province = /,?\s+(?:AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d\s*$/.test(address);
      if (province || state && states.has(state)) markets.push({ country: province ? 'CA' : 'US', evidence: `Published business address: ${address}` });
    }
  });
  $('script,style,noscript,template,blockquote,[hidden],[aria-hidden="true"],.testimonial,.review').remove();
  const content = $('main,[role="main"]').first();
  const read = (selector: string) => content.length ? content.find(selector) : $(selector).filter((_i, node) => !$(node).closest('nav,footer,aside').length);
  const headings = read('h1,h2,h3,h4,h5,h6').slice(0, 50).toArray().map(node => squash($(node).text()).slice(0, 240));
  const attributedTestimonialPage = /(?:^|[-/])(?:testimonials?|client-reviews|coaching-reviews)(?:[-/]|$)/i.test(new URL(url).pathname);
  const testimonialContext = headings.some(heading => /\b(?:testimonials|what (?:our )?clients say|what executives are saying)\b/i.test(heading)) ||
    relevantCoach.test(headings[0] ?? '') && /\b(?:program(?:me)?|package|services)\b/i.test(headings[0] ?? '');
  if (attributedTestimonialPage || testimonialContext) {
    const clientName = /^[\p{L}][\p{L}.'’-]+(?: [\p{L}][\p{L}.'’-]+){1,3}$/u;
    const roleOnly = /^(?:co-founder|founder|CEO|COO|CFO|president|managing director|(?:executive |senior )?director(?: of [\p{L} &/-]{3,36})?)$/iu;
    const blocks = read('p,h3,h4,h5,h6').slice(0, 180).toArray().flatMap(node => {
      const paragraph = $(node).clone();
      paragraph.find('br').replaceWith('\u001e');
      const lines = paragraph.text().split('\u001e').map(squash).filter(Boolean);
      if (lines.length === 3 && clientName.test(lines[0]) && roleOnly.test(lines[1])) return lines;
      return lines.length ? [lines.join(' ')] : [];
    });
    for (let index = 0; index + 2 < blocks.length && clientAccounts.length < 8; index++) {
      const [account, author, attribution] = blocks.slice(index, index + 3);
      if (account.length < 45 || !/\b(?:I|we|our)\b/i.test(account) ||
        !/\bcoach(?:es|ed|ing)?\b/i.test(account) ||
        !/\b(?:work(?:ed|ing)? (?:with|through|together)|engagement|helped|guided|sessions|coaching with|coached)\b/i.test(account) ||
        !clientName.test(author)) continue;
      const inlineOrganization = attribution.match(/^(?:(?:co-)?(?:founder|CEO|COO|CFO|president|managing director)|(?:executive |senior )?director)\s*(?:,| of | at )\s*([\p{L}\d][\p{L}\d .+'&-]{2,65})$/iu)?.[1];
      const next = blocks[index + 3] ?? '';
      const adjacentOrganization = roleOnly.test(attribution) && /^[\p{Lu}\d][\p{L}\d .+'&()-]{2,65}$/u.test(next) &&
        !/\b(?:book|schedule|what|how|learn|testimonials?|reviews?|clients?)\b/i.test(next) ? next : '';
      const department = /^(?:operations|finance|marketing|sales|engineering|human resources|strategy|product)$/i.test(inlineOrganization ?? '');
      const organization = adjacentOrganization || (department ? undefined : inlineOrganization);
      if (organization) clientAccounts.push({ organization: normalized(organization).replace(/\s+(?:ltd|limited|llc|llp|inc|corp)$/i, ''),
        excerpt: [author, attribution, adjacentOrganization].filter(Boolean).join(', ') + ' · ' + account.slice(0, 320) });
    }
  }
  $('br').replaceWith(' ');
  const paragraphs = read('p').slice(0, 120).toArray().map(node => squash($(node).text())).filter(Boolean);
  for (let index = 0; index < paragraphs.length - 1; index++) {
    const clientAccount = paragraphs[index].replace(/^[\s\u200b]+/, '');
    const attribution = paragraphs[index + 1];
    if (/^[“"].{45,700}[”"]$/u.test(clientAccount) && /\b(?:I|we|our)\b/i.test(clientAccount) && /\bcoach(?:ed|ing)?\b/i.test(clientAccount) &&
        /^\p{Lu}[\p{L}'’-]+(?: \p{Lu}[\p{L}.'’-]+){1,3},\s*(?:Founder|Co-founder|Chief\b[^,]{0,50}|CEO|COO|Director|Managing Director|President|Head of\b[^,]{0,50}),\s*\S.{1,80}$/u.test(attribution)) {
      testimonials.push(`${attribution} · ${clientAccount.slice(0, 320)}`);
    }
  }
  const activityDates = datedRecords.length ? datedRecords : read('time[datetime]').slice(0, 12).toArray().map(node => $(node).attr('datetime') ?? '');
  if (!activityDates.length) activityDates.push($('meta[property="article:published_time"]').attr('content') ?? $('meta[name="date"]').attr('content') ?? '');
  const published = $('meta[property="article:published_time"]').attr('content') ??
    read('time[itemprop="datePublished"],time.published,time.entry-date:not(.updated)').first().attr('datetime');
  if (published) publicationDates.push(published);
  const eventAction = read('a[href],button').slice(0, 80).toArray().map(node => squash($(node).text()).slice(0, 100))
    .find(text => text.length <= 80 && activityAction.test(text));
  const identity = [title, site, ...headings.slice(0, 5)].filter(Boolean).join(' · ').slice(0, 400);
  const statements = read('p,li,h1,h2,h3,address,dl').filter((_i, node) => !$(node).closest('nav,footer,aside').length)
    .slice(0, 220).toArray().map(node => squash($(node).text()).slice(0, 450)).filter(Boolean);
  if (!activityDates.some(Boolean) && (activityLink.test(`${headings[0] ?? ''} ${title} ${new URL(url).pathname.replace(/[-_/]/g, ' ')}`) ||
    statements.some(line => /\b(?:next cohort|program(?:me)? starts|applications close|enrolment closes|enrollment closes)\b/i.test(line)))) {
    const dateLabels = read('div,span,time').filter((_index, node) => !$(node).children().length && !$(node).closest('header,footer,nav,aside').length)
      .slice(0, 120).toArray().map(node => squash($(node).text())).filter(value => value.length <= 80);
    const dates = [...statements.slice(0, 28), ...dateLabels].flatMap(line => [...line.matchAll(preciseDate)]);
    for (const match of dates) {
      const date = Date.parse(`${match[0]} UTC`);
      const day = Number(match.groups?.dayFirst ?? match.groups?.dayAfter);
      if (Number.isFinite(date) && new Date(date).getUTCDate() === day) activityDates.push(new Date(date).toISOString());
    }
  }
  const links = $('a[href]').slice(0, 240).toArray().flatMap(node => {
    const raw = $(node).attr('href') ?? '';
    const label = squash($(node).text() || $(node).attr('aria-label') || $(node).find('img[alt]').first().attr('alt') || '').slice(0, 100);
    const target = linkedUrl(raw, url);
    if (!label || !target || target === url) return [];
    const main = !$(node).closest('header,footer,nav,aside').length;
    const context = squash($(node).closest('article,li,p,figure').text()).slice(0, 350);
    return [{ label, url: target, main, appearanceContext: main && appearanceLink.test(context) }];
  });
  if (hostedBooking(url)) {
    for (const link of links) {
      if (link.main && !hostedBooking(link.url) && domain(link.url) !== domain(url) &&
        /^(?:visit (?:the )?)?(?:event )?organi[sz]er(?:['’]s)? (?:official )?website$/i.test(link.label))
        organizerSites.add(link.url);
    }
  }
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
  const contactPage = /\/(?:contact(?:-us|-me)?|get-in-touch)\/?$/i.test(new URL(url).pathname) ||
    [headings[0], title].some(value => value && contactLink.test(value));
  const genericInquiry = contactPage ? read('form').toArray().flatMap(node => {
    const form = $(node);
    const label = squash([form.attr('aria-label'), form.text(), form.find('input[type="submit"]').attr('value')].join(' '));
    return form.find('input[type="email"]').length && form.find('textarea').length && /\b(?:send (?:a|your|us a) message|send message|general enquir|general inquir)\b/i.test(label) ? [label.slice(0, 250)] : [];
  })[0] : undefined;
  const scheduling = read('iframe,input[type="date"],input[type="time"],[data-cal-link],[data-calendly-url],select').toArray().some(node => {
    const element = $(node);
    return element.is('input,[data-cal-link],[data-calendly-url]') || /calendly|acuityscheduling|cal\.com|schedule|select (?:a )?(?:date|time)/i.test([element.attr('src'), element.attr('aria-label'), element.text()].join(' '));
  }) || links.some(link => booking.test(link.label) || /\b(?:calendar|choose a time|book online)\b/i.test(link.label)) ||
    /calendly-inline-widget|acuity-embed|cal-embed|hubspot-meetings|meetings\.hubspot\.com/i.test(html);
  const embeddedInquiry = read('iframe[src]').slice(0, 12).toArray().map(node => $(node).attr('src') ?? '').find(publicInquiryWidget);
  const hostedInquiry = publicInquiryWidget(url) && !scheduling && read('input[type="email"]').length && read('input[type="tel"]').length
    ? read('label,textarea[aria-label]').toArray().map(node => squash($(node).text() || $(node).attr('aria-label') || ''))
      .find(label => /^(?:what would you like help with|your message|how can we help|how can I help)\??\s*\*?$/i.test(label)) : undefined;
  const informedIntake = [title, ...headings, ...statements].some(value => intakeDisclosure.test(value) || callArrangement.test(value));
  const consultationIntake = !scheduling && !informedIntake ? read('form').slice(0, 6).toArray().flatMap(node => {
    const form = $(node);
    const labels = form.find('label[for]').toArray().map(label => [$(label).attr('for'), squash($(label).text()).replace(/\s*\*$/, '')] as const);
    const byId = new Map(labels);
    const formCopy = form.find('label,legend,p,h2,h3,h4').toArray().map(element => $(element).text());
    const context = squash([form.attr('aria-label'), ...formCopy, form.text()].join(' '));
    if (!/\b(?:initial|introductory|discovery|complimentary|strategy)\b.{0,55}\b(?:consultation|call|session)\b/i.test(context)) return [];
    const fields = new Map<string, string>();
    form.find('input[required],select[required],textarea[required],input[aria-required="true"],select[aria-required="true"],textarea[aria-required="true"]').each((_index, field) => {
      const control = $(field);
      if (control.is('[disabled],[readonly],[type="hidden"],[type="submit"],[type="button"]') || control.closest('fieldset[disabled]').length) return;
      const label = control.closest('fieldset').find('legend').first().text() || byId.get(control.attr('id')) || control.attr('aria-label') || control.closest('label').text();
      const key = control.is('[type="radio"],[type="checkbox"]') ? control.attr('name') : control.attr('id') || control.attr('name');
      if (key && label) fields.set(key, squash(label).replace(/\s*\*$/, '').slice(0, 75));
    });
    const prompts = [...new Set(fields.values())];
    return prompts.length >= 8 && prompts.some(label => /\b(?:current )?(?:employment|job title|job role|annual income)\b/i.test(label)) &&
      prompts.some(label => /\b(?:address|city|state|province|post(?:al)? code|zip|country)\b/i.test(label)) ? [prompts] : [];
  })[0] : undefined;
  $('main a[href^="mailto:"],article a[href^="mailto:"], address a[href^="mailto:"], a[href^="mailto:"]').each((_i, node) => {
    const a = $(node);
    const address = (a.attr('href') ?? '').slice(7).trim().toLowerCase();
    const context = squash(a.closest('p,li,address,section,div').text()).slice(0, 450);
    if (!forbidden.test(bodyText) && (invitation.test(context) || contactPage || a.closest('address,footer').length > 0) &&
      (contactPage ? /^[a-z\d][a-z\d._+-]{0,79}@[a-z\d.-]+\.[a-z]{2,}$/i : /^(?:hello|info|contact|office|team|partnerships|business|vendors|enquiries|inquiries)@[a-z\d.-]+\.[a-z]{2,}$/i).test(address)
      && address.split('@')[1].replace(/^www\./, '') === domain(url)) contact = { address, context };
  });
  if (!contact && contactPage && !forbidden.test(bodyText)) {
    const labeled = statements.find(line => /\be-?mail(?: address)?\s*:\s*[a-z\d._+-]+@[a-z\d.-]+\.[a-z]{2,}\b/i.test(line));
    const address = labeled?.match(/[a-z\d._+-]+@[a-z\d.-]+\.[a-z]{2,}\b/i)?.[0].toLowerCase();
    if (address?.split('@')[1] === domain(url)) contact = { address, context: labeled! };
  }
  if (!contact && contactPage && !forbidden.test(bodyText)) {
    const visible = $('main p,main address,footer p,footer address').slice(0, 130).toArray().map(node => squash($(node).text()));
    const address = visible.find(value => /^[a-z\d][a-z\d._+-]{0,79}@[a-z\d.-]+\.[a-z]{2,}$/i.test(value) && value.toLowerCase().split('@')[1] === domain(url));
    if (address) contact = { address: address.toLowerCase(), context: 'Same-domain business email on the public contact page.' };
  }
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
  const schedulerProblem = [title, ...headings.slice(0, 4), ...statements.slice(0, 12)].find(item =>
    /\b(?:this (?:calendly |booking |scheduling |meeting |event )?link (?:is no longer valid|is invalid|has expired|is not active)|this event type is (?:inactive|unavailable)|this calendly url is not valid|we couldn.t find (?:that|this) event)\b/i.test(item));
  return { identity, brand, canonical, statements, headings, title, links, contact, bookingControl, markets, missingPage, activityDates, publicationDates,
    organizerSites: [...organizerSites].slice(0, 2), activityAction: eventAction,
    testimonials, clientAccounts, genericInquiry, consultationIntake, informedIntake, scheduling, schedulerProblem, feedUrl: feedUrl ?? undefined, embeddedInquiry, hostedInquiry,
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

function caseEvidence(item: Page, provider: string) {
  const client = item.headings.map(text => text.match(/^case study\s*[:–-]\s*([\p{L}\d][\p{L}\d& .'-]{3,80})$/iu)).find(Boolean);
  const engagement = client && item.statements.find(text => containsName(text, client[1]) && /\b(?:hired|retained|commissioned|engaged|contracted)\b.{0,90}\b(?:executive|leadership|business) coaching\b/i.test(text));
  if (client && engagement) return quote(item, `${client[0]} · ${engagement}`, 'Named business engagement case study');
  if (!caseDetailPath.test(new URL(item.url).pathname)) return;
  const recordedWork = item.statements.find(text => scope.test(text) && /\b(?:one[- ]to[- ]one|1\s*[:\-]\s*1|sessions|engagement)\b/i.test(text));
  const delivery = item.headings.find(text => /^(?:what (?:we delivered|the client asked for)|the solution|(?:the )?(?:coaching )?engagement|client perspective)$/i.test(text));
  const namedEngagement = item.statements.find(text => {
    const match = text.match(/\b(?:engaged|retained|hired|commissioned|contracted)\s+([^.!?]{3,95}?)\s+(?:to (?:provide|deliver|lead|run)|for)\s+[^.!?]{0,80}\bcoach(?:ing)?\b/i);
    return match && normalized(match[1]) === normalized(provider);
  });
  if (recordedWork && delivery && namedEngagement) return quote(item, `${namedEngagement} · ${recordedWork}`, 'Named business engagement case study');
  const implementation = item.statements.find(text => /\b(?:we|our team)\b.{0,32}\b(?:provided|designed|delivered|coached|worked with)\b/i.test(text));
  if (recordedWork && delivery && implementation) return quote(item, `${item.headings[0] ?? item.title} · ${recordedWork}`, 'Documented coaching engagement case study');
}

export async function enrichCommercial(web: PublicWeb, job: Job, urls: string[], signal: AbortSignal) {
  const { checkpoint } = job;
  const gate = checkpoint.gates.find(item => item.name === 'substance');
  if (gate?.state !== 'UNVERIFIED' || !checkpoint.gates.some(item => item.name === 'niche' && item.state === 'VERIFIED')) return;
  const earlier = checkpoint.evidence.filter(item => gate.evidence.includes(item.id));
  if (earlier.some(item => /case study|contract award|client account/i.test(item.method))) return;
  const pending = [...new Set(urls)].filter(url => domain(url) === job.domain && !checkpoint.journey.some(step => step.url === url)).slice(0, 3);
  const pages = await Promise.all(pending.map(url => inspect(web, url, signal, 'Targeted coaching case recheck', address => domain(address.href) === job.domain)));
  for (const page of pages) addJourney(checkpoint, job.website, page, 'Targeted coaching case');
  const record = pages.map(page => caseEvidence(page, checkpoint.identityName ?? job.name)).find(Boolean);
  if (!record) return;
  const supportsFit = earlier.some(item => ['First-party operating history', 'Published coaching program scope', 'Published offer price'].includes(item.method));
  add(checkpoint, 'substance', supportsFit ? 'VERIFIED' : 'UNVERIFIED', supportsFit
    ? 'The official site documents a delivered client engagement and a separate measure of commercial substance.'
    : 'A client engagement was documented. One additional commercial signal remains unresolved.', [...earlier, record]);
}

export async function resolveBusiness(web: PublicWeb, job: Job, signal: AbortSignal) {
  const checkpoint = emptyCheckpoint();
  if (hostedBooking(job.website)) {
    add(checkpoint, 'identity', 'UNVERIFIED', 'A hosted booking or event page cannot identify the coaching business.');
    return { checkpoint, done: true };
  }
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
    ? Boolean(item.brand) : item.brand === seed.name || containsName(item.identity, seed.name));
  let candidates = matches(identity);
  const homepage = new URL('/', page.url).href;
  if (!candidates.length && seeds.some(seed => seed.method === 'BUSINESS_SEARCH' || seed.method === 'PUBLIC_OFFER') && homepage !== page.url) {
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
  const canonicalConflict = [page, identity].some(item => item.state === 'READABLE' && item.canonical && domain(item.canonical) !== job.domain);
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
  const irrelevant = page.headings.find(line => /\b(?:executive search firm|recruitment agency|psychotherapy practice|software platform|podcast (?:directory|monitoring|database)|media monitoring)\b/i.test(line));
  if (irrelevant && !page.statements.some(line => relevantCoach.test(line))) {
    add(checkpoint, 'niche', 'CONTRADICTED', 'The official site describes a different primary service.', [quote(page, irrelevant, 'Primary service heading')]);
    return { checkpoint, done: true };
  }
  recordMarket(checkpoint, [...new Set([page, identity])]);
  return { checkpoint, done: false };
}

function recordMarket(checkpoint: Checkpoint, pages: Page[]) {
  delete checkpoint.country;
  checkpoint.marketEvidenceChecked = true;
  const region = /\b(?:(?:serve|serves|serving|work with|work across|coaching (?:for|across|in)|our clients (?:are|include)|clients (?:based|located) in|(?:we are|our (?:practice|business|office) is|our headquarters (?:is|are)) based in)\b[^.;!?]{0,65}|we (?:partner with|coach) (?:[\w-]+ ){0,5}(?:leaders|executives|founders|business owners|clients)\b[^.;!?]{0,125})\b(United States\b|United Kingdom\b|Canada\b|U\.S\.|U\.K\.|USA\b|UK\b|US\b)/i;
  const outside = /\b(?:only|exclusively)\s+(?:serve|work with|coach)\b[^.;!?]{0,60}\b(France|Germany|Spain|Italy|Netherlands|Belgium|Switzerland|Australia|New Zealand|India|Singapore|Ireland)\b/i;
  const declared = pages.flatMap(page => [...page.statements, page.title].flatMap(line => {
    if (/\b(?:not|never|except|excludes?)\b/i.test(line) || /\?$/.test(line) || /^(?:do|does|can|could|what|where|who|when|will|how|is|are)\b/i.test(line)) return [];
    const match = line.match(region);
    if (!match || /^(?:us|uk)$/i.test(match[1]) && match[1] !== match[1].toUpperCase()) return [];
    const country = /Canada/i.test(match[1]) ? 'CA' as const : /Kingdom|U\.?K/i.test(match[1]) ? 'UK' as const : 'US' as const;
    return [{ country, evidence: quote(page, line, 'Explicit market or business base') }];
  }));
  const positive = [...pages.flatMap(page => page.markets.map(market => ({ country: market.country,
    evidence: quote(page, market.evidence, 'Official service area or operating address') }))), ...declared];
  const negative = pages.flatMap(page => page.statements.filter(line => outside.test(line)).map(line => quote(page, line, 'Exclusive market statement')));
  if (positive.length && negative.length) add(checkpoint, 'geography', 'UNVERIFIED', 'The site makes conflicting market statements.', [positive[0].evidence, negative[0]]);
  else if (negative.length) add(checkpoint, 'geography', 'CONTRADICTED', 'The business explicitly limits service to an ineligible market.', [negative[0]]);
  else if (positive.length) {
    checkpoint.country = positive[0].country;
    add(checkpoint, 'geography', 'VERIFIED', 'Official service or operating-address evidence establishes an eligible market.', [positive[0].evidence]);
  } else add(checkpoint, 'geography', 'UNVERIFIED', 'The public site did not establish an eligible business market.');
}

function recordAcquisition(job: Job, checkpoint: Checkpoint, activityDays: number) {
  if (!checkpoint.gates.some(item => item.name === 'niche' && item.state === 'VERIFIED')) {
    add(checkpoint, 'acquisition', 'UNVERIFIED', 'Acquisition activity needs to belong to a verified coaching offer.');
    return;
  }
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

function ownedActivity(page: Page, offerUrl?: string) {
  const heading = page.headings[0] || page.title;
  const context = [heading, ...page.statements.slice(0, 16)].join(' ');
  const host = domain(page.url);
  if (page.canonical && domain(page.canonical) !== host || !relevantCoach.test(context) && !activityAudience.test(context)) return [];
  const campaign = activityLink.test(`${heading} ${new URL(page.url).pathname.replace(/[-_/]/g, ' ')} ${page.title}`) && page.activityAction;
  const consultation = page.publicationDates?.length && relevantCoach.test(context) ? page.links.find(link => link.main &&
    (offerUrl && link.url === offerUrl && offerLink.test(link.label) ||
      /^(?:book|schedule)\b.{0,65}\b(?:consultation|call|coaching session)\b/i.test(link.label) && routeHost(link.url, host))) : undefined;
  if (!campaign && !consultation) return [];
  const dates = campaign ? page.activityDates : page.publicationDates ?? [];
  const days = [...new Set(dates.filter(value => /^\d{4}-\d\d-\d\d(?:T|$)/.test(value) && Number.isFinite(Date.parse(value)))
    .map(value => value.slice(0, 10)))];
  if (days.length !== 1) return [];
  const destination = consultation ? `${consultation.label} → ${consultation.url}` : '';
  return [{ date: days[0], evidence: quote(page, `${days[0]} · ${heading} · ${campaign || destination}`, 'Dated first-party coaching campaign') }];
}

async function ownedFeedActivities(web: PublicWeb, url: string, host: string, signal: AbortSignal) {
  try {
    const response = await web.document(url, AbortSignal.any([signal, AbortSignal.timeout(6_000)]), address => domain(address.href) === host);
    if (response.status !== 200 || !/xml|rss|atom/i.test(response.headers['content-type'] ?? '') || response.body.length > 512_000 ||
      /\b(?:nofollow|noarchive|none)\b/i.test(response.headers['x-robots-tag'] ?? '')) return [];
    const $ = load(response.body.toString('utf8'), { xml: true });
    if (!$('rss,feed').length) return [];
    const identity = squash($('channel > title,feed > title').first().text());
    if (/\b(?:comments|replies|reviews)\b/i.test(identity)) return [];
    const description = squash($('channel > description,feed > subtitle').first().text()).slice(0, 450);
    const coachingPublication = relevantCoach.test(description) && (activityAudience.test(description) || /\bentrepreneurs?\b/i.test(description));
    return $('item,entry').slice(0, 12).toArray().flatMap(node => {
      const item = $(node);
      const title = squash(item.children('title').first().text()).slice(0, 140);
      const category = item.children('category').toArray().slice(0, 12).map(entry => $(entry).text()).join(' ');
      const relatedCategory = /\b(?:leadership|business (?:growth|finance|strateg(?:y|ies))|growth strategies|shareholder value)\b/i.test(category)
        && (coachingPublication || /\b(?:real estate|executive|leadership|business) coaching\b/i.test(category));
      if (!title || (!relevantCoach.test(`${title} ${category}`) && !activityAudience.test(title) && !relatedCategory)) return [];
      const date = Date.parse(item.children('pubDate,published').first().text());
      const link = item.children('link').filter((_index, entry) => !$(entry).attr('rel') || $(entry).attr('rel') === 'alternate').first();
      const target = linkedUrl(link.attr('href') || link.text(), response.url);
      if (!target || domain(target) !== host || !Number.isFinite(date) || date > Date.now()) return [];
      const dateString = new Date(date).toISOString().slice(0, 10);
      const evidence = observe('official', target, `${dateString} · ${title} · Published in the site's subscriber feed ${response.url}.`, 'Dated first-party subscriber publication', response.body);
      return [{ date: dateString, evidence }];
    });
  } catch { return []; }
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

export async function enrichAcquisition(web: PublicWeb, job: Job, settings: Settings, signal: AbortSignal, campaignUrls: string[] = []) {
  const checkpoint = job.checkpoint;
  if (checkpoint.gates.find(gate => gate.name === 'acquisition')?.state === 'VERIFIED' ||
      checkpoint.gates.find(gate => gate.name === 'identity')?.state !== 'VERIFIED' ||
      checkpoint.gates.find(gate => gate.name === 'niche')?.state !== 'VERIFIED') return [];
  if (campaignUrls.length) {
    const offerHeading = checkpoint.gates.find(gate => gate.name === 'niche')?.evidence;
    const offerUrl = checkpoint.evidence.find(item => offerHeading?.includes(item.id) && item.method === 'Offer heading')?.url;
    const pending = [...new Set(campaignUrls)].filter(url => domain(url) === job.domain && !checkpoint.journey.some(step => step.url === url));
    const pages = await Promise.all(pending.slice(0, 3).map(url => inspect(web, url, signal, 'Targeted campaign recheck', address => domain(address.href) === job.domain)));
    for (const page of pages) {
      addJourney(checkpoint, job.website, page, 'Targeted promotion');
      if (page.state === 'READABLE') (checkpoint.ownedActivities ??= []).push(...ownedActivity(page, offerUrl));
    }
    recordAcquisition(job, checkpoint, settings.activityDays);
    return [];
  }
  const feed = checkpoint.ownedFeeds?.[0];
  if (feed) {
    (checkpoint.ownedActivities ??= []).push(...await ownedFeedActivities(web, feed, job.domain, signal));
    recordAcquisition(job, checkpoint, settings.activityDays);
    if (checkpoint.gates.find(gate => gate.name === 'acquisition')?.state === 'VERIFIED') return [];
  }
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
  return host === official || ['book.', 'booking.', 'bookme.', 'schedule.'].some(prefix => host === `${prefix}${official}`) ||
    /^outlook\.office(?:365)?\.com$/i.test(host) && /^\/book\//i.test(new URL(value).pathname) ||
    /^(?:calendly\.com|cal\.com|app\.acuityscheduling\.com|[a-z\d-]+\.(?:as\.me|youcanbook\.me)|savvycal\.com|koalendar\.com)$/i.test(host);
}

function addJourney(checkpoint: Checkpoint, from: string, page: Page, label: string) {
  checkpoint.evidence.push(page.evidence);
  checkpoint.journey.push({ from, url: page.url, label, result: page.state, evidence: page.evidence.id });
}

function mobileBookingDisparity(rendered: RenderedPage, destination: string) {
  if (rendered.incompleteAssets || rendered.unavailable.length || rendered.bookingDialogs?.length) return;
  const desktop = rendered.bookingLayouts?.find(item => item.device === 'desktop');
  const mobile = rendered.bookingLayouts?.find(item => item.device === 'mobile');
  if (!desktop || !mobile || linkedUrl(desktop.url, rendered.url) !== destination || linkedUrl(mobile.url, rendered.url) !== destination ||
      desktop.top >= desktop.viewport || mobile.top < mobile.viewport * 3) return;
  return `The first visible booking link began at ${desktop.top}px in an ${desktop.viewport}px desktop viewport and at ${mobile.top}px in an ${mobile.viewport}px mobile viewport.`;
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

function bookingDestinationMismatch(from: Page, link: Link, destination: Page) {
  if (!link.main || !/^(?:book|schedule)\b.{0,55}\b(?:call|session|consultation|meeting)\b/i.test(link.label) ||
    destination.state !== 'READABLE' || destination.scheduling || destination.bookingControl) return;
  const heading = destination.headings[0] || destination.title;
  const mediaPath = /\/(?:podcasts?|newsletters?|blog|articles?)(?:\/|$)/i.test(new URL(destination.url).pathname);
  if (!mediaPath || !/\b(?:podcast|newsletter|blog|episode)\b/i.test(heading)) return;
  return [quote(from, link.label, 'Public booking promise'), quote(destination, heading, 'Unrelated booking destination')];
}

function bookingToInquiry(from: Page, link: Link, destination: Page, widget?: Page) {
  const promise = /^(?:book|schedule)\b.{0,55}\b(?:call|session|consult(?:ation)?|appointment|meeting)\b/i;
  if (!link.main || !promise.test(link.label) || destination.state !== 'READABLE') return;
  if (/\b(?:request|inquir|enquir|application)\b/i.test(link.label) || from.links.some(other => other.url !== link.url && promise.test(other.label))) return;
  const advertised = quote(from, link.label, 'Direct booking CTA');
  const complimentary = /\b(?:free|complimentary|no[- ]cost)\b/i;
  if (complimentary.test(link.label)) {
    const lines = [destination.title, ...destination.headings.slice(0, 4), ...destination.statements.slice(0, 18)];
    const charge = lines.find(text => /\b(?:initial|introductory|discovery)\s+(?:call|consultation|session)\b[^.;!?]{0,45}(?:\$|£|USD\s+|CAD\s+|GBP\s+)[1-9]\d*(?:\.\d{2})?/i.test(text));
    if (charge && !lines.some(text => (complimentary.test(text) || /\b(?:waived|refundable deposit|credited)\b/i.test(text)) && /\b(?:call|session|consultation)\b/i.test(text))) {
      return { kind: 'fee' as const, evidence: [advertised, quote(destination, charge, 'Published charge for the introductory call')] };
    }
  }
  if (from.informedIntake || destination.informedIntake || destination.scheduling) return;
  if (destination.genericInquiry) {
    return { kind: 'message' as const, evidence: [advertised, quote(destination, destination.genericInquiry, 'Generic message form at booking destination')] };
  }
  if (widget?.url === destination.embeddedInquiry && widget?.hostedInquiry) {
    return { kind: 'embedded' as const, evidence: [advertised, quote(destination, `The booking destination embeds a general inquiry widget at ${widget.url}.`, 'Booking destination and its public form'),
      quote(widget, `The form asks for email, phone, and ${widget.hostedInquiry} without an appointment-time selector.`, 'General embedded business inquiry')] };
  }
  if (destination.consultationIntake) {
    const fields = destination.consultationIntake;
    return { kind: 'intake' as const, evidence: [advertised, quote(destination,
      `The consultation form requires ${fields.length} prompts before submission: ${fields.join(', ')}. No calendar or explained callback step was visible.`, 'Required consultation intake before date selection')] };
  }
}

function monthlyPriceMismatch(page: Page) {
  const prices = new Map<number, Evidence>();
  let currency: string | undefined;
  for (const statement of page.statements) {
    if (/\b(?:members only|discount|different tiers|add-ons?|renewal|last year|formerly|depending on the plan)\b/i.test(statement)) continue;
    const match = statement.match(/\b(?:investment|pricing|fees?|rates?) (?:levels? )?(?:(?:starts?|begins?) (?:at|from)|ranges? from)\s+(?:(a monthly fee of)\s+)?(GBP|USD|CAD|£)\s*((?:\d{1,3}(?:,\d{3})+|\d{3,5}))(?![\d,.])([^.!?]{0,32})/i);
    if (!match || !match[1] && !/^\s*(?:at a monthly fee|a month|per month)\b/i.test(match[4])) continue;
    const symbol = match[2] === '£' ? 'GBP' : match[2].toUpperCase();
    if (currency && symbol !== currency) return;
    currency = symbol;
    prices.set(Number(match[3].replaceAll(',', '')), quote(page, match[0].trim().split(/\s+or\s+/i)[0], 'Published starting monthly coaching fee'));
  }
  const amounts = [...prices.keys()].sort((a, b) => a - b);
  if (currency && amounts.length === 2 && amounts[0] >= 500 && amounts[1] - amounts[0] >= 50) {
    return { currency, amounts: [amounts[0], amounts[1]] as [number, number], evidence: amounts.map(amount => prices.get(amount)!) };
  }
}

function offerOn(page: Page) {
  const softwareCoach = /\b(?:AI (?:teammate|(?:powered )?(?:executive |CEO |leadership |business )?coach(?:ing)? (?:agent|tool|software))|(?:executive |CEO |leadership |business )?coach(?:ing)? AI agent)\b/i;
  if ([page.title, ...page.headings.slice(0, 4)].some(text => softwareCoach.test(text))) return;
  if ([page.title, page.headings[0] ?? ''].some(text => coachingEditorial.test(text) ||
    /^(?:do you need an? .{1,40}coach|when (?:to|should you) hire|the benefits of hiring)\b|\b\d+ signs (?:it.s time|you need)\b/i.test(text))) return;
  const specialty = /\b(?:(?:strategic )?leadership advis(?:ory|er|or)|CEO mentor(?:ing|ship)?|founder advis(?:ory|er|or)|executive development)\b/i;
  const training = /\b(?:coach(?:ing)? (?:skills |credential )?(?:training|education|certification|accreditation)|(?:become|qualify as) (?:an? )?(?:certified |professional |executive )?coach|leader as coach)\b/i;
  const servicesForCoaches = /\b(?:lead generation|digital marketing|seo|paid ads?|web design|appointment setting|branding|lead magnet)\b/i;
  if ([page.headings[0], page.title].some(value => training.test(value ?? '') || servicesForCoaches.test(value ?? '') && /\bfor (?:[^.]{0,42} )?coach(?:es|ing)\b/i.test(value ?? ''))) return null;
  const brokerageOffer = page.statements.some(value => /\b(?:brokerage (?:firms?|executives?|leaders?)|real estate teams?)\b/i.test(value));
  const line = [page.headings[0], page.title, ...page.headings].find(value => value && (relevantCoach.test(value) || specialty.test(value) ||
    brokerageOffer && /\breal estate coaching\b/i.test(value)) &&
    !/^(?:why|how|what|do|does|should|the .* questions)\b/i.test(value));
  if (!line) return null;
  const detail = page.statements.find(value => scope.test(value) && (relevantCoach.test(line) || /\bcoach(?:ing|es)?\b/i.test(value)) &&
    !/^(?:“|"|one of my (?:previous|former)|my (?:former |previous )?employer|when i hired|i highly recommend)/i.test(value));
  return { page, line, detail };
}

function detailPages(pages: Page[], own: (url: URL) => boolean, includePublications: boolean) {
  const targets = [...new Map(pages.flatMap(page => page.links).filter(link => own(new URL(link.url)) &&
    (!navigationOnly.test(link.label) || publicationIndex.test(link.label)) && !pages.some(page => page.url === link.url)).map(link => [link.url, link])).values()];
  const ranked = targets.map(link => {
    const label = `${link.label} ${new URL(link.url).pathname.replace(/[-_/]/g, ' ')}`;
    const score = Number(relevantCoach.test(label)) * 6 + Number(offerLink.test(label)) * 2 + Number(link.main) -
      Number(/\b(?:podcasts?|blog|articles?|library|news|speaking|free training|case stud(?:y|ies)|client stor(?:y|ies)|testimonials?)\b/i.test(label)) * 9;
    return { link, score };
  });
  const offers = ranked.filter(value => value.score >= 2).sort((a, b) => b.score - a.score).slice(0, 2).map(value => value.link);
  const other = [caseLink, pricingLink, contactLink, aboutLink, ...(includePublications ? [activityLink, publicationIndex] : [])]
    .flatMap(pattern => targets.filter(link => pattern.test(link.label)).slice(0, 1));
  return [...new Map([...offers, ...other].map(link => [link.url, link])).values()];
}

const paidLanguage = /\b(?:investment|price|pricing|fee|tuition|cost|instal+l?ments|payments?|per (?:coaching )?session)\b/i;
const paidAmount = /(?:US\$|CA\$|[$£]|(?:USD|CAD|GBP)\s*)\s*[1-9]\d{0,2}(?:,\d{3})*(?:\.\d{2})?\b|(?:USD|CAD|GBP|[$£])\s*[1-9]\d{3,6}(?:\.\d{2})?\b/i;
const programAction = /\b(?:explore|discover|learn (?:more|about)|join|apply|enrol+l?|work with|book|schedule|view|see)\b/i;
const businessNiche = /\b(?:executive|leadership|business|CEO|founder)\b/i;

function paidOffer(page: Page) {
  const quotedEngagement = /\b(?:executive|leadership|business) coaching (?:investment|fees?|pricing) (?:varies|depends) (?:significantly )?(?:on|based on) (?:the )?(?:scope|duration|length)\b/i;
  const marketPrice = page.statements.find(line => paidAmount.test(line) && (paidLanguage.test(line) || /^[A-Z]{0,3}[$£]/i.test(line)) &&
    !/\b(?:could|typical|average|revenue|savings|salary|scholarship|donat(?:e|ion)|free trial|example|other coaches|earn|formerly)\b/i.test(line));
  return marketPrice ?? page.statements.find(line => quotedEngagement.test(line));
}

export async function screenPublicOffer(web: PublicWeb, source: string, signal: AbortSignal,
  excluded: ReadonlySet<string>): Promise<{ seed: Seed } | { reason: string }> {
  const sourceHost = domain(source);
  const pointer = await inspect(web, source, signal, 'Public offer screening', address => domain(address.href) === sourceHost);
  if (pointer.state !== 'READABLE') return { reason: pointer.state };
  const hosted = hostedBooking(pointer.url);
  const official = hosted ? pointer.organizerSites?.[0] : pointer.url;
  if (!official) return { reason: 'Host did not identify an official coach website' };
  const host = domain(official);
  if (excluded.has(host)) return { reason: 'Previously queued or investigated' };
  const own = (url: URL) => domain(url.href) === host;
  const entry = hosted ? await inspect(web, official, signal, 'Event organizer website', own) : pointer;
  if (entry.state !== 'READABLE' || entry.canonical && !own(new URL(entry.canonical))) return { reason: 'Official site unverified' };
  const sameSite = [...new Map(entry.links.filter(link => own(new URL(link.url)) && link.url !== entry.url &&
    (offerPath.test(new URL(link.url).pathname) || link.main && offerLink.test(link.label) &&
      (relevantCoach.test(link.label) || programAction.test(link.label)))).map(link => [link.url, link])).values()];
  const ranked = sameSite.sort((a, b) => Number(b.main) - Number(a.main));
  const scoped = [entry, ...await Promise.all(ranked.slice(0, 2).map(link => inspect(web, link.url, signal, 'Paid offer screening', own)))]
    .filter(page => page.state === 'READABLE' && (!page.canonical || own(new URL(page.canonical))) &&
      businessNiche.test(offerOn(page)?.line ?? '') && offerOn(page)?.detail);
  if (!scoped.length) return { reason: 'No scoped coaching offer' };
  const paid = scoped.filter(paidOffer);
  if (!paid.length) return { reason: 'Paid terms unverified' };
  const offer = paid[0];
  const homeUrl = new URL('/', offer.url).href;
  const home = homeUrl === entry.url || homeUrl === offer.url ? (homeUrl === entry.url ? entry : offer) :
    await inspect(web, homeUrl, signal, 'Official business context screening', own);
  const pages = [entry, offer, home].filter(page => page.state === 'READABLE' && own(new URL(page.url)) &&
    (!page.canonical || own(new URL(page.canonical))));
  if (hosted && !pages.some(page => page.links.some(link => link.main && link.url === pointer.url)))
    return { reason: 'Official website did not corroborate the hosted listing' };
  const identity = pages.find(page => page.brand)?.brand;
  if (!identity) return { reason: 'Official business name unverified' };
  const checkpoint = emptyCheckpoint();
  recordMarket(checkpoint, pages);
  if (!checkpoint.country) {
    const links = pages.flatMap(page => page.links).filter(link => own(new URL(link.url)) && !pages.some(page => page.url === link.url));
    const context = [...new Set([links.find(link => contactLink.test(link.label))?.url, links.find(link => aboutLink.test(link.label))?.url]
      .filter((url): url is string => Boolean(url)))];
    const read = await Promise.all(context.map(url => inspect(web, url, signal, 'Market evidence screening', own)));
    recordMarket(checkpoint, [...pages, ...read]);
  }
  if (!checkpoint.country) return { reason: 'Eligible market unverified' };
  return { seed: { method: 'PUBLIC_OFFER', name: identity, website: offer.url, source: pointer.url,
    sourceKey: 'public-offer:' + hash(offer.url), excerpt: 'Official paid coaching offer with a verified business and eligible market.', discoveryPriority: 20 } };
}

export async function investigate(web: PublicWeb, job: Job, settings: Settings, signal: AbortSignal,
  { qualificationOnly = false }: { qualificationOnly?: boolean } = {}) {
  const checkpoint = job.checkpoint;
  if (qualificationOnly) checkpoint.gates = checkpoint.gates.filter(gate => gateNames.some(name => name === gate.name));
  const linkedOffers = new Set<string>();
  const own = (url: URL) => domain(url.href) === job.domain || linkedOffers.has(url.href);
  const entry = await inspect(web, job.website, signal, 'Offer investigation entry', own);
  const page = entry.state !== 'READABLE' && checkpoint.identityPage && checkpoint.identityPage !== entry.url ?
    await inspect(web, checkpoint.identityPage, signal, 'Public official entry recheck', own) : entry;
  if (entry !== page) addJourney(checkpoint, job.website, entry, 'Discovered route');
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
  // Search can enter through a deep offer page. The official homepage can supply
  // the business's market, history and contact links that the offer omits.
  if (!pages.some(item => new URL(item.url).pathname === '/')) {
    const home = await inspect(web, new URL('/', page.url).href, signal, 'Official homepage context', own);
    addJourney(checkpoint, page.url, home, 'Official homepage');
    if (home.state === 'READABLE' && !pages.some(item => item.url === home.url) &&
      (home.brand && home.brand === checkpoint.identityName || containsName(home.identity, checkpoint.identityName ?? job.name))) pages.push(home);
  }
  const promotedOffers = pages.flatMap(item => item.links).filter(link =>
    linkedOfferHost(new URL(link.url), job.domain) && offerLink.test(link.label));
  for (const link of promotedOffers.slice(0, 3)) linkedOffers.add(link.url);
  const discoveredCampaigns = qualificationOnly ? [] : [...new Set(job.seeds.flatMap(seed => seed.activityLinks ?? []))].filter(url => own(new URL(url)) && !pages.some(item => item.url === url))
    .slice(0, 2).map(url => ({ url, label: 'Discovered promotion' }));
  const discoveredCases = [...new Set(job.seeds.flatMap(seed => seed.commercialLinks ?? []))].filter(url => own(new URL(url)) && !pages.some(item => item.url === url))
    .slice(0, 2).map(url => ({ url, label: 'Discovered coaching case' }));
  const planned = [...new Map([...promotedOffers.slice(0, 1), ...detailPages(pages, own, !qualificationOnly), ...discoveredCampaigns, ...discoveredCases]
    .map(link => [link.url, link])).values()];
  const details = await Promise.all(planned.map(link => inspect(web, link.url, signal, 'Official detail page', own)));
  for (const [index, detail] of details.entries()) {
    addJourney(checkpoint, page.url, detail, planned[index].label);
    if (detail.state === 'READABLE' && (domain(detail.url) === job.domain ||
      containsName(detail.brand ?? detail.identity, checkpoint.identityName ?? job.name))) pages.push(detail);
  }
  const deeper = [...new Map(pages.flatMap(item => item.links).filter(link => link.main && own(new URL(link.url)) && !pages.some(item => item.url === link.url) &&
    (caseLink.test(link.label) || caseDetailPath.test(new URL(link.url).pathname) || !qualificationOnly &&
      (activityLink.test(link.label) || publicationPath.test(new URL(link.url).pathname))) &&
    !/\b(?:personal use|directory|privacy|login|view all|archives?)\b/i.test(link.label)).map(link => [link.url, link])).values()]
    .sort((a, b) => Number(/\/(?:case-stud(?:y|ies)|webinars?|episodes?)\/[^/]+/i.test(new URL(b.url).pathname)) -
      Number(/\/(?:case-stud(?:y|ies)|webinars?|episodes?)\/[^/]+/i.test(new URL(a.url).pathname))).slice(0, 3);
  for (const [index, detail] of (await Promise.all(deeper.map(link => inspect(web, link.url, signal, qualificationOnly ? 'Supporting coaching case' : 'Supporting case or campaign', own)))).entries()) {
    addJourney(checkpoint, page.url, detail, deeper[index].label);
    if (detail.state === 'READABLE') pages.push(detail);
  }
  recordMarket(checkpoint, pages);
  const observed = pages.flatMap(item => {
    const candidate = offerOn(item);
    return candidate && (!qualificationOnly || businessNiche.test(candidate.line)) ? [candidate] : [];
  });
  const offerRank = ({ page: item, detail }: NonNullable<ReturnType<typeof offerOn>>) =>
    Number(Boolean(detail)) * 10 + Number(offerPath.test(new URL(item.url).pathname)) * 4 +
    (qualificationOnly ? Number(Boolean(paidOffer(item))) * 6 : Number(item.links.some(link => link.main && booking.test(link.label))) * 2) +
    Number(linkedOffers.has(item.url)) * 3 + Number(item.url === page.url);
  const screenedOffer = job.seeds.find(seed => seed.method === 'PUBLIC_OFFER')?.website;
  const selected = observed.find(item => item.page.url === screenedOffer && item.detail && paidOffer(item.page)) ??
    observed.sort((a, b) => offerRank(b) - offerRank(a))[0];
  const offer = selected?.page;
  const line = selected?.line;
  const engagement = selected?.detail;
  checkpoint.attributedProgramScope = true;
  if (offer && line && engagement) {
    checkpoint.offer = line;
    add(checkpoint, 'niche', 'VERIFIED', 'The official page describes a specialized coaching engagement.', [quote(offer, line, 'Offer heading'), quote(offer, engagement, 'Engagement scope')]);
    const price = offer.statements.find(item => !/\b(?:revenue|sales|per (?:hour|session|month)|\/hour|estimated|industry average)\b|\/(?:hour|hr|month|mo|session)\b/i.test(item) &&
      /\b(?:investment|pricing|package|engagement|program(?:me)? fee|\d{1,2} (?:private |executive |leadership |business )?coaching sessions)\b[^.!?]{0,55}(?:USD|CAD|GBP|[$£])\s*(?:[3-9],?\d{3}|[1-9]\d,?\d{3})\b/i.test(item));
    const substance = pages.filter(item => ![item.title, item.headings[0] ?? ''].some(text => coachingEditorial.test(text)))
      .flatMap(item => item.statements.map(statement => ({ page: item, statement })))
      .find(item => {
        const since = item.statement.match(/\b(?:founded|established|in business|(?:providing|offering|delivering) (?:executive |leadership |business )?coaching)\s+(?:in\s+|since\s+)?(19\d{2}|20\d{2})\b/i);
        const practiceStarted = item.statement.match(/^since (19\d{2}|20\d{2}),?\s+(?:we|I|our (?:practice|firm|business))\b.{0,70}\b(?:coach(?:ed|ing)?|coaching)\b/i);
        const founding = item.statement.match(/\bin (19\d{2}|20\d{2}),\s*(?:we|I|she|he|[\p{L}]+ [\p{L}]+)\s+founded\b/iu);
        return Boolean(since && Number(since[1]) <= new Date().getUTCFullYear() - 3 &&
            (/\b(?:our (?:business|firm|practice|company|team)|we (?:have|were|started|began)|I (?:have|started|began))\b/i.test(item.statement) ||
              containsName(item.statement, checkpoint.identityName ?? job.name))) ||
          Boolean(practiceStarted && Number(practiceStarted[1]) <= new Date().getUTCFullYear() - 3) ||
          Boolean(founding && Number(founding[1]) <= new Date().getUTCFullYear() - 3 && containsName(item.statement, checkpoint.identityName ?? job.name)) ||
          /\b(?:[5-9]|[1-9]\d)\+? years of (?:executive |career |leadership |business )?coaching experience\b/i.test(item.statement) &&
          (/\b(?:the practice|our (?:team|practice|firm)|we (?:bring|have)|I (?:bring|have))\b/i.test(item.statement) ||
            containsName(item.statement, checkpoint.identityName ?? job.name));
      });
    const clientCase = pages.map(item => caseEvidence(item, checkpoint.identityName ?? job.name)).find(Boolean);
    const procurement = job.seeds.find(seed => seed.method === 'PROCUREMENT' && seed.contract &&
      normalized(seed.name) === normalized(checkpoint.identityName ?? job.name) && domain(seed.website) === job.domain);
    const testimonial = (offer.testimonials ?? [])[0];
    const clientAccounts = new Map(pages.flatMap(item => (item.clientAccounts ?? []).map(account =>
      [account.organization, quote(item, account.excerpt, 'Attributed coaching client account')] as const)));
    const namedClients = [...clientAccounts.values()].slice(0, 2);
    const proof = clientCase ?? (procurement?.contract ? observe('external', procurement.source,
      `${procurement.contract.buyer} recorded a coaching award to ${procurement.name} on ${procurement.contract.awardedOn.slice(0, 10)}. Value GBP ${procurement.contract.amountGbp}. Open Government Licence v3.0.`, 'Public contract award') : undefined);
    const writtenProgram = offer.statements.find(item => /\b(?:(?:[3-9]|1[0-9]|three|four|five|six|nine|twelve)[- ]months?|(?:[6-9]|[1-9]\d) (?:private |individual |executive |leadership |one-on-one )?coaching (?:sessions|calls))\b/i.test(item)
      && /\b(?:coaching|engagement|program(?:me)?)\b/i.test(item)
      && !/\b(?:free|may offer|might offer|formerly|according to|report (?:on|by|from)|(?:a |the )?(?:study|survey|report|research) (?:shows|found|finds|documents|suggests|by|from))\b/i.test(item)
      && (/\b(?:our|my) (?:[\w:-]+ ){0,5}(?:coaching|engagement|program(?:me)?)\b|\bthis (?:[\w:-]+ ){0,4}coaching (?:container|package|program(?:me)?|engagement)\b|\b(?:at|with) (?:our|this|the) (?:practice|firm)\b|\b(?:we|I) (?:offer|deliver|provide|run|include)\b|\byou(?:['’]ll| will) (?:receive|get)\b/i.test(item)
        || containsName(item, checkpoint.identityName ?? job.name)));
    const programLabel = /\bcoaching (?:program(?:me)?|package|engagement)\b/i;
    const programTitle = [line, offer.title, ...offer.headings.slice(0, 4)].find(item =>
      /\b(?:9\d|[1-3]\d{2})[- ]day\b/i.test(item) && businessNiche.test(item) &&
      programLabel.test(item) && !/\b(?:free|trial)\b/i.test(item));
    const programSessions = programTitle && offer.headings.find(item =>
      /^(?:[^\p{L}\p{N}]*)(?:[6-9]|[1-9]\d)\s+(?:(?:private|individual|1[: -]1|one-on-one|weekly|biweekly|monthly)\s+){0,3}coaching (?:sessions|calls)\b/iu.test(item) &&
      !/\b(?:free|sample|bonus)\b/i.test(item));
    const packageHeading = offer.headings.find(item => programLabel.test(item) && !/\b(?:free|trial|sample|how|what)\b/i.test(item));
    const packageSchedule = packageHeading && offer.headings.find(item =>
      /^(?:[6-9]|[1-9]\d) (?:coaching )?(?:sessions|calls) (?:to use )?(?:over|within) (?:[3-9]|1[0-9]|three|four|five|six|nine|twelve) months?$/i.test(item));
    const program = writtenProgram ?? (programTitle && programSessions ? `${programTitle} | ${programSessions}` : undefined) ??
      (packageHeading && packageSchedule ? `${packageHeading} | ${packageSchedule}` : undefined);
    const requirePaidTerms = qualificationOnly || Boolean(screenedOffer);
    const explicitPrice = requirePaidTerms ? paidOffer(offer) : price;
    const commercial = [explicitPrice && quote(offer, explicitPrice, paidAmount.test(explicitPrice) ? 'Published offer price' : 'Published paid terms'),
      proof ?? namedClients[0] ?? (testimonial && quote(offer, testimonial, 'Attributed coaching client account')), substance && quote(substance.page, substance.statement, 'First-party operating history'),
      program && quote(offer, program, 'Published coaching program scope')].filter((item): item is Evidence => Boolean(item));
    // Separately attributed engagements from different organizations can establish repeat client work.
    if (commercial.length < 2 && namedClients.length === 2) commercial.splice(0, commercial.length, ...namedClients);
    const supportsPaidOffer = !requirePaidTerms || Boolean(explicitPrice);
    add(checkpoint, 'substance', commercial.length >= 2 && supportsPaidOffer ? 'VERIFIED' : 'UNVERIFIED', commercial.length >= 2 && supportsPaidOffer
      ? 'Multiple documented measures establish commercial substance for the scoped coaching offer.'
      : !supportsPaidOffer ? 'The published paid coaching offer could not be independently verified.'
      : 'Commercial substance needs two supporting signals across a substantial program, published pricing, a client engagement, and operating history.', commercial);
  } else {
    add(checkpoint, 'niche', 'UNVERIFIED', line ? 'A specialized offer was visible, but the provider did not establish its coaching scope.' : 'A specialized coaching offer was not established.');
    add(checkpoint, 'substance', 'UNVERIFIED', 'A matching scoped coaching engagement is needed before commercial proof can qualify.');
  }
  const privacyLink = !checkpoint.country && !checkpoint.gates.some(gate => gate.name === 'geography' && gate.state === 'CONTRADICTED')
    ? pages.flatMap(item => item.links).find(link => own(new URL(link.url)) && /^(?:privacy policy|privacy notice)$/i.test(link.label)) : undefined;
  if (privacyLink) {
    const privacy = await inspect(web, privacyLink.url, signal, 'First-party business postal contact', own);
    addJourney(checkpoint, page.url, privacy, privacyLink.label);
    if (privacy.state === 'READABLE' && privacy.markets.length) recordMarket(checkpoint, [...pages, privacy]);
  }
  const artifacts: Artifact[] = [];
  if (qualificationOnly) return { checkpoint, artifacts };
  checkpoint.ownedFeeds = [...new Set(pages.flatMap(item => item.feedUrl && own(new URL(item.feedUrl)) ? [item.feedUrl] : []))].slice(0, 2);
  publicationLinks(pages, job, checkpoint);
  checkpoint.ownedActivities = pages.flatMap(item => ownedActivity(item, engagement ? offer?.url : undefined));
  recordAcquisition(job, checkpoint, settings.activityDays);
  if (checkpoint.gates.some(gate => gate.state === 'CONTRADICTED')) return { checkpoint, artifacts };
  const prioritized = offer ? [offer, ...pages.filter(item => item !== offer)] : pages;
  const routesByUrl = new Map<string, { from: Page; link: Link }>();
  for (const from of prioritized) for (const link of [...from.links].sort((a, b) => Number(b.main) - Number(a.main))) {
    const existing = routesByUrl.get(link.url);
    const address = new URL(link.url);
    const publicCalendar = link.main && domain(link.url) !== job.domain && routeHost(link.url, job.domain) &&
      (address.pathname !== '/' || /\.(?:as\.me|youcanbook\.me)$/i.test(address.hostname));
    if ((booking.test(link.label) || publicCalendar) && (!existing || link.main && !existing.link.main)) routesByUrl.set(link.url, { from, link });
  }
  const routes = [...routesByUrl.values()].filter(({ link }) => routeHost(link.url, job.domain)).slice(0, 3);
  const cta = routes[0]?.link;
  checkpoint.funnel = { found: routesByUrl.size, tested: 0, interactive: prioritized.some(item => item.bookingControl), intakeVersion: 2 };
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
    const soft = destination.state === 'READABLE' && (destination.missingPage || destination.schedulerProblem) && !destination.scheduling && !destination.bookingControl;
    const status = soft ? 200 : Number(destination.state.replace('HTTP_', ''));
    if (index === 0 && link.main && (soft || [404, 410].includes(status))) {
      const alternatives = prioritized.some(item => hasAlternateRoute(item, link.url));
      checkpoint.breakage = { url: link.url, from: from.url, label: link.label, status, evidence: destination.evidence.id, alternatives,
        ...(soft ? { soft: true } : {}) };
    }
    if (offer && (offer === from || offerOn(from)?.detail)) {
      const unrelated = !checkpoint.bookingDestinationMismatch && bookingDestinationMismatch(from, link, destination);
      if (unrelated) {
        checkpoint.evidence.push(...unrelated);
        checkpoint.bookingDestinationMismatch = { url: link.url, from: from.url, destination: destination.url, label: link.label,
          evidence: unrelated.map(item => item.id) };
      }
      const pricing = !checkpoint.priceMismatch && offer === from && link.main && destination.state === 'READABLE' && !soft && monthlyPriceMismatch(from);
      if (pricing) {
        checkpoint.evidence.push(...pricing.evidence);
        checkpoint.priceMismatch = { url: from.url, booking: link.url, currency: pricing.currency, amounts: pricing.amounts,
          evidence: pricing.evidence.map(item => item.id) };
      }
      const mismatch = !checkpoint.bookingMismatch && durationMismatch(from, link, destination);
      if (mismatch) {
        checkpoint.evidence.push(...mismatch.evidence);
        checkpoint.bookingMismatch = { from: from.url, url: link.url, destination: destination.url,
          promised: mismatch.promised, listed: mismatch.listed, evidence: mismatch.evidence.map(item => item.id) };
      }
      const widgetUrl = !checkpoint.inquiryMismatch && link.main && !destination.scheduling &&
        !from.informedIntake && !destination.informedIntake ? destination.embeddedInquiry : undefined;
      const widget = widgetUrl ? await inspect(web, widgetUrl, signal, 'Public embedded contact form', url => url.href === widgetUrl) : undefined;
      const inquiry = !checkpoint.inquiryMismatch && bookingToInquiry(from, link, destination, widget);
      if (inquiry) {
        checkpoint.evidence.push(...inquiry.evidence);
        checkpoint.inquiryMismatch = { from: from.url, url: link.url, destination: destination.url, label: link.label,
          kind: inquiry.kind, ...(inquiry.kind === 'embedded' && widgetUrl ? { widget: widgetUrl } : {}), evidence: inquiry.evidence.map(item => item.id) };
      }
    }
  }

  const contactPages = [...pages, ...probes.filter(item => own(new URL(item.url)) && item.state === 'READABLE')];
  const contact = contactPages.find(item => item.contact);
  const termsLink = contact && !contactPages.some(item => item.contactProhibited) ? contactPages.flatMap(item => item.links)
    .find(link => own(new URL(link.url)) && /^(?:website |site )?terms(?: (?:of (?:use|service)|and conditions))?$/i.test(link.label)) : undefined;
  const terms = termsLink ? await inspect(web, termsLink.url, signal, 'Official contact restrictions', own) : undefined;
  const restricted = [...contactPages, ...(terms ? [terms] : [])].find(item => item.contactProhibited);
  delete checkpoint.contact;
  if (contact?.contact && !restricted) {
    checkpoint.contact = contact.contact.address;
    add(checkpoint, 'contact', 'VERIFIED', 'The official site publishes a general business inquiry route.', [quote(contact, `${contact.contact.address} · ${contact.contact.context}`, 'Published business inquiry route')]);
  } else add(checkpoint, 'contact', 'UNVERIFIED', restricted
    ? 'The site publishes restrictions on unsolicited inquiries.' : 'No suitable public business inquiry route was found.', restricted ? [restricted.evidence] : []);

  const renderPage = routes[0]?.from ?? offer ?? page;
  if (settings.browser && (offer || cta) && pages[0].state === 'READABLE' && !signal.aborted) {
    const browserSignal = AbortSignal.any([signal, AbortSignal.timeout(19_000)]);
    const browser = createFunnelBrowser((url, requestSignal) => web.asset(url, requestSignal, renderPage.url), browserSignal, { inspectBookingDialogs: true });
    try {
      const rendered = await browser.render(renderPage.url, job.id);
      const renderedPage = parseBusinessPage(rendered.html, rendered.url);
      const confirmed = Boolean(cta && !renderedPage.challenged && renderedPage.links.some(link => link.url === cta.url && booking.test(link.label)));
      const depth = cta && confirmed && cta.main && offer === renderPage && mobileBookingDisparity(rendered, cta.url);
      if (depth && cta) {
        const observation = observe('browser', rendered.url, depth, 'Desktop and mobile booking-link position', Buffer.from(rendered.html));
        checkpoint.evidence.push(observation);
        checkpoint.mobileBookingDepth = { from: rendered.url, destination: cta.url, evidence: observation.id };
      }
      const missing = rendered.missingBookingSections?.[0];
      if (!renderedPage.challenged && missing && rendered.missingBookingSections?.length === 2 &&
          rendered.missingBookingSections.every(item => item.fragment === missing.fragment && item.label === missing.label) &&
          checkpoint.funnel.found === 0 && !rendered.bookingDialogs?.length) {
        const observation = observe('browser', rendered.url, `On desktop and mobile, ${missing.label} navigated to ${missing.fragment} without opening a booking control or reaching a section.`,
          'Observed missing booking section', Buffer.from(rendered.html));
        checkpoint.evidence.push(observation);
        checkpoint.missingBookingSection = { url: rendered.url, fragment: missing.fragment, label: missing.label, evidence: observation.id };
      }
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
  const offerScope = (source: string) => (url: URL) => offerRecheckScope(url, source, job.domain);
  const issue = checkpoint.breakage;
  const original = checkpoint.evidence.find(item => item.id === issue?.evidence);
  const mismatch = checkpoint.bookingMismatch;
  const inquiry = checkpoint.inquiryMismatch;
  const section = checkpoint.missingBookingSection;
  const mobile = checkpoint.mobileBookingDepth;
  const pricing = checkpoint.priceMismatch;
  const wrongPage = checkpoint.bookingDestinationMismatch;
  if (wrongPage) {
    const offer = await inspect(web, wrongPage.from, signal, 'Independent booking CTA recheck', offerScope(wrongPage.from));
    const link = offer.links.find(item => item.main && item.url === wrongPage.url && item.label === wrongPage.label);
    const original = checkpoint.evidence.filter(item => wrongPage.evidence.includes(item.id));
    if (link && original.length === 2 && offer.state === 'READABLE' && offerOn(offer)?.detail) {
      const destination = await inspect(web, wrongPage.url, signal, 'Independent booking destination recheck', url => domain(url.href) === domain(wrongPage.url));
      addJourney(checkpoint, offer.url, destination, link.label);
      const repeated = destination.url === wrongPage.destination && bookingDestinationMismatch(offer, link, destination);
      if (repeated) {
        add(checkpoint, 'opportunity', 'VERIFIED', 'A coaching booking action leads to a content page without a booking control. An independent read reproduced both steps. Point this action to the correct appointment route.', [...original, ...repeated]);
        return checkpoint;
      }
    }
  }
  if (!issue && pricing) {
    const page = await inspect(web, pricing.url, signal, 'Independent published price recheck', offerScope(pricing.url));
    const initial = checkpoint.evidence.filter(item => pricing.evidence.includes(item.id));
    const repeated = page.url === pricing.url && page.state === 'READABLE' && page.links.some(link =>
      link.main && link.url === pricing.booking && booking.test(link.label)) && monthlyPriceMismatch(page);
    if (initial.length === 2 && repeated && repeated.currency === pricing.currency && repeated.amounts.every((amount, index) => amount === pricing.amounts[index])) {
      const [lower, upper] = pricing.amounts.map(value => new Intl.NumberFormat('en', { style: 'currency', currency: pricing.currency, maximumFractionDigits: 0 }).format(value));
      add(checkpoint, 'opportunity', 'VERIFIED', `The same coaching page publishes two starting monthly prices, ${lower} and ${upper}, alongside a consultation route. Both prices reproduced. Reconcile the starting price before prospects book.`, [...initial, page.evidence, ...repeated.evidence]);
      return checkpoint;
    }
  }
  if (!issue && !mismatch && !inquiry && !section && mobile && browserEnabled) {
    const first = checkpoint.evidence.find(item => item.id === mobile.evidence);
    const budget = AbortSignal.any([signal, AbortSignal.timeout(16_000)]);
    const browser = createFunnelBrowser((url, requestSignal) => web.asset(url, requestSignal, mobile.from), budget, { inspectBookingDialogs: true });
    try {
      const rendered = await browser.render(mobile.from, job.id);
      const depth = rendered.url === mobile.from && !parseBusinessPage(rendered.html, rendered.url).challenged && mobileBookingDisparity(rendered, mobile.destination);
      if (first && depth) {
        const confirmation = observe('browser', rendered.url, depth, 'Independent mobile placement recheck', Buffer.from(rendered.html));
        add(checkpoint, 'opportunity', 'VERIFIED', 'The booking link appears in the first desktop viewport. The first visible mobile booking link begins at least three screens down. The difference reproduced. Surface the booking action earlier in the mobile journey.', [first, confirmation]);
        return checkpoint;
      }
    } catch { /* Keep the observation as a hypothesis without an independent render. */ }
    finally { await browser.close(); }
    add(checkpoint, 'opportunity', 'UNVERIFIED', 'The mobile booking placement could not be independently reproduced.', first ? [first] : []);
    return checkpoint;
  }
  if (!issue && !mismatch && !inquiry && section && browserEnabled) {
    const first = checkpoint.evidence.find(item => item.id === section.evidence);
    const budget = AbortSignal.any([signal, AbortSignal.timeout(16_000)]);
    const browser = createFunnelBrowser((url, requestSignal) => web.asset(url, requestSignal, section.url), budget, { inspectBookingDialogs: true });
    try {
      const rendered = await browser.render(section.url, job.id);
      const observed = parseBusinessPage(rendered.html, rendered.url);
      if (first && rendered.url === section.url && !observed.challenged && !observed.links.some(link => booking.test(link.label)) &&
          !rendered.bookingDialogs?.length && rendered.missingBookingSections?.length === 2 &&
          rendered.missingBookingSections.every(item => item.fragment === section.fragment && item.label === section.label)) {
        const confirmation = observe('browser', rendered.url, `The in-page booking link still points to the absent ${section.fragment} section on both viewports.`, 'Independent missing-section recheck');
        add(checkpoint, 'opportunity', 'VERIFIED', 'The booking call to action points to a missing section on desktop and mobile. Both viewports reproduced the dead end. Restore the section or link directly to a working scheduler.', [first, confirmation]);
        return checkpoint;
      }
    } catch { /* Keep the observation as a hypothesis without an independent render. */ }
    finally { await browser.close(); }
    add(checkpoint, 'opportunity', 'UNVERIFIED', 'The in-page booking issue did not reproduce independently.', first ? [first] : []);
    return checkpoint;
  }
  if (!issue && !mismatch && inquiry) {
    const offer = await inspect(web, inquiry.from, signal, 'Independent booking CTA recheck', offerScope(inquiry.from));
    const link = offer.links.find(item => item.main && item.url === inquiry.url && item.label === inquiry.label);
    const stored = checkpoint.evidence.filter(item => inquiry.evidence.includes(item.id));
    if (link && stored.length === (inquiry.kind === 'embedded' ? 3 : 2)) {
      const destination = await inspect(web, inquiry.url, signal, 'Independent message-form recheck', url => domain(url.href) === domain(inquiry.url));
      addJourney(checkpoint, offer.url, destination, link.label);
      const widget = inquiry.widget && destination.embeddedInquiry === inquiry.widget ?
        await inspect(web, inquiry.widget, signal, 'Independent embedded form recheck', url => url.href === inquiry.widget) : undefined;
      const repeated = destination.url === inquiry.destination && bookingToInquiry(offer, link, destination, widget);
      if (repeated && repeated.kind === (inquiry.kind ?? 'message')) {
        const proof = [...stored, ...repeated.evidence];
        if (browserEnabled && repeated.kind !== 'fee') {
          const budget = AbortSignal.any([signal, AbortSignal.timeout(23_000)]);
          const renderUrl = repeated.kind === 'embedded' ? widget!.url : destination.url;
          const browser = createFunnelBrowser((url, requestSignal) => web.asset(url, requestSignal, renderUrl), budget,
            { inspectBookingDialogs: true, captureScreenshots: false });
          try {
            const rendered = await browser.render(renderUrl, job.id);
            const observed = parseBusinessPage(rendered.html, rendered.url);
            const confirmedPrompts = observed.consultationIntake?.filter(prompt => destination.consultationIntake?.includes(prompt)) ?? [];
            const sameForm = repeated.kind === 'message' ? observed.genericInquiry : repeated.kind === 'embedded' ? observed.hostedInquiry : confirmedPrompts.length >= 8;
            if (rendered.url === renderUrl && !observed.challenged && sameForm && !observed.scheduling && !rendered.bookingDialogs?.length) {
              const observation = repeated.kind === 'message' ? 'The rendered destination showed a general message form.' :
                repeated.kind === 'embedded' ? 'The rendered public widget collected a general inquiry. It showed no appointment-time selector.' :
                `The rendered destination showed ${confirmedPrompts.length} of the same required intake prompts before any choice of appointment time.`;
              proof.push(observe('browser', rendered.url, observation, 'Independent booking destination render', Buffer.from(rendered.html)));
            }
          } catch { /* Browser corroboration is required before making a dynamic-page claim. */ }
          finally { await browser.close(); }
        }
        const independentlyVerified = repeated.kind === 'fee' || proof.some(item => item.kind === 'browser') || !browserEnabled && repeated.kind === 'message';
        add(checkpoint, 'opportunity', independentlyVerified ? 'VERIFIED' : 'UNVERIFIED', independentlyVerified
          ? repeated.kind === 'fee' ? 'The offer advertises a complimentary call. Its linked destination lists a charge for an introductory call. Both descriptions reproduced. Align the advertised promise and booking terms.'
            : repeated.kind === 'intake' ? 'The call to action offers scheduling. The linked consultation form requires at least eight answers, including work and location details, before any time selection. The browser reproduced the route. Explain the intake and timing or move those questions after scheduling.'
            : repeated.kind === 'embedded' ? 'The coaching page offers booking a strategy call. Its destination embeds a general inquiry form with no visible appointment selection. Both steps reproduced. Offer a calendar or state that a reply is needed to reserve a time.'
            : 'The offer promises booking a call. Its linked contact page only collects a general message and offers no scheduling option. Both steps reproduced. Add a scheduling step or explain the inquiry and response process at the call to action.'
          : 'The static pages suggest a booking-to-intake mismatch. The destination could not be corroborated in a browser.', proof);
        return checkpoint;
      }
    }
    add(checkpoint, 'opportunity', 'UNVERIFIED', 'The booking-to-message mismatch did not reproduce.', [...stored, offer.evidence]);
    return checkpoint;
  }
  if (!issue && mismatch) {
    const offer = await inspect(web, mismatch.from, signal, 'Independent offer recheck', offerScope(mismatch.from));
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
  const offer = await inspect(web, issue.from, signal, 'Independent offer recheck', offerScope(issue.from));
  const stillLinked = offer.links.some(link => link.main && link.url === issue.url && booking.test(link.label));
  const alternate = hasAlternateRoute(offer, issue.url);
  if (!stillLinked || alternate) {
    add(checkpoint, 'opportunity', 'UNVERIFIED', 'The original CTA structure did not reproduce.', [original, offer.evidence]);
    return checkpoint;
  }
  const retry = await inspect(web, issue.url, signal, 'Independent direct booking GET', url => domain(url.href) === domain(issue.url));
  addJourney(checkpoint, offer.url, retry, issue.label);
  let confirmed = retry.url === original.url && (issue.soft ? retry.state === 'READABLE' && (retry.missingPage || retry.schedulerProblem) && !retry.scheduling && !retry.bookingControl
    : retry.state === `HTTP_${issue.status}`);
  const proof = [original, offer.evidence, retry.evidence];
  if (confirmed && issue.soft && !browserEnabled) confirmed = false;
  if (confirmed && issue.soft) {
    const budget = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
    const browser = createFunnelBrowser((url, requestSignal) => web.asset(url, requestSignal, retry.url), budget);
    try {
      const rendered = await browser.render(retry.url, job.id);
      const page = parseBusinessPage(rendered.html, rendered.url);
      confirmed = rendered.url === retry.url && !rendered.incompleteAssets && !page.challenged && Boolean(page.missingPage || page.schedulerProblem) && !page.scheduling && !page.bookingControl;
      proof.push(observe('browser', rendered.url, confirmed ? `Rendered destination reports ${page.schedulerProblem ?? 'page not found'}.`
        : 'The rendered destination did not corroborate the reported failure.', 'Independent destination render', Buffer.from(rendered.html)));
    } catch { confirmed = false; }
    finally { await browser.close(); }
  }
  add(checkpoint, 'opportunity', confirmed ? 'VERIFIED' : 'UNVERIFIED', confirmed
    ? `The direct booking CTA returned ${issue.soft ? 'an explicit unavailable-destination screen' : `HTTP ${issue.status}`} in two independent requests. Repair or replace the public booking link.`
    : 'The reported destination failure did not reproduce under independent verification.', proof);
  return checkpoint;
}
