import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverPublicationPointers, verifyPublications } from '../../src/lib/origin/auto-publishers';
import { createPublicWeb } from '../../src/lib/origin/public-web';
import { parseBusinessPage } from '../../src/lib/origin/research';

const item = 'https://journal.example/interview';
const site = 'https://cedar.example/';
const name = 'Cedar Leadership';
const license = 'https://creativecommons.org/licenses/by/4.0/';
const reportDate = new Date(Date.now() - 86_400_000).toISOString();
const node = { '@type': 'PodcastEpisode', url: item, datePublished: reportDate, headline: `Executive coaching interview with ${name}`,
  publisher: { '@type': 'Organization', url: 'https://journal.example/', name: 'Independent Journal' },
  actor: { '@type': 'Person', name, jobTitle: 'Executive coach', url: site } };
const head = `<link rel="license" href="${license}">`;
const article = (metadata: Record<string, unknown> = node, extra = head, body = '') => `<html><head>${extra}
  <script type="application/ld+json">${JSON.stringify(metadata)}</script></head><body><main>
  <h1>Executive coaching interview with ${name}</h1><a href="${site}">${name}</a>${body}</main></body></html>`;

function transport(html: string, terms = '', robots = 'User-agent: *\nAllow: /', headers: Record<string, string> = {}) {
  const requests: string[] = [];
  const web = createPublicWeb(async run => run(), async url => {
    requests.push(url);
    if (url.endsWith('/robots.txt')) return { url, status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from(robots) };
    return { url, status: 200, headers: { 'content-type': 'text/html', ...headers }, body: Buffer.from(url.endsWith('/terms') ? terms : html) };
  });
  return { web, requests };
}

test('an explicitly licensed attributable publication can independently discover a coaching business', async () => {
  const { web } = transport(article());
  const result = await verifyPublications(web, [{ url: item }], 120, AbortSignal.timeout(6_000));
  assert.deepEqual(result.audit.map(audit => audit.code), ['ADMITTED']);
  assert.equal(result.seeds[0].method, 'PUBLICATION');
  assert.equal(result.seeds[0].website, site);
  assert.equal(result.seeds[0].publisher, 'organization:independent journal');
  assert.equal(result.seeds[0].permission, license);
  assert.equal(result.seeds[0].occurredAt, reportDate);
  assert.match(result.seeds[0].publication?.digest ?? '', /^[a-f0-9]{64}$/);
});

test('a public fact citation retains no article title or text and needs no content reuse license', async () => {
  const variations = [article(node, ''), article(node, head.replace('/by/', '/by-nc/')), article(node, head.replace('creativecommons.org', 'example.org')),
    article(node, '', `<a rel="license" href="${license}">Photo license</a>`)];
  for (const html of variations) {
    const result = await verifyPublications(transport(html).web, [{ url: item }], 120, AbortSignal.timeout(6_000));
    assert.equal(result.audit[0].code, 'ADMITTED');
    assert.equal(result.seeds[0]?.permission, undefined);
    assert.equal(result.seeds[0]?.publication?.use, 'FACTS_ONLY');
    assert.equal(result.seeds[0]?.publication?.title, undefined);
    assert.doesNotMatch(result.seeds[0]?.excerpt ?? '', /Executive coaching interview/);
  }
});

test('site access policies take precedence over page-level licensing', async () => {
  const licensed = article(node, head, '<a href="/terms">Terms of use</a>');
  const denied = transport(licensed, 'You agree not to use automated means to extract data from our site.');
  assert.equal((await verifyPublications(denied.web, [{ url: item }], 120, AbortSignal.timeout(6_000))).audit[0].code, 'TERMS_RESTRICTED');
  assert.ok(denied.requests.some(url => url.endsWith('/terms')));
  const copyrighted = transport(licensed, 'All rights reserved. Reproduction of our photographs for commercial use is prohibited.');
  assert.equal((await verifyPublications(copyrighted.web, [{ url: item }], 120, AbortSignal.timeout(6_000))).audit[0].code, 'ADMITTED');
  const registrationOnly = transport(licensed, 'Accounts registered by “bots” or other automated methods are not permitted.');
  assert.equal((await verifyPublications(registrationOnly.web, [{ url: item }], 120, AbortSignal.timeout(6_000))).audit[0].code, 'ADMITTED');
  const accessAlso = transport(licensed, 'Accounts registered by bots are not permitted. Automated access is forbidden.');
  assert.equal((await verifyPublications(accessAlso.web, [{ url: item }], 120, AbortSignal.timeout(6_000))).audit[0].code, 'TERMS_RESTRICTED');
  const robots = transport(article(), '', 'User-agent: *\nDisallow: /interview');
  assert.equal((await verifyPublications(robots.web, [{ url: item }], 120, AbortSignal.timeout(6_000))).audit[0].code, 'ROBOTS_DISALLOWED');
  assert.equal(robots.requests.length, 1);
  const nofollow = transport(article(node, `${head}<meta name="robots" content="nofollow">`));
  assert.equal((await verifyPublications(nofollow.web, [{ url: item }], 120, AbortSignal.timeout(6_000))).audit[0].code, 'RESTRICTED');
});

test('outdated, syndicated and uncorroborated publisher records cannot establish acquisition', async () => {
  const cases = [[article({ ...node, datePublished: '2000-01-01' }), 'ACTIVITY_UNVERIFIED'],
    [article(node, `${head}<link rel="canonical" href="https://another-journal.example/source">`), 'SYNDICATED'],
    [article({ ...node, publisher: { ...node.publisher, url: 'https://another-journal.example/' } }), 'PUBLISHER_UNVERIFIED'],
    [article({ ...node, actor: null }), 'OFFICIAL_LINK_UNVERIFIED']];
  for (const [html, reason] of cases) {
    const result = await verifyPublications(transport(html).web, [{ url: item }], 120, AbortSignal.timeout(6_000));
    assert.equal(result.audit[0].code, reason);
    assert.deepEqual(result.seeds, []);
  }
});

test('an open index emits pointers and keeps arbitrary API requests out of the transport', async () => {
  const reads: string[] = [];
  const web = createPublicWeb(async run => run(), async url => {
    reads.push(url);
    return { url, status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ articles: [
      { url: item }, { url: 'https://www.linkedin.com/in/person' }, { url: 'http://127.0.0.1/private' }, { url: `${item}.pdf` },
    ] })) };
  });
  const signal = AbortSignal.timeout(6_000);
  assert.deepEqual(await discoverPublicationPointers(web, 'executive coach', signal), [{ url: item }]);
  await assert.rejects(web.api('https://api.gdeltproject.org/api/other', 'api.gdeltproject.org', signal), { code: 'UNVERIFIED_SOURCE' });
  await assert.rejects(web.api('https://journal.example/search', 'journal.example', signal), { code: 'UNVERIFIED_SOURCE' });
  assert.equal(reads.length, 1);
});

test('a matching official coaching service can explicitly declare a market in structured markup', () => {
  const service = { '@type': 'Service', serviceType: 'Leadership coaching', url: site,
    areaServed: [{ '@type': 'Country', name: 'Canada' }, { '@type': 'City', name: 'London' }, 'CA'] };
  const read = (record: object) => parseBusinessPage(`<script type="application/ld+json">${JSON.stringify(record)}</script>`, site).markets;
  assert.deepEqual(read(service), [{ country: 'CA', evidence: 'Service.areaServed: Canada · Leadership coaching' }]);
  assert.deepEqual(read({ ...service, provider: { url: 'https://others.example/' } }), []);
  assert.deepEqual(read({ ...service, '@type': 'Organization', addressCountry: 'US', areaServed: undefined }), []);
});
