'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net'),Module=require('node:module'),ts=require('typescript'),puppeteer=require('puppeteer');
const file=path.resolve(__dirname,'../../provider/aliasmode-native-identity/native-clock.ts'),compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(compiled,file);
const {watchNativeClock}=mod.exports,controller=require('../../src/lib/aliasmode-page.cjs'),policy=require('../../src/lib/account-session-policy.cjs');
function reading(){const date=new Date(),name=new Intl.DateTimeFormat('en-US',{timeZoneName:'longOffset'}).formatToParts(date).find(p=>p.type==='timeZoneName')?.value,m=name?.match(/^GMT([+-])(\d{2}):(\d{2})$/);return {timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,timezoneOffsetMinutes:date.getTimezoneOffset(),timezoneIntlOffsetMinutes:name==='GMT'?0:m?(m[1]==='+'?-1:1)*(Number(m[2])*60+Number(m[3])):null};}
const code='('+reading.toString()+')()';
test('native clock guardian governs first script in pages, frames and workers without Runtime subscriptions',async()=>{
 const server=http.createServer((req,res)=>{
  res.setHeader('content-type',req.url.endsWith('.js')?'application/javascript':'text/html');
  if(req.url==='/worker.js')return res.end('const initial='+code+';onmessage=()=>{postMessage(initial);close();};');
  if(req.url==='/shared.js')return res.end('const initial='+code+';onconnect=e=>{const p=e.ports[0];p.onmessage=()=>p.postMessage(initial);p.start();};');
  if(req.url==='/sw.js')return res.end('const initial='+code+';oninstall=()=>skipWaiting();onactivate=e=>e.waitUntil(clients.claim());onmessage=e=>e.ports[0].postMessage(initial);');
  if(req.url==='/frame')return res.end('<!doctype html><script>parent.postMessage({fixtureClock:'+code+'},"*");</script>');
  res.end('<!doctype html><script>window.initialClock='+code+';</script><title>Native clock fixture</title>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 let launched,browser,page,clock,child;const methods=[];
 class MeasuredSocket extends WebSocket{send(data){methods.push(JSON.parse(String(data)).method);return super.send(data);}}
 try{
  launched=await puppeteer.launch({headless:true,ignoreDefaultArgs:true,waitForInitialPage:false,args:['--headless=new','--remote-debugging-port='+port,'--no-startup-window','--no-first-run','--no-default-browser-check','--disable-background-networking'],defaultViewport:null});child=launched.process();const endpoint=launched.wsEndpoint();await launched.disconnect();
  browser=await puppeteer.connect({browserWSEndpoint:endpoint,defaultViewport:null,targetFilter:t=>!['page','tab','background_page','worker','service_worker','shared_worker'].includes(t._getTargetInfo?.()?.type||t.type())});
  clock=await watchNativeClock(endpoint,'America/New_York',{WebSocket:MeasuredSocket});await clock.createBlank();page=await controller.openPage(browser);await clock.configureTarget(page.target()._targetId);
  await page.setRequestInterception(true);page.on('request',r=>{let allowed=false;try{const u=new URL(r.url());allowed=['127.0.0.1','localhost'].includes(u.hostname)&&u.port===String(server.address().port)||u.protocol==='blob:';}catch{}void(allowed?r.continue():r.abort()).catch(()=>{});});
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'load',timeout:10000});
  const values=await page.evaluate(async port=>{
   const receive=(p,start)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture worker deadline')),5000);p.onmessage=e=>{clearTimeout(timer);resolve(e.data);};start();});
   const dedicatedWorker=new Worker('/worker.js'),dedicated=await receive(dedicatedWorker,()=>dedicatedWorker.postMessage('probe'));
   const sharedWorker=new SharedWorker('/shared.js'),shared=await receive(sharedWorker.port,()=>{sharedWorker.port.start();sharedWorker.port.postMessage('probe');});sharedWorker.port.close();
   await navigator.serviceWorker.register('/sw.js');const registration=await navigator.serviceWorker.ready,channel=new MessageChannel(),service=await receive(channel.port1,()=>registration.active.postMessage('probe',[channel.port2]));channel.port1.close();await registration.unregister();
   const frame=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture frame deadline')),5000),listener=e=>{if(e.data?.fixtureClock){clearTimeout(timer);window.removeEventListener('message',listener);resolve(e.data.fixtureClock);}};window.addEventListener('message',listener);const iframe=document.createElement('iframe');iframe.src='http://localhost:'+port+'/frame';document.body.appendChild(iframe);});
   return {main:window.initialClock,dedicated,shared,service,frame};
  },server.address().port);
  for(const [context,value]of Object.entries(values))assert.equal(policy.clockVerdict(value,'America/New_York',Date.now()).verdict,'PASS',context+' first-script clock');
  assert.equal(clock.healthy(),true);
  assert.ok(methods.includes('Emulation.setTimezoneOverride'));for(const method of ['Runtime.enable','Runtime.disable','Runtime.evaluate','Runtime.callFunctionOn','Page.addScriptToEvaluateOnNewDocument'])assert.equal(methods.includes(method),false,method+' is not used by the clock guardian');
  await page.close();page=null;await browser.close();browser=null;
  if(child.exitCode===null&&child.signalCode===null)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture process closure unconfirmed')),15000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
 }finally{await page?.close().catch(()=>{});await browser?.close().catch(()=>{});clock?.stop();if(launched?.isConnected())await launched.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
