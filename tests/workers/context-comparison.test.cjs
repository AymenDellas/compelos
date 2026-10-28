'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {compareContexts}=require('../../scripts/engine-worker-target-comparison.cjs'),checks=require('../../src/lib/stealth-self-test.cjs');
const run=automated=>{const probe={origin:'https://fixture.test',webdriver:false,userAgent:'Chrome/155',platform:'Win32',chrome:'object',plugins:5,screen:{width:1920,height:1080},timezone:'UTC',locale:'en-GB',hardwareConcurrency:4,deviceMemory:8,webglVendor:'Fixture',webglRenderer:'Fixture renderer',cdpDetected:false};return {browserVersion:'Chrome/155',verdict:automated?'FAIL':'PASS',sites:Array.from({length:7},(_,i)=>({url:'https://fixture.test/'+i,kind:i===0?'device':'fixture',status:200,finalUrl:'https://fixture.test/'+i,verdict:automated&&i===0?'FAIL':'PASS',checks:checks.assessProbe(probe),probe:{...probe},external:i===0?{verdict:automated?'FAIL':'PASS',flags:{isAutomatedWithCDP:automated,isAutomatedWithCDPInWebWorker:automated,isBot:automated,hasWebdriverTrue:false,hasInconsistentTimingResolution:false}}:null}))};};
test('context comparison accepts only cleared measured signals with unchanged identity and a complete passing battery',()=>{
 assert.equal(compareContexts(run(true),run(false)).acceptance,true);
 for(const missing of ['isAutomatedWithCDP','isAutomatedWithCDPInWebWorker','isBot']){const after=run(false);delete after.sites[0].external.flags[missing];assert.equal(compareContexts(run(true),after).acceptance,false);}
 const detected=run(false);detected.sites[0].external.flags.isAutomatedWithCDP=true;assert.equal(compareContexts(run(true),detected).acceptance,false);
 const unknown=run(false);unknown.sites[0].external={verdict:'UNKNOWN'};assert.equal(compareContexts(run(true),unknown).acceptance,false);
 const otherFailure=run(false);otherFailure.sites[0].external.flags.hasInconsistentTimingResolution=true;assert.equal(compareContexts(run(true),otherFailure).acceptance,false);
 const drift=run(false);drift.sites[0].probe.userAgent='Different browser';assert.equal(compareContexts(run(true),drift).acceptance,false);
 const versionDrift=run(false);versionDrift.browserVersion='Chrome/156';assert.equal(compareContexts(run(true),versionDrift).acceptance,false);
 const missingBaseline=run(true);missingBaseline.sites.pop();assert.equal(compareContexts(missingBaseline,run(false)).acceptance,false);
 const partial=run(false);partial.sites.pop();assert.equal(compareContexts(run(true),partial).acceptance,false);
 const incomplete=run(false);incomplete.sites[2].verdict='UNKNOWN';assert.equal(compareContexts(run(true),incomplete).acceptance,false);
});
