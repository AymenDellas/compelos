'use strict';
// Uses isolated tables in a new test schema, never real leads or account data.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {Pool}=require('pg'),core=require('../../src/lib/linkedin-workers.cjs');
test('accounts, concurrent leases, recovery, hosted queue and email placement work against PostgreSQL',async()=>{
 for(const line of fs.readFileSync(path.resolve(__dirname,'../../.env.local'),'utf8').split('\n')){
  const match=line.replace(/\r/g,'').match(/^([^#=]+)=(.+)$/);
  if(match)process.env[match[1].trim()]=match[2].trim().replace(/^(['"])([\s\S]*)\1$/,'$2');
 }
 const raw=new Pool({connectionString:process.env.DATABASE_URL,max:6,connectionTimeoutMillis:10000,ssl:{rejectUnauthorized:false}});
 const schema='compel_worker_test_'+randomUUID().replaceAll('-','');
 assert.match(schema,/^compel_worker_test_[a-f0-9]{32}$/);
 const qualify=sql=>sql.replace(/\b(compel_worker_config|compel_linkedin_accounts|compel_worker_usage|compel_worker_sessions|compel_worker_jobs|leads)\b/g,`"${schema}".$1`);
 const pool={query:(sql,values)=>raw.query(qualify(sql),values),connect:async()=>{
  const client=await raw.connect();return{query:(sql,values)=>client.query(qualify(sql),values),release:()=>client.release()};
 }};
 try{
  await raw.query(`CREATE SCHEMA "${schema}"`);
  await core.importAccounts(pool,[{email:'first@example.test',password:'private'},{email:'second@example.test',password:'private2'}],{date:new Date().toISOString().slice(0,10),count:2});
  let config=await core.settings(pool);
  assert.equal(config.accounts.length,2);assert.equal(config.accounts[0].dailyCount,2);
  assert.ok(!JSON.stringify(config).includes('private'));assert.equal(config.activeCount,1);
  const originalProfile=(await pool.query('SELECT profile_key FROM compel_linkedin_accounts WHERE id=$1',['legacy-0'])).rows[0].profile_key;
  config=await core.saveSettings(pool,{...config,activeCount:2,accounts:config.accounts.map(a=>({...a,password:''}))});
  assert.equal((await core.selectedAccounts(pool)).length,2);
  assert.equal((await pool.query('SELECT profile_key FROM compel_linkedin_accounts WHERE id=$1',['legacy-0'])).rows[0].profile_key,originalProfile);
  assert.equal(core.decrypt((await pool.query('SELECT secret FROM compel_linkedin_accounts WHERE id=$1',['legacy-0'])).rows[0].secret),'private');
  await core.ensure({query:pool.query});
  assert.equal((await raw.query(`SELECT count(*)::integer AS n FROM information_schema.sequences WHERE sequence_schema=$1`,[schema])).rows[0].n,1);
  await assert.rejects(core.saveSettings(pool,{...config,revision:0}));
  await assert.rejects(core.saveSettings(pool,{...config,accounts:config.accounts.map((a,i)=>({...a,email:i===0?'replacement@example.test':a.email}))}));
  const duplicate=await Promise.all([core.enqueue(pool,['https://www.linkedin.com/in/first/']),core.enqueue(pool,['https://uk.linkedin.com/in/FIRST/?trk=fixture'])]);
  assert.equal(duplicate.reduce((sum,r)=>sum+r.jobs.length,0),1);
  await core.enqueue(pool,['https://www.linkedin.com/in/second/','https://www.linkedin.com/in/third/']);
  assert.equal(await core.acquireSession(pool,'legacy-0','one'),true);
  assert.equal(await core.acquireSession(pool,'legacy-0','impostor'),false);
  assert.equal(await core.acquireSession(pool,'legacy-1','two'),true);
  const [first,second]=await Promise.all([core.claim(pool,'legacy-0','one'),core.claim(pool,'legacy-1','two')]);
  assert.notEqual(first.job.jobId,second.job.jobId);
  assert.equal(first.dailyCount,3);assert.equal(second.dailyCount,1);
  await core.heartbeat(pool,'legacy-0','one',{status:'processing'});
  await assert.rejects(core.heartbeat(pool,'legacy-0','impostor',{}));
  await pool.query(`UPDATE compel_worker_jobs SET lease_until=NOW()-interval '1 minute' WHERE id=$1`,[first.job.jobId]);
  const recovered=await core.claim(pool,'legacy-1','two');assert.equal(recovered.job.jobId,first.job.jobId);
  await assert.rejects(core.complete(pool,first.job.jobId,'one',{status:'QUALIFIED'}));
  await core.complete(pool,recovered.job.jobId,'two',{status:'REJECTED',primaryEmail:''});
  assert.equal((await core.jobStatus(pool,recovered.job.jobId)).status,'done');
  await core.clearQueue(pool);assert.equal((await core.jobStatus(pool,second.job.jobId)).status,'processing');
  await core.releaseSession(pool,'legacy-1','two',{status:'offline'});
  assert.equal((await core.jobStatus(pool,second.job.jobId)).status,'queued');
  await core.clearQueue(pool);
  const ordered=await core.enqueue(pool,Array.from({length:1000},(_,n)=>`https://www.linkedin.com/in/bulk-${n}/`));
  assert.equal(ordered.jobs.length,1000);
  assert.equal((await core.claim(pool,'legacy-0','one')).job.linkedinUrl,'https://www.linkedin.com/in/bulk-0/');
  await core.releaseSession(pool,'legacy-0','one',{status:'offline'});await core.clearQueue(pool);
  await core.enqueue(pool,['https://www.linkedin.com/in/remaining/']);await core.acquireSession(pool,'legacy-0','one');
  config=await core.settings(pool);config=await core.saveSettings(pool,{...config,activeCount:0});
  assert.equal((await core.claim(pool,'legacy-0','one')).disabled,true);
  config=await core.saveSettings(pool,{...config,activeCount:1,accounts:config.accounts.map(a=>({...a,dailyLimit:1}))});
  assert.equal((await core.claim(pool,'legacy-0','one')).limited,true);
  await core.requestLogin(pool,'legacy-1');assert.equal((await core.settings(pool)).accounts[1].loginPending,true);
  await pool.query("UPDATE compel_linkedin_accounts SET login_requested_at='2026-10-09 00:11:49.280123+00' WHERE id='legacy-1'");
  const request=(await pool.query("SELECT login_requested_at,login_requested_at::text AS token FROM compel_linkedin_accounts WHERE id='legacy-1'")).rows[0];
  assert.equal(await core.consumeLoginRequest(pool,'legacy-1',request.login_requested_at),false,'a hydrated Date loses the PostgreSQL microseconds');
  assert.equal(await core.consumeLoginRequest(pool,'legacy-1',request.token),true);
  assert.equal((await core.settings(pool)).accounts[1].loginPending,false);
  await core.requestLogin(pool,'legacy-1');
  assert.equal(await core.consumeLoginRequest(pool,'legacy-1',request.token),false,'a newer sign-in request must survive an old browser');
  assert.equal((await core.settings(pool)).accounts[1].loginPending,true);
  const beforeRemove=config.accounts[0].dailyCount;
  config=await core.saveSettings(pool,{...config,activeCount:1,accounts:config.accounts.filter(a=>a.id!=='legacy-0')});
  config=await core.saveSettings(pool,{...config,activeCount:2,accounts:[...config.accounts,{label:'Restored',email:'first@example.test',password:'private',enabled:true,dailyLimit:400}]});
  assert.equal(config.accounts.find(a=>a.email==='first@example.test').id,'legacy-0');
  assert.equal(config.accounts.find(a=>a.id==='legacy-0').dailyCount,beforeRemove);
  const status=await core.queueStatus(pool);assert.equal(status.queueSize,1);assert.equal(status.recentResults.length,1);
  await core.importResult(pool,'job_old_text',{completedAt:new Date().toISOString(),result:{url:'https://www.linkedin.com/in/old/',status:'REJECTED',logs:['😀\ud83d broken\u0000']}});
  assert.equal((await core.jobStatus(pool,'job_old_text')).result.logs[0],'😀� broken');
  await pool.query(`CREATE TABLE leads(id TEXT PRIMARY KEY,linkedin_url TEXT,first_name TEXT,last_name TEXT,website TEXT,website_source TEXT,location TEXT,email TEXT,all_emails TEXT,email_status TEXT,
   pipeline_status TEXT,do_not_contact BOOLEAN,contacted BOOLEAN,contacted_source TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),email_verification_method TEXT,email_verification_reason TEXT,email_verification_score INTEGER,email_verified_at TIMESTAMPTZ,email_verification_expires_at TIMESTAMPTZ)`);
  const {research}=require('../prospects/fixtures.cjs'),{saveWorkerResearch}=require('../../src/lib/worker-research-store.cjs');
  const r=research({researchedAt:new Date().toISOString()});
  let saved=await saveWorkerResearch(pool,{linkedinUrl:r.linkedinUrl,research:{...r,contacts:[]},email:''});
  assert.equal(saved.pipelineStatus,'NOT_QUALIFIED');assert.equal(saved.tier,'A');
  saved=await saveWorkerResearch(pool,{linkedinUrl:r.linkedinUrl,research:r,email:'ava@avamorgan.test'});
  assert.equal(saved.pipelineStatus,'QUALIFIED');
  let lead=(await pool.query('SELECT * FROM leads WHERE id=$1',[saved.id])).rows[0];
  assert.equal(lead.email_status,'UNVERIFIED');assert.equal(lead.email_verification_method,null);
  await pool.query(`UPDATE leads SET email_status='VALID',email_verification_method='SMTP_DIRECT',email_verification_score=99,do_not_contact=TRUE,contacted=TRUE,contacted_source='PLATFORM' WHERE id=$1`,[saved.id]);
  const replacement={...r,contacts:[{...r.contacts[0],address:'other@avamorgan.test'}]};
  await saveWorkerResearch(pool,{linkedinUrl:r.linkedinUrl,research:replacement,email:'other@avamorgan.test'});
  lead=(await pool.query('SELECT * FROM leads WHERE id=$1',[saved.id])).rows[0];
  assert.equal(lead.email_verification_method,null);assert.equal(lead.email_verification_score,null);assert.equal(lead.do_not_contact,true);assert.equal(lead.contacted_source,'PLATFORM');
 }finally{
  await raw.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await raw.end();
 }
});
