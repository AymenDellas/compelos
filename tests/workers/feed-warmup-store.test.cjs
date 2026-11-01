'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const core=require('../../src/lib/linkedin-workers.cjs'),alias=require('../../src/lib/aliasmode-store.cjs'),store=require('../../src/lib/account-session-store.cjs'),{database}=require('./db-fixture.cjs');
test('warm-up settings keep identity, diagnostic evidence, historical days and exact holds; no browser closure is required',async()=>{
 const db=await database(),{pool}=db;try{
  await core.ensure(pool);await alias.ensure(pool);const id=await alias.importProfile(pool,{profileId:'feed-settings',name:'Feed fixture',expectedMemberName:'Fixture'});
  await core.acquireSession(pool,id,'owner');const evidence={network:{verdict:'PASS',key:'original'},gate:{verdict:'UNKNOWN',reportId:'retained',sites:[{verdict:'FAIL'}]},fingerprint:{hash:'frozen'},warmupDays:['2026-10-29']};
  await pool.query('UPDATE compel_linkedin_accounts SET session_evidence=$2::jsonb,attention_reason=$3 WHERE id=$1',[id,JSON.stringify(evidence),'Exact existing hold']);let a=await core.readRuntimeAccount(pool,id);
  await store.saveWarmupSettings(pool,{accountId:id,revision:Number(a.session_revision),minutes:10,days:5});let next=await core.readRuntimeAccount(pool,id);
  assert.deepEqual(next.session_evidence,evidence);assert.equal(next.session_revision,a.session_revision);assert.equal(next.attention_reason,'Exact existing hold');assert.equal(next.processing_enabled,false);assert.equal(next.session_policy.warmupMinutes,10);
  await assert.rejects(store.saveWarmupSettings(pool,{accountId:id,revision:Number(a.session_revision),minutes:0,days:5}),/warmupMinutes/);
  await pool.query('UPDATE compel_linkedin_accounts SET processing_enabled=TRUE WHERE id=$1',[id]);await assert.rejects(store.saveWarmupSettings(pool,{accountId:id,revision:Number(a.session_revision),minutes:20,days:4}),/Stop browsing/);
 }finally{await db.close();}
});
test('completion pauses atomically and cannot write after Pause, hold, control drift or lease expiry',async()=>{
 const db=await database(),{pool}=db;try{
  await core.ensure(pool);await alias.ensure(pool);const id=await alias.importProfile(pool,{profileId:'feed-fences',name:'Feed fixture',expectedMemberName:'Fixture'});await core.acquireSession(pool,id,'owner');await pool.query('UPDATE compel_worker_config SET active_count=1 WHERE id=1');
  const arm=async()=>{await pool.query("UPDATE compel_linkedin_accounts SET processing_enabled=TRUE,attention_reason='',session_evidence='{}'::jsonb WHERE id=$1",[id]);await core.acquireSession(pool,id,'owner');return core.readRuntimeAccount(pool,id);};
  let a=await arm();await store.updateFeedWarmupOwned(pool,a,'owner',{feedWarmup:{state:'completed'},warmupDays:['2026-11-01']},true);let row=await core.readRuntimeAccount(pool,id);assert.equal(row.processing_enabled,false);assert.deepEqual(row.session_evidence.warmupDays,['2026-11-01']);assert.equal(row.attention_reason,'');
  for(const defect of ['pause','hold','version','lease']){
   a=await arm();if(defect==='pause')await core.pauseProcessing(pool,id);
   if(defect==='hold')await core.pauseProcessing(pool,id,'Exact 401 hold',true);
   if(defect==='version')await pool.query('UPDATE compel_linkedin_accounts SET changed_at=clock_timestamp() WHERE id=$1',[id]);
   if(defect==='lease')await pool.query("UPDATE compel_worker_sessions SET lease_until=NOW()-interval '1 second' WHERE account_id=$1",[id]);
   await assert.rejects(store.updateFeedWarmupOwned(pool,a,'owner',{warmupDays:['2026-11-01']},true),/paused|ownership/);row=await core.readRuntimeAccount(pool,id);assert.equal(row.session_evidence.warmupDays,undefined);if(defect==='hold')assert.equal(row.attention_reason,'Exact 401 hold');
  }
 }finally{await db.close();}
});
