'use client';
import {useState} from 'react';
import type {WorkerAccount} from '@/lib/linkedin-workers.cjs';
type Props={account:WorkerAccount;disabled:boolean;onSave:(body:unknown)=>Promise<unknown>};
export default function FeedWarmupPanel({account:a,disabled,onSave}:Props){
 const s=a.session;
 const [minutes,setMinutes]=useState(s?.policy.warmupMinutes??20),[days,setDays]=useState(s?.policy.warmupDays??4);
 const [editing,setEditing]=useState(false);
 if(!s||s.lifecycle.state!=='WARMUP'&&!s.feedWarmup)return null;
 const progress=s.feedWarmup,active=a.processingEnabled&&s.lifecycle.state==='WARMUP';
 const elapsed=Math.max(0,Math.floor((progress?.elapsedMs||0)/60000)),target=progress?progress.targetMs/60000:s.policy.warmupMinutes;
 const completed=s.lifecycle.completedToday||progress?.state==='completed'&&s.lifecycle.state!=='WARMUP';
 return <div className="border-t border-[var(--line)] px-4 py-3 space-y-2" aria-label="Feed warm-up">
  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
   <strong className="font-medium">{completed?'Warm-up session complete':active?(a.status==='WARMUP'?'Browsing the feed':'Warm-up starting'):'Feed warm-up'}</strong>
   <span className="text-[var(--text-dim)] num">{s.lifecycle.done||0}/{s.lifecycle.required||s.policy.warmupDays} days · {s.policy.warmupMinutes} min/session</span>
  </div>
  <p className="text-xs text-[var(--text-dim)]">{completed?(s.lifecycle.state==='WARMUP'?'Today’s session is done. Return on another day; qualification stays paused.':'Warm-up is complete. Start processing when you’re ready.'):'Scroll the feed and expand post text. No queued profiles, likes, comments or messages.'}</p>
  {progress&&<div className="space-y-1">
   <progress className="w-full h-1.5 accent-[var(--signal)]" max={progress.targetMs} value={Math.min(progress.elapsedMs,progress.targetMs)} aria-label="Feed browsing progress"/>
   <p className="text-xs text-[var(--text-faint)] num">{elapsed}/{target} minutes · {progress.scrollCount} scrolls · {progress.expandedPosts} posts expanded{!active&&progress.state==='running'?' · Paused':''}</p>
   {progress.state==='stopped'&&<p className="text-xs text-[var(--text-dim)]">Session interrupted. Start a new warm-up when ready.</p>}
  </div>}
  {s.lifecycle.state==='WARMUP'&&<div>
   <button type="button" className="text-xs underline underline-offset-2" aria-expanded={editing} onClick={()=>setEditing(!editing)}>Warm-up settings</button>
   {editing&&<form className="flex flex-wrap items-end gap-3 pt-3" onSubmit={event=>{event.preventDefault();void onSave({action:'warmup-settings',accountId:a.id,revision:s.revision,minutes,days}).then(result=>{if(result!==false)setEditing(false);});}}>
    <label className="space-y-1"><span className="field-label">Minutes per session</span><input className="field w-28" type="number" min="1" max="40" value={minutes} disabled={disabled||active} onChange={e=>setMinutes(Number(e.target.value))}/></label>
    <label className="space-y-1"><span className="field-label">Observed days</span><input className="field w-28" type="number" min="1" max="90" value={days} disabled={disabled||active} onChange={e=>setDays(Number(e.target.value))}/></label>
    <button className="btn btn-outline !text-xs" type="submit" disabled={disabled||active||a.loginPending||a.closePending||!!s.diagnosticRequested}>Save warm-up</button>
    {active&&<p className="field-hint w-full">Stop warm-up before changing its duration.</p>}
   </form>}
  </div>}
 </div>;
}
