import type { Seed } from '../../src/lib/origin/policy';
import { emptyCheckpoint } from '../../src/lib/origin/policy';
import { createPublicWeb } from '../../src/lib/origin/public-web';
import type { Job } from '../../src/lib/origin/store';

export const official = 'https://cedar-leadership.test/';
export const company = 'Cedar Leadership';
export const book = `${official}booking`;
export const page = `<html><head><title>${company}</title></head><body><main>
  <h1>${company} executive coaching</h1><p>Our 1:1 coaching engagement is for leadership teams.</p>
  <p>We serve executive teams in the United Kingdom.</p><p>Our business was founded in 2012.</p>
  <p>Coaching engagement pricing is $5,000.</p><a href="/booking">Book a call</a>
  <p>Vendor inquiries are welcome at <a href="mailto:vendors@cedar-leadership.test">vendors@cedar-leadership.test</a>.</p>
  </main></body></html>`;

export function source(host: string, topic: string, name = company): Seed {
  return { name, website: official, method: 'ECHO', source: `https://${host}/episode`, sourceKey: `${host}:${topic}`,
    excerpt: `${name} appeared in a coaching session about ${topic}.`, occurredAt: new Date(Date.now() - 86_400_000).toISOString() };
}
export const seed = source('publisher-one.test', 'executive onboarding');
export function candidate(seeds = [seed, source('publisher-two.test', 'leading through change')]): Job {
  return { id: 'fixture', business_id: 'fixture-business', website: official, domain: new URL(official).hostname,
    name: company, seeds, attempts: 0, stage: 'RESOLVING', checkpoint: emptyCheckpoint(), signature: undefined };
}

export function fixture(home = page, booking: (count: number) => { status: number; body: string } = () => ({ status: 404, body: '<title>Page not found</title>' })) {
  const read: string[] = [];
  let checked = 0;
  const web = createPublicWeb(async run => run(), async url => {
    read.push(url);
    if (new URL(url).pathname === '/robots.txt') return { url, status: 404, headers: { 'content-type': 'text/plain' }, body: Buffer.alloc(0) };
    const response = url === book ? booking(++checked) : { status: 200, body: home };
    return { url, status: response.status, headers: { 'content-type': 'text/html' }, body: Buffer.from(response.body) };
  });
  return { web, read };
}
