'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const feed=require('../../src/lib/feed-warmup.cjs');
function fixture(){
 let at=Date.parse('2026-11-01T12:00:00Z'),url='https://www.linkedin.com/feed/',active=true,actions=0,saves=0,paused=false;
 const account={id:'fixture',session_revision:0,control_version:'v1',daily_day:'2026-11-01',session_policy:{warmupMinutes:1},session_evidence:{warmupVisits:{historical:['retained']}}};
 const page={url:()=>url};
 const options={owner:'owner',now:()=>at,random:min=>min,assertActive:async()=>{if(!active)throw Error('Paused');},inspect:async()=>{},feed:async()=>{url='https://www.linkedin.com/feed/';return{status:()=>200};},action:async()=>{actions++;return'scroll';},save:async(patch,finish)=>{saves++;account.session_evidence={...account.session_evidence,...structuredClone(patch)};if(finish)paused=true;}};
 return {account,page,options,step:()=>feed.step(account,page,options),advance:ms=>{at+=ms;},get actions(){return actions;},get saves(){return saves;},get paused(){return paused;},set active(value){active=value;},set url(value){url=value;}};
}
test('feed warm-up requires observed duration, retains history, records one day and finishes paused',async()=>{
 const f=fixture();await f.step();for(let i=1;i<=5;i++){f.advance(10000);const r=await f.step();assert.equal(r.done,false);assert.equal(f.account.session_evidence.warmupDays,undefined);}
 f.advance(10000);const r=await f.step();assert.equal(r.done,true);assert.equal(r.progress.elapsedMs,60000);assert.equal(r.progress.state,'completed');assert.equal(f.paused,true);assert.deepEqual(f.account.session_evidence.warmupDays,['2026-11-01']);assert.deepEqual(f.account.session_evidence.warmupVisits,{historical:['retained']});assert.equal(f.actions,6);const saves=f.saves;assert.equal((await f.step()).completedToday,true);assert.equal(f.saves,saves);
});
test('pause/restart and long gaps never count inactive time; expired sessions do not earn a day',async()=>{
 const f=fixture();await f.step();f.advance(10000);await f.step();const elapsed=f.account.session_evidence.feedWarmup.elapsedMs;
 f.advance(120000);await f.step();assert.equal(f.account.session_evidence.feedWarmup.elapsedMs,elapsed);
 f.advance(10000);await feed.step(f.account,{url:()=> 'https://www.linkedin.com/feed/'},f.options);assert.equal(f.account.session_evidence.feedWarmup.elapsedMs,elapsed,'a replacement page cannot credit disconnected time');
 f.options.owner='new-owner';f.account.control_version='new-start';f.advance(3600000);await f.step();assert.equal(f.account.session_evidence.feedWarmup.elapsedMs,elapsed);
 f.advance(400000);const result=await f.step();assert.equal(result.stopped,true);assert.equal(f.paused,true);assert.equal(f.account.session_evidence.warmupDays,undefined);
});
test('pause, security inspection, unrecognized navigation and partial saves cannot complete a day',async()=>{
 const f=fixture();await f.step();const writes=f.saves;f.active=false;await assert.rejects(f.step(),/Paused/);assert.equal(f.saves,writes);
 f.active=true;f.advance(10000);f.url='https://www.linkedin.com/in/unexpected/';await assert.rejects(f.step(),/left the feed/);assert.equal(f.saves,writes);
 f.url='https://www.linkedin.com/feed/';f.options.inspect=async()=>{throw Error('Exact security warning');};await assert.rejects(f.step(),/Exact security warning/);assert.equal(f.saves,writes);
 f.options.inspect=async()=>{};f.options.save=async()=>{throw Error('Lost lease');};await assert.rejects(f.step(),/Lost lease/);assert.equal(f.account.session_evidence.warmupDays,undefined);
});
test('waiting checks the feed for warnings and keeps the action history bounded',async()=>{
 const f=fixture();await f.step();let inspections=0;f.options.inspect=async()=>{inspections++;};assert.equal((await f.step()).waiting,true);assert.equal(inspections,1);assert.equal(f.actions,1);
 f.account.session_policy.warmupMinutes=20;await f.step();for(let i=0;i<20;i++){f.advance(10000);await f.step();}assert.equal(f.account.session_evidence.feedWarmup.actions.length,12);
});
