'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),store=require('../../src/lib/account-session-store.cjs'),core=require('../../src/lib/linkedin-workers.cjs'),alias=require('../../src/lib/aliasmode-store.cjs'),p=require('../../src/lib/account-session-policy.cjs'),admission=require('../../src/lib/diagnostic-admission.cjs'),fixture=require('./diagnostic-fixture.cjs'),{database}=require('./db-fixture.cjs');

test('public evidence distinguishes raw failures and local decisions without forwarding private report fields',()=>{
 const sites=fixture.sites(),a=admission.assess(sites);sites[0].privateToken='private-report-value';a.compatibility[0].privateToken='private-report-value';
 const gate=store.publicState({session_evidence:{gate:{verdict:a.verdict,measurementVerdict:'FAIL',sites,admission:a}}}).gate;
 assert.equal(gate.verdict,'PASS');assert.equal(gate.measurementVerdict,'FAIL');assert.equal(gate.compatibility[0].rawVerdict,'FAIL');
 const legacy=gate.sites.find(s=>s.url==='https://bot.incolumitas.com/');assert.equal(legacy.verdict,'FAIL');assert.equal(legacy.admissionVerdict,'PASS');assert.ok(legacy.admissionReasons.length);
 assert.ok(!JSON.stringify(gate).includes('private-report-value'));assert.ok(!JSON.stringify(gate).includes('sourceHashes'));
 const fp=sites.find(s=>s.kind==='fingerprint');fp.external.observations[0].value='Yes';const blocked=store.publicState({session_evidence:{gate:{verdict:'FAIL',sites,admission:admission.assess(sites)}}}).gate.sites.find(s=>s.url===fp.url);
 assert.equal(blocked.verdict,'PASS');assert.equal(blocked.website.verdict,'PASS');assert.equal(blocked.admissionVerdict,'FAIL');assert.equal(blocked.website.observations[0].value,'Yes');
});

test('human approval cannot override modification and retains raw compatibility evidence when another result is unknown',async()=>{
 const db=await database(),pool=db.pool;try{
  await core.ensure(pool);await alias.ensure(pool);const id=await alias.importProfile(pool,{profileId:'gate-review',name:'Gate review',expectedMemberName:'Gate review'}),a=await core.readRuntimeAccount(pool,id),key=p.evidenceKey(a),sites=fixture.sites();
  const fp=sites.find(s=>s.kind==='fingerprint');fp.external.observations[0].value='Yes';
  const e={network:{verdict:'PASS',key},fingerprint:{hash:'fixture'},gate:{verdict:'UNKNOWN',measurementVerdict:'FAIL',key,reportId:'exact-report',fingerprintHash:'fixture',sites}};
  await pool.query('UPDATE compel_linkedin_accounts SET session_evidence=$2::jsonb WHERE id=$1',[id,JSON.stringify(e)]);
  await assert.rejects(store.approveUnknown(pool,{accountId:id,revision:0,reportId:'exact-report'}),/Confirmed failures/);
  fp.external.observations[0].value='Not detected';sites.find(s=>s.kind==='device').external={verdict:'UNKNOWN'};
  await pool.query('UPDATE compel_linkedin_accounts SET session_evidence=$2::jsonb WHERE id=$1',[id,JSON.stringify(e)]);
  await store.approveUnknown(pool,{accountId:id,revision:0,reportId:'exact-report'});
  const saved=await core.readRuntimeAccount(pool,id);assert.equal(saved.processing_enabled,false);assert.equal(saved.session_evidence.gate.verdict,'HUMAN_APPROVED');assert.equal(saved.session_evidence.gate.measurementVerdict,'FAIL');assert.equal(saved.session_evidence.gate.admission.verdict,'UNKNOWN');assert.equal(saved.session_evidence.gate.sites.find(s=>s.kind==='incolumitas').verdict,'FAIL');
 }finally{await db.close();}
});

test('rendering choice and provider patch are part of frozen browser identity',()=>{
 const probe={...fixture.probe(),platform:'Win32',timezone:'UTC',locale:'en-GB',screen:{width:1920,height:1080}},metadata={profileId:'fixture',mode:'headful',readbackMode:'native',providerPatchVersion:'COMPELOS_ALIASMODE_READBACK_V1'},hash=p.fingerprint(probe,metadata).hash;
 assert.equal(hash,p.fingerprint(probe,{...metadata}).hash);assert.notEqual(hash,p.fingerprint(probe,{...metadata,readbackMode:'seeded'}).hash);assert.notEqual(hash,p.fingerprint(probe,{...metadata,providerPatchVersion:null}).hash);
 // Literal snapshot from the preceding controller. Installing the patch alone
 // must not manufacture identity drift for an unchanged, untagged profile.
 assert.equal(p.fingerprint(probe,{...metadata,readbackMode:'seeded'}).hash,'216c8af382deb97c9a3aee74f236c2f6dafbb206769b8d70da13e0e95047236b');
});
