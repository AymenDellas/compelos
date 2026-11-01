'use strict';
const {randomInt,randomUUID}=require('node:crypto');
const policy=require('./account-session-policy.cjs');
const human=require('./session-humanizer.cjs');
const VERSION='FEED_WARMUP_V1',MAX_GAP_MS=30000;
const pageInstances=new WeakMap();
const MORE='main .feed-shared-update-v2 button.feed-shared-inline-show-more-text__see-more-less-toggle,main [data-urn^="urn:li:activity:"] button.feed-shared-inline-show-more-text__see-more-less-toggle';
function onFeed(url){try{const u=new URL(url);return u.origin==='https://www.linkedin.com'&&u.pathname==='/feed/';}catch{return false;}}
function assertFeed(page){if(!onFeed(page.url()))throw Object.assign(Error('Feed browsing left the feed. The session stopped before another action.'),{failure:{stage:'page',code:'FEED_WARMUP_DESTINATION',retryable:false}});}
function eligible(node){
 return node.tagName==='BUTTON'&&!node.disabled&&node.getAttribute('aria-disabled')!=='true'&&node.type!=='submit'&&!node.closest('form')&&
  !!node.closest('main .feed-shared-update-v2,main [data-urn^="urn:li:activity:"]')&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden'&&
  /^(?:see\s+more|(?:…|\.{3})?\s*more)$/i.test((node.getAttribute('aria-label')||node.textContent||'').trim());
}
async function expandPost(page,{assertActive,random}){
 const elements=await page.$$(MORE);try{
  const candidates=[];for(const element of elements.slice(0,40))if(await element.evaluate(eligible))candidates.push(element);
  if(!candidates.length)return false;
  const element=candidates[random(0,candidates.length)];await assertActive();assertFeed(page);
  await element.scrollIntoView();const b=await element.boundingBox();if(!b)return false;
  // Recheck after the ownership wait and scrolling. An overlay/replaced control
  // must never turn a read-only expansion into a click on a different action.
  if(!await element.evaluate((n,check)=>{
   const hit=n.ownerDocument.elementFromPoint(check.x,check.y);
   return !!hit&&(hit===n||n.contains(hit));
  },{x:b.x+b.width/2,y:b.y+b.height/2})||!await element.evaluate(eligible))return false;
  await assertActive();assertFeed(page);await page.mouse.click(b.x+b.width/2,b.y+b.height/2);return true;
 }finally{await Promise.allSettled(elements.map(e=>e.dispose()));}
}
async function browse(page,{assertActive,random=randomInt}={}){
 await assertActive();assertFeed(page);
 if(random(0,4)===0&&await expandPost(page,{assertActive,random})){assertFeed(page);return 'expand-post';}
 const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
 await assertActive();assertFeed(page);
 await page.mouse.move(random(40,Math.max(41,Math.min(1000,viewport.width-40))),random(80,Math.max(81,Math.min(650,viewport.height-40))));
 await assertActive();assertFeed(page);
 const distance=random(180,621)*(random(0,8)===0?-1:1);
 await page.evaluate(dy=>scrollBy({top:dy,behavior:'instant'}),distance);return 'scroll';
}
async function step(a,page,{owner,now=Date.now,random=randomInt,assertActive,inspect=async()=>{},save,action=browse,feed=human.feed}={}){
 await assertActive();const at=now(),e=a.session_evidence||{},day=a.daily_day||policy.localDay(at,a.proxy_timezone||'UTC');
 if(!pageInstances.has(page))pageInstances.set(page,randomUUID());const pageToken=pageInstances.get(page);
 if((e.warmupDays||[]).includes(day))return {done:true,completedToday:true};
 const targetMs=policy.config(a.session_policy).warmupMinutes*60000,previous=e.feedWarmup;
 const valid=previous?.version===VERSION&&previous.day===day&&previous.targetMs===targetMs&&previous.revision===Number(a.session_revision||0)&&
  previous.state==='running'&&Number.isFinite(previous.elapsedMs)&&previous.elapsedMs>=0&&previous.elapsedMs<targetMs&&
  Number.isInteger(previous.scrollCount)&&previous.scrollCount>=0&&Number.isInteger(previous.expandedPosts)&&previous.expandedPosts>=0&&Array.isArray(previous.actions)&&Number.isFinite(Date.parse(previous.expiresAt));
 const continuous=valid&&previous.owner===owner&&previous.controlVersion===a.control_version&&previous.pageToken===pageToken;
 let progress=valid?{...previous}:{version:VERSION,id:randomUUID(),state:'running',day,revision:Number(a.session_revision||0),targetMs,elapsedMs:0,startedAt:new Date(at).toISOString(),expiresAt:new Date(at+targetMs+300000).toISOString(),scrollCount:0,expandedPosts:0,actions:[]};
 if(valid&&!continuous){progress.startedAt=new Date(at).toISOString();progress.expiresAt=new Date(at+targetMs-progress.elapsedMs+300000).toISOString();}
 if(continuous&&at>=Date.parse(progress.expiresAt)){
  progress={...progress,state:'stopped',finishedAt:new Date(at).toISOString(),reason:'The session expired while browsing was interrupted. Start a new warm-up when ready.'};
  await save({feedWarmup:progress},true);return {done:true,stopped:true,progress};
 }
 if(continuous&&onFeed(page.url())&&Date.parse(progress.nextActionAt)>at){await inspect();await assertActive();assertFeed(page);return {waiting:true,progress};}
 // Session verification establishes the feed first. Restore it only at a new
 // explicit start/reconnect; an unexpected destination mid-session is a stop.
 if(!continuous||!onFeed(page.url())){
  if(continuous)assertFeed(page);
  const response=await feed(page,{assertActive});await inspect(response);assertFeed(page);
 }
 await inspect();await assertActive();assertFeed(page);
 const gap=continuous?at-Date.parse(progress.observedAt):0;
 if(gap>=0&&gap<=MAX_GAP_MS)progress.elapsedMs=Math.min(targetMs,progress.elapsedMs+gap);
 const finished=progress.elapsedMs>=targetMs;
 if(!finished){
  const kind=await action(page,{assertActive,random});await inspect();await assertActive();assertFeed(page);
  if(kind==='scroll')progress.scrollCount++;
  if(kind==='expand-post')progress.expandedPosts++;
  progress.actions=[...(progress.actions||[]),{kind,at:new Date(now()).toISOString()}].slice(-12);
 }
 progress={...progress,owner,pageToken,controlVersion:a.control_version,observedAt:new Date(now()).toISOString(),nextActionAt:new Date(now()+random(5000,15001)).toISOString()};
 const patch={feedWarmup:progress};
 if(finished){progress.state='completed';progress.finishedAt=new Date(now()).toISOString();patch.warmupDays=[...new Set([...(e.warmupDays||[]),day])].sort().slice(-90);patch.warmupObservedAt=progress.finishedAt;}
 await assertActive();await save(patch,finished);
 return {done:finished,progress};
}
module.exports={VERSION,MAX_GAP_MS,onFeed,assertFeed,eligible,browse,step};
