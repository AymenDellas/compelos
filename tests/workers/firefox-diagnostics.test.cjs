'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const raw=require('../../src/lib/stealth-self-test.cjs'),admission=require('../../src/lib/diagnostic-admission.cjs'),family=require('../../src/lib/diagnostic-admission-firefox.cjs');
const readback=require('../../src/lib/browser-profile-readback.cjs'),policy=require('../../src/lib/account-session-policy.cjs');
const ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:156.0) Gecko/20100101 Firefox/156.0';
function sites(){return require('./diagnostic-fixture.cjs').sites().map(site=>{
 const probe={...site.probe,userAgent:ua,chrome:'undefined'};let external=site.external,tls=site.tls;
 if(site.kind==='incolumitas')external={verdict:'UNKNOWN'};
 if(site.kind==='device')external={verdict:'PASS',flags:Object.fromEntries(family.DEVICE_FLAGS.map(k=>[k,false]))};
 if(site.kind==='sannysoft')external={verdict:'FAIL',source:'Completed primary and scanner tables',cells:family.SANNY_CELLS.map(id=>({id,failed:id==='chrome-result',value:id==='chrome-result'?'missing (failed)':id==='user-agent-result'?ua:'passed'}))};
 if(tls){tls={...tls,user_agent:ua};probe.cdpDetected=null;}
 const entry={...site,probe,external,tls};return {...entry,...(tls?raw.assessTLS(tls,probe):raw.assessSite(entry))};
});}
const assess=s=>admission.assess(s,{engine:'aliasmode-firefox'});
test('Firefox compatibility retains every raw failure and leaves unsupported required results UNKNOWN',()=>{
 const data=sites(),before=structuredClone(data),result=assess(data);assert.equal(result.version,family.VERSION);assert.equal(result.verdict,'UNKNOWN');assert.equal(result.checks.filter(c=>c.verdict==='UNKNOWN').length,1);assert.equal(result.checks.find(c=>c.verdict==='UNKNOWN').name,'static-checklist');assert.equal(result.compatibility.length,8);assert.equal(admission.assess(data).verdict,'FAIL');assert.deepEqual(data,before);assert.equal(data.filter(s=>s.verdict==='FAIL').length,6);
});
test('Firefox compatibility never overrides positive signals, modification, extra scanner failures or bad TLS',()=>{
 const mutations=[s=>{s[0].probe.webdriver=true;},s=>{s[0].probe.cdpDetected=true;},s=>{s[0].checks.push({name:'other-detector',verdict:'FAIL'});},s=>{s.find(v=>v.kind==='device').external.flags.isBot=true;},s=>{s.find(v=>v.kind==='device').external.flags.isAutomatedWithCDPInWebWorker=true;},s=>{s.find(v=>v.kind==='fingerprint').external.observations[0].value='Yes';},s=>{s.find(v=>v.kind==='sannysoft').external.cells[1].failed=true;},s=>{s.find(v=>v.kind==='sannysoft').external.flags={isBot:true};},s=>{s.find(v=>v.kind==='tls').tls.user_agent='different';},s=>{s[0].probe.chrome='object';}];
 for(const change of mutations){const data=sites();change(data);assert.equal(assess(data).verdict,'FAIL');}
});
test('missing flags, failed navigation, redirects and incomplete supported results remain UNKNOWN',()=>{
 for(const change of [s=>{delete s.find(v=>v.kind==='device').external.flags.hasBotUserAgent;},s=>{s[0].finalUrl='https://example.com/';},s=>{s[0].status=503;},s=>{s[0].verdict='UNKNOWN';},s=>{s.find(v=>v.kind==='fingerprint').external={verdict:'UNKNOWN'};},s=>s.pop(),s=>s.push(structuredClone(s[0]))]){const data=sites();change(data);assert.equal(assess(data).verdict,'UNKNOWN');}
});
test('real TLS collection has no console challenge and still requires intact TLS and matching browser identity',()=>{
 const data=sites(),tls=data.find(s=>s.kind==='tls');assert.equal(tls.probe.cdpDetected,null);assert.equal(assess(data).checks.find(c=>c.name==='tls-coherence').verdict,'PASS');
 tls.probe.cdpDetected=true;assert.equal(assess(data).verdict,'FAIL');
});
function pixels(){return {canvas:'png-session-one',canvasPixels:Array(260*90*4).fill(123),webgl:Array(96*64*4).fill(80),audio:Array(1000).fill(.12),fonts:{Arial:12.3},hardware:{cores:4}};}
test('actual pixel identity ignores PNG session metadata but detects a single changed pixel',()=>{
 const value=pixels(),one=readback.summarize(value),two=readback.summarize({...value,canvas:'png-session-two'});assert.equal(one.combined,two.combined);assert.equal(one.canvas,two.canvas);assert.notEqual(one.canvasEncoding,two.canvasEncoding);const next=structuredClone(value);next.canvasPixels[999]=124;assert.notEqual(one.canvas,readback.summarize(next).canvas);
 for(const change of [v=>{v.webgl=[];},v=>{v.canvasPixels[1]=NaN;},v=>{v.audio.pop();}]){const invalid=pixels();change(invalid);assert.throws(()=>readback.summarize(invalid));}
});
test('Firefox fingerprint freezes actual rendering and requires the native controller evidence',()=>{
 const probe={userAgent:ua,platform:'Win32',timezone:'America/New_York',locale:'en-US',screen:{width:1920,height:1080},rendering:{version:readback.VERSION,canvas:'a'.repeat(64),webgl:'b'.repeat(64),audio:'c'.repeat(64),fonts:'d'.repeat(64)}},meta={engine:'aliasmode-firefox',identityMode:'aliasmode-firefox-profile',providerControlVersion:'ALIASMODE_FIREFOX_NATIVE_V1',browserVersion:'156.0.1-beta.36'};
 const before=policy.fingerprint(probe,meta);assert.notEqual(before.hash,policy.fingerprint({...probe,rendering:{...probe.rendering,canvas:'e'.repeat(64)}},meta).hash);assert.throws(()=>policy.fingerprint({...probe,rendering:null},meta));assert.throws(()=>policy.fingerprint(probe,{...meta,providerControlVersion:'old'}));assert.equal(before.fields.rendering.version,readback.VERSION);
});
