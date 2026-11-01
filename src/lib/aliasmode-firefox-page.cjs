'use strict';
const {EventEmitter}=require('node:events');
const VERSION='ALIASMODE_FIREFOX_NATIVE_V1';
const safeHeaders=headers=>Object.fromEntries(Object.entries(headers||{}).filter(([key])=>['referer','sec-fetch-site','content-type','user-agent','location'].includes(key.toLowerCase())).map(([k,v])=>[k.toLowerCase(),String(v)]));
function literal(value,seen=new Set()){
 if(value===undefined)return 'undefined';if(value===null)return 'null';
 if(typeof value==='number')return Object.is(value,-0)?'-0':String(value);
 if(['string','boolean'].includes(typeof value))return JSON.stringify(value);
 if(typeof value==='bigint')return 'BigInt('+JSON.stringify(String(value))+')';
 if(value instanceof Date)return 'new Date('+JSON.stringify(value.toISOString())+')';
 if(value instanceof RegExp)return 'new RegExp('+JSON.stringify(value.source)+','+JSON.stringify(value.flags)+')';
 if(typeof value!=='object'||seen.has(value)||seen.size>30)throw Error('Unsupported or cyclic page argument');
 seen.add(value);let result;
 if(Array.isArray(value))result='['+value.map(v=>literal(v,seen)).join(',')+']';
 else{if(Object.getPrototypeOf(value)!==Object.prototype)throw Error('Unsupported page argument');result='{'+Object.entries(value).map(([k,v])=>'['+JSON.stringify(k)+']:'+literal(v,seen)).join(',')+'}';}
 seen.delete(value);if(result.length>3*1024*1024)throw Error('Page arguments exceed the bounded size');return result;
}
class Element{
 constructor(page,handle){this.page=page;this.handle=handle;this.disposed=false;}
 evaluate(fn,...args){return this.handle.evaluate(new Function('node','args','return ('+fn.toString()+')(node,...args);'),args);}
 scrollIntoView(){return this.evaluate(n=>n.scrollIntoView({block:'center',inline:'center',behavior:'instant'}));}
 boundingBox(){return this.handle.boundingBox();}
 async click(){await this.scrollIntoView();const b=await this.boundingBox();if(!b)throw Error('Node is detached from document');await this.page.mouse.click(b.x+b.width/2,b.y+b.height/2);}
 async dispose(){if(this.disposed)return;this.disposed=true;this.page.handles.delete(this);await this.handle.dispose();}
}
class Request{
 constructor(page,native){this.page=page;this.native=native;this.route=null;this.handled=false;}
 url(){return this.native.url();} headers(){return safeHeaders(this.native.headers());}
 resourceType(){return this.native.resourceType();}isNavigationRequest(){return this.native.isNavigationRequest();}
 frame(){try{return this.page.frame(this.native.frame());}catch{return null;}}
 redirectChain(){const values=[];let previous=this.native.redirectedFrom();while(previous&&values.length<8){values.unshift(this.page.request(previous));previous=previous.redirectedFrom();}return values;}
 failure(){return this.native.failure();}isInterceptResolutionHandled(){return this.handled;}
 async resolve(action,options){if(this.handled)return;if(!this.route)throw Error('Request is not intercepted');this.handled=true;return this.route[action](options);}
 continue(options={}){return this.resolve('continue',options);}
 abort(){return this.resolve('abort','aborted');}
 respond({status=200,headers={},contentType,body=''}={}){if(Buffer.byteLength(body)>2*1024*1024)throw Error('Fixture response exceeds bound');return this.resolve('fulfill',{status,headers,contentType,body});}
}
class Response{
 constructor(page,native){this.page=page;this.native=native;}
 url(){return this.native.url();}status(){return this.native.status();}
 request(){return this.page.request(this.native.request());}frame(){return this.request().frame();}
 headers(){return safeHeaders(this.native.headers());}
 async text(){const body=await this.native.body();if(body.byteLength>2*1024*1024)throw Error('Browser response exceeds bound');return body.toString('utf8');}
 async json(){return JSON.parse(await this.text());}
}
class FirefoxPage extends EventEmitter{
 constructor(native,browser){
  super();this.native=native;this.browserOwner=browser;this.handles=new Set();this.requests=new WeakMap();this.frames=new WeakMap();this.bindings=[];this.disposed=false;this.fault=null;this.intercept=false;this.defaultTimeout=15000;
  this.controlTransport='ALIASMODE_FIREFOX_NATIVE';this.engine='aliasmode-firefox';
  this.mouse=native.mouse;this.keyboard=native.keyboard;
  const on=(name,fn)=>{native.on(name,fn);this.bindings.push([name,fn]);};
  on('request',r=>{if(!this.intercept)this.emit('request',this.request(r));});
  const context=native.context?.(),unsafe=r=>[401,403,429,999].includes(r.status());
  // Security responses from this profile's background workers/other tabs must
  // reach the same account hold handler. This observes metadata only, never
  // reads response bodies or adopts those tabs, and cannot cross profiles.
  this.context=context;this.contextResponse=context?.on?(r=>{if(unsafe(r))this.emit('response',new Response(this,r));}):null;
  if(this.contextResponse)context.on('response',this.contextResponse);
  on('response',r=>{if(!this.contextResponse||!unsafe(r))this.emit('response',new Response(this,r));});
  for(const name of ['requestfinished','requestfailed'])on(name,r=>this.emit(name,this.request(r)));
  on('framenavigated',f=>this.emit('framenavigated',this.frame(f)));
  for(const name of ['load','domcontentloaded','close'])on(name,()=>this.emit(name));
  on('crash',()=>{this.fault=Error('AliasMode Firefox page crashed');this.emit('controllererror',this.fault);});
 }
 request(native){let r=this.requests.get(native);if(!r){r=new Request(this,native);this.requests.set(native,r);}return r;}
 frame(native){if(!native)return null;let f=this.frames.get(native);if(!f){f={url:()=>native.url()};this.frames.set(native,f);}return f;}
 mainFrame(){return this.frame(this.native.mainFrame());}
 url(){return this.native.url();}isClosed(){return this.native.isClosed();}isUsable(){return !this.disposed&&!this.fault&&!this.isClosed();}
 target(){return {_targetId:this.native._guid};}browser(){return this.browserOwner;}workers(){return [];}
 setDefaultTimeout(ms){if(!Number.isInteger(ms)||ms<1)throw Error('A positive bounded timeout is required');this.defaultTimeout=ms;this.native.setDefaultTimeout(ms);}
 evaluate(fn,...args){
  // AliasMode Firefox explicitly opts new profiles into the core's native mw:
  // interface. Binary DOM/fetch reads belong in the page realm, rather than
  // crossing Gecko's Xray typed-array membrane. This changes no browser global
  // or prototype and adds no initialization/stealth script. Handles remain in
  // the native isolated DOM context; the core rejects handles on its mw: path.
  if(typeof fn==='string')return this.native.evaluate('mw:'+fn);
  const mapped=args.map(a=>a instanceof Element?a.handle:a);
  if(args.some(a=>a instanceof Element))return this.native.evaluate(new Function('args','return ('+fn.toString()+')(...args);'),mapped);
  return this.native.evaluate('mw:('+fn.toString()+')(...'+literal(mapped)+')');
 }
 async $$(selector){const handles=await this.native.$$(selector);if(handles.length+this.handles.size>1000){await Promise.all(handles.map(h=>h.dispose()));throw Error('Rendered element handle limit exceeded');}return handles.map(h=>{const e=new Element(this,h);this.handles.add(e);return e;});}
 async $(selector){const values=await this.$$(selector);await Promise.all(values.slice(1).map(e=>e.dispose()));return values[0]||null;}
 async waitForFunction(fn,{timeout=this.defaultTimeout,polling=100}={},...args){
  if(!Number.isFinite(timeout)||timeout<1)throw Error('A bounded wait is required');
  // Keep predicates in the same native page realm as evaluate(). The core's
  // main-world interface deliberately cannot return Playwright JS handles.
  const deadline=Date.now()+timeout,interval=typeof polling==='number'?Math.max(25,Math.min(polling,250)):100;
  let cancelled=false,timer;const failure=()=>Object.assign(Error('Waiting for page function failed: '+timeout+'ms exceeded'),{name:'TimeoutError'});
  const poll=(async()=>{while(!cancelled){
   try{const value=await this.evaluate(fn,...args);if(value)return {jsonValue:async()=>value,dispose:async()=>{}};}
   catch(error){if(this.isClosed()||this.disposed||!/execution context|context.*destroyed|cannot find context|navigat/i.test(error.message||''))throw error;}
   const remaining=deadline-Date.now();if(remaining<=0)throw failure();await new Promise(resolve=>setTimeout(resolve,Math.min(interval,remaining)));
  }throw failure();})();
  try{return await Promise.race([poll,new Promise((_,reject)=>{timer=setTimeout(()=>{cancelled=true;reject(failure());},timeout);})]);}finally{cancelled=true;clearTimeout(timer);}
 }
 async waitForSelector(selector,{timeout=this.defaultTimeout,visible=false}={}){const h=await this.native.waitForSelector(selector,{timeout,state:visible?'visible':'attached'});if(!h)return null;if(this.handles.size>=1000){await h.dispose();throw Error('Rendered element handle limit exceeded');}const e=new Element(this,h);this.handles.add(e);return e;}
 async goto(url,{waitUntil='load',timeout=this.defaultTimeout}={}){const r=await this.native.goto(url,{waitUntil,timeout});return r?new Response(this,r):null;}
 async waitForNavigation({waitUntil='load',timeout=this.defaultTimeout}={}){const r=await this.native.waitForNavigation({waitUntil,timeout});return r?new Response(this,r):null;}
 async setRequestInterception(enabled){
  if(typeof enabled!=='boolean')throw Error('Choose request interception mode');if(this.intercept===enabled)return;
  if(enabled){this.routeHandler=async(route,raw)=>{const request=this.request(raw);request.route=route;this.emit('request',request);};await this.native.route('**/*',this.routeHandler);}
  else await this.native.unroute('**/*',this.routeHandler);this.intercept=enabled;
 }
 bringToFront(){return this.native.bringToFront();}content(){return this.native.content();}title(){return this.native.title();}screenshot(options){return this.native.screenshot(options);}
 diagnostics(){let u;try{const parsed=new URL(this.url());u=parsed.origin+parsed.pathname;}catch{u='[unavailable]';}return {url:u,closed:this.isClosed(),transport:this.controlTransport};}
 async dispose(){if(this.disposed)return;this.disposed=true;for(const [name,fn]of this.bindings)this.native.off(name,fn);if(this.contextResponse)this.context.off('response',this.contextResponse);if(this.intercept)await this.native.unroute('**/*',this.routeHandler).catch(()=>{});await Promise.allSettled([...this.handles].map(h=>h.dispose()));}
 async close(){await this.native.close();await this.dispose();}
}
async function openPage(browser,{targetId}={}){
 const contexts=browser.contexts();if(contexts.length!==1)throw Error('AliasMode Firefox must expose exactly one persistent context');
 const existing=targetId?contexts[0].pages().find(p=>p._guid===targetId):null;
 const native=existing||await contexts[0].newPage();return new FirefoxPage(native,browser);
}
module.exports={VERSION,FirefoxPage,openPage,literal};
