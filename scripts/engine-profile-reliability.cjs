'use strict';
// Authorized anonymous diagnostics only; never an actual member account.

const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
const root=path.resolve(__dirname,'..'),core=require('../src/lib/linkedin-workers.cjs'),store=require('../src/lib/aliasmode-store.cjs'),checks=require('../src/lib/stealth-self-test.cjs'),helper=require('../src/lib/aliasmode-cli.cjs'),policy=require('../src/lib/account-session-policy.cjs');
const {poolForRoot,BATCH_SCHEMA}=require('../scripts/engine-benchmark.cjs');
async function main(argv=process.argv.slice(2)){
 const options=parseArgs(argv);
 if(options.assess){const summary=require('../src/lib/browser-diagnostic-repeatability.cjs').assess(options.assess.map(readStudy));console.log(JSON.stringify(summary,null,2));if(summary.verdict!=='PASS')process.exitCode=1;return summary;}
 if(process.env.VERCEL)throw Error('Browser diagnostics run on the local workstation only');
 require('./test-env.cjs');
 const mode='fresh',directory=path.join(root,'data/engine-v2/profile-reliability');fs.mkdirSync(directory,{recursive:true});
 const production=poolForRoot(root),report={id:'profile-reliability-'+crypto.randomUUID(),at:new Date().toISOString(),mode,scope:'Two predeclared restarts per blank profile, no LinkedIn, no real account import or identity changes',runs:[],cleanup:[],accountClearance:false},file=path.join(directory,report.id+'.json');
 const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
 const controls=async()=>crypto.createHash('sha256').update(JSON.stringify((await production.query('SELECT id,enabled,archived,processing_enabled,attention_reason,login_requested_at,logout_requested_at,close_requested_at,session_evidence FROM compel_linkedin_accounts ORDER BY id')).rows)).digest('hex');
 let api,db,browser,owner,accountId,heartbeat,heartbeatError,created,profileId,createdOwned=false,forbidden=false,before,roster;
 try{
  if((await production.query('SELECT 1 FROM compel_linkedin_accounts WHERE processing_enabled LIMIT 1')).rowCount)throw Error('Pause actual account processing before a browser study');
  before=await controls();api=require('../src/lib/aliasmode-client.cjs').createAliasModeClient({config:await store.privateConfig(production)});const list=await api.list();if(list.truncated)throw Error('Incomplete roster');roster=list.profiles.map(p=>p.id).sort();
  created=await api.createProfile({name:'CompelOS reliability fixture '+crypto.randomUUID().slice(0,8)});if(roster.includes(created.id))throw Error('Create returned existing profile');profileId=created.id;createdOwned=true;
  report.profileId=profileId;report.newProfile=true;report.proxyBound=false;report.controlMethod=require('../src/lib/browser-control-version.cjs');save();
  if((await production.query('SELECT 1 FROM compel_linkedin_accounts WHERE aliasmode_profile_id=$1',[profileId])).rowCount)throw Error('Profile is mapped to a real account');
  if((await api.active(profileId)).active)throw Error('Profile is externally open');
  db=await require('../tests/workers/db-fixture.cjs').database();await core.ensure(db.pool);await store.ensure(db.pool);accountId=await store.importProfile(db.pool,{profileId,name:'Anonymous reliability fixture',expectedMemberName:'Anonymous reliability fixture'});await db.pool.query("UPDATE compel_linkedin_accounts SET engine='aliasmode-chromium' WHERE id=$1",[accountId]);owner='reliability/'+crypto.randomUUID();await core.acquireSession(db.pool,accountId,owner);
  heartbeat=setInterval(()=>void core.heartbeat(db.pool,accountId,owner,{status:'diagnostics',runtimeVersion:'SESSION_V2'}).catch(e=>{heartbeatError=e;}),10000);heartbeat.unref();
  const assertActive=async()=>{if(forbidden)throw Error('LinkedIn navigation blocked');if(heartbeatError)throw heartbeatError;if(!await core.sessionOwned(db.pool,accountId,owner))throw Error('Diagnostic ownership lost');};
  for(let iteration=1;iteration<=2;iteration++){
   await assertActive();if(before!==await controls())throw Error('Actual account controls changed during the study');if((await api.active(profileId)).active)throw Error('Profile did not close');
   let run={iteration,at:new Date().toISOString()},trace=[],methods={};
   const puppeteer={...require('puppeteer'),connect:async options=>{
    const b=await require('puppeteer').connect(options),root=await b.target().createCDPSession(),connection=root.connection(),send=connection._rawSend.bind(connection);
    connection._rawSend=(registry,method,...args)=>{methods[method]=(methods[method]||0)+1;if(['Runtime.enable','Runtime.disable','Target.attachToTarget','Target.setAutoAttach'].includes(method)&&trace.length<200)trace.push({method,afterMs:Date.now()-Date.parse(run.at)});return send(registry,method,...args);};await root.detach();return b;
   }};
   browser=require('../src/lib/aliasmode-browser.cjs').createAliasModeBrowser({account:await core.readRuntimeAccount(db.pool,accountId),owner,pool:db.pool,provider:{client:api,store},puppeteer});
   try{
    const surface=await browser.open({headless:false});let requests=0,linkedinBlocked=0;await surface.page.setRequestInterception(true);surface.page.on('request',r=>{requests++;let host='';try{host=new URL(r.url()).hostname;}catch{}if(/(^|\.)(?:linkedin\.com|licdn\.com)$/.test(host)){linkedinBlocked++;forbidden||=r.isNavigationRequest()&&r.frame()===surface.page.mainFrame();void r.abort().catch(()=>{});}else void r.continue().catch(()=>{});});
    const pid=browser.pid(),ps='Get-CimInstance Win32_Process -Filter "ProcessId = '+pid+'" | ForEach-Object { [pscustomobject]@{ noisePresent = $_.CommandLine -match \'(?:^| )--fingerprint-noise(?: |$)\'; clockWorkaround = $_.CommandLine -match \'no-icu-timezone-data\' } | ConvertTo-Json -Compress }';
    const {stdout}=await execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true,shell:false,timeout:10000,maxBuffer:32768});run.launch=JSON.parse(stdout);run.providerConfiguration=surface.page.providerConfiguration;run.browserVersion=await surface.browser.version();
    run.result=await checks.run(surface.page,{assertActive,resultTimeoutMs:10000});run.clocks=run.result.sites.map(s=>({kind:s.kind,...policy.clockVerdict(s.probe,s.probe?.timezone,Date.parse(run.result.checkedAt))}));run.requests=requests;run.linkedinBlocked=linkedinBlocked;
   }catch(e){run.error={code:e.code||e.name,reason:e.failure?.reason||String(e.message).replace(/wss?:\/\/\S+/gi,'[CDP endpoint]').slice(0,300)};}
   finally{run.methods=methods;run.trace=trace;report.runs.push(run);save();await browser.recycle();await browser.close();browser=null;console.log(JSON.stringify({report:report.id,mode,iteration,verdict:run.result?.verdict,counts:run.result?.counts,runtimeEnabled:methods['Runtime.enable']||0,error:run.error,sites:run.result?.sites.map(s=>({kind:s.kind,verdict:s.verdict,flags:s.kind==='device'?s.external?.flags:undefined,bot:s.kind==='fingerprint'?s.external?.value:undefined,tampering:s.kind==='fingerprint'?s.external?.observations?.find(o=>o.name==='Browser tampering')?.value:undefined}))}));}
   if(run.error)break;
  }
 }catch(e){report.error={code:e.code||e.name,reason:e.failure?.reason||String(e.message).replace(/wss?:\/\/\S+/gi,'[CDP endpoint]').slice(0,300)};}
 finally{
  clearInterval(heartbeat);
  try{
   if(browser){await browser.recycle();await browser.close();}
   if(profileId){if((await api.active(profileId)).active)throw Error('Profile closure unconfirmed');report.cleanup.push({closed:true,retained:!created});}
   if(await deleteTemporaryProfile({api,production,profileId,owned:createdOwned}))report.cleanup[0].deleted=true;
   if(accountId&&owner)await core.releaseSession(db.pool,accountId,owner,{status:'offline',runtimeVersion:'SESSION_V2'});
   report.accountsUnchanged=before===await controls();report.rosterRestored=JSON.stringify(roster)===JSON.stringify((await api.list()).profiles.map(p=>p.id).sort());report.completedAt=new Date().toISOString();
   report.repeatable=report.runs.length===2&&report.runs.every(r=>r.result?.verdict==='PASS'&&!r.error&&r.clocks.every(c=>c.verdict==='PASS'))&&report.accountsUnchanged&&report.rosterRestored;
   await production.query(BATCH_SCHEMA);await production.query("INSERT INTO compel_engine_batches(id,account_id,profiles,state,requested_count,started_at,finished_at,report) VALUES($1,'ANONYMOUS_RELIABILITY',$2,$3,2,$4,NOW(),$5::jsonb)",[report.id,checks.URLS,report.repeatable?'DIAGNOSTIC_COMPLETE':'DIAGNOSTIC_PARTIAL',report.at,JSON.stringify(report)]);
  }catch(e){report.cleanupError={code:e.code||e.name,reason:String(e.message).slice(0,300)};}
  finally{save();await api?.idle();await db?.close();await production.end();}
 }
 console.log(JSON.stringify({report:report.id,repeatable:report.repeatable,accountsUnchanged:report.accountsUnchanged,rosterRestored:report.rosterRestored,error:report.error,cleanupError:report.cleanupError}));if(!report.repeatable)process.exitCode=1;
}
function parseArgs(argv){
 if(argv.length===2&&argv[0]==='--run'&&argv[1]==='--fresh')return {fresh:true};
 if(argv[0]==='--assess'&&argv.length===4)return {assess:argv.slice(1)};
 throw Error('Use --run --fresh or --assess SAVED_REPORT FRESH_REPORT FRESH_REPORT. Browser runs only create new anonymous profiles.');
}
function readStudy(file){
 const base=fs.realpathSync(path.join(root,'data/engine-v2')),absolute=fs.realpathSync(path.resolve(root,file)),relative=path.relative(base,absolute);
 if(relative.startsWith('..')||path.isAbsolute(relative)||path.extname(absolute)!=='.json'||fs.statSync(absolute).size>5*1024*1024)throw Error('Use bounded diagnostic JSON files under ignored data/engine-v2');
 return JSON.parse(fs.readFileSync(absolute,'utf8'));
}
async function deleteTemporaryProfile({api,production,profileId,owned,remove=async id=>{
 const {stdout}=await execFile(helper.helperPath(),['profiles','delete','--profile',id,'--json'],{windowsHide:true,shell:false,timeout:20000,maxBuffer:262144,env:helper.environment()});
 const r=JSON.parse(stdout);return r.ok===true&&r.result?.deleted===true;
}}){
 if(owned!==true)return false;
 if((await api.active(profileId)).active)throw Error('Diagnostic profile closure is unconfirmed; retaining it');
 if((await production.query('SELECT 1 FROM compel_linkedin_accounts WHERE aliasmode_profile_id=$1',[profileId])).rowCount)throw Error('New profile is mapped; retaining it');
 if(await remove(profileId)!==true)throw Error('Diagnostic deletion unconfirmed');
 return true;
}
if(require.main===module)main().catch(e=>{console.error(e.code||e.name,e.message);process.exitCode=1;});
module.exports={parseArgs,readStudy,main,deleteTemporaryProfile};

