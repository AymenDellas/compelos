'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),p=require('puppeteer'),checks=require('../../src/lib/stealth-self-test.cjs');
const current={puppeteerEvaluationScript:'OK',webdriverPresent:'OK',connectionRTT:'OK',refMatch:'OK',overrideTest:'OK',overflowTest:'OK',puppeteerExtraStealthUsed:'OK',inconsistentWebWorkerNavigatorPropery:'OK',inconsistentServiceWorkerNavigatorPropery:'OK'};
test('current Incolumitas schema completes without obsolete fields and retains literal legacy failure',async()=>{
 const b=await p.launch({headless:true});try{const page=await b.newPage(),html=(data,legacy)=>'<pre id="new-tests">'+JSON.stringify(data)+'</pre><pre id="detection-tests">'+JSON.stringify(legacy)+'</pre><p>Your Behavioral Score: ...</p>';
  await page.setContent(html(current,{intoli:{webDriver:'OK'},fpscanner:{WEBDRIVER:'FAIL'}}));const r=await page.evaluate(checks.siteResult,'incolumitas');
  assert.equal(r.source,'#new-tests and #detection-tests');assert.equal(r.verdict,'FAIL');assert.equal(Object.keys(r.checks).length,11);assert.equal(r.checks['legacy.fpscanner.WEBDRIVER'],'FAIL');assert.equal(r.legacyChecks['fpscanner.WEBDRIVER'],'FAIL');assert.equal(r.observations.find(o=>o.name==='Legacy fpscanner.WEBDRIVER').value,'FAIL');assert.equal(r.observations.find(o=>o.name==='Behavioral score').value,'Unavailable');assert.match(r.scope,/behavioral score is recorded separately/i);
  const probe={webdriver:false,userAgent:'Chrome/155',chrome:'object',plugins:5,webglVendor:'Fixture',webglRenderer:'Fixture',cdpDetected:false};assert.equal(checks.assessSite({url:checks.URLS[1],status:200,probe,external:r}).verdict,'FAIL','literal legacy failure must reach the unchanged site assessment');
  const missing={...current};delete missing.overrideTest;await page.setContent(html(missing,{fpscanner:{WEBDRIVER:'FAIL'}}));assert.equal(await page.evaluate(checks.siteResult,'incolumitas'),null);
  await page.setContent(html(current,{intoli:{webDriver:'OK'}}));assert.equal(await page.evaluate(checks.siteResult,'incolumitas'),null,'legacy output must finish before a complete current PASS is captured');
  await page.setContent(html({...current,webdriverPresent:'FAIL'},{intoli:{webDriver:'OK'}}));assert.equal((await page.evaluate(checks.siteResult,'incolumitas')).verdict,'FAIL','a known current failure cannot be swallowed by incomplete legacy output');
 }finally{await b.close();}
});
test('Sannysoft waits for its scanner and includes a scanner failure when all primary cells pass',async()=>{
 const b=await p.launch({headless:true});try{const page=await b.newPage(),ids=['user-agent-result','webdriver-result','advanced-webdriver-result','chrome-result','plugins-length-result','plugins-type-result','permissions-result','languages-result','webgl-vendor','webgl-renderer','broken-image-dimensions'];
  const top='<table>'+ids.map(id=>'<tr><td>'+id+'</td><td id="'+id+'" class="passed">'+(id==='plugins-length-result'?'5':'OK')+'</td></tr>').join('')+'</table>';
  await page.setContent(top+'<table id="fp2"></table>');assert.equal(await page.evaluate(checks.siteResult,'sannysoft'),null);
  const rows=failed=>Array.from({length:20},(_,i)=>'<tr><td>CHECK_'+i+'</td><td class="'+(failed&&i===19?'failed':'passed')+'">'+(failed&&i===19?'FAIL':'ok')+'</td></tr>').join('');
  await page.setContent(top+'<table id="fp2">'+rows(true)+'</table>');let r=await page.evaluate(checks.siteResult,'sannysoft');assert.equal(r.verdict,'FAIL');assert.equal(r.cells.length,31);assert.equal(r.cells.find(c=>c.id==='scanner.CHECK_19').failed,true);
  await page.setContent(top+'<table id="fp2">'+rows(false)+'</table>');r=await page.evaluate(checks.siteResult,'sannysoft');assert.equal(r.verdict,'PASS');assert.equal(r.cells.length,31);
 }finally{await b.close();}
});
test('Fingerprint Bot PASS preserves tampering/VPN warnings and timezone reads do not change the identity hash',async()=>{
 const b=await p.launch({headless:true});try{const page=await b.newPage();await page.setContent('<div data-test-property-name="bot">Not detected</div><div data-test-property-name="tampering">Yes</div><div data-test-property-name="vpn">You are using a VPN (timezone mismatch)</div>');
  const r=await page.evaluate(checks.siteResult,'fingerprint');assert.equal(r.verdict,'PASS');assert.equal(r.observations.find(o=>o.name==='Browser tampering').value,'Yes');assert.equal(r.observations.find(o=>o.name==='Website VPN warning').value,'You are using a VPN (timezone mismatch)');assert.equal(r.observations.find(o=>o.name==='Suspect score').value,'Unavailable');
  const probe=await checks.probe(page);assert.equal(Number.isInteger(probe.timezoneOffsetMinutes),true);const policy=require('../../src/lib/account-session-policy.cjs'),other={...probe,timezoneOffsetMinutes:probe.timezoneOffsetMinutes+60};assert.equal(policy.fingerprint(probe).hash,policy.fingerprint(other).hash,'additional diagnostic detail must not silently change frozen identity fields');
 }finally{await b.close();}
});
test('dashboard retains bounded website warnings and timezone without forwarding arbitrary private fields',()=>{
 const site={url:checks.URLS[3],verdict:'PASS',reason:'Direct signals',external:{verdict:'PASS',value:'Not detected',secret:'not-for-dashboard',observations:[{name:'Browser tampering',value:'Yes'},{name:'Website VPN warning',value:'timezone mismatch'}]},probe:{timezone:'Africa/Casablanca',timezoneOffsetMinutes:-60,secret:'not-for-dashboard'}};
 const state=require('../../src/lib/account-session-store.cjs').publicState({daily_limit:300,session_evidence:{gate:{verdict:'PASS',sites:[site]}}}),saved=state.gate.sites[0];assert.equal(saved.website.observations[0].value,'Yes');assert.equal(saved.website.observations[1].value,'timezone mismatch');assert.equal(saved.timezone,'Africa/Casablanca');assert.equal(saved.timezoneOffsetMinutes,-60);assert.equal(JSON.stringify(saved).includes('not-for-dashboard'),false);
});
