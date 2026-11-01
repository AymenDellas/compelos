'use strict';
const {profileId,providerError}=require('./aliasmode-client.cjs');
const {connection,createFirefoxRuntime}=require('./aliasmode-firefox-runtime.cjs');
const pageController=require('./aliasmode-firefox-page.cjs');
const localOwnership=new Map();
function createAliasModeFirefoxBrowser({account,owner,pool,provider,onDisconnect=()=>{},onStage=()=>{},runtime=createFirefoxRuntime(),pages=pageController,ownership=localOwnership}){
 const id=profileId(account.aliasmode_profile_id),store=provider.store;
 let entry=null,opening=null,openingMode=null,closing=null,cancelled=false,stopPending=false;
 const assertOwner=()=>store.assertOwner(pool,account,owner);
 const error=(code,text)=>providerError(code,text);
 const usable=()=>!!entry?.browser.isConnected()&&entry.page.isUsable();
 const verify=async(client)=>connection(await client.call('firefox.connection',{profileId:id}),id);
 async function detach(release=true){
  if(entry){const e=entry;entry=null;e.expected=true;e.browser.off('disconnected',e.listener);await e.page.dispose().catch(()=>{});
   // Native connect() marks close as transport-only. Never close the saved
   // persistent context; AliasMode remains the browser lifecycle owner.
   await e.browser.close().catch(()=>{});e.client.close();}
  if(release&&ownership.get(id)===owner)ownership.delete(id);
 }
 async function finish(){await store.finishSession(pool,account,owner);}
 async function stop(force=false){
  await assertOwner();
  if(entry&&!force&&!entry.managed){await detach();await finish();return;}
  let client=entry?.client,temporary=false;
  if(!client){if(!force)return;client=await runtime.connect();temporary=true;}
  try{
   const state=await client.call('browser.status',{profileId:id});
   if(state.running){const current=await verify(client);
    if(entry&&(entry.connection.generation!==current.generation||entry.connection.pid!==current.pid||entry.connection.instanceId!==current.instanceId))throw error('ALIASMODE_INSTANCE_CHANGED','The Firefox instance changed. The replacement browser was left open.');
    await assertOwner();stopPending=true;if(entry){entry.expected=true;await entry.page.close().catch(()=>{});}
    await client.call('browser.close',{profileId:id,expectedEndpoint:current.instanceId});
   }else if(state.state!=='closed')throw error('ALIASMODE_STOP_PENDING','AliasMode has not confirmed Firefox closure.');
   if((await client.call('browser.status',{profileId:id})).state!=='closed')throw error('ALIASMODE_STOP_PENDING','Firefox closure remains unconfirmed.');
   await detach();await finish();stopPending=false;
  }catch(e){if(entry)entry.expected=false;throw e;}finally{if(temporary)client.close();}
 }
 function open({headless=account.launch_mode==='headless'}={}){
  if(closing)return Promise.reject(error('ALIASMODE_CLOSING','This Firefox profile is closing.'));
  if(stopPending)return Promise.reject(error('ALIASMODE_STOP_PENDING','The previous Firefox stop is unconfirmed. Retry Close profile before reopening.'));
  if(typeof headless!=='boolean')return Promise.reject(error('ALIASMODE_MODE_UNVERIFIED','Choose a supported browser mode.'));
  if(opening)return openingMode===headless?opening:Promise.reject(error('ALIASMODE_MODE_CONFLICT','Another browser mode is opening.'));
  if(usable()&&entry.headless===headless)return Promise.resolve({browser:entry.browser,page:entry.page});
  if(ownership.has(id)&&ownership.get(id)!==owner)return Promise.reject(error('ALIASMODE_PROFILE_BUSY','This profile already has an automation owner.'));
  ownership.set(id,owner);cancelled=false;openingMode=headless;
  opening=(async()=>{
   let client,browser,page,started=false,createdPage=false,info;
   const check=async()=>{await assertOwner();if(cancelled)throw error('ALIASMODE_OPEN_CANCELLED','Firefox opening was cancelled. Queued work is retained.');};
   try{
    if(usable()&&entry.headless!==headless){if(!entry.managed)throw error('ALIASMODE_MODE_CONFLICT','Close the manually opened Firefox profile before changing its mode.');await stop();ownership.set(id,owner);}else if(entry)await detach(false);
    await check();client=await runtime.connect();await check();
    let state=await client.call('browser.status',{profileId:id});const saved=await store.session(pool,id);
    let previous=saved?.account_id===account.id&&!saved.closed_at?saved:null;
    if(state.running){
     info=await verify(client);
     if(state.engine!=='firefox'||state.headless!==info.headless)throw error('ALIASMODE_MODE_UNVERIFIED','AliasMode did not confirm the Firefox engine and mode.');
     if(state.headless!==headless){
      browser=await client.attach(info);const target=browser.contexts().flatMap(c=>c.pages()).find(p=>p._guid===previous?.target_id);
      if(!previous?.managed||previous.pid!==info.pid||!target)throw error('ALIASMODE_MODE_CONFLICT','The wrong-mode Firefox browser has no verified CompelOS ownership. Close it explicitly.');
      await check();await client.call('browser.close',{profileId:id,expectedEndpoint:info.instanceId});await browser.close().catch(()=>{});browser=null;previous=null;
      state=await client.call('browser.status',{profileId:id});
     }
    }
    if(!state.running){
     if(state.state!=='closed')throw error('ALIASMODE_LIFECYCLE_UNCERTAIN','Reconcile the Firefox profile lifecycle in AliasMode before reopening.');
     const profile=(await client.call('profiles.list')).profiles?.find(p=>p.id===id);
     if(profile?.engine!=='firefox')throw error('ALIASMODE_FIREFOX_PROFILE','The bound closed profile is not confirmed as Firefox. Refresh AliasMode profiles and choose the actual engine; no browser was launched.');
     if(!profile.tags?.includes('compelos-firefox-native-v1'))throw error('ALIASMODE_FIREFOX_CONFIGURATION','This older Firefox profile lacks reserved-navigation startup controls. Use a freshly provisioned profile from the validated AliasMode setup; no browser was launched.');
     onStage('PROFILE_OPENING','Opening the saved AliasMode Firefox profile.');
     const opened=await client.call('browser.open',{profileId:id,headless});
     if(opened.alreadyOpen||!opened.ownedByConnection||opened.engine!=='firefox')throw error('ALIASMODE_CLI_RACE','AliasMode did not confirm a newly owned Firefox launch.');
     started=true;
    }
    await check();info=await verify(client);
    if(info.headless!==headless)throw error('ALIASMODE_MODE_UNVERIFIED','The requested Firefox mode was not confirmed.');
    onStage('NATIVE_FIREFOX_ATTACHING','Connecting through AliasMode’s native Firefox transport.');
    if(!browser)browser=await client.attach(info);await check();
    if(!browser.isConnected()||browser.contexts().length!==1)throw error('ALIASMODE_FIREFOX_CONNECTION','Firefox did not expose its saved persistent context.');
    const browserVersion=await browser.version();
    if(browserVersion!=='156.0.1-beta.36')throw error('ALIASMODE_FIREFOX_VERSION','This Firefox core has not been validated with the native controller. Review the provider update before using it.');
    const target=previous?.pid===info.pid?browser.contexts()[0].pages().find(p=>p._guid===previous.target_id):null;
    page=await pages.openPage(browser,{targetId:target?._guid});createdPage=!target;await check();
    const again=await verify(client);
    if(again.generation!==info.generation||again.pid!==info.pid||again.instanceId!==info.instanceId||again.headless!==headless)throw error('ALIASMODE_INSTANCE_CHANGED','Firefox changed during attachment.');
    Object.defineProperty(page,'providerConfiguration',{value:Object.freeze({identityMode:'aliasmode-firefox-profile',providerControlVersion:pages.VERSION,browserVersion}),configurable:false});
    const managed=started||previous?.managed===true&&!!target;
    const record={client,browser,page,connection:info,pid:info.pid,headless,managed,targetId:page.target()._targetId,expected:false};
    record.listener=()=>{if(entry===record&&!record.expected)onDisconnect(error('ALIASMODE_FIREFOX_DISCONNECTED','AliasMode Firefox disconnected. Saved checkpoints and account holds remain.'));};
    browser.on('disconnected',record.listener);entry=record;
    await store.saveSession(pool,account,owner,{managed,headless,pid:record.pid,targetId:record.targetId});await check();
    // Handoff only after the fenced receipt is durable. A subsequent manager
    // connection loss must not close a held browser awaiting human review.
    if(started)await client.call('browser.detach',{profileId:id});
    return {browser,page};
   }catch(e){
    if(entry){entry.expected=true;entry.browser.off('disconnected',entry.listener);entry=null;}
    if(createdPage){try{await assertOwner();await page?.close();}catch{await page?.dispose().catch(()=>{});}}else await page?.dispose().catch(()=>{});
    await browser?.close().catch(()=>{});
    if(started&&client){try{await assertOwner();const current=await verify(client);if(info&&(current.generation!==info.generation||current.pid!==info.pid))throw Error('Changed instance');await client.call('browser.close',{profileId:id,expectedEndpoint:current.instanceId});await finish();}catch{await client.call('browser.detach',{profileId:id}).catch(()=>{});client.close();if(ownership.get(id)===owner)ownership.delete(id);throw error('ALIASMODE_CLEANUP_PENDING','Firefox attachment failed and its owned launch closure is unconfirmed. Review the profile before retrying.');}}
    // If the lease was lost, detach before disconnecting the manager client:
    // its automatic cleanup must not bypass CompelOS's ownership fence.
    if(started&&client)await client.call('browser.detach',{profileId:id}).catch(()=>{});
    client?.close();if(ownership.get(id)===owner)ownership.delete(id);
    if(e.failure?.stage==='provider')throw e;throw error('ALIASMODE_FIREFOX_CONNECTION','The native Firefox connection failed. No Chrome fallback was started.');
   }
  })();const task=opening;task.finally(()=>{if(opening===task)opening=null;}).catch(()=>{});return task;
 }
 async function disconnect(){cancelled=true;if(opening)await opening.catch(()=>{});await detach();}
 function close(){if(closing)return closing;closing=disconnect().finally(()=>{closing=null;});return closing;}
 return {provider:'ALIASMODE',controlMethod:pages.VERSION,open,disconnect,close,isOpen:usable,isHeadless:()=>entry?.headless??null,pid:()=>entry?.pid||null,
  get:()=>usable()?{browser:entry.browser,page:entry.page}:null,heartbeat:()=>{},recycle:()=>stop(false),stop:()=>stop(true),
  adopt:async()=>{await assertOwner();if(!entry)throw error('ALIASMODE_FIREFOX_DISCONNECTED','Firefox is disconnected.');entry.managed=true;await store.saveSession(pool,account,owner,{managed:true,headless:entry.headless,pid:entry.pid,targetId:entry.targetId});},
  reveal:async()=>{if(!usable()||entry.headless)return false;await entry.page.bringToFront();return true;},background:async()=>false,
 };
}
module.exports={createAliasModeFirefoxBrowser};
