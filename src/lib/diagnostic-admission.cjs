'use strict';
// Admission is separate from raw vendor verdicts. Never edit a site's FAIL.
const VERSION='LOCAL_DIAGNOSTIC_ADMISSION_V1';
const SOURCE_HASHES=Object.freeze({fpScanner:'f91e05ce0587f825ba072c296022882371e598b9d159fa1d3104dd25390e65a2',fpCollect:'9c826cdc6b72f6d0c6f18a140ba215e3a7cf94b21abe75b0d6824158e0a2de2e'});
const CURRENT_INCOL=Object.freeze(['puppeteerEvaluationScript','webdriverPresent','connectionRTT','refMatch','overrideTest','overflowTest','puppeteerExtraStealthUsed','inconsistentWebWorkerNavigatorPropery','inconsistentServiceWorkerNavigatorPropery']);
function sameEndpoint(actual,expected){try{const a=new URL(actual),b=new URL(expected);return a.origin===b.origin&&a.pathname.replace(/\/$/,'')===b.pathname.replace(/\/$/,'')&&!a.search;}catch{return false;}}
function legacyCompatibility(site){
 const p=site.probe,e=site.external,checks=e?.checks||{};
 const failures=Object.keys(checks).filter(k=>checks[k]==='FAIL');
 return site.url==='https://bot.incolumitas.com/'&&site.status===200&&sameEndpoint(site.finalUrl,site.url)&&
  p?.webdriver===false&&p.webdriverPropertyPresent===true&&/\bChrome\/\d+/.test(p.userAgent||'')&&
  e?.source==='#new-tests and #detection-tests'&&e.verdict==='FAIL'&&CURRENT_INCOL.every(k=>checks[k]==='OK')&&
  failures.length===1&&failures[0]==='legacy.fpscanner.WEBDRIVER'&&e.legacyChecks?.['fpscanner.WEBDRIVER']==='FAIL'&&
  Object.entries(SOURCE_HASHES).every(([name,hash])=>e.sourceHashes?.[name]===hash);
}
function assess(sites=[]){
 if(!Array.isArray(sites))sites=[];
 // Required lazily so the raw measurement module can use this separate policy.
 const raw=require('./stealth-self-test.cjs'),checks=[],compatibility=[];
 const push=(url,name,verdict,reason)=>checks.push({url,name,verdict,reason});
 for(const site of sites){
  const entry=raw.BATTERY.find(e=>e.url===site.url),kind=entry?.kind;
  const probeChecks=raw.assessProbe(site.probe);
  const direct=kind==='tls'?raw.assessTLS(site.tls,site.probe).verdict:probeChecks.some(v=>v.verdict==='FAIL')?'FAIL':probeChecks.some(v=>v.verdict==='UNKNOWN')?'UNKNOWN':'PASS';
  if(direct==='FAIL'||probeChecks.some(c=>c.verdict==='FAIL')||site.checks?.some(c=>c.verdict==='FAIL')){push(site.url,'direct','FAIL','Measured browser or TLS checks failed.');continue;}
  if(site.verdict==='FAIL'||site.external?.verdict==='FAIL'||Object.values(site.external?.checks||{}).includes('FAIL')||site.external?.cells?.some(c=>c.failed)){
   if(kind==='incolumitas'&&direct==='PASS'&&legacyCompatibility(site)){
    compatibility.push({id:'INCOL_WEBDRIVER_PROPERTY_V1',url:site.url,rawVerdict:'FAIL',reason:'The verified old scanner flags the presence of a standard false-valued property. Raw failure retained.',sourceHashes:{...site.external.sourceHashes}});
    push(site.url,'legacy-compatibility','PASS','Exact obsolete property-presence rule verified; raw FAIL remains visible.');
   }else{push(site.url,'raw-failure','FAIL','A raw failure is not covered by the exact verified compatibility case.');continue;}
  }
  if(kind==='fingerprint'&&/^Yes\b|^Detected\b|^true$/i.test(site.external?.observations?.find(o=>o.name==='Browser tampering')?.value||'')){push(site.url,'browser-modification','FAIL','The website reports browser modification.');continue;}
  if(kind==='device'&&Object.values(site.external?.flags||{}).some(v=>v===true)){push(site.url,'vendor-signals','FAIL','The website reports a positive browser signal.');continue;}
  if(!entry||site.status!==200||!sameEndpoint(site.finalUrl,site.url)||site.error||direct==='UNKNOWN'||site.verdict==='UNKNOWN'){
   push(site.url,'measurement','UNKNOWN','The required endpoint or measurement did not complete.');continue;
  }
  const e=site.external;
  if(kind==='fingerprint'){
   const value=e?.observations?.find(o=>o.name==='Browser tampering')?.value;
   if(/^Yes\b|^Detected\b|^true$/i.test(value||''))push(site.url,'browser-modification','FAIL','The website reports browser modification.');
   else if(e?.verdict==='PASS'&&e.value==='Not detected'&&value==='Not detected')push(site.url,'bot-and-modification','PASS','Both published bot and modification results are clear.');
   else push(site.url,'bot-and-modification','UNKNOWN','A complete bot and modification result is required.');
  }else if(kind==='device'){
   const flags=e?.flags;
   if(flags&&Object.values(flags).some(v=>v===true))push(site.url,'vendor-signals','FAIL','The website reports a positive browser signal.');
   else if(e?.verdict==='PASS'&&flags?.isBot===false)push(site.url,'vendor-signals','PASS','The published bot result is clear.');
   else push(site.url,'vendor-signals','UNKNOWN','The published bot result is missing.');
  }else if(['incolumitas','sannysoft'].includes(kind)){
   if(e?.verdict==='PASS'||kind==='incolumitas'&&legacyCompatibility(site))push(site.url,'static-checklist','PASS','A completed static checklist is available.');
   else push(site.url,'static-checklist','UNKNOWN','The published static checklist is incomplete.');
  }else push(site.url,kind==='tls'?'tls-coherence':'direct-probe-context','PASS',kind==='tls'?'TLS capture and coherence checks passed.':'Direct browser checks passed; this is not a website human verdict.');
 }
 for(const required of raw.BATTERY)if(!sites.some(s=>s.url===required.url))push(required.url,'missing-endpoint','UNKNOWN','A required diagnostic endpoint is absent.');
 if(new Set(sites.map(s=>s.url)).size!==sites.length)push('','duplicate-endpoint','UNKNOWN','Duplicate diagnostic endpoints cannot establish complete coverage.');
 const verdict=checks.some(c=>c.verdict==='FAIL')?'FAIL':checks.some(c=>c.verdict==='UNKNOWN')?'UNKNOWN':'PASS';
 return {version:VERSION,verdict,checks,compatibility,scope:'Local diagnostic admission only; not LinkedIn permission, an account start, or proof of undetectability.',reason:verdict==='FAIL'?'A blocking browser finding must be repaired.':verdict==='UNKNOWN'?'Required diagnostic evidence is incomplete.':'Required local diagnostics passed; raw website results and compatibility findings remain visible.'};
}
module.exports={VERSION,SOURCE_HASHES,CURRENT_INCOL,assess,legacyCompatibility};
