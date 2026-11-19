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
const date = () => new Date(Date.now() - 7 * 86_400_000).toUTCString();
const page = (title: string, body: string) => `<html><head><title>${title}</title></head><body><main>${body}</main></body></html>`;

export function endToEndFixture() {
  const bookingReads = new Map<string, number>();
  const feeds = publisherHosts.map((host, i) => ({ title: `Fixture publisher ${i + 1}`, url: `https://${host}/feed`, permission: `https://${host}/terms` }));
  const expected = Object.fromEntries(cases.map(item => [site(item.slug), item.expected]));
  const web = createPublicWeb(async run => run(), async value => {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    const reply = (status: number, body: string, type = 'text/html') => ({ url: value, status, headers: { 'content-type': type }, body: Buffer.from(body) });
    if (url.pathname === '/robots.txt') return reply(200, 'User-agent: *\nAllow: /', 'text/plain');
    if (url.host === 'www.wikidata.org') return reply(200, JSON.stringify({ query: { search: [] } }), 'application/json');
    const publisher = publisherHosts.indexOf(host);
    if (publisher >= 0 && url.pathname === '/feed') {
      const entries = cases.filter(item => item.slug !== 'birch' || publisher === 0).map(item => `<item>
        <title>${item.name} on ${publisher ? 'exec coaching and succession' : 'executive coaching and onboarding'}</title><pubDate>${date()}</pubDate>
        <link>https://${host}/${item.slug}-appearance</link><description><![CDATA[<p>Executive coaching with
        <a rel="author" href="https://${publisher ? 'www.' : ''}${site(item.slug)}/">${item.name}</a></p>]]></description></item>`);
      return reply(200, `<rss version="2.0"><channel>${entries.join('')}</channel></rss>`, 'application/rss+xml');
    }
    const business = cases.find(item => site(item.slug) === host);
    if (!business) throw new Error('Fixture attempted a request outside its closed transport.');
    const { slug, name } = business;
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
      <p>${slug === 'oak' ? 'We exclusively serve clients in France.' : 'We serve leadership teams in the UK.'}</p>
      ${slug === 'maple' ? '<a href="/about">About us</a><a href="/case-study">Case study</a>' : '<p>Our business was founded in 2012.</p><p>Coaching engagement pricing is $5,000.</p>'}
      <a href="/booking">Book a call</a><form aria-label="Newsletter"><p>Subscribe to our newsletter</p></form>
      <p>Vendor inquiries are welcome at <a href="mailto:vendors@${host}">vendors@${host}</a>.</p>`));
  });
  return { web, feeds, expected, suppressedDomain: site('fir') };
}
