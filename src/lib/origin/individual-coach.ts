import type { CheerioAPI } from 'cheerio';

type Claim = { name: string; text: string; provider: boolean; self?: boolean };
export type CoachPage = { url: string; coachClaims?: Claim[]; coachDelivery?: string; teamDelivery?: string };

const coachRole = /\b(?:executive|leadership|business|CEO|founder|professional development)\s+(?:and mentoring\s+)?coach\b|\bcoach for (?:[\w-]+ ){0,2}(?:executives|leaders|founders|business owners)\b/i;
const coachingService = /\b(?:executive|leadership|business|CEO|founder) coaching\b|\bcoaching for (?:executives|leaders|founders|business owners)\b/i;
export const directCoaching = /\b(?:I\s+(?:coach|(?:offer|provide|deliver) (?:executive |leadership |business )?coaching|work (?:one[- ]on[- ]one |1:1 )?with)|my (?:(?:online|executive|leadership|business|private|1:1) ){0,2}coaching|hire me (?:for|to provide) (?:executive |leadership |business )?coaching)\b/i;
const teamDelivery = /\b(?:our (?:team|network|roster|bench) of (?:[\w-]+ ){0,4}coaches|(?:meet|explore|choose from) (?:our|the) (?:[\w-]+ ){0,3}coaches|(?:meet )?our coaching team|one of our (?:[\w-]+ ){0,4}coaches|coaches (?:from|in|on) our (?:network|team|roster)|(?:every|each) coach (?:in|on) our (?:network|team|roster)|(?:we['’]ll|we will|we) match you (?:with|to) (?:an? |one of our )?(?:[\w-]+ ){0,4}coach(?:es)?|our (?:[\w-]+ ){0,3}coaches (?:are|work|provide|offer|deliver|help)|(?:a|the) (?:team|network|directory) of (?:[\w-]+ ){0,4}coaches|(?:browse|compare|find and book) (?:[\w-]+ ){0,4}coaches)\b/i;
const roleWords = /^(?:the|our|your)\b|\b(?:coach(?:es|ing)?|executive|leadership|business|services|company|collective|solutions|team|about|meet|work|founder|hello|welcome|mentoring|consulting|program(?:me)?|partners|strategy|management|designer|entrepreneur|Canadian|British|American)\b/i;
const nameWord = String.raw`\p{Lu}[\p{L}\p{M}.'’\-]{1,29}`;
const namePart = String.raw`(?:${nameWord}|\p{Lu}\.|(?:de|del|da|dos|van|von|la|le))`;
const namePattern = String.raw`(${nameWord}(?:\s+${namePart}){1,5})`;
const selfName = new RegExp(String.raw`^(?:[Hh](?:i|ello)[!, .–—-]*\s*)?(?:I(?:['’]m| am)|[Mm]y name is)\s+(?:Dr\.?\s+)?${namePattern}(?=\s*[,!?.:–—]|\s+and\b|$)`, 'u');
const bioName = new RegExp(String.raw`^(?:Dr\.?\s+)?${namePattern}\s+(?:is|works as|speciali[sz]es as)\s+`, 'u');
const namedHeading = new RegExp(String.raw`^(?:(?:[Aa]bout|[Mm]eet|[Cc]ontact)\s+)?(?:Dr\.?\s+)?${namePattern}(?=\s*[,|:–—]|$)`, 'u');
const withNamePrefix = /^(?:.*\bcoaching with|work with)\s+/i;

const compact = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function matchesPersonalDomain(url: string, name: string) {
  const host = compact(new URL(url).hostname.replace(/^www\./, '').split('.')[0]);
  const personal = compact(name);
  return host === personal || /^(?:(?:executive|business|leadership)?coach(?:ing)?|consulting)$/.test(host.slice(personal.length)) && host.startsWith(personal);
}

function plausibleName(value: unknown) {
  if (typeof value !== 'string') return;
  const name = value.trim().replace(/^(?:Dr\.?|Mr\.?|Ms\.?|Mrs\.?)\s+/i, '').split(/[,|]/, 1)[0].trim().replace(/\.+$/, '');
  if (roleWords.test(name) || !new RegExp(`^${namePattern}$`, 'u').test(name) || /\b(?:LLC|LLP|Ltd|Inc|PCC|MCC|ACC)\b/.test(name)) return;
  return name;
}

function ownUrl(value: unknown, page: URL) {
  if (typeof value !== 'string' || !value) return false;
  try { return new URL(value, page).hostname.replace(/^www\./, '') === page.hostname.replace(/^www\./, ''); }
  catch { return false; }
}

export function coachMetadata($: CheerioAPI, url: string) {
  type Node = Record<string, unknown>;
  const nodes = (value: unknown): Node[] => (Array.isArray(value) ? value : [value])
    .filter((item): item is Node => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
  const type = (node: Node, label: string) => [node['@type']].flat().some(item =>
    typeof item === 'string' && item.replace(/^https?:\/\/schema\.org\//, '') === label);
  const page = new URL(url);
  const entries = $('script[type="application/ld+json"]').slice(0, 10).toArray().flatMap(node => {
    try {
      const data = $(node).text();
      return data.length <= 60_000 ? nodes(JSON.parse(data)).flatMap(item => [item, ...nodes(item['@graph'])]).slice(0, 40) : [];
    } catch { return []; }
  });
  const claims: Claim[] = [];
  for (const item of entries) {
    const name = plausibleName(item.name);
    if (type(item, 'Person') && name && coachRole.test(String(item.jobTitle ?? '')) && ownUrl(item.url ?? item['@id'], page)) {
      claims.push({ name, text: `${name} · ${String(item.jobTitle).slice(0, 100)} (official Person metadata)`, provider: false });
    }
    const service = String(item.serviceType ?? item.name ?? '').slice(0, 100);
    if (!type(item, 'Service') || !coachingService.test(service)) continue;
    for (const reference of nodes(item.provider)) {
      const provider = entries.find(node => typeof reference['@id'] === 'string' && node['@id'] === reference['@id']) ?? reference;
      const person = plausibleName(provider.name);
      const providerUrl = provider.url ?? provider['@id'];
      if (person && type(provider, 'Person') && (!providerUrl || ownUrl(providerUrl, page))) {
        claims.push({ name: person, text: `${person} · ${service} (official coaching service provider metadata)`, provider: true });
      }
    }
  }
  return claims;
}

export function pageCoachIdentity(url: string, title: string, headings: string[], paragraphs: string[], brand: string | undefined, metadata: Claim[]) {
  const claims = [...metadata];
  const ownParagraphs = paragraphs.filter(text => !/^["“‘']/.test(text));
  const firstPersonRole = ownParagraphs.find(text => coachRole.test(text.slice(0, 144)) &&
    /^(?:I(?:['’]m| am)\b|As (?:an? |your )[^.!?]{0,90},\s*I\b)/i.test(text));
  const coachDelivery = ownParagraphs.find(text => directCoaching.test(text)) ?? firstPersonRole;
  for (const text of [...headings.slice(0, 10), ...ownParagraphs.slice(0, 85)]) {
    if (/\b(?:guest|client spotlight|interview|contributor|podcast host|written by)\b/i.test(text.slice(0, 90))) continue;
    const self = plausibleName(text.match(selfName)?.[1]);
    if (self) claims.push({ name: self, text, provider: coachRole.test(text) || Boolean(coachDelivery), self: true });
    const bio = plausibleName(text.match(bioName)?.[1]);
    if (bio && coachRole.test(text.slice(0, 140))) claims.push({ name: bio, text, provider: false });
  }
  const visible = [...headings.slice(0, 12), ...ownParagraphs.slice(0, 24)];
  const personalNameLabel = (brand ?? '').replace(/\s+(?:(?:executive|leadership|business) )?coaching$/i, '');
  for (const text of [personalNameLabel, title, ...headings.slice(0, 8)]) {
    const segments = [text, ...text.split(/\s*[|–—]\s*/).slice(1)];
    for (const label of segments) {
      const proposed = label.replace(withNamePrefix, '');
      const restoredCase = proposed === proposed.toLowerCase() ? proposed.replace(/\b\p{L}/gu, letter => letter.toUpperCase()) : proposed;
      const name = plausibleName(restoredCase.match(namedHeading)?.[1]);
      if (!name) continue;
      const first = name.split(/\s+/)[0];
      const selfIntro = visible.some(line => {
        const intro = line.match(/^(?:[Hh](?:i|ello)[!, .–—-]*\s*)?(?:I(?:['’]m| am)|[Mm]y name is)\s+(\p{L}[\p{L}\p{M}'’-]*)/u)?.[1];
        return intro && compact(intro) === compact(first);
      });
      const explicit = coachingService.test(label) && withNamePrefix.test(label);
      const professionalTitle = coachRole.test(text) && (matchesPersonalDomain(url, name) || Boolean(coachDelivery));
      if (explicit || professionalTitle || matchesPersonalDomain(url, name) && (selfIntro || firstPersonRole)) {
        claims.push({ name, text, provider: true });
      }
    }
  }
  const team = [title, ...headings, ...ownParagraphs.slice(0, 120)].find(text => teamDelivery.test(text) &&
    (!/\b(?:previously|formerly|I used to|in my previous role)\b/i.test(text) || /\b(?:now|currently|today)\b/i.test(text)));
  return { coachClaims: claims, coachDelivery, teamDelivery: team };
}

export function singleCoach<T extends CoachPage>(pages: T[]) {
  const team = pages.find(page => page.teamDelivery);
  if (team) return { state: 'CONTRADICTED' as const, observations: [{ page: team, text: team.teamDelivery! }] };
  const names = new Map<string, { page: T; claim: Claim }>();
  for (const page of pages) {
    for (const claim of page.coachClaims ?? []) {
      const parts = claim.name.split(/\s+/);
      const key = compact(parts[0]) + ':' + compact(parts[parts.length - 1]);
      if (!names.has(key) || claim.provider && !names.get(key)?.claim.provider) names.set(key, { page, claim });
    }
  }
  if (names.size > 1) return { state: 'CONTRADICTED' as const,
    observations: [...names.values()].slice(0, 3).map(({ page, claim }) => ({ page, text: claim.text })) };
  const match = names.values().next().value;
  if (!match) return { state: 'UNVERIFIED' as const, observations: [] };
  const { page, claim } = match;
  const delivery = pages.find(item => item.coachDelivery);
  if (!claim.provider && !(claim.self && delivery) && !matchesPersonalDomain(page.url, claim.name)) {
    return { state: 'UNVERIFIED' as const, observations: [{ page, text: claim.text }] };
  }
  return { state: 'VERIFIED' as const, name: claim.name, observations: [{ page, text: claim.text },
    ...(delivery && delivery.coachDelivery !== claim.text ? [{ page: delivery, text: delivery.coachDelivery! }] : [])] };
}
