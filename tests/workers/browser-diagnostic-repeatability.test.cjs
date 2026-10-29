'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{assess}=require('../../src/lib/browser-diagnostic-repeatability.cjs'),fixture=require('./diagnostic-fixture.cjs'),signals=require('../../src/lib/stealth-self-test.cjs');
function study(id,newProfile=true){return {profileId:id,newProfile,accountsUnchanged:true,rosterRestored:true,cleanup:[{closed:true}],runs:[1,2].map(iteration=>{const sites=fixture.sites();Object.assign(sites[0].probe,{platform:'Win32',timezone:'America/New_York',locale:'en-US',screen:{width:1920,height:1080}});return {iteration,browserVersion:'Chrome/155',providerConfiguration:{readbackMode:'native',providerPatchVersion:'fixture'},clocks:signals.BATTERY.map(s=>({kind:s.kind,verdict:'PASS'})),result:{version:signals.VERSION,verdict:'PASS',sites}};})};}
test('repeatability needs distinct fresh profiles and every declared restart, retaining raw legacy failures',()=>{
 const inputs=[study('saved',false),study('new-a'),study('new-b')],before=JSON.stringify(inputs),r=assess(inputs);
 assert.equal(r.verdict,'PASS');assert.equal(r.coverage.observedLaunches,6);assert.equal(r.observations.length,6);assert.ok(r.observations.every(o=>o.rawCounts.FAIL===1));assert.equal(JSON.stringify(inputs),before);assert.equal(JSON.stringify(r).includes('new-a'),false,'public summary does not disclose provider identifiers');
 assert.equal(assess(inputs.slice(0,2)).verdict,'UNKNOWN');const duplicate=[inputs[0],inputs[1],inputs[1]];assert.equal(assess(duplicate).verdict,'UNKNOWN');inputs[2].runs.pop();assert.equal(assess(inputs).verdict,'UNKNOWN');
});
test('a later clean restart cannot hide an earlier automation failure even under a forged top-level PASS',()=>{
 const inputs=[study('saved',false),study('new-a'),study('new-b')],device=inputs[0].runs[0].result.sites.find(s=>s.kind==='device');device.external.flags.isAutomatedWithCDP=true;
 const r=assess(inputs);assert.equal(r.verdict,'FAIL');assert.deepEqual(r.observations[0].automationFlags,['isAutomatedWithCDP']);assert.deepEqual(r.observations[1].automationFlags,[]);
});
test('bot Not detected and browser modification stay separate, and modification remains blocking under the unchanged policy',()=>{
 const inputs=[study('saved',false),study('new-a'),study('new-b')];inputs[1].runs[0].result.sites.find(s=>s.kind==='fingerprint').external.observations[0].value='Yes 🖥️🔧';
 const r=assess(inputs);assert.equal(r.verdict,'FAIL');assert.equal(r.observations[2].bot,'Not detected');assert.equal(r.observations[2].modification,'Yes 🖥️🔧');assert.equal(r.observations[3].modification,'Not detected');
});
test('missing endpoint, obsolete result, cleanup uncertainty and identity drift cannot certify repeatability',()=>{
 for(const change of [s=>s.runs[0].result.sites.pop(),s=>s.runs[0].result.version='old',s=>s.cleanup=[],s=>s.rosterRestored=false,s=>s.runs[0].clocks.pop(),s=>s.runs[0].clocks=null,s=>s.runs[0].providerConfiguration=null,s=>delete s.runs[0].result.sites[0].probe.locale]){const inputs=[study('saved',false),study('new-a'),study('new-b')];change(inputs[1]);assert.equal(assess(inputs).verdict,'UNKNOWN');}
 const inputs=[study('saved',false),study('new-a'),study('new-b')];inputs[1].runs[1].result.sites[0].probe.webglRenderer='Changed GPU';assert.equal(assess(inputs).verdict,'FAIL');
 inputs[0].runs[0].clocks[0].verdict='FAIL';assert.ok(assess(inputs).findings.some(f=>f.reason.includes('clock mismatch')));
});
test('the live CLI requires an explicit fresh-profile request and refuses arbitrary existing profile IDs',async()=>{
 const script=require('../../scripts/engine-profile-reliability.cjs');
 for(const args of [[],['--run'],['--fresh'],['--run','--profile','some-existing-profile'],['--run','--fresh','--ignore-failures']])await assert.rejects(script.main(args),/Use --run --fresh/);
 assert.deepEqual(script.parseArgs(['--run','--fresh']),{fresh:true});
 assert.deepEqual(script.parseArgs(['--assess','one.json','two.json','three.json']),{assess:['one.json','two.json','three.json']});
});
test('temporary-profile cleanup cannot delete pre-existing, open, newly mapped or unconfirmed profiles',async()=>{
 const {deleteTemporaryProfile}=require('../../scripts/engine-profile-reliability.cjs');let deleted=0;
 const fixture={profileId:'new-anonymous-profile',owned:true,api:{active:async()=>({active:false})},production:{query:async()=>({rowCount:0})},remove:async id=>{assert.equal(id,'new-anonymous-profile');deleted++;return true;}};
 assert.equal(await deleteTemporaryProfile({...fixture,owned:false,api:null,production:null}),false);
 await assert.rejects(deleteTemporaryProfile({...fixture,api:{active:async()=>({active:true})}}),/closure is unconfirmed/);
 await assert.rejects(deleteTemporaryProfile({...fixture,production:{query:async()=>({rowCount:1})}}),/mapped/);
 assert.equal(deleted,0);await assert.rejects(deleteTemporaryProfile({...fixture,remove:async()=>false}),/deletion unconfirmed/);
 assert.equal(await deleteTemporaryProfile(fixture),true);assert.equal(deleted,1);
});
