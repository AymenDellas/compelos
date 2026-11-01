'use strict';
// Explicit anonymous provider integration measurement, separate from unit
// tests. Uses only disposable profiles, synthetic data and intercepted pages.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {randomUUID}=require('node:crypto');
const {createFirefoxRuntime}=require('../src/lib/aliasmode-firefox-runtime.cjs');
const {createAliasModeFirefoxBrowser}=require('../src/lib/aliasmode-firefox-browser.cjs');
const readback=require('../src/lib/browser-profile-readback.cjs');
const human=require('../src/lib/session-humanizer.cjs');
const reader=require('../src/lib/linkedin-voyager-reader.cjs');
async function run({directory,pool}){
 const runtime=createFirefoxRuntime(),client=await runtime.connect();
 const report={id:'firefox-native-fixture-'+randomUUID(),at:new Date().toISOString(),checks:[],profiles:[],authenticatedLinkedInRequests:0,accountClearance:false};
 const file=path.join(directory,report.id+'.json'),save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
 const server=http.createServer((req,res)=>{
  if(req.url==='/denied'){res.writeHead(401);return res.end('Synthetic 401');}
  if(req.url.startsWith('/in/'))report.lastHeaders={referer:req.headers.referer,secFetchSite:req.headers['sec-fetch-site']};
  res.setHeader('content-type','text/html');res.end('<!doctype html><title>Local fixture</title><main style="height:3500px"><a href="/in/rendered-fixture/">Fixture member</a></main>');
 });
 let driver,id;const roster=(await client.call('profiles.list')).profiles.map(p=>p.id).sort();save();
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  for(let number=0;number<2;number++){
   id=(await client.call('profiles.create',{input:{name:'CompelOS anonymous native fixture '+number,engine:'firefox'},temporary:false})).id;
   assert.ok(id&&!roster.includes(id));const meta=(await client.call('profiles.list')).profiles.find(p=>p.id===id);
   await client.call('profiles.update',{profileId:id,expectedVersion:meta.expectedVersion,set:{timezone:'America/New_York'}});
   let row;const account={id:'disposable-native-fixture',aliasmode_profile_id:id,engine:'aliasmode-firefox'},store={assertOwner:async()=>{},session:async()=>row,saveSession:async(_p,_a,_o,v)=>{row={...v,account_id:account.id,target_id:v.targetId};},finishSession:async()=>{if(row)row.closed_at='closed';}};
   driver=createAliasModeFirefoxBrowser({account,owner:report.id,pool:{},provider:{store},runtime});
   const observations=[];report.profiles.push({mode:'headful',observations});
   for(let restart=0;restart<2;restart++){
    let {browser,page}=await driver.open({headless:false});let context=browser.contexts()[0];
    assert.ok(context.pages().every(p=>['about:blank','about:newtab'].includes(p.url())),'no restored or automatic website navigation');
    await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
    await page.goto(origin+'/feed/',{waitUntil:'load',timeout:10000});
    if(restart)assert.match(await page.evaluate(()=>document.cookie),/fixture_persistence=kept/);
    else await page.evaluate(()=>{document.cookie='fixture_persistence=kept;path=/';});
    observations.push(await readback.capture(page));save();
    if(!restart){
     const pid=driver.pid(),target=page.target()._targetId;await driver.disconnect();
     assert.equal((await client.call('browser.status',{profileId:id})).running,true);
     const reconnected=await driver.open({headless:false});page=reconnected.page;context=reconnected.browser.contexts()[0];assert.equal(driver.pid(),pid);assert.equal(reconnected.page.target()._targetId,target);
     await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
     await reconnected.page.goto(origin+'/feed/',{waitUntil:'load'});
     for(const [url,method,referer]of [[origin+'/in/rendered-fixture/','rendered-link',origin+'/feed/'],[origin+'/in/assigned-fixture/','location.assign',origin+'/in/rendered-fixture/']]){
      const navigation=page.waitForNavigation({waitUntil:'load',timeout:10000});navigation.catch(()=>{});
      if(method==='rendered-link'){const link=await page.$('a');try{await link.click();}finally{await link.dispose();}}
      else await page.evaluate(target=>location.assign(target),url);
      await navigation;assert.equal(report.lastHeaders.secFetchSite,'same-origin');assert.equal(report.lastHeaders.referer,referer);
     }
     const clock={at:0,now(){return this.at;},async sleep(ms){this.at+=ms;}};
     const dwell=await human.dwell(reconnected.page,{now:()=>clock.now(),sleep:ms=>clock.sleep(ms),random:min=>min});
     assert.ok(dwell.dwellMs>=30000&&dwell.dwellMs<=90000);assert.ok(dwell.scrollCount>=2&&dwell.scrollCount<=4);
     let denied;reconnected.page.on('response',r=>{if(r.status()===401)denied=r.status();});await reconnected.page.evaluate(()=>fetch('/denied'));assert.equal(denied,401);
     await assert.rejects(reconnected.page.waitForFunction(()=>false,{timeout:50}),e=>e.name==='TimeoutError');
    }
    // Every external URL is aborted at the context boundary. Only this owned
    // page can fulfill the canonical synthetic feed/API; no network is sent.
    const reads=[],navigations=[];await page.setRequestInterception(true);
    page.on('request',request=>{
     const u=new URL(request.url());if(u.origin===origin)return void request.continue().catch(()=>{});
     if(u.origin!=='https://www.linkedin.com')return void request.abort().catch(()=>{});
     if(request.isNavigationRequest())navigations.push(u.pathname);
     if(u.pathname==='/feed/')return void request.respond({contentType:'text/html',body:'<!doctype html><main>Disposable synthetic feed</main>'}).catch(()=>{});
     if(!u.pathname.startsWith('/voyager/api/'))return void request.abort().catch(()=>{});
     reads.push(u.pathname);let data;const urn='urn:li:fsd_profile:ACoFixture';
     if(u.pathname.endsWith('/profileView'))data={data:{profile:{publicIdentifier:'voyager-fixture',entityUrn:urn,firstName:'Fixture',lastName:'Member',locationName:'Toronto, Canada',followerCount:2345}}};
     else if(u.pathname.endsWith('/profileUpdatesV2'))data={data:{elements:[{actor:{profileUrn:urn},createdAt:Date.now()-86400000,commentary:{text:'Own synthetic post'}}]}};
     else if(u.pathname.endsWith('/profileContactInfo'))data={data:{emailAddress:'fixture@example.test',websites:[]}};
     else return void request.abort().catch(()=>{});
     void request.respond({contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
    });
    await page.goto('https://www.linkedin.com/feed/',{waitUntil:'load',timeout:10000});
    await context.addCookies([{name:'JSESSIONID',value:'"synthetic-fixture-csrf"',domain:'.linkedin.com',path:'/',secure:true}]);
    const checkpoints=[],capture=await reader.captureProfile(page,'https://www.linkedin.com/in/voyager-fixture/',{accountId:'fixture',requireTargetLocation:true,onCheckpoint:async v=>checkpoints.push(v)});
    assert.equal(capture.followers.count,2345);assert.equal(capture.activityStatus,'Active');assert.equal(capture.primaryEmail,'fixture@example.test');assert.equal(capture.linkedinCapture.complete,true);
    assert.ok(!JSON.stringify({capture,checkpoints}).includes('synthetic-fixture-csrf'));assert.deepEqual(navigations,['/feed/']);assert.equal(reads.length,3);
    await page.setRequestInterception(false);await driver.recycle();
   }
   for(const key of ['canvas','webgl','audio','fonts'])assert.deepEqual(observations[0][key],observations[1][key],key+' stable across full restart');
   report.checks.push('profile '+number+': blank restart, cookie persistence, native reconnect, link/assign headers, bounded dwell/wait, security event and synthetic Voyager reader');
   if(pool)assert.equal((await pool.query('SELECT 1 FROM compel_linkedin_accounts WHERE aliasmode_profile_id=$1',[id])).rowCount,0);
   assert.equal((await client.call('browser.status',{profileId:id})).state,'closed');assert.equal((await client.call('profiles.delete',{profileId:id})).deleted,true);id=null;driver=null;save();
  }
  for(const key of ['canvas','webgl','fonts'])assert.notDeepEqual(report.profiles[0].observations[0][key],report.profiles[1].observations[0][key],key+' differs across fresh profiles');
  report.checks.push('two profiles have distinct canvas pixels, WebGL and fonts; each remains stable across two launches');report.success=true;
 }catch(e){report.error={name:e.name,code:e.code,message:String(e.message).replace(/wss?:\/\/\S+/g,'[private endpoint]').slice(0,400)};}
 finally{
  await driver?.stop().catch(e=>{report.cleanupError=e.code||e.name;});
  if(id){if(pool)assert.equal((await pool.query('SELECT 1 FROM compel_linkedin_accounts WHERE aliasmode_profile_id=$1',[id])).rowCount,0);if((await client.call('browser.status',{profileId:id})).state==='closed')await client.call('profiles.delete',{profileId:id});else report.cleanupError='CLOSURE_UNCONFIRMED';}
  report.rosterRestored=JSON.stringify((await client.call('profiles.list')).profiles.map(p=>p.id).sort())===JSON.stringify(roster);client.close();server.closeAllConnections();await new Promise(r=>server.close(r));report.finishedAt=new Date().toISOString();save();
 }
 return report;
}
module.exports={run};
if(require.main===module){
 const {poolForRoot}=require('./engine-benchmark.cjs'),pool=poolForRoot(path.resolve(__dirname,'..')),directory=path.resolve(__dirname,'../data/engine-v2/firefox-integration-20261101');fs.mkdirSync(directory,{recursive:true});
 run({directory,pool}).then(r=>{console.log(JSON.stringify({id:r.id,success:r.success===true,checks:r.checks,rosterRestored:r.rosterRestored,error:r.error,cleanupError:r.cleanupError}));if(!r.success||!r.rosterRestored||r.cleanupError)process.exitCode=1;}).catch(e=>{console.error(e.name,e.message);process.exitCode=1;}).finally(()=>pool.end());
}
