'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createAliasModeFirefoxBrowser}=require('../../src/lib/aliasmode-firefox-browser.cjs');
const {connection,createFirefoxRuntime}=require('../../src/lib/aliasmode-firefox-runtime.cjs');
const {FirefoxPage}=require('../../src/lib/aliasmode-firefox-page.cjs');
let sequence=0;
function fixture({active=false,headless=false,saved=false,profileEngine='firefox',controlled=true}={}){
 const id='native-fixture-'+(++sequence),account={id,aliasmode_profile_id:id,engine:'aliasmode-firefox',launch_mode:'headful'},owner='owner';
 const calls=[];let allowed=true,connected=false,owned=false,stopWorks=true,generation='a'.repeat(32),pid=12345,row=saved?{account_id:id,managed:true,pid:12345,target_id:'page@worker'}:null,failPage=false;
 const nativePage={_guid:'page@worker'},humanPage={_guid:'page@human'};
 const browser=new EventEmitter();browser.version=async()=> '156.0.1-beta.36';browser.isConnected=()=>connected;browser.contexts=()=>[{pages:()=>[humanPage,...(row?.target_id?[nativePage]:[])]}];browser.close=async()=>{calls.push('transport.close');connected=false;browser.emit('disconnected');};
 const info=()=>({version:'COMPELOS_FIREFOX_CONTROL_V1',profileId:id,engine:'firefox',protocol:'playwright',evaluation:'native-main-world',startupMode:'blank',endpoint:'ws://127.0.0.1:9333/'+'b'.repeat(64),instanceId:'firefox://127.0.0.1:9444/'+generation,generation,pid,headless});
 const client={call:async(method,params)=>{
  calls.push(method);if(method==='profiles.list')return {profiles:[{id,engine:profileEngine,tags:controlled?['compelos-firefox-native-v1']:[]}]};assert.equal(params.profileId,id);
  if(method==='browser.status')return {profileId:id,engine:'firefox',running:active,state:active?'running':'closed',headless};
  if(method==='browser.open'){if(active)throw Error('Already open');active=true;owned=true;headless=params.headless;return {engine:'firefox',ownedByConnection:true,alreadyOpen:false,headless};}
  if(method==='firefox.connection'){if(!active)throw Error('Closed');return info();}
  if(method==='browser.detach'){owned=false;return {detached:true};}
  if(method==='browser.close'){assert.equal(params.expectedEndpoint,info().instanceId);if(stopWorks)active=false;owned=false;return {closed:!active};}
  throw Error('Unexpected manager call');
 },attach:async()=>{calls.push('attach');connected=true;return browser;},close:()=>{calls.push('manager.close');if(owned){calls.push('AUTOMATIC_CLOSE');active=false;}}};
 let page;
 const pages={VERSION:'ALIASMODE_FIREFOX_NATIVE_V1',openPage:async(_browser,{targetId})=>{calls.push('page.open');if(failPage){allowed=false;throw Error('Ownership changed during open');}assert.ok(!targetId||targetId==='page@worker');let disposed=false,closed=false;page={isUsable:()=>!disposed&&!closed,isClosed:()=>closed,target:()=>({_targetId:'page@worker'}),dispose:async()=>{disposed=true;calls.push('page.dispose');},close:async()=>{closed=true;calls.push('page.close');},bringToFront:async()=>calls.push('front')};return page;}};
 const store={assertOwner:async()=>{if(!allowed)throw Object.assign(Error('Lease changed'),{failure:{stage:'provider'},code:'ALIASMODE_OWNERSHIP_CHANGED'});},session:async()=>row,saveSession:async(_p,_a,_o,value)=>{row={...value,account_id:id,target_id:value.targetId};},finishSession:async()=>{if(row)row.closed_at='closed';}};
 return {account,calls,browser,options:{account,owner,pool:{},provider:{store},pages,runtime:{connect:async()=>client}},info,get active(){return active;},get row(){return row;},set allowed(v){allowed=v;},set stopWorks(v){stopWorks=v;},set generation(v){generation=v;pid++;},set failPage(v){failPage=v;}};
}
test('native capability rejects remote URLs, wrong engines and missing generation/process/mode evidence',()=>{
 const f=fixture();assert.equal(connection(f.info(),f.account.id).engine,'firefox');
 for(const patch of [{endpoint:'ws://example.com:9333/'+'b'.repeat(64)},{endpoint:'ws://127.0.0.1:9333/short'},{engine:'chromium'},{pid:0},{generation:'unknown'},{headless:null},{instanceId:'ws://127.0.0.1:9333/devtools/browser/x'}])assert.throws(()=>connection({...f.info(),...patch},f.account.id));
});
test('a closed wrong-engine or unknown profile is rejected before any browser launch',async()=>{
 for(const engine of ['chromium',undefined]){const f=fixture({profileEngine:engine===undefined?'unknown':engine}),b=createAliasModeFirefoxBrowser(f.options);await assert.rejects(b.open(),e=>e.code==='ALIASMODE_FIREFOX_PROFILE');assert.equal(f.calls.includes('browser.open'),false);assert.equal(f.active,false);}
});
test('an older Firefox profile cannot launch restored pages before reserving a visit',async()=>{
 const f=fixture({controlled:false}),b=createAliasModeFirefoxBrowser(f.options);await assert.rejects(b.open(),e=>e.code==='ALIASMODE_FIREFOX_CONFIGURATION');assert.equal(f.calls.includes('browser.open'),false);
});
test('new native launch persists before handoff and disconnect preserves its browser',async()=>{
 const f=fixture(),b=createAliasModeFirefoxBrowser(f.options),[one,two]=await Promise.all([b.open(),b.open()]);assert.equal(one,two);assert.equal(b.pid(),12345);assert.equal(b.isHeadless(),false);assert.equal(f.row.managed,true);assert.ok(f.calls.indexOf('page.open')<f.calls.indexOf('browser.detach'));await b.close();assert.equal(f.active,true);assert.equal(f.calls.includes('browser.close'),false);assert.equal(f.calls.includes('AUTOMATIC_CLOSE'),false);
});
test('manual instances are detached on recycle and explicit Close is generation-fenced',async()=>{
 const f=fixture({active:true}),b=createAliasModeFirefoxBrowser(f.options);await b.open();assert.equal(f.row.managed,false);await b.recycle();assert.equal(f.active,true);await b.stop();assert.equal(f.active,false);
});
test('owned stop refuses to close a replacement instance',async()=>{
 const f=fixture(),b=createAliasModeFirefoxBrowser(f.options);await b.open();f.generation='c'.repeat(32);await assert.rejects(b.stop(),e=>e.code==='ALIASMODE_INSTANCE_CHANGED');assert.equal(f.active,true);assert.equal(f.calls.includes('browser.close'),false);await b.disconnect();
});
test('ownership loss blocks native lifecycle mutations, including manager automatic cleanup',async()=>{
 const f=fixture(),b=createAliasModeFirefoxBrowser(f.options);f.failPage=true;await assert.rejects(b.open(),e=>e.code==='ALIASMODE_CLEANUP_PENDING');assert.equal(f.active,true);assert.equal(f.calls.includes('browser.close'),false);assert.equal(f.calls.includes('AUTOMATIC_CLOSE'),false);assert.ok(f.calls.includes('browser.detach'));await b.close();
});
test('managed mode switches require both saved PID and recorded worker target',async()=>{
 const f=fixture({active:true,headless:true,saved:true}),b=createAliasModeFirefoxBrowser(f.options);await b.open({headless:false});assert.equal(b.isHeadless(),false);assert.equal(f.calls.filter(x=>x==='browser.close').length,1);assert.equal(f.calls.filter(x=>x==='browser.open').length,1);await b.recycle();
 const human=fixture({active:true,headless:true}),other=createAliasModeFirefoxBrowser(human.options);await assert.rejects(other.open({headless:false}),e=>e.code==='ALIASMODE_MODE_CONFLICT');assert.equal(human.calls.includes('browser.close'),false);assert.equal(human.active,true);await other.close();
});
test('unconfirmed stop prevents another open until a confirmed Close',async()=>{
 const f=fixture(),b=createAliasModeFirefoxBrowser(f.options);await b.open();f.stopWorks=false;await assert.rejects(b.stop(),e=>e.code==='ALIASMODE_STOP_PENDING');await assert.rejects(b.open(),e=>e.code==='ALIASMODE_STOP_PENDING');assert.equal(f.calls.filter(x=>x==='browser.open').length,1);f.stopWorks=true;await b.stop();assert.equal(f.active,false);
});
test('no validated Firefox capability means no native attachment or browser fallback',async()=>{
 let closes=0,attaches=0;const runtime=createFirefoxRuntime({helper:{version:async()=> '0.1.0-beta.69'},load:async()=>({discoverRuntime:async()=>({client:{call:async()=>({version:'wrong'}),close:()=>closes++}}),firefox:{connect:async()=>attaches++}})});
 await assert.rejects(runtime.connect(),e=>e.code==='ALIASMODE_FIREFOX_UNAVAILABLE');assert.equal(attaches,0);assert.equal(closes,1);
});
test('native control requests have a deadline and retire the failed connection',async()=>{
 let closes=0;const runtime=createFirefoxRuntime({commandTimeoutMs:25,helper:{version:async()=> '0.1.0-beta.69'},load:async()=>({discoverRuntime:async()=>({client:{call:async method=>method==='firefox.connectionCapability'?{version:'COMPELOS_FIREFOX_CONTROL_V1',protocol:'playwright',lifecycleOwner:'AliasMode',evaluation:'native-main-world',startupMode:'blank'}:new Promise(()=>{}),close:()=>closes++}}),firefox:{}})});
 const client=await runtime.connect();await assert.rejects(client.call('browser.status',{profileId:'fixture'}),e=>e.code==='ALIASMODE_CLI_TIMEOUT');assert.equal(closes,1);
});
test('native page expressions preserve arguments and cannot turn supplied text into code',async()=>{
 const vm=require('node:vm'),context=vm.createContext({}),native=new EventEmitter();native.evaluate=async text=>{assert.ok(text.startsWith('mw:'));return await vm.runInContext(text.slice(3),context);};const page=new FirefoxPage(native,{});
 const dangerous='\");globalThis.accident=true;//';assert.equal(await page.evaluate(value=>value,dangerous),dangerous);assert.equal(context.accident,undefined);
 const result=await page.evaluate((...values)=>[values[0]===undefined,Number.isNaN(values[1]),values[2]===Infinity,Object.is(values[3],-0),values[4].nested===undefined],undefined,NaN,Infinity,-0,{nested:undefined});assert.deepEqual(Array.from(result),[true,true,true,true,true]);
 const cycle={};cycle.self=cycle;assert.throws(()=>page.evaluate(v=>v,cycle),/cyclic/);await page.dispose();
});
test('predicate waits share the native page realm and bound even an unresolved promise',async()=>{
 const vm=require('node:vm'),context=vm.createContext({}),native=new EventEmitter();native.evaluate=async text=>await vm.runInContext(text.slice(3),context);native.isClosed=()=>false;const page=new FirefoxPage(native,{});
 await page.evaluate(()=>{globalThis.fixtureValue=7;});const handle=await page.waitForFunction(()=>globalThis.fixtureValue===7,{timeout:200});assert.equal(await handle.jsonValue(),true);await handle.dispose();
 await assert.rejects(page.waitForFunction(()=>new Promise(()=>{}),{timeout:40}),e=>e.name==='TimeoutError');await page.dispose();
});
test('security responses are observed across the bound profile and never leak to another profile',async()=>{
 const make=()=>{const context=new EventEmitter(),native=new EventEmitter();native.context=()=>context;return {context,native,page:new FirefoxPage(native,{})};},one=make(),two=make();const observed=[[],[]];one.page.on('response',r=>observed[0].push(r.status()));two.page.on('response',r=>observed[1].push(r.status()));
 const denied={status:()=>401,url:()=> 'https://www.linkedin.com/fixture'};one.context.emit('response',denied);one.native.emit('response',denied);assert.deepEqual(observed,[[401],[]]);await one.page.dispose();one.context.emit('response',denied);assert.deepEqual(observed,[[401],[]]);await two.page.dispose();
});
