'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),admission=require('../../src/lib/diagnostic-admission.cjs'),fixture=require('./diagnostic-fixture.cjs');
test('only the exact verified obsolete rule is a compatibility finding, while its raw FAIL remains unchanged',()=>{
 const sites=fixture.sites(),before=structuredClone(sites),r=admission.assess(sites);assert.equal(r.verdict,'PASS');assert.equal(r.compatibility.length,1);assert.equal(r.compatibility[0].rawVerdict,'FAIL');assert.equal(sites.find(s=>s.kind==='incolumitas').verdict,'FAIL');assert.deepEqual(sites,before);
});
test('unverified source versions, extra failures and positive webdriver values cannot use the compatibility case',()=>{
 const mutations=[s=>delete s.external.sourceHashes,s=>{s.external.sourceHashes.fpScanner='0'.repeat(64);},s=>delete s.probe.webdriverPropertyPresent,s=>{s.probe.webdriver=true;},s=>{s.probe.webdriverPropertyPresent=false;},s=>{s.external.checks.overrideTest='FAIL';},s=>{s.external.checks['legacy.intoli.someOtherRule']='FAIL';},s=>{s.finalUrl='https://example.test/';}];
 for(const mutate of mutations){const sites=fixture.sites();mutate(sites.find(s=>s.kind==='incolumitas'));const r=admission.assess(sites);assert.equal(r.verdict,'FAIL');assert.equal(r.compatibility.length,0);}
});
test('a bot-field PASS cannot hide a positive modification warning, including a partial measurement',()=>{
 for(const partial of [false,true]){const sites=fixture.sites(),s=sites.find(s=>s.kind==='fingerprint');s.external.observations[0].value='Yes 🖥️🔧';if(partial){s.error='Optional read failed';s.verdict='UNKNOWN';}const r=admission.assess(sites);assert.equal(r.verdict,'FAIL');assert.equal(s.external.verdict,'PASS');assert.ok(r.checks.some(c=>c.name==='browser-modification'&&c.verdict==='FAIL'));}
});
test('missing required vendor findings stay unknown; positive direct findings always block',()=>{
 for(const kind of ['fingerprint','device','sannysoft']){const sites=fixture.sites();sites.find(s=>s.kind===kind).external={verdict:'UNKNOWN'};assert.equal(admission.assess(sites).verdict,'UNKNOWN');}
 const missing=fixture.sites().filter(s=>s.kind!=='device');assert.equal(admission.assess(missing).verdict,'UNKNOWN');
 for(const change of [{webdriver:true},{cdpDetected:true},{plugins:0}]){const sites=fixture.sites();Object.assign(sites[0].probe,change);assert.equal(admission.assess(sites).verdict,'FAIL');}
 const device=fixture.sites();device.find(s=>s.kind==='device').external.flags.isBot=true;assert.equal(admission.assess(device).verdict,'FAIL');
});
