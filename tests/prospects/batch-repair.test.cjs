'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {publishedProfileEmails,publishedProfileWebsites}=require('../../src/lib/profile-public-contacts.cjs');
const {researchProspect,attributableCandidate}=require('../../src/lib/prospect-research.cjs');
const {createPageRenderer}=require('../../src/lib/public-page-browser.cjs');
const {extractActivityPage,relativeDate,activityRoute,checkActivityPage}=require('../../src/lib/linkedin-activity-page.cjs');
const {extractActivity}=require('../../src/lib/linkedin-activity.cjs');
const now='2026-10-12T12:00:00.000Z',person='https://www.linkedin.com/in/brian-white-cco/';
const input={firstName:'Brian',lastName:'White',profileIdentityConfirmed:true,linkedinUrl:person,lastActivityAt:'2026-10-11T12:00:00Z',websites:['https://www.eosworldwide.com/brian-white'],about:'Call me at 717.502.2084\nBrian.White@EOSworldwide.com'};
const html='<html><body><h1>Brian White</h1><p>Brian White helps businesses grow through practical coaching and leadership development.</p><a href="mailto:asonksen@eosworldwide.com">Email our speakers team</a><footer><a href="mailto:hello@eosworldwide.com">Contact</a></footer></body></html>';
test('a named standalone LinkedIn signature is accepted; corporate staff mailboxes are not owned merely by domain',async()=>{
 assert.deepEqual(publishedProfileEmails(input).map(c=>c.address),['brian.white@eosworldwide.com']);
 const r=await researchProspect(input,{now,ai:false,fetchPage:async url=>({url,html})});
 assert.deepEqual(r.contacts.filter(c=>['PUBLISHED','DOMAIN_MATCH'].includes(c.ownership)).map(c=>c.address),['brian.white@eosworldwide.com','hello@eosworldwide.com']);
 assert.equal(attributableCandidate({address:'adamwhite@eosworldwide.com',url:input.websites[0],explicit:true,contactPage:true},input),false);
 assert.equal(publishedProfileEmails({...input,about:'Client testimonial:\nBrian.White@EOSworldwide.com'}).length,0);
 for(const [address,url,firstName,lastName]of [['kb@kristibaxter.com','https://kristibaxter.com/','Kristi','Baxter'],['coachtonycarter@gmail.com','https://coachtonycarter.com/contact','Anthony','Carter'],['hh@coachseattle.com','https://coachseattle.com/','HsuanHua','Chang'],['me@practice.test','https://practice.test/','Brian','White']])assert.equal(attributableCandidate({address,url,explicit:true,businessContact:true},{firstName,lastName}),true);
});
test('joined sentences and credentials never become website roots, including in old checkpoints',async()=>{
 const about='Hard conversations.ICF-certified coach. Tuesday reality.CREDENTIALS • Executive Coach. Visit https://www.chaumontsolutions.com/';
 assert.deepEqual(publishedProfileWebsites({...input,about}),['https://www.chaumontsolutions.com/']);
 let prev=await researchProspect({...input,about:'',websites:['https://conversations.icf/'],emailSource:'',emails:[]},{now,ai:false,fetchPage:async()=>{throw Error('ENOTFOUND');}});
 const calls=[];
 const next=await researchProspect({...input,about,website:'https://conversations.icf/',websites:['https://conversations.icf/'],websiteSource:'about_section'},{now,ai:false,previousResearch:prev,fetchPage:async url=>{calls.push(url);return{url,html};}});
 assert.ok(calls.length);assert.ok(calls.every(u=>!u.includes('conversations.icf')));assert.ok(next.crawl.roots.every(u=>!u.includes('conversations.icf')));
});
test('an old accepted staff contact is revalidated instead of blindly restored on a saved profile',async()=>{
 let previous=await researchProspect({...input,about:''},{now,ai:false,fetchPage:async url=>({url,html})});
 previous.contacts.push({address:'asonksen@eosworldwide.com',url:input.websites[0],source:'website',ownership:'DOMAIN_MATCH'});
 previous.crawl.candidates.push({address:'asonksen@eosworldwide.com',url:input.websites[0],explicit:true,contactPage:true});
 previous.crawl.attributionVersion=2;previous.crawl.complete=false;
 const next=await researchProspect({...input,emails:['asonksen@eosworldwide.com'],emailSource:'website_scraped'},{now,ai:false,previousResearch:previous,fetchPage:async url=>({url,html})});
 assert.ok(!next.contacts.some(c=>c.address==='asonksen@eosworldwide.com'&&c.ownership!=='UNCONFIRMED'));
 assert.equal(next.contacts[0].address,'brian.white@eosworldwide.com');
});
const card=(author,label,quote='')=>`<div><h2>Feed post</h2><div><a href="${author}">Author</a><p>${label}</p></div>${quote}<p>Actual post text</p></div>`;
const activityOptions={profileUrl:person,pageUrl:person+'recent-activity/all/',now};
test('visible activity requires the requested author; quoted posts and ambiguous rounded dates never qualify',()=>{
 assert.equal(extractActivityPage(card(person,'2d'),activityOptions).activityStatus,'Active');
 assert.equal(extractActivityPage(card(person,'9yr'),activityOptions).activityStatus,'Inactive');
 assert.equal(extractActivityPage(card('https://www.linkedin.com/in/someone-else/','2d'),activityOptions).activityStatus,'Unknown');
 assert.equal(extractActivityPage(card(person,'',`<div><a href="https://www.linkedin.com/company/other/">Other</a><p>2d</p></div>`),activityOptions).activityStatus,'Unknown');
 assert.equal(extractActivityPage(card(person,'','<p><span>2d</span> is mentioned in the body.</p>'),activityOptions).activityStatus,'Unknown');
 for(const label of ['1mo','4w','undated'])assert.equal(relativeDate(label,now),null);
 assert.equal(extractActivityPage('<h2>All activity</h2><p>Nothing to see for now</p>',activityOptions).activityStatus,'Unknown');
 assert.equal(extractActivityPage(card(person,'2d'),{...activityOptions,pageUrl:'https://www.linkedin.com/feed/'}).activityStatus,'Unknown');
 assert.equal(activityRoute('https://example.com/in/brian-white-cco/recent-activity/all/',person),null);
});
test('activity fallback follows only observed routes and closes its tab on errors',async()=>{
 let closed=0,navigations=[];
 const page={setViewport:async()=>{},goto:async u=>navigations.push(u),waitForFunction:async()=>{},evaluate:async()=>['https://www.linkedin.com/in/other/recent-activity/all/'],close:async()=>closed++};
 assert.equal(await checkActivityPage({newPage:async()=>page},person),null);assert.deepEqual(navigations,[person]);assert.equal(closed,1);
 page.evaluate=async()=>[person+'recent-activity/all/'];page.content=async()=>{throw Error('Page crashed');};page.url=()=>person+'recent-activity/all/';
 await assert.rejects(checkActivityPage({newPage:async()=>page},person),/crashed/);assert.equal(closed,2);
});
test('API actor references match the author; company posts and unrelated member links are not substituted',()=>{
 const opts={now,profileUrn:'urn:li:fsd_profile:brian',profileUrl:person};
 const post={createdAt:Date.parse('2026-10-11T12:00:00Z'),actor:{urn:'urn:li:member:123',name:{attributes:[{'*miniProfile':'urn:li:fs_miniProfile:brian'}]}}};
 assert.equal(extractActivity({data:{elements:[post]}},opts).activityEvidence.selected.association,'matching_author');
 for(const actor of [{urn:'urn:li:company:123'},{navigationContext:{actionTarget:'https://www.linkedin.com/in/other/'}}])assert.equal(extractActivity({data:{elements:[{...post,actor}]}},opts).activityStatus,'Unknown');
});
test('public rendering preserves the original main-document DNS error and always closes the isolated context',async()=>{
 let handler,closed=0;
 const page={setRequestInterception:async()=>{},on:(_e,fn)=>handler=fn,goto:async()=>{await handler({method:()=> 'GET',url:()=>input.websites[0],resourceType:()=> 'document',abort:async()=>{}});throw Error('net::ERR_BLOCKED_BY_CLIENT');}};
 const browser={userAgent:async()=> 'Fixture',createBrowserContext:async()=>({newPage:async()=>page,close:async()=>closed++})};
 const render=createPageRenderer(browser,{fetchResource:async()=>{throw Object.assign(Error('getaddrinfo ENOTFOUND website'),{code:'ENOTFOUND'});}});
 await assert.rejects(render(input.websites[0]),e=>e.code==='ENOTFOUND'&&!e.message.includes('ERR_BLOCKED'));assert.equal(closed,1);
});
