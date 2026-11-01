'use strict';
// Local family-specific interpretation only. Raw vendor/direct results remain
// byte-for-byte evidence. Unsupported required results remain UNKNOWN.
const VERSION='LOCAL_DIAGNOSTIC_ADMISSION_FIREFOX_V1';
const DEVICE_FLAGS=Object.freeze(['hasBotUserAgent','hasWebdriverTrue','hasWebdriverInFrameTrue','isPlaywright','hasInconsistentChromeObject','isPhantom','isNightmare','isSequentum','isSeleniumChromeDefault','isHeadlessChrome','isWebGLInconsistent','hasInconsistentWebGLShaderLang','isAutomatedWithCDP','isAutomatedWithCDPInWebWorker','hasInconsistentClientHints','hasInconsistentGPUFeatures','isIframeOverridden','hasInconsistentWorkerValues','hasHighHardwareConcurrency','hasHeadlessChromeDefaultScreenResolution','hasSuspiciousWeakSignals','hasInconsistentTimingResolution','isBot']);
const SANNY_CELLS=Object.freeze(['user-agent-result','webdriver-result','advanced-webdriver-result','chrome-result','plugins-length-result','plugins-type-result','permissions-result','languages-result','webgl-vendor','webgl-renderer','broken-image-dimensions',...['PHANTOM_UA','PHANTOM_PROPERTIES','PHANTOM_ETSL','PHANTOM_LANGUAGE','PHANTOM_WEBSOCKET','MQ_SCREEN','PHANTOM_OVERFLOW','PHANTOM_WINDOW_HEIGHT','HEADCHR_UA','HEADCHR_CHROME_OBJ','HEADCHR_PERMISSIONS','HEADCHR_PLUGINS','HEADCHR_IFRAME','CHR_DEBUG_TOOLS','SELENIUM_DRIVER','CHR_BATTERY','CHR_MEMORY','TRANSPARENT_PIXEL','SEQUENTUM','VIDEO_CODECS'].map(k=>'scanner.'+k)]);
function sameEndpoint(actual,expected){try{const a=new URL(actual),b=new URL(expected);return a.origin===b.origin&&a.pathname.replace(/\/$/,'')===b.pathname.replace(/\/$/,'')&&!a.search&&!a.hash;}catch{return false;}}
function assess(sites=[]){
 const raw=require('./stealth-self-test.cjs'),checks=[],compatibility=[];
 const push=(url,name,verdict,reason)=>checks.push({url,name,verdict,reason});
 if(!Array.isArray(sites))sites=[];
 for(const site of sites){
  const entry=raw.BATTERY.find(s=>s.url===site.url),kind=entry?.kind,p=site.probe,e=site.external;
  const probe=raw.assessProbe(p),family=/\brv:156\.0\).*\bFirefox\/156\.0$/.test(p?.userAgent||'');
  const missingChrome=family&&p?.chrome==='undefined';
  const failures=probe.filter(c=>c.verdict==='FAIL'&&!(missingChrome&&c.name==='chrome'));
  const reported=(site.checks||[]).filter(c=>c.verdict==='FAIL'&&!(missingChrome&&c.name==='chrome'&&c.value==='undefined'));
  const positive=Object.values(e?.flags||{}).some(v=>v===true)||Object.values(e?.checks||{}).includes('FAIL');
  const tampering=e?.observations?.find(o=>o.name==='Browser tampering')?.value;
  const sannyFailures=(e?.cells||[]).filter(c=>c.failed);
  const sannyCompat=kind==='sannysoft'&&missingChrome&&e?.source==='Completed primary and scanner tables'&&e.cells?.length===31&&new Set(e.cells.map(c=>c.id)).size===31&&SANNY_CELLS.every(id=>e.cells.some(c=>c.id===id&&typeof c.failed==='boolean'))&&
   sannyFailures.length===1&&sannyFailures[0].id==='chrome-result'&&sannyFailures[0].value==='missing (failed)'&&e.cells.find(c=>c.id==='user-agent-result')?.value===p.userAgent;
  if(failures.length||reported.length){push(site.url,'direct','FAIL','A measured automation or browser consistency signal failed.');continue;}
  if(/^Yes\b|^Detected\b|^true$/i.test(tampering||'')){push(site.url,'browser-modification','FAIL','The website reports browser modification.');continue;}
  if(positive||e?.verdict==='FAIL'&&!sannyCompat||sannyFailures.length&&!sannyCompat){push(site.url,'vendor-signals','FAIL','A published failure is not covered by the exact Firefox Chrome-object finding.');continue;}
  if(!family){push(site.url,'browser-family',p?.userAgent?'FAIL':'UNKNOWN','The native Firefox 156 context was not confirmed.');continue;}
  if(!missingChrome){push(site.url,'browser-family','FAIL','This native Firefox profile unexpectedly exposes a Chrome-specific object.');continue;}
  // TLS collection deliberately does not run the console/CDP challenge. A
  // missing challenge there is not a missing TLS measurement. Positive direct
  // findings above still fail, including a positive CDP result if supplied.
  const requiredProbe=kind==='tls'?probe.filter(c=>c.name!=='cdpSerialization'):probe;
  if(!entry||site.status!==200||!sameEndpoint(site.finalUrl,site.url)||site.error||site.verdict==='UNKNOWN'||requiredProbe.some(c=>c.verdict==='UNKNOWN')){
   push(site.url,'measurement','UNKNOWN','A required endpoint or browser measurement did not complete.');continue;
  }
  if(missingChrome){compatibility.push({id:'FIREFOX_CHROME_OBJECT_V1',url:site.url,rawVerdict:site.verdict,reason:'Native Firefox has no Chrome-specific object. Its raw Chromium check remains visible.'});}
  else if(probe.some(c=>c.name==='chrome'&&c.verdict!=='PASS')){push(site.url,'chrome-object','UNKNOWN','The browser object result is unreadable.');continue;}
  if(kind==='tls'){
   const tls=raw.assessTLS(site.tls,p);push(site.url,'tls-coherence',tls.verdict,'TLS capture integrity and HTTP/browser identity are checked independently of Chrome.');
  }else if(kind==='fingerprint'){
   push(site.url,'bot-and-modification',e?.verdict==='PASS'&&e.value==='Not detected'&&tampering==='Not detected'?'PASS':'UNKNOWN','Both published Bot and Browser tampering fields must be clear. Other website warnings remain visible.');
  }else if(kind==='device'){
   push(site.url,'vendor-signals',e?.verdict==='PASS'&&DEVICE_FLAGS.every(k=>e.flags?.[k]===false)?'PASS':'UNKNOWN','All 23 expected published automation flags must be present and false.');
  }else if(kind==='sannysoft'){
   if(sannyCompat){compatibility.push({id:'FIREFOX_SANNYSOFT_CHROME_V1',url:site.url,rawVerdict:'FAIL',reason:'Only the literal Chrome-object cell fails; all other 30 published Firefox results are clear. Raw FAIL retained.'});push(site.url,'static-checklist','PASS','Thirty required checks passed; the exact Chrome-only cell is retained as compatibility evidence.');}
   else push(site.url,'static-checklist',e?.verdict==='PASS'&&e.cells?.length===31?'PASS':'UNKNOWN','A complete published static checklist is required.');
  }else if(kind==='incolumitas'){
   push(site.url,'static-checklist',e?.verdict==='PASS'?'PASS':'UNKNOWN','An unsupported or unfinished Incolumitas checklist remains UNKNOWN; it is not an automated pass.');
  }else push(site.url,'direct-probe-context','PASS','Direct checks passed in this Firefox context; no website human verdict is inferred.');
 }
 for(const required of raw.BATTERY)if(!sites.some(s=>s.url===required.url))push(required.url,'missing-endpoint','UNKNOWN','A required endpoint is missing.');
 if(new Set(sites.map(s=>s.url)).size!==sites.length)push('','duplicate-endpoint','UNKNOWN','Duplicate endpoints cannot establish coverage.');
 const verdict=checks.some(c=>c.verdict==='FAIL')?'FAIL':checks.some(c=>c.verdict==='UNKNOWN')?'UNKNOWN':'PASS';
 return {version:VERSION,verdict,checks,compatibility,scope:'Local Firefox diagnostic admission only; raw results retained. No account start or guarantee of undetectability.',reason:verdict==='FAIL'?'A blocking Firefox finding needs repair.':verdict==='UNKNOWN'?'Required Firefox evidence is incomplete. Explicit review of this exact current report is required.':'Required Firefox diagnostics completed; raw compatibility findings and website warnings remain visible.'};
}
module.exports={VERSION,DEVICE_FLAGS,SANNY_CELLS,assess};
