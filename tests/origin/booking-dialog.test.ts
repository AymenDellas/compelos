import assert from 'node:assert/strict';
import test from 'node:test';
import { createFunnelBrowser } from '../../src/lib/funnel-browser';

test('ORIGIN opens a declared booking dialog without dispatching any new request', { timeout: 30_000 }, async () => {
  const url = 'https://coach.test/';
  const reads: string[] = [];
  const html = `<main><h1>Executive coaching</h1>
    <button type="button" aria-controls="booking" onclick="document.getElementById('booking').showModal();fetch('/fixture-read').catch(()=>{});">Book a call</button>
    <dialog id="booking"><h2>Schedule a discovery call</h2><form action="/fixture-submission"><input type="email"></form></dialog>
  </main>`;
  const browser = createFunnelBrowser(async requested => {
    reads.push(requested);
    return { url: requested, status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(html) };
  }, AbortSignal.timeout(20_000), { inspectBookingDialogs: true });
  try {
    const result = await browser.render(url, 'fixture');
    assert.equal(result.bookingDialogs?.length, 2);
    assert.ok(result.bookingDialogs.every(dialog => dialog.label === 'Book a call' && dialog.heading === 'Schedule a discovery call' && dialog.hasForm));
    assert.equal(reads.filter(request => request.includes('fixture-')).length, 0);
  } finally {
    await browser.close();
  }
});

test('the browser distinguishes a missing booking anchor from an existing section', { timeout: 35_000 }, async () => {
  const url = 'https://coach.test/';
  let section = '';
  const browser = createFunnelBrowser(async requested => ({ url: requested, status: 200,
    headers: { 'content-type': 'text/html' }, body: Buffer.from(`<main><h1>Executive coaching</h1><a href="#booking">Book a call</a>${section}</main>`) }),
  AbortSignal.timeout(30_000), { inspectBookingDialogs: true });
  try {
    const broken = await browser.render(url, 'missing');
    assert.equal(broken.missingBookingSections?.length, 2);
    assert.ok(broken.missingBookingSections.every(item => item.fragment === '#booking'));
    section = '<section id="booking"><h2>Schedule a call</h2></section>';
    const corrected = await browser.render(url, 'present');
    assert.deepEqual(corrected.missingBookingSections, []);
  } finally {
    await browser.close();
  }
});

test('the renderer measures real booking-link placement across independent viewports', { timeout: 30_000 }, async () => {
  const url = 'https://coach.test/';
  const html = `<meta name="viewport" content="width=device-width, initial-scale=1"><style>
    .intro { height: 100px; } @media (max-width: 600px) { .intro { height: 2800px; } }
    </style><main><div class="intro">Executive coaching</div><a href="/schedule">Book a call</a></main>`;
  const browser = createFunnelBrowser(async requested => ({ url: requested, status: 200,
    headers: { 'content-type': 'text/html' }, body: Buffer.from(html) }), AbortSignal.timeout(25_000), { inspectBookingDialogs: true });
  try {
    const result = await browser.render(url, 'layout');
    const desktop = result.bookingLayouts?.find(item => item.device === 'desktop');
    const mobile = result.bookingLayouts?.find(item => item.device === 'mobile');
    assert.ok(desktop && desktop.top < desktop.viewport);
    assert.ok(mobile && mobile.top > mobile.viewport * 3);
    assert.equal(desktop.url, mobile.url);
  } finally {
    await browser.close();
  }
});
