import test from 'node:test';
import assert from 'node:assert/strict';
import { activitySearchPointers, businessSearchQuery, businessSearchSeeds, campaignSearchQuery, createBusinessSearch } from '../../src/lib/origin/business-search';

test('business search rotates across markets and specialties and returns distinct discovery pointers', () => {
  assert.equal(new Set(Array.from({ length: 15 }, (_, index) => businessSearchQuery(index))).size, 15);
  const seeds = businessSearchSeeds([
    { title: 'Executive Coaching | North Star Partners', link: 'https://www.example.com/coaching' },
    { title: 'Executive Coaching | North Star Partners', link: 'https://example.com/executive-coaching' },
    { title: 'CEO Coaching | Another Company', link: 'https://www.linkedin.com/company/business' },
    { title: 'Top 30 Executive Coaching Providers', link: 'https://directory.example.com/list' },
    { title: 'Leadership Coaching | Third Company', link: 'http://127.0.0.1/admin' },
    { title: 'Business Coaching', link: 'https://example.net/' },
    { title: 'White Oak Advisory | CEO Mentoring', snippet: 'Executive coaching for founder transitions.', link: 'https://example.org/' },
  ], 10);
  assert.deepEqual(seeds.map(seed => seed.name), ['North Star Partners', 'White Oak Advisory']);
  assert.equal(seeds[0].sourceKey, 'business-search:example.com');
  assert.equal(seeds[0].website, 'https://www.example.com/coaching');
  assert.match(seeds[0].excerpt, /require first-party verification/);
  assert.equal(seeds.every(seed => !seed.occurredAt && !seed.publisher), true);
});

test('Serper capacity errors are deferred without spending another search credit', async (t) => {
  const previous = process.env.SERPER_API_KEY;
  t.after(() => { if (previous === undefined) delete process.env.SERPER_API_KEY; else process.env.SERPER_API_KEY = previous; });
  process.env.SERPER_API_KEY = 'fixture-key';
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status: 429 }));
  await assert.rejects(createBusinessSearch()!(0, 8, new AbortController().signal), { code: 'SEARCH_RETRY_DEFERRED' });
  assert.equal(fetch.mock.callCount(), 1);
});

test('publisher search keeps only public URLs for subsequent first-party source verification', () => {
  assert.deepEqual(activitySearchPointers([
    { title: 'Unverified date and speaker', link: 'https://journal.example/interview' },
    { title: 'Duplicate', link: 'https://journal.example/interview?utm_source=search' },
    { link: 'https://www.linkedin.com/posts/speaker' },
    { link: 'https://127.0.0.1/private' },
  ]), [{ url: 'https://journal.example/interview' }]);
});

test('syndicated podcast directories enter neither business-first nor campaign-first discovery', () => {
  const indexed = { title: 'Executive coaching podcast | Podscan', link: 'https://podscan.fm/podcasts/coaching-real-leaders' };
  assert.deepEqual(businessSearchSeeds([indexed], 8), []);
  assert.deepEqual(businessSearchSeeds([indexed], 8, true), []);
});

test('campaign searches look for active promotions with a buyer action in each eligible market', () => {
  for (const market of ['United States', 'United Kingdom', 'Canada']) {
    const queries = Array.from({ length: 12 }, (_, index) => campaignSearchQuery(index, 120)).filter(query => query.includes(`"${market}"`));
    assert.ok(queries.some(query => query.includes('"schedule a consultation"') && query.includes('workshop')));
    assert.ok(queries.some(query => query.includes('"reserve your spot"')));
  }
});

test('business search can require an intake action and a commercial reference in regional markets', () => {
  for (const [offset, city] of ['Chicago', 'London', 'Toronto'].entries()) {
    const query = businessSearchQuery(45 + offset);
    assert.match(query, /consultation/);
    assert.match(query, /client stories/);
    assert.ok(query.includes(city));
  }
  const coverage = { title: 'Terra Coaching expansion announcement', link: 'https://www.theglobeandmail.com/investing/markets/pressreleases/coaching/' };
  assert.deepEqual(businessSearchSeeds([coverage], 4, true), []);
  assert.deepEqual(activitySearchPointers([coverage]), [{ url: coverage.link }]);
});

test('search favors indexed offers with commercial clues and keeps cases as supporting pages', () => {
  const homepage = 'https://cedar.test/';
  const offerUrl = homepage + 'executive-coaching';
  const caseUrl = homepage + 'client-results';
  const found = businessSearchSeeds([
    { title: 'Executive coach | Cedar Leadership', link: homepage },
    { title: 'Executive coaching results | Cedar Leadership', link: caseUrl },
    { title: 'Executive coaching | Cedar Leadership', link: offerUrl,
      snippet: 'Our 6-month coaching program has client results. Book a discovery call.' },
  ], 10);
  assert.deepEqual(found.map(item => item.website), [offerUrl, homepage]);
  assert.deepEqual(found[1].commercialLinks, [caseUrl]);
  assert.ok(found.every(item => item.occurredAt === undefined));
  assert.deepEqual(businessSearchSeeds([{ title: 'Privacy Policy | Cedar Leadership',
    snippet: 'Executive coaching webinars', link: homepage + 'privacy-policy/' }], 10, true), []);
  assert.equal(new Set(Array.from({ length: 120 }, (_, index) => businessSearchQuery(index))).size, 120);
});
