import { createPublicWeb } from '../../src/lib/origin/public-web';
import type { Outcome } from '../../src/lib/origin/policy';

const publisherHosts = ['journal-leadership.test', 'forum-executives.test'];
const cases = [
  { slug: 'cedar', name: 'Cedar Leadership', expected: 'QUALIFIED' },
  { slug: 'maple', name: 'Maple Coaching', expected: 'QUALIFIED' },
  { slug: 'birch', name: 'Birch Leadership', expected: 'UNRESOLVED' },
  { slug: 'pine', name: 'Pine Leadership', expected: 'UNRESOLVED' },
  { slug: 'hemlock', name: 'Hemlock Coaching', expected: 'UNRESOLVED' },
  { slug: 'oak', name: 'Oak Leadership', expected: 'REJECTED' },
  { slug: 'fir', name: 'Fir Leadership', expected: 'REJECTED' },
] satisfies { slug: string; name: string; expected: Outcome }[];
const site = (slug: string) => `${slug}-leadership.test`;
const date = () => new Date(Date.now() - 7 * 86_400_000).toISOString();
const page = (title: string, body: string) => `<html><head><title>${title}</title></head><body><main>${body}</main></body></html>`;
const article = (host: string, slug: string) => `https://${host}/${slug}-interview`;

export function endToEndFixture() {
  const bookingReads = new Map<string, number>();
  const expected = Object.fromEntries(cases.map(item => [site(item.slug), item.expected]));
  const web = createPublicWeb(async run => run(), async value => {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    const reply = (status: number, body: string, type = 'text/html') => ({ url: value, status, headers: { 'content-type': type }, body: Buffer.from(body) });
    if (url.pathname === '/robots.txt') return reply(200, 'User-agent: *\nAllow: /', 'text/plain');
    if (url.host === 'api.gdeltproject.org') return reply(200, JSON.stringify({ articles: [{ url: article(publisherHosts[0], 'cedar') }] }), 'application/json');
    if (url.host === 'www.wikidata.org') {
      const others = cases.filter(item => item.slug !== 'cedar');
      const items = others.map((item, i) => ({ ...item, qid: `Q${i + 1}` }));
      const claim = (url: string) => ({ rank: 'normal', mainsnak: { datavalue: { value: url } } });
      const data = url.searchParams.get('action') === 'query' ? { query: { search: items.map(item => ({ title: item.qid })) } } : {
        entities: Object.fromEntries(items.map(item => [item.qid, { labels: { en: { value: item.name } }, claims: {
          P856: [claim(`https://${site(item.slug)}/`)], P973: item.slug === 'maple' ? [claim(article(publisherHosts[0], item.slug))] : [],
        } }])),
      };
      return reply(200, JSON.stringify(data), 'application/json');
    }
    const publisher = publisherHosts.indexOf(host);
    if (publisher >= 0) {
      const item = cases.find(item => url.pathname === `/${item.slug}-interview`);
      if (!item) return reply(404, '');
      const title = `Executive coaching interview with ${item.name} on ${publisher ? 'succession' : 'onboarding'}`;
      const website = `https://${site(item.slug)}/`;
      const blocked = item.slug === 'birch' && publisher === 1;
      const license = 'by/4.0';
      return reply(200, `<html><head><title>${title}</title><link rel="license" href="https://creativecommons.org/licenses/${license}/">
        <script type="application/ld+json">${JSON.stringify({ '@type': 'PodcastEpisode', url: value, headline: title, datePublished: date(),
          publisher: { '@type': 'Organization', url: `https://${host}/`, name: publisher ? 'Executive Forum' : 'Leadership Journal' },
          actor: { '@type': 'Person', name: item.name, url: website, jobTitle: 'Executive coach' },
        })}</script></head><body><main><h1>${title}</h1><a href="${website}">${item.name}</a>
        ${blocked ? '<p>Use of this website is for personal use only.</p>' : ''}</main></body></html>`);
    }
    const business = cases.find(item => site(item.slug) === host);
    if (!business) throw new Error('Fixture attempted a request outside its closed transport.');
    const { slug, name } = business;
    if (url.pathname === '/sitemap.xml') return slug === 'maple'
      ? reply(200, `<sitemapindex><sitemap><loc>https://${host}/page-sitemap.xml</loc></sitemap></sitemapindex>`, 'application/xml')
      : reply(404, '');
    if (slug === 'maple' && url.pathname === '/page-sitemap.xml') return reply(200,
      `<urlset><url><loc>https://ignored.example/appearances</loc></url><url><loc>https://${host}/archive/appearances</loc></url></urlset>`, 'application/xml');
    if (slug === 'maple' && url.pathname === '/archive/appearances') return reply(200, page('Appearances',
      `<article><h2>Executive coaching podcast</h2><a href="${article(publisherHosts[1], slug)}">Listen</a></article>
      <nav><a href="https://ignored.example/plugin-podcast/">Podcast plugin</a></nav>
      <p><a href="https://ignored.example/helpline/">Helpline</a></p>
      <p><a href="https://media.${host}/podcast/">Our podcast</a></p>`));
    if (url.pathname === '/booking') {
      const count = (bookingReads.get(slug) ?? 0) + 1;
      bookingReads.set(slug, count);
      if (slug === 'pine') return reply(403, page('Access denied', '<p>Verify you are human</p>'));
      if (slug === 'hemlock' && count > 1) return reply(200, page('Booking', '<p>Choose a time</p>'));
      return reply(404, page('Page not found', '<p>This destination is unavailable.</p>'));
    }
    if (url.pathname === '/about') return reply(200, page(name, `<h1>${name}</h1><p>Our business was founded in 2012.</p>`));
    if (url.pathname === '/case-study') return reply(200, page('Case study', '<h1>Case study: Tern Manufacturing</h1><p>Tern Manufacturing engaged us to deliver executive coaching for its directors.</p>'));
    const brand = slug === 'maple' ? 'The Boardroom Practice' : name;
    return reply(200, page(brand, `<h1>${brand} executive coaching</h1><p>Our 1:1 coaching engagement is for leadership teams.</p>
      ${slug === 'maple' ? `<script type="application/ld+json">${JSON.stringify({ '@type': 'Service', serviceType: 'Executive coaching', url: value,
        areaServed: { '@type': 'Country', name: 'Canada' } })}</script>` : `<p>${slug === 'oak' ? 'We exclusively serve clients in France.' : 'We serve leadership teams in the UK.'}</p>`}
      ${slug === 'maple' ? '<a href="/about">About us</a><a href="/case-study">Case study</a>' : '<p>Our business was founded in 2012.</p><p>Coaching engagement pricing is $5,000.</p>'}
      ${slug === 'maple' ? '' : publisherHosts.map(host => `<p><a href="${article(host, slug)}">Executive coaching interview</a></p>`).join('')}
      <a href="/booking">Book a call</a><form aria-label="Newsletter"><p>Subscribe to our newsletter</p></form>
      <p>Vendor inquiries are welcome at <a href="mailto:vendors@${host}">vendors@${host}</a>.</p>`));
  });
  return { web, expected, suppressedDomain: site('fir') };
}
