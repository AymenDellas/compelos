'use strict';
// A bounded page controller over the installed Puppeteer's manual CDP sessions.
// CDP remains the transport. Contexts/handles are resolved explicitly instead of
// subscribing to Runtime execution-context/console events. No browser globals,
// detector results, cookies, user agents or prototype methods are patched.
const {EventEmitter}=require('node:events');
const {CDPSessionEvent}=require('puppeteer');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timeoutError=message=>Object.assign(Error(message),{name:'TimeoutError'});
// Callers retain their own 2 MiB evidence limits; allow JSON escaping/envelope
// overhead here instead of accidentally rejecting a valid bounded response.
const MAX_RESULT=5*1024*1024,MAX_HANDLES=1000;
function contextError(error){return /Cannot find context|Execution context was destroyed|Cannot find object|Inspected target navigated|Session closed|Target closed/i.test(error?.message||'');}
function remoteValue(result){
 if(result.unserializableValue==='NaN')return NaN;
 if(result.unserializableValue==='Infinity')return Infinity;
 if(result.unserializableValue==='-Infinity')return -Infinity;
 if(result.unserializableValue==='-0')return -0;
 if(typeof result.unserializableValue==='string'&&/^-?\d+n$/.test(result.unserializableValue))return BigInt(result.unserializableValue.slice(0,-1));
 return result.value;
}
function resultOf(response){
 if(response.exceptionDetails){const e=response.exceptionDetails;throw Error(String(e.exception?.description||e.text||'Page evaluation failed').slice(0,1200));}
 const result=response.result;if(!result)throw Error('Missing page evaluation result.');
 if(result.value!==undefined&&Buffer.byteLength(JSON.stringify(result.value))>MAX_RESULT)throw Error('Page evaluation result exceeded the bounded content size.');
 return result;
}
function argument(value,page){
 if(value instanceof Element){if(value.page!==page||value.disposed)throw Error('JSHandle is disposed or belongs to another page');return {objectId:value.objectId};}
 if(typeof value==='number'&&!Number.isFinite(value))return {unserializableValue:String(value)};
 if(typeof value==='bigint')return {unserializableValue:value+'n'};
 if(Object.is(value,-0))return {unserializableValue:'-0'};
 return value===undefined?{}:{value};
}
class Element{
 constructor(page,objectId){this.page=page;this.objectId=objectId;this.disposed=false;}
 async evaluate(fn,...args){
  if(this.disposed)throw Error('JSHandle is disposed');
  const result=await this.page._call(this.objectId,'function(...args){if(!this.isConnected)throw Error("Node is detached from document");return ('+fn.toString()+')(this,...args);}',args,true);
  return remoteValue(result);
 }
 async scrollIntoView(){await this.evaluate(n=>n.scrollIntoView({block:'center',inline:'center',behavior:'instant'}));}
 async boundingBox(){return this.evaluate(n=>{if(!n.getClientRects().length||getComputedStyle(n).visibility==='hidden')return null;const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});}
 async dispose(){if(this.disposed)return;this.disposed=true;this.page._handles.delete(this);await this.page._send('Runtime.releaseObject',{objectId:this.objectId}).catch(()=>{});}
 async click(){await this.scrollIntoView();const b=await this.boundingBox();if(!b)throw Error('Node is detached from document');await this.page.mouse.click(b.x+b.width/2,b.y+b.height/2);}
}
class Request{
 constructor(page,id,event){this.page=page;this.id=id;this.event=event;this.redirects=[];this.emitted=false;this.interceptId=null;this.handled=false;this.error=null;}
 url(){return this.event.request.url;}
 headers(){return Object.fromEntries(Object.entries(this.event.request.headers||{}).map(([k,v])=>[k.toLowerCase(),String(v)]));}
 resourceType(){return String(this.event.type||this.event.resourceType||'other').toLowerCase();}
 isNavigationRequest(){return this.resourceType()==='document';}
 frame(){return this.event.frameId===this.page._frameId?this.page._frame:null;}
 redirectChain(){return this.redirects;}
 failure(){return this.error;}
 isInterceptResolutionHandled(){return this.handled;}
 async _intercept(method,params={}){
  if(this.handled)return;this.handled=true;
  if(!this.interceptId)throw Error('Request interception is not available for this request');
  await this.page._send(method,{requestId:this.interceptId,...params});
 }
 async continue(options={}){
  const params={};for(const k of ['url','method','postData'])if(options[k]!==undefined)params[k]=options[k];
  if(options.headers)params.headers=Object.entries(options.headers).map(([name,value])=>({name,value:String(value)}));
  return this._intercept('Fetch.continueRequest',params);
 }
 async abort(){return this._intercept('Fetch.failRequest',{errorReason:'Aborted'});}
 async respond({status=200,headers={},contentType,body=''}={}){
  if(contentType)headers={...headers,'content-type':contentType};
  return this._intercept('Fetch.fulfillRequest',{responseCode:status,responseHeaders:Object.entries(headers).map(([name,value])=>({name,value:String(value)})),body:Buffer.from(body).toString('base64')});
 }
}
class Response{
 constructor(page,request,data){this.page=page;this.req=request;this.data=data;}
 status(){return this.data.status;}
 url(){return this.data.url||this.req.url();}
 request(){return this.req;}
 frame(){return this.req.frame();}
 async text(){const r=await this.page._send('Network.getResponseBody',{requestId:this.req.id}),value=r.base64Encoded?Buffer.from(r.body,'base64').toString('utf8'):r.body;if(Buffer.byteLength(value)>MAX_RESULT)throw Error('Response body exceeded the bounded content size');return value;}
 async json(){return JSON.parse(await this.text());}
}
class ControlledPage extends EventEmitter{
 constructor(browser,root,client,targetId,frame){
  super();this._browser=browser;this._root=root;this._clientSession=client;this._targetId=targetId;this._frameId=frame.id;this._url=frame.url;this._closed=false;this._disposed=false;this._global=null;this._generation=0;this._defaultTimeout=30000;this._interception=false;this._requests=new Map();this._pausedRequests=new Map();this._documents=new Map();this._handles=new Set();this._fault=null;this._lifecycleLog=[];
  this._frame={_id:frame.id,url:()=>this._url};
  this._target={_targetId:targetId,type:()=> 'page',url:()=>this._url,page:async()=>this,createCDPSession:()=>root.connection().createSession({targetId})};
  this._disconnect=()=>this._didClose();browser.on('disconnected',this._disconnect);
  client.on(CDPSessionEvent.Disconnected,()=>this._didClose());
  client.on('Page.frameNavigated',({frame:f})=>{if(f.parentId)return;this._frameId=f.id;this._frame._id=f.id;this._url=f.url;this._generation++;this._global=null;this._handles.clear();this._event('commit');this.emit('framenavigated',this._frame);this.emit('_navigation',{kind:'commit',loaderId:f.loaderId});});
  client.on('Page.navigatedWithinDocument',e=>{if(e.frameId!==this._frameId)return;this._url=e.url;this.emit('framenavigated',this._frame);this.emit('_navigation',{kind:'same-document'});});
  client.on('Page.lifecycleEvent',e=>{if(e.frameId===this._frameId){this._event(e.name);this.emit('_navigation',{kind:e.name,loaderId:e.loaderId});}});
  client.on('Network.requestWillBeSent',e=>this._request(e));
  client.on('Fetch.requestPaused',e=>this._paused(e));
  client.on('Network.responseReceived',e=>this._response(e));
  client.on('Network.loadingFinished',e=>this._finished(e));
  client.on('Network.loadingFailed',e=>this._finished(e,true));
  let x=0,y=0;
  this.mouse={move:async(nx,ny,{steps=1}={})=>{if(!Number.isFinite(nx)||!Number.isFinite(ny)||!Number.isInteger(steps)||steps<1||steps>20)throw Error('Invalid bounded pointer movement');const ox=x,oy=y;x=nx;y=ny;for(let i=1;i<=steps;i++)await this._send('Input.dispatchMouseEvent',{type:'mouseMoved',x:ox+(nx-ox)*i/steps,y:oy+(ny-oy)*i/steps,button:'none'});},click:async(nx,ny)=>{await this.mouse.move(nx,ny);await this._send('Input.dispatchMouseEvent',{type:'mousePressed',x:nx,y:ny,button:'left',buttons:1,clickCount:1});await this._send('Input.dispatchMouseEvent',{type:'mouseReleased',x:nx,y:ny,button:'left',buttons:0,clickCount:1});},wheel:({deltaY=0,deltaX=0}={})=>this._send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX,deltaY})};
 }
 _send(method,params={},options){if(this._fault)return Promise.reject(this._fault);if(this._disposed||this._closed)return Promise.reject(Error('Target closed'));return this._clientSession.send(method,params,options);}
 _event(kind){this._lifecycleLog.push(kind);if(this._lifecycleLog.length>20)this._lifecycleLog.shift();}
 _bounded(){if(this._requests.size>1024||this._pausedRequests.size>1024){this._fault=Error('Too many concurrent page requests');this._requests.clear();this._pausedRequests.clear();this.emit('controllererror',this._fault);return false;}return true;}
 _emitRequest(request){if(!request.emitted){request.emitted=true;this.emit('request',request);}}
 _request(e){
  if(this._fault)return;
  let previous=this._requests.get(e.requestId);
  if(e.redirectResponse&&previous){
   const old=previous._provisional?previous._previous:previous;
   if(old){this.emit('response',new Response(this,old,e.redirectResponse));this.emit('requestfinished',old);}
   if(previous._provisional&&previous.url()===e.request.url){previous.redirects=old?[...old.redirects,old].slice(-8):[];}
   else{const next=new Request(this,e.requestId,e);next.redirects=old?[...old.redirects,old].slice(-8):[];previous=next;}
  }
  const request=previous||new Request(this,e.requestId,e);request.event=e;this._requests.set(e.requestId,request);
  request._provisional=false;request._previous=null;
  if(!this._bounded())return;
  const paused=this._pausedRequests.get(e.requestId);if(paused&&paused.request.url===e.request.url){request.interceptId=paused.requestId;this._pausedRequests.delete(e.requestId);}
  if(!this._interception||request.interceptId)this._emitRequest(request);
 }
 _paused(e){
  if(this._fault)return;
  const id=e.networkId||e.requestId;let request=this._requests.get(id);
  // Fetch can precede Network, and worker/blob script requests may never have
  // a matching Network event on this page. Resume from Fetch's own metadata;
  // retain the old request separately if Network later supplies a redirect.
  if(!request||request.handled||request.url()!==e.request.url){const next=new Request(this,id,{...e,type:e.resourceType});next._provisional=true;next._previous=request?._provisional?request._previous:request;next.redirects=request?[...request.redirects,request].slice(-8):[];request=next;}
  request.interceptId=e.requestId;this._requests.set(id,request);if(this._bounded())this._emitRequest(request);
 }
 _response(e){
  const request=this._requests.get(e.requestId);if(!request)return;
  const response=new Response(this,request,e.response);
  if(request.isNavigationRequest()&&request.frame()===this._frame){this._documents.set(e.loaderId,response);if(this._documents.size>16)this._documents.delete(this._documents.keys().next().value);}
  this.emit('response',response);
 }
 _finished(e,failed=false){const request=this._requests.get(e.requestId);if(!request)return;if(failed){request.error={errorText:e.errorText||'REQUEST_FAILED'};if(request.isNavigationRequest()&&request.frame()===this._frame)this.emit('_navigation',{kind:'failed',error:Error(request.error.errorText)});}this.emit(failed?'requestfailed':'requestfinished',request);this._requests.delete(e.requestId);this._pausedRequests.delete(e.requestId);}
 _didClose(){if(this._closed)return;this._closed=true;this._global=null;this._handles.clear();this.emit('close');}
 url(){return this._url;}
 isClosed(){return this._closed;}
 target(){return this._target;}
 mainFrame(){return this._frame;}
 workers(){return [];}
 browser(){return this._browser;}
 _client(){return this._clientSession;}
 diagnostics(){const route=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.origin+u.pathname:u.protocol+'[non-http]';}catch{return '[unavailable]';}};return {url:route(this._url),closed:this._closed,generation:this._generation,activeRequests:this._requests.size,pausedRequests:[...this._requests.values()].filter(r=>r.interceptId&&!r.handled).length,events:[...this._lifecycleLog],pending:[...this._requests.values()].slice(0,20).map(r=>({url:route(r.url()),kind:r.resourceType(),paused:!!r.interceptId,handled:r.handled}))};}
 setDefaultTimeout(ms){if(!Number.isInteger(ms)||ms<1)throw Error('A positive bounded timeout is required');this._defaultTimeout=ms;}
 async _globalObject(){if(!this._global)this._global=this._send('Runtime.evaluate',{expression:'globalThis',returnByValue:false,objectGroup:'compelos-page'}).then(r=>{const value=resultOf(r);if(!value.objectId)throw Error('Missing page context');return value.objectId;}).catch(e=>{this._global=null;throw e;});return this._global;}
 async _call(objectId,declaration,args,returnByValue){
  try{return resultOf(await this._send('Runtime.callFunctionOn',{objectId,functionDeclaration:declaration,arguments:args.map(value=>argument(value,this)),awaitPromise:true,returnByValue,objectGroup:'compelos-page'}));}
  catch(error){if(contextError(error))this._global=null;throw error;}
 }
 async evaluate(fn,...args){
  if(typeof fn==='string')return remoteValue(resultOf(await this._send('Runtime.evaluate',{expression:fn,awaitPromise:true,returnByValue:true,objectGroup:'compelos-page'})));
  if(typeof fn!=='function')throw Error('A page function or expression is required');
  return remoteValue(await this._call(await this._globalObject(),'function(...args){return ('+fn.toString()+')(...args);}',args,true));
 }
 async $$(selector){
  const array=await this._call(await this._globalObject(),'function(selector){return Array.from(document.querySelectorAll(selector));}',[selector],false);
  if(!array.objectId)return [];
  try{
   const {result}=await this._send('Runtime.getProperties',{objectId:array.objectId,ownProperties:true});
   const entries=result.filter(p=>/^\d+$/.test(p.name)&&p.value?.objectId);
   if(entries.length+this._handles.size>MAX_HANDLES)throw Error('Rendered element handle limit exceeded');
   return entries.map(p=>{const handle=new Element(this,p.value.objectId);this._handles.add(handle);return handle;});
  }finally{await this._send('Runtime.releaseObject',{objectId:array.objectId}).catch(()=>{});}
 }
 async $(selector){const values=await this.$$(selector);await Promise.all(values.slice(1).map(h=>h.dispose()));return values[0]||null;}
 async waitForFunction(fn,{timeout=this._defaultTimeout,polling=100}={},...args){
  if(!Number.isFinite(timeout)||timeout<1)throw Error('A positive bounded wait is required');
  const started=Date.now(),generation=this._generation,interval=typeof polling==='number'?Math.max(25,Math.min(polling,250)):100;let cancelled=false,timer;
  const failure=()=>timeoutError('Waiting for page function failed: '+timeout+'ms exceeded'+(generation!==this._generation?' after navigation':''));
  const poll=(async()=>{do{
   try{const value=await this.evaluate(fn,...args);if(value)return {jsonValue:async()=>value,dispose:async()=>{}};}
   catch(error){if(this._closed||!contextError(error))throw error;this._global=null;}
   if(this._closed)throw Error('Target closed');
   if(Date.now()-started>=timeout)break;
   await delay(Math.min(interval,Math.max(1,timeout-(Date.now()-started))));
  }while(!this._closed&&!cancelled);
  throw failure();})();
  try{return await Promise.race([poll,new Promise((_,reject)=>{timer=setTimeout(()=>{cancelled=true;reject(failure());},timeout);})]);}finally{cancelled=true;clearTimeout(timer);}
 }
 async waitForSelector(selector,{timeout=this._defaultTimeout,visible=false}={}){
  await this.waitForFunction(({selector,visible})=>{const n=document.querySelector(selector);return !!n&&(!visible||n.getClientRects().length>0&&getComputedStyle(n).visibility!=='hidden');},{timeout}, {selector,visible});
  return this.$(selector);
 }
 waitForNavigation({waitUntil='load',timeout=this._defaultTimeout}={}){
  const kind=waitUntil==='domcontentloaded'?'DOMContentLoaded':waitUntil;
  if(!['load','DOMContentLoaded'].includes(kind)||!Number.isFinite(timeout)||timeout<1)return Promise.reject(Error('Unsupported or unbounded navigation wait'));
  let cancel;const promise=new Promise((resolve,reject)=>{
   let loader=null,committed=false;
   const cleanup=()=>{clearTimeout(timer);this.off('_navigation',event);this.off('close',closed);};
   const closed=()=>{cleanup();reject(Error('Target closed'));};
   cancel=error=>{cleanup();reject(error);};
   const event=e=>{
    if(e.kind==='failed'){cleanup();reject(e.error);return;}
    if(e.kind==='same-document'){cleanup();resolve(null);return;}
    if(e.kind==='commit'){loader=e.loaderId;committed=true;return;}
    if(committed&&e.kind===kind&&e.loaderId===loader){cleanup();resolve(this._documents.get(loader)||null);}
   };
   const timer=setTimeout(()=>{cleanup();reject(timeoutError('Navigation timeout of '+timeout+' ms exceeded'));},timeout);
   this.on('_navigation',event);this.once('close',closed);
  });promise.cancel=cancel;return promise;
 }
 async goto(url,options={}){
  const navigation=this.waitForNavigation(options);navigation.catch(()=>{});
  try{const result=await this._send('Page.navigate',{url});if(result.errorText)throw Error(result.errorText+' at requested page');return await navigation;}
  catch(error){navigation.cancel(error);throw error;}
 }
 async setRequestInterception(enabled){if(typeof enabled!=='boolean')throw Error('Invalid request interception mode');this._interception=enabled;await this._send(enabled?'Fetch.enable':'Fetch.disable',enabled?{patterns:[{urlPattern:'*',requestStage:'Request'}]}:{});}
 async content(){return this.evaluate(()=>document.documentElement.outerHTML);}
 async title(){return this.evaluate(()=>document.title);}
 async bringToFront(){await this._send('Page.bringToFront');}
 async close(){if(this._closed)return;await this._root.send('Target.closeTarget',{targetId:this._targetId});this._didClose();await this.dispose();}
 async dispose(){if(this._disposed)return;this._browser.off('disconnected',this._disconnect);await this._clientSession.send('Runtime.releaseObjectGroup',{objectGroup:'compelos-page'}).catch(()=>{});this._disposed=true;await this._clientSession.detach().catch(()=>{});await this._root.detach().catch(()=>{});this._requests.clear();this._pausedRequests.clear();this._documents.clear();this._handles.clear();this.removeAllListeners();}
}
async function existingTarget(browser,targetId){
 const session=await browser.target().createCDPSession();try{const {targetInfos}=await session.send('Target.getTargets');return targetInfos.find(t=>t.targetId===targetId&&t.type==='page')||null;}finally{await session.detach();}
}
async function openPage(browser,{targetId}={}){
 if(require('puppeteer-core/package.json').version!=='24.38.0')throw Error('Explicit page contexts require the verified pinned Puppeteer Core 24.38.0; run compatibility fixtures before changing it');
 const root=await browser.target().createCDPSession();let client,created=false;
 try{
  const connection=root.connection();if(typeof connection?.createSession!=='function')throw Error('Installed Puppeteer cannot create an explicit page session');
  if(!targetId){({targetId}=await root.send('Target.createTarget',{url:'about:blank'}));created=true;}
  client=await connection.createSession({targetId});
  // Resume only this explicitly owned worker target if discovery paused it at
  // creation. This does not subscribe to execution-context or console events.
  await client.send('Runtime.runIfWaitingForDebugger');
  await client.send('Page.enable');await client.send('Network.enable');await client.send('Page.setLifecycleEventsEnabled',{enabled:true});
  const {frameTree}=await client.send('Page.getFrameTree');return new ControlledPage(browser,root,client,targetId,frameTree.frame);
 }catch(error){if(created)await root.send('Target.closeTarget',{targetId}).catch(()=>{});await client?.detach().catch(()=>{});await root.detach().catch(()=>{});throw error;}
}
module.exports={openPage,existingTarget,ControlledPage};
