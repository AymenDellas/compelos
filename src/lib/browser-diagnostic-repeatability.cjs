'use strict';
// A study summary, never a runtime permit or a replacement for account admission.
const admission=require('./diagnostic-admission.cjs'),signals=require('./stealth-self-test.cjs');
const VERSION='BROWSER_REPEATABILITY_V1';
function assess(studies,{profiles=3,launches=2,newProfiles=2}={}){
 if(!Number.isInteger(profiles)||profiles<1||profiles>10||!Number.isInteger(launches)||launches<2||launches>10||!Number.isInteger(newProfiles)||newProfiles<0||newProfiles>profiles)throw Error('Invalid study coverage');
 if(!Array.isArray(studies))throw Error('Expected diagnostic studies');
 const findings=[],observations=[],seen=new Set();let fresh=0;
 const add=(profile,verdict,reason)=>findings.push({profile,verdict,reason});
 for(const [index,study]of studies.entries()){
  const label='Profile '+(index+1),runs=Array.isArray(study?.runs)?study.runs:[];
  if(!study?.profileId||seen.has(study.profileId))add(label,'UNKNOWN','Missing or duplicate profile identity');
  else seen.add(study.profileId);
  if(study?.newProfile===true)fresh++;
  if(study?.accountsUnchanged!==true||study?.rosterRestored!==true||study?.error||study?.cleanupError||!study?.cleanup?.some(c=>c.closed===true))add(label,'UNKNOWN','Ownership, closure or account preservation is unconfirmed');
  if(runs.length!==launches||new Set(runs.map(r=>r.iteration)).size!==launches||runs.some(r=>!Number.isInteger(r.iteration)||r.iteration<1||r.iteration>launches))add(label,'UNKNOWN','The declared launch coverage did not complete');
  let identity;
  for(const run of runs){
   const result=run.result,sites=Array.isArray(result?.sites)?result.sites:[],assessment=admission.assess(sites);
   const device=sites.find(s=>s.kind==='device'),fingerprint=sites.find(s=>s.kind==='fingerprint');
   observations.push({profile:label,launch:run.iteration,verdict:assessment.verdict,
    rawCounts:Object.fromEntries(['PASS','FAIL','UNKNOWN'].map(v=>[v,sites.filter(s=>s.verdict===v).length])),
    automationFlags:device?.external?.flags?Object.entries(device.external.flags).filter(([,v])=>v===true).map(([k])=>k):null,
    bot:fingerprint?.external?.value||'Unavailable',modification:fingerprint?.external?.observations?.find(o=>o.name==='Browser tampering')?.value||'Unavailable'});
   if(assessment.verdict!=='PASS')add(label,assessment.verdict,'Launch '+run.iteration+': '+assessment.reason);
   if(run.error||result?.version!==signals.VERSION||sites.length!==signals.BATTERY.length)add(label,'UNKNOWN','Launch '+run.iteration+': incomplete or obsolete measurement');
   const clocks=Array.isArray(run.clocks)?run.clocks:[];
   if(clocks.some(c=>c.verdict==='FAIL'))add(label,'FAIL','Launch '+run.iteration+': clock mismatch');
   if(clocks.length!==signals.BATTERY.length||clocks.some(c=>c.verdict!=='PASS')||signals.BATTERY.some(s=>clocks.filter(c=>c.kind===s.kind).length!==1))add(label,'UNKNOWN','Launch '+run.iteration+': incomplete clock evidence');
   // One profile must retain its measured identity/configuration across restarts.
   // Different profiles can legitimately expose the same physical hardware.
   const probe=sites.find(s=>s.kind==='browserscan')?.probe;
   if(probe&&run.browserVersion&&run.providerConfiguration){
    try{
     const current=JSON.stringify({hash:require('./account-session-policy.cjs').fingerprint(probe).hash,browserVersion:run.browserVersion,provider:run.providerConfiguration});
     if(identity&&current!==identity)add(label,'FAIL','Browser identity or configuration changed between launches');
     identity=current;
    }catch{add(label,'UNKNOWN','Launch '+run.iteration+': identity probe is incomplete');}
   }else add(label,'UNKNOWN','Launch '+run.iteration+': identity/configuration evidence is missing');
  }
 }
 if(studies.length!==profiles||seen.size!==profiles||fresh<newProfiles)add('Study','UNKNOWN','The declared number of distinct and newly created profiles was not observed');
 const verdict=findings.some(f=>f.verdict==='FAIL')?'FAIL':findings.length?'UNKNOWN':'PASS';
 return {version:VERSION,verdict,coverage:{expectedProfiles:profiles,observedProfiles:seen.size,expectedLaunchesPerProfile:launches,observedLaunches:observations.length,requiredNewProfiles:newProfiles,observedNewProfiles:fresh},observations,findings,
  scope:'Diagnostic repeatability only. No LinkedIn prediction, account authorization or permanent undetectability claim. A later passing launch never erases a failing launch in this study.'};
}
module.exports={VERSION,assess};
