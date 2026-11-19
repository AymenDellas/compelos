import assert from 'node:assert/strict';
import test from 'node:test';
import { coachingContracts } from '../../src/lib/origin/procurement';
import { createPublicWeb } from '../../src/lib/origin/public-web';

test('the procurement adapter requires a scoped single-supplier award and an explicit website under OGL', async () => {
  const party = { id: 'seller', name: 'Cedar Coaching Ltd', roles: ['supplier'], contactPoint: { url: 'https://cedar.example/' } };
  const award = { status: 'active', title: 'Executive coaching', suppliers: [{ id: 'seller' }], value: { amount: 6000, currency: 'GBP' } };
  const notice = { id: 'published-notice', ocid: 'ocds-b5fd17-abcdef', date: new Date(Date.now() - 86_400_000).toISOString(),
    buyer: { name: 'Public Authority' }, tender: { title: 'Executive coaching' }, awards: [award], parties: [party] };
  let payload = { license: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', releases: [notice,
    { ...notice, id: 'joint', awards: [{ ...award, suppliers: [{ id: 'seller' }, { id: 'another' }] }] },
    { ...notice, id: 'unknown-website', parties: [{ ...party, contactPoint: { url: 'http://localhost/' } }] }] };
  const web = createPublicWeb(async run => run(), async url => ({ url, status: 200,
    headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(payload)) }));
  const signal = AbortSignal.timeout(6_000);
  const seeds = await coachingContracts(web, 'contracts', 0, 8, signal);
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].website, 'https://cedar.example/');
  assert.equal(seeds[0].contract?.amountGbp, 6000);
  assert.equal(seeds[0].occurredAt, undefined);
  payload = { ...payload, license: 'https://unverified.example/' };
  await assert.rejects(coachingContracts(web, 'contracts', 0, 8, signal), { code: 'OPEN_DATA_UNVERIFIED' });
});
