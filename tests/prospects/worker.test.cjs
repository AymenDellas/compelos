'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { research, NOW } = require('./fixtures.cjs');
const q = require('../../src/lib/prospect-qualification.cjs');
const worker = fs.readFileSync(require.resolve('../../worker.cjs'), 'utf8');
function load(name, next, context) {
    const start = worker.indexOf(`async function ${name}(`);
    const end = worker.indexOf(next, start);
    assert.ok(start >= 0 && end > start);
    return vm.runInNewContext(`${worker.slice(start, end)}; ${name}`, { dbWorker: null, failureOf:require('../../src/lib/worker-failure.cjs').failureOf, pipelineForAssessment: q.pipelineForAssessment, ...context, AbortSignal, process: { env: {} } });
}
test('the real enrichment function retains business fit but rejects qualification when no email is found', async () => {
    const r = research({ contacts: [], lastActivityAt: '2024-01-01T12:00:00.000Z' });
    let actualInput;
    const enrich = load('enrichAndFinalize', 'function isProcessRunning', {
        researchProspect: async input => { actualInput = input; return r; }, assessProspect: q.assessProspect,
        prioritizeEmails: emails => emails, hostOf: q.hostOf,
    });
    const result = await enrich({ url: r.linkedinUrl, activityStatus: 'Inactive', emails: [], logs: [] }, null);
    assert.equal(result.status, 'REJECTED'); assert.equal(result.primaryEmail, '');
    assert.equal(result.prospectQualification.tier, 'A');
    assert.equal(actualInput.url, r.linkedinUrl); assert.equal(result.prospectQualification.contact.channel, 'LINKEDIN_ONLY');
});
test('the real CRM persistence path sends evidence without generating opening lines or using sales outcomes', async () => {
    let payload, url; let hookCalls = 0;
    const persist = load('nativePostProcess', 'async function main(', {
        fetch: async (target, options) => { url = target; payload = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'saved', tier: 'B', assessment: q.assessProspect(research({ facts: { ...research().facts, paidOffer: q.emptyFact() } })) }) }; },
        generateHook: () => hookCalls++, sleep: async () => {}, writeDeadLetter: () => assert.fail('unexpected dead letter'),
    });
    const result = { url: research().linkedinUrl, firstName: 'TEST Ava', status: 'QUALIFIED', logs: [], primaryEmail: '', prospectQualification: q.assessProspect(research()) };
    await persist({ jobId: 'test' }, result, () => {});
    assert.ok(url.endsWith('/api/prospects/research-result')); assert.equal(payload.research.version, 1);
    assert.equal(hookCalls, 0); assert.equal(payload.hook, undefined); assert.equal(payload.outcome, undefined);
    assert.equal(result.crmSaved, true); assert.equal(result.status, 'REJECTED');
});
test('failed CRM saves retain complete business research for recovery instead of reporting success', async () => {
    let attempts = 0, recovery;
    const persist = load('nativePostProcess', 'async function main(', {
        fetch: async () => { attempts++; return { ok: false, status: 503 }; }, sleep: async () => {},
        writeDeadLetter: (_id, _url, payload) => { recovery = payload; },
    });
    const result = { url: research().linkedinUrl, status: 'QUALIFIED', logs: [], prospectQualification: q.assessProspect(research()) };
    await persist({ jobId: 'test' }, result, () => {});
    assert.equal(attempts, 3); assert.equal(result.crmSaved, false); assert.equal(recovery.research.version, 1);
});
