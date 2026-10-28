'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const puppeteer=require('puppeteer'),controller=require('../../src/lib/aliasmode-page.cjs'),rendered=require('../../src/lib/linkedin-browser-page.cjs');
async function fixture(){
 const server=http.createServer((req,res)=>{
  if(req.url==='/worker.js'){res.writeHead(200,{'content-type':'application/javascript'});return res.end('fetch("/worker-data").then(r=>r.text()).then(v=>postMessage(v));');}
  if(req.url==='/worker-data'){res.writeHead(200);return res.end('worker-completed');}
  if(req.url==='/denied'){res.writeHead(401);return res.end('Fixture 401');}
  if(req.url==='/redirect'){res.writeHead(302,{location:'/second'});return res.end();}
  if(req.url==='/early-route'){res.writeHead(200,{'content-type':'text/html'});return res.end('<!doctype html><script>history.replaceState({},"","/early-routed");</script><title>Early route loaded</title>');}
  if(req.url==='/error'){res.writeHead(503);return res.end('<title>Fixture 503</title>');}
  res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><title>'+req.url+'</title><main style="height:2400px"><h1>'+req.url+'</h1><a id="next" href="/second">Next</a><a id="spa" href="/same-document">SPA</a></main><script>document.querySelector("#spa").onclick=e=>{e.preventDefault();history.pushState({},"","/same-document");document.querySelector("h1").textContent="SPA";};</script>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let launcher,browser,page;
 try{
  launcher=await puppeteer.launch({headless:true});const endpoint=launcher.wsEndpoint();await launcher.disconnect();
  browser=await puppeteer.connect({browserWSEndpoint:endpoint,targetFilter:t=>!['page','tab','worker','shared_worker','service_worker','background_page'].includes(t._getTargetInfo?.()?.type||t.type()),defaultViewport:null});
  const root=await browser.target().createCDPSession(),connection=root.connection(),rawSend=connection._rawSend.bind(connection),methods=[];
  connection._rawSend=(registry,method,...args)=>{methods.push(method);return rawSend(registry,method,...args);};await root.detach();
  page=await controller.openPage(browser);
  return {page,browser,methods,url:'http://127.0.0.1:'+server.address().port,close:async()=>{await page.close().catch(()=>{});await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
 }catch(error){await page?.close().catch(()=>{});await browser?.close();if(launcher?.isConnected())await launcher.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));throw error;}
}
test('explicit page contexts survive navigation, native clicks, SPA changes and worker fetches without Runtime event subscription',async()=>{
 const f=await fixture(),p=f.page;try{
  const first=await p.goto(f.url+'/first',{waitUntil:'load',timeout:5000});assert.equal(first.status(),200);assert.equal(await p.title(),'/first');
  const handle=await p.$('#next'),point=await rendered.controlPoint(handle);assert.ok(point.x>0);const navigation=p.waitForNavigation({waitUntil:'load',timeout:5000});await rendered.pressControl(p,handle);const second=await navigation;await handle.dispose();
  assert.equal(second.status(),200);assert.equal(await p.evaluate(()=>document.querySelector('h1').textContent),'/second');
  const spa=await p.$('#spa'),changed=p.waitForNavigation({waitUntil:'load',timeout:5000});await spa.click();assert.equal(await changed,null);await spa.dispose();assert.equal(await p.evaluate(()=>document.querySelector('h1').textContent),'SPA');assert.ok(p.url().endsWith('/same-document'));
  const message=await p.evaluate(()=>new Promise((resolve,reject)=>{const worker=new Worker('/worker.js');worker.onmessage=e=>{worker.terminate();resolve(e.data);};worker.onerror=()=>reject(Error('Worker fixture failed'));}));assert.equal(message,'worker-completed');
  const routed=await p.goto(f.url+'/early-route',{waitUntil:'domcontentloaded',timeout:5000});assert.equal(routed.status(),200);assert.equal(p.url(),f.url+'/early-routed');assert.equal(await p.title(),'Early route loaded');
  for(let i=0;i<5;i++){await p.goto(f.url+'/context-'+i,{waitUntil:'domcontentloaded',timeout:5000});assert.equal(await p.evaluate(()=>document.querySelector('h1').textContent),'/context-'+i);}
  assert.ok(f.methods.includes('Runtime.callFunctionOn'));assert.ok(!f.methods.includes('Runtime.enable'));assert.ok(!f.methods.includes('Runtime.disable'));assert.equal((await f.browser.pages()).length,0,'Puppeteer does not own an instrumented Page alongside the explicit controller');
 }finally{await f.close();}
});
test('explicit page network events retain HTTP failures, redirects, request kinds and interception responses',async()=>{
 const f=await fixture(),p=f.page,events=[];try{
  p.on('response',r=>events.push({url:r.url(),status:r.status(),kind:r.request().resourceType(),frame:r.frame()}));
  await p.setRequestInterception(true);const pass=request=>void request.continue().catch(()=>{});p.on('request',pass);
  await p.goto(f.url+'/first',{waitUntil:'load',timeout:5000});
  const blob=await p.evaluate(()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Monitored blob worker stalled')),2500),url=URL.createObjectURL(new Blob(['postMessage("blob-worker-completed")'])),worker=new Worker(url);worker.onmessage=e=>{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);resolve(e.data);};worker.onerror=()=>reject(Error('Blob worker failed'));}));assert.equal(blob,'blob-worker-completed');
  const network=p._request.bind(p);p._request=event=>{if(event.redirectResponse)setTimeout(()=>network(event),30);else network(event);};
  let redirectTimer;const redirectSeen=new Promise((resolve,reject)=>{redirectTimer=setTimeout(()=>reject(Error('Redirect metadata missing')),1000);const listener=r=>{if(r.status()===302){p.off('response',listener);clearTimeout(redirectTimer);resolve();}};p.on('response',listener);});
  const response=await p.goto(f.url+'/redirect',{waitUntil:'load',timeout:5000});try{await redirectSeen;}finally{clearTimeout(redirectTimer);}assert.equal(response.status(),200);assert.equal(response.request().redirectChain().length,1);assert.ok(events.some(e=>e.status===302));
  await p.evaluate(()=>fetch('/denied'));await p.waitForFunction(()=>true,{timeout:1000});assert.ok(events.some(e=>e.status===401&&e.kind==='fetch'&&e.frame===p.mainFrame()));
  const failed=await p.goto(f.url+'/error',{waitUntil:'load',timeout:5000});assert.equal(failed.status(),503);
  p.off('request',pass);p.on('request',request=>void request.respond({status:200,contentType:'text/html',body:'<!doctype html><title>Intercepted locally</title><main>Fixture</main>'}).catch(()=>{}));
  const intercepted=await p.goto('https://www.linkedin.com/feed/',{waitUntil:'load',timeout:5000});assert.equal(intercepted.status(),200);assert.equal(await p.title(),'Intercepted locally');
  const extra=await p.target().createCDPSession();await extra.send('Network.enable');await extra.detach();assert.ok(!f.methods.includes('Runtime.enable'));
 }finally{await f.close();}
});
test('explicit page ownership lookup, bounded waits and close do not adopt or destroy another tab',async()=>{
 const f=await fixture(),p=f.page;try{
  const own=p.target()._targetId;assert.equal((await controller.existingTarget(f.browser,own)).targetId,own);assert.equal(await controller.existingTarget(f.browser,'not-a-target'),null);
  await p.goto(f.url+'/first',{waitUntil:'load',timeout:5000});await assert.rejects(p.waitForFunction(()=>false,{timeout:100,polling:'mutation'}),e=>e.name==='TimeoutError');
  const started=Date.now();await assert.rejects(p.waitForFunction(()=>new Promise(()=>{}),{timeout:100}),e=>e.name==='TimeoutError');assert.ok(Date.now()-started<1500,'an unresolved page promise cannot escape the caller deadline');
  const selection=await p.$$('a');assert.equal(selection.length,2);await Promise.all(selection.map(h=>h.dispose()));assert.equal(p._handles.size,0);
  const pending=p.waitForNavigation({timeout:5000});pending.catch(()=>{});await p.close();await assert.rejects(pending,/Target closed/);assert.equal(p.isClosed(),true);assert.equal(f.browser.isConnected(),true);
 }finally{await f.close();}
});
