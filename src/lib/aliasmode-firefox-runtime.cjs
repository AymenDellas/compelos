'use strict';
// Reuse AliasMode's installed native client. No dependency installation,
// browser launch, cookie transfer or CDP emulation occurs here.
const path=require('node:path'),{pathToFileURL}=require('node:url');
const {providerError,profileId}=require('./aliasmode-client.cjs');
const VERSION='COMPELOS_FIREFOX_CONTROL_V1';
const admission=require('./bounded-work.cjs').createBoundedQueue({capacity:16,concurrency:2});
let sharedHelper;
function connection(value,id){
 let u;try{u=new URL(value?.endpoint);}catch{}
 if(value?.version!==VERSION||value.profileId!==profileId(id)||value.engine!=='firefox'||value.protocol!=='playwright'||value.evaluation!=='native-main-world'||value.startupMode!=='blank'||
  !u||!['ws:','wss:'].includes(u.protocol)||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.search||u.hash||!/^\/[a-f0-9]{64}$/.test(u.pathname)||
  !Number.isSafeInteger(value.pid)||value.pid<1||typeof value.headless!=='boolean'||typeof value.instanceId!=='string'||!value.instanceId.startsWith('firefox://')||
  typeof value.generation!=='string'||!/^[a-f0-9]{32,128}$/.test(value.generation))throw providerError('ALIASMODE_FIREFOX_CONNECTION','AliasMode did not verify this native Firefox instance.');
 return value;
}
function createFirefoxRuntime({helper,load,commandTimeoutMs}={}){
 helper??=(sharedHelper??=require('./aliasmode-cli.cjs').createAliasModeCli());
 async function rpc(client,method,params={}){
  let timer;try{return await Promise.race([client.call(method,params),new Promise((_,reject)=>{timer=setTimeout(()=>{client.close();reject(providerError('ALIASMODE_CLI_TIMEOUT','AliasMode native control timed out. Reconcile the profile before retrying.'));},commandTimeoutMs??(method==='browser.open'?120000:method==='browser.close'?90000:30000));})]);}finally{clearTimeout(timer);}
 }
 async function installed(){
  const base=path.dirname(require('./aliasmode-cli.cjs').helperPath());
  const runtime=path.join(base,'playwright');
  const {discoverRuntime,COMPELOS_NO_AUTO_LAUNCH}=await import(pathToFileURL(path.join(runtime,'agent/runtime-client.mjs')).href);
  // This is an installed desktop dependency, never a dashboard bundle asset.
  // Resolve it with Node's native loader relative to AliasMode's own client.
  const installedRequire=require('node:module').createRequire(path.join(runtime,'agent/runtime-client.mjs'));
  const pkg=installedRequire('playwright-core/package.json');
  if(pkg.version!=='1.58.2'||COMPELOS_NO_AUTO_LAUNCH!==true)throw Error('Unvalidated native client');
  return {discoverRuntime,firefox:installedRequire('playwright-core').firefox};
 }
 async function connectNow(){
  let client;
  try{
   const version=await helper.version(),native=await (load||installed)();
   ({client}=await native.discoverRuntime({version,launch:false}));
   const capability=await rpc(client,'firefox.connectionCapability');
   if(capability?.version!==VERSION||capability.protocol!=='playwright'||capability.lifecycleOwner!=='AliasMode'||capability.evaluation!=='native-main-world'||capability.startupMode!=='blank')throw Error('Missing native capability');
   return {
    call:async(method,params={})=>{
     try{return await rpc(client,method,params);}catch(error){
      if(error.failure?.stage==='provider')throw error;
      const codes={mode_conflict:'ALIASMODE_MODE_CONFLICT',browser_changed:'ALIASMODE_INSTANCE_CHANGED',close_unconfirmed:'ALIASMODE_STOP_PENDING',browser_not_running:'ALIASMODE_FIREFOX_DISCONNECTED',connection_unverified:'ALIASMODE_FIREFOX_CONNECTION',firefox_configuration_required:'ALIASMODE_FIREFOX_CONFIGURATION',browser_not_firefox:'ALIASMODE_FIREFOX_PROFILE'};
      const reason=error.code==='firefox_configuration_required'?'This older Firefox profile lacks native page-query support. Existing identities were not migrated. Use a freshly provisioned profile from the validated AliasMode setup.':error.code==='browser_not_firefox'?'The bound profile is not confirmed as Firefox. Choose its actual engine in session setup.':'AliasMode could not complete the native Firefox operation. Review that profile before retrying.';
      throw providerError(codes[error.code]||'ALIASMODE_FIREFOX_CONTROL',reason);
     }
    },
    attach:async value=>native.firefox.connect(value.endpoint,{timeout:30000}),
    close:()=>client.close(),
   };
  }catch{client?.close();throw providerError('ALIASMODE_FIREFOX_UNAVAILABLE','The installed AliasMode manager/native Firefox client lacks validated Firefox control. Restore the published provider repair; no fallback browser was started.');}
 }
 return {connect:async()=> (await admission.submit(connectNow)).done};
}
module.exports={VERSION,connection,createFirefoxRuntime};
