'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{fixture}=require('./aliasmode-fixture.cjs');
const feed=require('../../src/lib/feed-warmup.cjs');
test('offline feed actions expand only post text and scroll, never click social actions or navigate profiles',async()=>{
 const f=await fixture(),owner=f.create('feed');try{
  const {page}=await owner.open({headless:true}),requests=[];await page.setRequestInterception(true);page.on('request',r=>{
   requests.push(r.url());if(r.url()==='https://www.linkedin.com/feed/')void r.respond({contentType:'text/html',body:'<!doctype html><main style="height:3500px"><article class="feed-shared-update-v2"><button type="button" class="feed-shared-inline-show-more-text__see-more-less-toggle" onclick="window.expanded=(window.expanded||0)+1;this.textContent=\'See less\'">See more</button><button type="button" onclick="window.social=true">Like</button><a href="/in/forbidden/">Member</a><form onsubmit="window.social=true"><button class="feed-shared-inline-show-more-text__see-more-less-toggle">See more</button></form></article></main><script>window.expanded=0;window.social=false;window.scrolled=0;const scroll=window.scrollBy;window.scrollBy=(...a)=>{window.scrolled++;scroll(...a);};</script>'}).catch(()=>{});else void r.abort().catch(()=>{});
  });await page.goto('https://www.linkedin.com/feed/',{waitUntil:'load'});
  assert.equal(await feed.browse(page,{assertActive:async()=>{},random:min=>min}),'expand-post');assert.equal(await page.evaluate(()=>window.expanded),1);assert.equal(await page.evaluate(()=>window.social),false);
  assert.equal(await feed.browse(page,{assertActive:async()=>{},random:min=>min}),'scroll');assert.equal(await page.evaluate(()=>window.scrolled),1);assert.equal(page.url(),'https://www.linkedin.com/feed/');assert.equal(requests.filter(u=>u==='https://www.linkedin.com/feed/').length,1);assert.ok(requests.every(u=>['https://www.linkedin.com/feed/','https://www.linkedin.com/favicon.ico'].includes(u)));
  let active=true;page.mouse.move=async()=>{active=false;};await assert.rejects(feed.browse(page,{assertActive:async()=>{if(!active)throw Error('Paused');},random:min=>min}),/Paused/);assert.equal(await page.evaluate(()=>window.scrolled),1);
 }finally{await f.close();}
});
