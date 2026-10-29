'use strict';
const checks=require('../../src/lib/stealth-self-test.cjs'),admission=require('../../src/lib/diagnostic-admission.cjs');
function probe(){return {webdriver:false,webdriverPropertyPresent:true,userAgent:'Mozilla/5.0 Chrome/155.0.0.0 Safari/537.36',chrome:'object',plugins:5,webglVendor:'Fixture GPU',webglRenderer:'Fixture renderer',cdpDetected:false};}
function sites(){return checks.BATTERY.map(({url,kind})=>{let external={verdict:'UNKNOWN'},tls;
 if(kind==='incolumitas')external={verdict:'FAIL',source:'#new-tests and #detection-tests',checks:{...Object.fromEntries(admission.CURRENT_INCOL.map(k=>[k,'OK'])),'legacy.fpscanner.WEBDRIVER':'FAIL'},legacyChecks:{'fpscanner.WEBDRIVER':'FAIL'},sourceHashes:{...admission.SOURCE_HASHES}};
 if(kind==='device')external={verdict:'PASS',source:'#jsonResult',flags:{isBot:false,hasWebdriverTrue:false,isAutomatedWithCDP:false,isAutomatedWithCDPInWebWorker:false}};
 if(kind==='fingerprint')external={verdict:'PASS',value:'Not detected',observations:[{name:'Browser tampering',value:'Not detected'}]};
 if(kind==='sannysoft')external={verdict:'PASS',cells:[{id:'fixture',failed:false}]};
 if(kind==='tls'){const text='771,4865-4866-4867,0-10-11-13,29-23,0';tls={user_agent:probe().userAgent,ja3_text:text,ja3_hash:require('node:crypto').createHash('md5').update(text).digest('hex'),ja4:'t13d1516h2_8daaf6152771_02713d6af862'};}
 const site={url,kind,status:200,finalUrl:url,probe:probe(),external,...(tls?{tls}:{})};return {...site,...(tls?checks.assessTLS(tls,site.probe):checks.assessSite(site))};
 });}
module.exports={probe,sites};
