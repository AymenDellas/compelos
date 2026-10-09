'use strict';
const assert = require('node:assert/strict'), { test } = require('node:test');
const { researchProspect, parsePage } = require('../../src/lib/prospect-research.cjs');
const input = { firstName: 'Lori', lastName: 'Brewer Collins, PCC', headline: 'Founder and CEO | Leadership Coach', profileIdentityConfirmed: true, lastActivityAt: new Date().toISOString(), websites: ['https://practice.test/'], linkedinUrl: 'https://www.linkedin.com/in/lori/' };
const intro = '<title>Brewer Collins Leadership</title><p>Lori Brewer Collins helps leaders through leadership coaching, workshops and consulting.</p>';
const graph = {
    '/': '<title>Leadership coaching</title><p>Our leadership coaching practice helps leaders communicate and grow with practical support.</p><a href="/notes">Notes</a><a href="/connect-with-us">Contact us</a><a href="/our-story">About us</a>',
    '/notes': intro + '<a href="/notes/one">One</a><a href="/notes/two">Two</a><a href="/notes/three">Three</a><a href="/notes/four">Four</a><a href="/">Home</a><a href="https://outside.test/contact">External</a><a href="/image.png">Image</a>',
    '/connect-with-us': intro + '<a href="mailto:hello@secondbrand.test">Email our practice</a>',
    '/our-story': intro + '<p>We provide coaching for leaders through transitions, communication challenges and team development.</p>',
    '/notes/one': intro, '/notes/two': intro, '/notes/three': intro, '/notes/four': intro,
};
test('the actual route graph is exhausted, contact/about routes are prioritized before blog pages, and description plus cross-brand contact are extracted', async () => {
    const calls = [];
    const r = await researchProspect(input, { ai: false, fetchPage: async url => { calls.push(url); assert.ok(graph[new URL(url).pathname], 'No guessed or external routes'); return { url, html: graph[new URL(url).pathname] }; } });
    assert.equal(calls.length, 8); assert.equal(new Set(calls).size, 8);
    assert.ok(calls.indexOf('https://practice.test/connect-with-us') < calls.indexOf('https://practice.test/notes'));
    assert.equal(r.crawl.complete, true); assert.equal(r.crawl.inspected, 8); assert.equal(r.crawl.contactPages, 1);
    assert.match(r.description.text, /coaching/); assert.equal(r.description.url, 'https://practice.test/our-story');
    assert.equal(r.contacts[0].address, 'hello@secondbrand.test'); assert.equal(r.contacts[0].ownership, 'PUBLISHED');
});
test('budget-limited crawling resumes only remaining actual routes and retains contact attribution and description', async () => {
    const calls = [];
    const fetchPage = async url => { calls.push(url); return { url, html: graph[new URL(url).pathname] }; };
    let r = await researchProspect(input, { ai: false, maxPages: 2, fetchPage });
    assert.equal(r.crawl.complete, false); assert.ok(r.crawl.pending.length);
    const first = [...calls];
    r = await researchProspect(input, { ai: false, previousResearch: r, fetchPage });
    assert.equal(r.crawl.complete, true); assert.equal(r.crawl.inspected, 8);
    assert.equal(calls.length, 8); assert.ok(first.every(url => calls.filter(value => value === url).length === 1));
    assert.match(r.description.text, /coaching/); assert.equal(r.contacts[0].address, 'hello@secondbrand.test');
});
test('blocked routes remain visibly incomplete and a resumed crawl retries them instead of treating failure as no email', async () => {
    let blocked = true;
    const fetchPage = async url => { if (blocked && url.endsWith('connect-with-us')) throw new Error('HTTP 503'); return { url, html: graph[new URL(url).pathname] }; };
    let r = await researchProspect(input, { ai: false, fetchPage });
    assert.equal(r.crawl.complete, false); assert.deepEqual(r.crawl.failed, ['https://practice.test/connect-with-us']);
    blocked = false; r = await researchProspect(input, { ai: false, fetchPage, previousResearch: r });
    assert.equal(r.crawl.complete, true); assert.equal(r.contacts[0].address, 'hello@secondbrand.test');
});
test('contacts survive late footers, encoded mailto, obfuscation, Cloudflare and structured data; placeholders and image filenames are excluded', () => {
    const key = 55, address = 'decoded@practice.test';
    const encoded = key.toString(16) + [...address].map(char => (char.charCodeAt(0)^key).toString(16).padStart(2,'0')).join('');
    const page = parsePage(`<script type="application/ld+json">{"email":"schema@practice.test"}</script><body><p>${'Content '.repeat(4000)}</p><footer>late@practice.test hidden [at] practice [dot] test example@email.com image@2x.png <a href="MAILTO:encoded%40practice.test">Email</a><span data-cfemail="${encoded}">Protected</span></footer></body>`, 'https://practice.test');
    assert.deepEqual(page.contacts.map(contact => contact.address).sort(), ['decoded@practice.test','encoded@practice.test','hidden@practice.test','late@practice.test','schema@practice.test']);
});
test('actual canonical aliases do not expand endlessly duplicated pagination routes',async()=>{
    const calls=[];
    const r=await researchProspect(input,{ai:false,fetchPage:async url=>{
        calls.push(url);
        return{url,html:intro+'<link rel="canonical" href="https://practice.test/"><a href="/page/2">Page 2</a>'+(url.endsWith('/page/2')?'<a href="/page/2/page/2">Duplicate pagination</a>':'')};
    }});
    assert.equal(calls.length,2);assert.equal(r.crawl.complete,true);assert.equal(r.crawl.inspected,1);
});
