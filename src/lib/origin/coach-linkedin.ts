import type { CheerioAPI } from 'cheerio';

const host = /^(?:www\.|[a-z]{2,3}\.)?linkedin\.com$/i;
const withoutAccents = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const words = (text: string) => withoutAccents(text).match(/[\p{L}\p{N}]+/gu) ?? [];

export function personalLinkedInUrl(value: unknown) {
  if (typeof value !== 'string' || !/^(?:https?:)?\/\//i.test(value.trim())) return;
  try {
    const url = new URL(value.trim(), 'https://www.linkedin.com');
    if (!host.test(url.hostname) || url.username || url.password || url.port) return;
    const path = decodeURIComponent(url.pathname).match(/^\/in\/([\p{L}\p{M}\p{N}_-]{2,120})\/?$/u);
    if (path) return `https://www.linkedin.com/in/${encodeURIComponent(path[1])}`;
  } catch { /* Ignore malformed or encoded non-profile URLs. */ }
}

export type LinkedInLink = { url: string; label?: string; owner?: string; self?: boolean; siteSocial?: boolean };
type LinkedInPage = { url: string; linkedInLinks?: LinkedInLink[] };

export function visibleLinkedInLinks($: CheerioAPI): LinkedInLink[] {
  return $('a[href*="linkedin.com" i]').slice(0, 60).toArray().flatMap(element => {
    const link = $(element);
    if (link.closest('blockquote,.testimonial,.review,[itemprop="review"]').length) return [];
    const url = personalLinkedInUrl(link.attr('href'));
    if (!url) return [];
    const label = [link.attr('aria-label'), link.attr('title'), link.text(), link.find('img[alt]').first().attr('alt')]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 180);
    const location = link.closest('footer,header,[aria-label*="social" i],[class*="social-links" i],[class*="social-icons" i]');
    const context = link.closest('p,li,figcaption').text().trim().slice(0, 200);
    if (/\b(?:site (?:design|by)|designed by|powered by|guest profile|client profile)\b/i.test(`${label} ${context}`)) return [];
    const self = (link.attr('rel') ?? '').split(/\s+/).some(value => value.toLowerCase() === 'me') ||
      /\b(?:(?:connect with|follow|find) me on linked\s*in|my linked\s*in)\b/i.test(label);
    return [{ url, label, self, siteSocial: Boolean(location.length) && (!label || /\blinked\s*in\b/i.test(label)) }];
  });
}

function matchesName(value: string, name: string) {
  const full = words(name);
  const parts = words(value);
  if (full.length < 2) return false;
  const first = full[0];
  const last = full[full.length - 1];
  return parts.some((part, index) => part === first && (parts[index + 1] === last ||
    parts[index + 1]?.length === 1 && parts[index + 2] === last)) ||
    ` ${parts.join(' ')} `.includes(` ${full.join(' ')} `);
}

function matchesSlug(url: string, name: string) {
  const slug = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  const tightName = words(name).join('');
  const tightSlug = words(slug).join('').replace(/\d+$/, '');
  const roleSuffix = /^(?:(?:executive|leadership|business)?coach(?:ing)?)?$/;
  return matchesName(slug, name) || Boolean(tightName && tightSlug.startsWith(tightName) && roleSuffix.test(tightSlug.slice(tightName.length)));
}

export function findCoachLinkedIn<T extends LinkedInPage>(pages: T[], name: string) {
  const links = pages.flatMap(page => (page.linkedInLinks ?? []).map(link => ({ page, link })));
  const people = new Set(links.filter(({ link }) => link.owner && !matchesName(link.owner, name)).map(({ link }) => link.url.toLowerCase()));
  const candidates = new Map<string, { page: T; url: string; score: number }>();
  for (const { page, link } of links) {
    const key = link.url.toLowerCase();
    if (people.has(key)) continue;
    const score = link.owner && matchesName(link.owner, name) ? 5 :
      link.label && matchesName(link.label, name) ? 4 : matchesSlug(link.url, name) ? 3 : link.self ? 2 : link.siteSocial ? 1 : 0;
    if (score > (candidates.get(key)?.score ?? 0)) candidates.set(key, { page, url: link.url, score });
  }
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  if (!ranked[0] || ranked[1]?.score === ranked[0].score) return;
  return ranked[0];
}
