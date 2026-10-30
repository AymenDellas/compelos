'use strict';
// Read-only measurements. Never patch navigator, export cookies or make Node TLS requests.
const VERSION='DIRECT_SIGNALS_V5',IDENTITY_URL='https://browserscan.net/';
const BATTERY=Object.freeze([
 {url:'https://www.browserscan.net/bot-detection',kind:'browserscan'},
 {url:'https://bot.incolumitas.com/',kind:'incolumitas'},
 {url:'https://deviceandbrowserinfo.com/are_you_a_bot',kind:'device'},
 {url:'https://demo.fingerprint.com/playground',kind:'fingerprint'},
 {url:'https://abrahamjuliot.github.io/creepjs/',kind:'creepjs'},
 {url:'https://bot.sannysoft.com/',kind:'sannysoft'},
 {url:'https://tls.browserleaks.com/json',kind:'tls'},
].map(Object.freeze));
const URLS=Object.freeze(BATTERY.map(s=>s.url));
async function probe(page,{checkCDP=false}={}){
 return page.evaluate(async check=>{
  const errors={},read=(key,fn)=>{try{return fn()??null;}catch{errors[key]='unavailable';return null;}};
  let gl,debug;try{gl=document.createElement('canvas').getContext('webgl');debug=gl?.getExtension('WEBGL_debug_renderer_info');}catch{errors.webgl='unavailable';}
  const clock=new Date();
  const p={origin:location.origin,secureContext:isSecureContext,
   webdriver:read('webdriver',()=>navigator.webdriver),webdriverPropertyPresent:read('webdriverPropertyPresent',()=> 'webdriver' in navigator),userAgent:read('userAgent',()=>navigator.userAgent),platform:read('platform',()=>navigator.platform),
   chrome:read('chrome',()=>window.chrome===null?'null':typeof window.chrome),plugins:read('plugins',()=>navigator.plugins.length),
   screen:read('screen',()=>({width:screen.width,height:screen.height})),timezone:read('timezone',()=>Intl.DateTimeFormat().resolvedOptions().timeZone),timezoneOffsetMinutes:read('timezoneOffsetMinutes',()=>clock.getTimezoneOffset()),
   timezoneIntlOffsetMinutes:read('timezoneIntlOffsetMinutes',()=>{
    // Date can follow Windows while Intl follows different bundled timezone
    // rules. Measuring only Date accepted that split in the native V8 trial.
    const name=new Intl.DateTimeFormat('en-US',{timeZoneName:'longOffset'}).formatToParts(clock).find(p=>p.type==='timeZoneName')?.value;
    const m=name?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
    return name==='GMT'?0:m?(m[1]==='+'?-1:1)*(Number(m[2])*60+Number(m[3])):null;
   }),locale:read('locale',()=>navigator.language),
   hardwareConcurrency:read('hardwareConcurrency',()=>navigator.hardwareConcurrency),deviceMemory:read('deviceMemory',()=>navigator.deviceMemory),
   webglVendor:read('webglVendor',()=>debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):null),webglRenderer:read('webglRenderer',()=>debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null),
   cdpDetected:null,cdpMethod:'Error.stack console serialization heuristic',errors};
  if(check){try{
   let detected=false;const diagnostic=new Error('CompelOS diagnostic');
   Object.defineProperty(diagnostic,'stack',{get(){detected=true;return 'CompelOS diagnostic';}});
   // Logging this local object is the challenge. Reading its stack ourselves
   // would trigger the getter and manufacture a positive, so never do that.
   console.debug(diagnostic);
   await new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=()=>{c.port1.close();c.port2.close();resolve();};c.port2.postMessage(null);});
   p.cdpDetected=detected;
  }catch{errors.cdpDetected='unavailable';}}
  return p;
 },checkCDP);
}
async function identityProbe(page,{assertActive=async()=>{}}={}){
 await assertActive();
 // Preserve the old secure origin/hash fields: battery updates must not create drift.
 const current=page.url();
 if(!current||(!current.startsWith('https://browserscan.net/')&&!current.startsWith('https://www.browserscan.net/')))await page.goto(IDENTITY_URL,{waitUntil:'domcontentloaded',timeout:35000});
 await assertActive();const p=await probe(page);
 if(!p.secureContext||new URL(p.origin).hostname.replace(/^www\./,'')!=='browserscan.net')throw Error('A consistent secure diagnostic context could not be established.');
 return p;
}
const result=(name,read,ok,value)=>({name,verdict:!read?'UNKNOWN':ok?'PASS':'FAIL',value:value??null});
const verdict=checks=>checks.some(c=>c.verdict==='FAIL')?'FAIL':checks.some(c=>c.verdict==='UNKNOWN')?'UNKNOWN':'PASS';
function assessProbe(p={}){
 p??={};
 const text=v=>typeof v==='string'&&v.trim().length>0;
 return [
  result('webdriver',typeof p.webdriver==='boolean',p.webdriver===false,p.webdriver),
  result('userAgent',text(p.userAgent),!/HeadlessChrome|PhantomJS|Selenium|Playwright/i.test(p.userAgent||''),p.userAgent),
  result('chrome',text(p.chrome),p.chrome==='object'||p.chrome==='function',p.chrome),
  result('plugins',Number.isInteger(p.plugins),p.plugins>0,p.plugins),
  result('webglVendor',text(p.webglVendor),true,p.webglVendor),
  result('webglRenderer',text(p.webglRenderer),true,p.webglRenderer),
  result('cdpSerialization',typeof p.cdpDetected==='boolean',p.cdpDetected===false,p.cdpDetected),
 ];
}
function endpointMatches(actual,expected){try{const a=new URL(actual),b=new URL(expected);return a.origin===b.origin&&a.pathname.replace(/\/$/,'')===b.pathname.replace(/\/$/,'')&&!a.search;}catch{return false;}}
function assessSite({url,status,finalUrl=url,probe:identity,external=null,error=''}){
 const checks=assessProbe(identity),measured=verdict(checks);
 if(measured==='FAIL'||external?.verdict==='FAIL'){
  const flagged=[...Object.entries(external?.flags||{}).filter(([k,v])=>v===true&&k!=='isBot').map(([k])=>k),...Object.entries(external?.checks||{}).filter(([,v])=>v==='FAIL').map(([k])=>k),...(external?.cells||[]).filter(c=>c.failed).map(c=>c.id)].join(', ').slice(0,400);
  return {url,checks,verdict:'FAIL',reason:external?.verdict==='FAIL'?'The test site reported failure'+(flagged?': '+flagged:external.value?': '+external.value:'')+'.':'Direct checks failed: '+checks.filter(c=>c.verdict==='FAIL').map(c=>c.name).join(', ')+'.'};
 }
 if(!URLS.includes(url)||!endpointMatches(finalUrl,url)||error||status!==200)return {url,checks,verdict:'UNKNOWN',reason:error||'The actual test endpoint was unavailable or redirected (HTTP '+status+').'};
 if(measured==='UNKNOWN')return {url,checks,verdict:'UNKNOWN',reason:'Cannot read direct signals: '+checks.filter(c=>c.verdict==='UNKNOWN').map(c=>c.name).join(', ')+'.'};
 return {url,checks,verdict:'PASS',reason:'All seven direct browser checks passed.'+(external?.verdict==='PASS'?' The site also reported a pass.':' The site-specific verdict is unavailable; direct measurements are separate.')};
}
// Runs in the page: real result elements, never examples or private app state.
function siteResult(kind){
 try{
  if(kind==='device'){
   const data=JSON.parse((document.querySelector('#jsonResult')?.textContent||'').slice(0,32768));if(typeof data.isBot!=='boolean')return null;
   const flags=Object.fromEntries(Object.entries({...data.details,...data.checks,...data}).filter(([k,v])=>/^(?:is|has)/.test(k)&&typeof v==='boolean').slice(0,40));
   const failed=data.isBot||['hasBotUserAgent','hasWebdriverTrue','isHeadlessChrome','isAutomatedWithCDP','isAutomatedWithCDPInWebWorker'].some(k=>flags[k]===true);
   return {verdict:failed?'FAIL':'PASS',source:'#jsonResult',flags};
  }
  if(kind==='fingerprint'){
   const value=document.querySelector('[data-test-property-name="bot"]')?.textContent?.replace(/\s+/g,' ').trim();
   const fields={tampering:'Browser tampering',vpn:'Website VPN warning',developer_tools:'Developer tools',suspect_score:'Suspect score'};
   const observations=Object.entries(fields).map(([key,name])=>({name,value:document.querySelector('[data-test-property-name="'+key+'"]')?.textContent?.replace(/\s+/g,' ').trim().slice(0,400)||'Unavailable'}));
   // Preserve the Bot-field assessment. Other published fields are evidence,
   // including warnings; they must not be hidden behind the Bot-field PASS.
   if(value==='Not detected')return {verdict:'PASS',source:'[data-test-property-name="bot"]',value,observations};
   if(/^You are a (?:bad |good )?bot\b/i.test(value||''))return {verdict:'FAIL',source:'[data-test-property-name="bot"]',value:value.slice(0,200),observations};
  }
  if(kind==='sannysoft'){
   if(!document.querySelector('#user-agent-result')?.textContent?.trim()||!/^\d+/.test(document.querySelector('#plugins-length-result')?.textContent?.trim()||''))return null;
   const scanner=document.querySelector('#fp2');
   const ids=['user-agent-result','webdriver-result','advanced-webdriver-result','chrome-result','plugins-length-result','plugins-type-result',...(scanner?['permissions-result','languages-result','webgl-vendor','webgl-renderer','broken-image-dimensions']:[])];
   const cells=ids.map(id=>{const e=document.getElementById(id);return e?.textContent?.trim()?{id,value:e.textContent.trim().slice(0,400),failed:e.classList.contains('failed')}:null;});
   if(cells.some(c=>!c))return null;
   if(scanner){
    const rows=Array.from(scanner.querySelectorAll('tr')).slice(0,80).map(row=>{const a=row.querySelectorAll('td');return a.length>=2?{id:'scanner.'+a[0].textContent.trim().slice(0,100),value:a[1].textContent.trim().slice(0,400),failed:a[1].classList.contains('failed')||/^FAIL$/i.test(a[1].textContent.trim())}:null;});
    // Never call the first table a complete pass while the scanner is pending.
    // A positive primary-table finding is already evidence and must survive.
    if(rows.length<20||rows.some(r=>!r||!r.value)){if(!cells.some(c=>c.failed))return null;}
    else cells.push(...rows);
   }
   return {verdict:cells.some(c=>c.failed)?'FAIL':'PASS',source:scanner?'Completed primary and scanner tables':'Completed result table',cells,observations:cells.map(c=>({name:c.id,value:(c.failed?'FAIL: ':'')+c.value}))};
  }
  if(kind==='incolumitas'){
   const data=JSON.parse((document.querySelector('#new-tests')?.textContent||'').slice(0,32768));
   // Current published names replaced the old inconsistentUserAgent/languages
   // fields. Accept either complete known schema, never a partial checklist.
   const schemas=[['webdriverPresent','puppeteerEvaluationScript','inconsistentUserAgent','inconsistentLanguages'],['puppeteerEvaluationScript','webdriverPresent','connectionRTT','refMatch','overrideTest','overflowTest','puppeteerExtraStealthUsed','inconsistentWebWorkerNavigatorPropery','inconsistentServiceWorkerNavigatorPropery']];
   if(!schemas.some(keys=>keys.every(k=>['OK','FAIL'].includes(data[k]))))return null;
   const checks=Object.fromEntries(Object.entries(data).filter(([,v])=>v==='OK'||v==='FAIL').slice(0,40));
   const observations=[];let legacyChecks=null;
   try{const legacy=JSON.parse((document.querySelector('#detection-tests')?.textContent||'').slice(0,32768));legacyChecks={};for(const [group,entries]of Object.entries(legacy))if(entries&&typeof entries==='object')for(const [name,status]of Object.entries(entries))if(['OK','FAIL','WARN'].includes(status)&&Object.keys(legacyChecks).length<80)legacyChecks[group+'.'+name]=status;}catch{/* Preserve the current result when optional legacy output is unavailable. */}
   if(!Object.values(checks).includes('FAIL')&&document.querySelector('#detection-tests')&&!Object.keys(legacyChecks||{}).some(k=>k.startsWith('fpscanner.')))return null;
   // Feed every completed published failure into the unchanged fail-wins
   // assessment. A documented compatibility issue is still the site's FAIL.
   for(const [name,status]of Object.entries(legacyChecks||{}))checks['legacy.'+name]=status;
   for(const [name,status]of Object.entries(legacyChecks||{}))observations.push({name:'Legacy '+name,value:status});
   const score=(document.body?.innerText||'').match(/Your Behavioral Score:\s*(0(?:\.\d+)?|1(?:\.0+)?)(?!\d)/i);
   observations.push({name:'Behavioral score',value:score?score[1]:'Unavailable'});
   return {verdict:Object.values(checks).includes('FAIL')?'FAIL':'PASS',source:legacyChecks?'#new-tests and #detection-tests':'#new-tests',checks,legacyChecks,observations,scope:'Completed static checklists; behavioral score is recorded separately and can remain unavailable.'};
  }
 }catch{/* Missing/incomplete vendor UI; direct probes are independent. */}
 return null;
}
function assessTLS(data,p={}){
 p??={};
 const md5=s=>require('node:crypto').createHash('md5').update(s).digest('hex');
 const hasJA3=typeof data?.ja3_hash==='string'&&/^[a-f0-9]{32}$/i.test(data.ja3_hash)&&typeof data.ja3_text==='string'&&/^\d+,[\d-]+,[\d-]*,[\d-]*,[\d-]*$/.test(data.ja3_text);
 const hasJA4=typeof data?.ja4==='string'&&/^[tq](?:1[0-3]|00)[di]\d{4}[a-z0-9]{2}_[a-f0-9]{12}_[a-f0-9]{12}$/i.test(data.ja4);
 const hasUA=typeof data?.user_agent==='string'&&data.user_agent.length>0&&typeof p.userAgent==='string'&&p.userAgent.length>0;
 const checks=[result('ja3',hasJA3,hasJA3&&md5(data.ja3_text)===data.ja3_hash?.toLowerCase(),data?.ja3_hash),result('ja4',hasJA4,true,data?.ja4),result('httpUserAgent',hasUA,hasUA&&data.user_agent===p.userAgent,data?.user_agent)];
 return {verdict:verdict(checks),checks,referenceVerdict:'NOT_EVALUATED',reason:'Checks cover fingerprint availability/integrity and HTTP/browser UA agreement. No reference Chrome TLS fingerprint was supplied.'};
}
async function run(page,{assertActive=async()=>{},now=Date.now,urls=URLS,resultTimeoutMs=8000}={}){
 if(urls.length!==URLS.length||urls.some((u,i)=>u!==URLS[i]))throw Error('Use only the configured diagnostic battery.');
 if(!Number.isInteger(resultTimeoutMs)||resultTimeoutMs<1||resultTimeoutMs>10000)throw Error('Invalid detector result deadline.');
 const sites=[],start=now();
 for(const {url,kind}of BATTERY){
  await assertActive();const at=now();let e={url,kind},stage='navigation';
  try{
   const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000});await assertActive();
   const status=response?.status(),finalUrl=page.url();e={...e,status,finalUrl};
   if(kind==='tls'){
    stage='tls-json';
    const data=await page.evaluate(()=>{const t=document.body?.innerText||'';if(t.length>65536)return null;try{const d=JSON.parse(t);return Object.fromEntries(['user_agent','ja4','ja4_r','ja4_o','ja4_ro','ja3_hash','ja3_text','ja3n_hash','ja3n_text','akamai_hash'].filter(k=>typeof d[k]==='string'&&d[k].length<=4096).map(k=>[k,d[k]]));}catch{return null;}});
    e.tls=data;stage='tls-browser-ua';const identity=await probe(page),assessment=assessTLS(data,identity);e={...e,probe:identity,...assessment};
    if(status!==200||!endpointMatches(finalUrl,url))e={...e,verdict:'UNKNOWN',reason:'The browser-routed TLS JSON endpoint was unavailable (HTTP '+status+').'};
   }else{
    let external=null;stage='site-result';
    if(status===200&&endpointMatches(finalUrl,url)&&['device','fingerprint','sannysoft','incolumitas'].includes(kind)){
     // Event-driven DOM observation, not a fixed rendering/throttle sleep.
     try{const h=await page.waitForFunction(siteResult,{timeout:resultTimeoutMs,polling:'mutation'},kind);try{external=await h.jsonValue();}finally{await h.dispose();}}catch{/* Direct measurements remain available if the site UI is unsupported/slow. */}
    }
    e.external=external||{verdict:'UNKNOWN',reason:'No completed supported site result; direct checks are independent.'};
    if(kind==='incolumitas'&&external){await assertActive();try{e.external={...e.external,sourceHashes:await sourceHashes(page)};}catch{e.sourceVerificationError='Public scanner source hashes unavailable; no compatibility exception can apply.';}}
    await assertActive();stage='direct-probe';e.probe=await probe(page,{checkCDP:true});e={...e,...assessSite(e)};
    // Raw page text is supporting evidence, not a required detector signal.
    // Failure to capture it cannot erase a completed PASS or confirmed FAIL.
    try{Object.assign(e,await page.evaluate(()=>({title:document.title,text:(document.body?.innerText||'').slice(0,8000)})));}catch{e.rawCaptureError='Optional page text unavailable; direct/site results retained.';}
   }
  }catch(error){
   const known=kind==='tls'?assessTLS(e.tls,e.probe):assessSite(e),message=String(error.message||error.name||'Detector error').replace(/wss?:\/\/\S+/gi,'[CDP endpoint]').slice(0,600);
   e={...e,...known,verdict:known.verdict==='FAIL'?'FAIL':'UNKNOWN',reason:known.verdict==='FAIL'?known.reason:'Cannot read '+stage+': '+message,error:String(error.name||'Detector error'),failureStage:stage};
  }
  // Pause/hold/lease loss aborts, never permits subsequent navigation as UNKNOWN.
  await assertActive();sites.push({...e,durationMs:now()-at});
 }
 const overall=verdict(sites),counts={PASS:0,FAIL:0,UNKNOWN:0};for(const s of sites)counts[s.verdict]++;
 const admission=require('./diagnostic-admission.cjs').assess(sites);
 return {version:VERSION,verdict:admission.verdict,reason:admission.reason,measurementVerdict:overall,admission,scope:admission.scope,controlTransport:'CDP',checkedAt:new Date(now()).toISOString(),durationMs:now()-start,counts,countsScope:'Raw direct/site/TLS results; compatibility does not rewrite these counts.',sites};
}
async function sourceHashes(page){
 return page.evaluate(async()=>{
  if(location.origin!=='https://bot.incolumitas.com')throw Error('Wrong scanner origin');
  const entries=await Promise.all([['fpScanner','/fpScanner.js'],['fpCollect','/fpCollect.min.js']].map(async([name,path])=>{
   const response=await fetch(path,{credentials:'omit',cache:'force-cache',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Source unavailable');
   const reader=response.body.getReader(),parts=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw Error('Source too large');}parts.push(value);}
   const body=new Uint8Array(size);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.length;}
   const digest=await crypto.subtle.digest('SHA-256',body);return [name,Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')];
  }));return Object.fromEntries(entries);
 });
}
async function network(page,{assertActive=async()=>{}}={}){
 const readings=[];
 for(let i=0;i<3;i++){
  await assertActive();const response=await page.goto('https://api.ipapi.is/',{waitUntil:'domcontentloaded',timeout:35000});
  if(response?.status()!==200)throw Error('Free network lookup unavailable (HTTP '+response?.status()+'); no automatic retry.');
  const data=await page.evaluate(()=>{try{return JSON.parse(document.body.innerText.slice(0,65536));}catch{return null;}});
  if(!data||data.error)throw Error('Free network lookup returned no usable evidence.');
  readings.push({ip:data.ip,country:data.location?.country_code||data.country,countryName:data.location?.country,timezone:data.location?.timezone||data.timezone,datacenter:data.is_datacenter});
 }
 await assertActive();return {...readings[0],rotating:new Set(readings.map(v=>v.ip)).size!==1,readings};
}
module.exports={VERSION,BATTERY,URLS,probe,identityProbe,assessProbe,assessSite,siteResult,assessTLS,run,network,sourceHashes};
