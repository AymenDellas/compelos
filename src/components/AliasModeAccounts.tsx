'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {
  AlertTriangle,ChevronDown,ExternalLink,Loader2,MoreVertical,
  Pause,Play,Plus,Power,RefreshCw,Settings2,Shield,Trash2,
  Unlink,Users,Wifi,X
} from 'lucide-react';
import type {WorkerAccount,WorkerSettings} from '@/lib/linkedin-workers.cjs';
import type {AliasModeSettings} from '@/lib/aliasmode-store.cjs';
import type {SupervisorStatus} from '@/lib/worker-supervisor-control.cjs';

/* ── helpers ─────────────────────────────────────────────────────── */

async function api<T>(url:string,body?:unknown,method='POST'):Promise<T>{
  const response=await fetch(url,body===undefined?{cache:'no-store'}:{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const value=await response.json();if(!response.ok)throw Error(value.error||'The local worker request failed.');return value;
}
const msg=(error:unknown)=>error instanceof Error?error.message:'The request failed.';

type Status='processing'|'warmup'|'paused'|'review'|'setup'|'recovery'|'hold'|'disabled'|'closing'|'connecting'|'offline'|'experiment';
function accountStatus(a:WorkerAccount):{status:Status;label:string;badge:string;dot:string}{
  if(a.session?.diagnosticRequested==='warmup-experiment')return {status:'experiment',label:'Warmup experiment',badge:'badge badge-warn',dot:'dot-warn'};
  if(a.attentionReason)return {status:'review',label:'Review required',badge:'badge badge-bad',dot:'dot-bad'};
  if(a.closePending)return {status:'closing',label:'Closing…',badge:'badge badge-idle',dot:'dot-idle'};
  if(a.loginPending||a.status==='awaiting_login')return {status:'connecting',label:'Verify in AliasMode',badge:'badge badge-warn',dot:'dot-warn'};
  if(a.startupStage==='FAILED'||a.status==='provider_unavailable')return {status:'review',label:'Needs attention',badge:'badge badge-bad',dot:'dot-bad'};
  if(!a.aliasmodeProfileId)return {status:'offline',label:'Not linked',badge:'badge badge-idle',dot:'dot-idle'};
  if(!a.enabled)return {status:'disabled',label:'Disabled',badge:'badge badge-idle',dot:'dot-idle'};
  if(a.status==='DAILY_LIMIT_REACHED')return {status:'paused',label:'Daily limit',badge:'badge badge-warn',dot:'dot-warn'};
  if(a.session?.lifecycle.state==='PROVISION')return {status:'setup',label:'Setup required',badge:'badge badge-warn',dot:'dot-warn'};
  if(a.session?.lifecycle.state==='RECOVERY')return {status:'recovery',label:'Recovery',badge:'badge badge-warn',dot:'dot-warn'};
  if(a.session?.lifecycle.state==='HOLD')return {status:'hold',label:'Identity review',badge:'badge badge-bad',dot:'dot-bad'};
  if(a.session?.lifecycle.state==='WARMUP')return {status:'warmup',label:`Warmup ${a.session.lifecycle.done||0}/${a.session.lifecycle.required}`,badge:'badge badge-info',dot:'dot-live'};
  if(a.processingEnabled)return a.status==='processing'?{status:'processing',label:'Processing',badge:'badge badge-ok',dot:'dot-live'}:a.status==='sleeping'?{status:'processing',label:'Waiting…',badge:'badge badge-ok',dot:'dot-live'}:{status:'processing',label:'Starting…',badge:'badge badge-info',dot:'dot-live'};
  return a.connectedAt?{status:'paused',label:'Paused',badge:'badge badge-idle',dot:'dot-idle'}:{status:'offline',label:'Not verified',badge:'badge badge-idle',dot:'dot-idle'};
}

type ActionResult={provider:AliasModeSettings;accounts:WorkerSettings};

/* ── main component ──────────────────────────────────────────────── */

export default function AliasModeAccounts(){
  const [accounts,setAccounts]=useState<WorkerSettings|null>(null);
  const [provider,setProvider]=useState<AliasModeSettings|null>(null);
  const [agent,setAgent]=useState<SupervisorStatus|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [pending,setPending]=useState('');
  const [showAdd,setShowAdd]=useState(false);
  const [showSetup,setShowSetup]=useState<string|null>(null);
  const [showSettings,setShowSettings]=useState(false);
  const [menuOpen,setMenuOpen]=useState<string|null>(null);

  const load=useCallback(async()=>{
    const [a,p,s]=await Promise.all([
      api<WorkerSettings>('/api/linkedin-accounts'),
      api<AliasModeSettings>('/api/aliasmode'),
      api<SupervisorStatus>('/api/worker-supervisor')
    ]);
    setAccounts(a);setProvider(p);setAgent(s);
  },[]);

  useEffect(()=>{
    let current=true;
    const refresh=()=>{if(current)void load().catch(e=>{if(current)setError(msg(e));});};
    refresh();const timer=setInterval(refresh,5000);
    return()=>{current=false;clearInterval(timer);};
  },[load]);

  async function run(key:string,task:()=>Promise<unknown>,success:string){
    setPending(key);setError('');setNotice('');
    try{await task();await load();setNotice(success);return true;}
    catch(e){setError(msg(e));return false;}
    finally{setPending('');}
  }
  const change=async(body:unknown)=>{
    const result=await api<ActionResult>('/api/aliasmode',body);
    setAccounts(result.accounts);setProvider(result.provider);
  };

  const online=agent?.state==='online';
  const connected=provider?.status.state==='connected';
  const linked=accounts?.accounts.filter(a=>a.aliasmodeProfileId)||[];
  const unlinked=accounts?.accounts.filter(a=>!a.aliasmodeProfileId)||[];

  return <section className="panel" aria-label="LinkedIn profiles">
    {/* ── header ──────────────────────────────────────────── */}
    <div className="panel-head">
      <Users className="w-3.5 h-3.5"/>
      LinkedIn profiles
      <span className="ml-auto flex items-center gap-2">
        {linked.length>0&&<span className="text-[0.7rem] font-normal text-[var(--text-faint)]">{linked.length} profile{linked.length!==1?'s':''}</span>}
        <button type="button" className="btn btn-ghost !p-1.5" aria-label="Connection settings" title="Connection settings" onClick={()=>setShowSettings(!showSettings)}>
          <Settings2 className="w-4 h-4"/>
        </button>
      </span>
    </div>

    <div className="panel-body space-y-4">
      {/* ── agent/connection status bar ───────────────────── */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span className={online?'dot-live':agent?.state==='starting'?'dot-warn':'dot-idle'}/>
          Agent {online?'online':agent?.state==='starting'?'starting':'offline'}
        </span>
        <span className="text-[var(--text-dim)] flex items-center gap-1.5">
          <Wifi className="w-3 h-3"/>
          AliasMode {connected?'connected':provider?.status.state==='unavailable'?'unavailable':'not checked'}
        </span>
        {!online&&<button className="btn btn-outline !text-xs !py-1" type="button" disabled={!!pending||agent?.state==='starting'||!agent?.canStart}
          onClick={()=>void run('agent',async()=>{setAgent(await api('/api/worker-supervisor',{action:'start'}));},'Agent started.')}>
          <Power className="w-3.5 h-3.5"/>Start agent
        </button>}
      </div>

      {/* ── connection settings (toggle) ─────────────────── */}
      {showSettings&&provider&&<ConnectionSettings provider={provider} disabled={!!pending} onSave={body=>run('connection',async()=>{
        setProvider(await api('/api/aliasmode',body,'PUT'));
      },'Connection saved.')} onRefresh={()=>run('refresh',()=>change({action:'refresh'}),'Profiles refreshed.')}
        refreshDisabled={!!pending||!online}
        allowProcessing={accounts?.activeCount!==undefined?accounts.activeCount>0:false}
        onAllowChange={enabled=>run('allow',()=>change({action:'allow',enabled}),'Processing availability updated.')}
        allowDisabled={!!pending}
      />}

      {/* ── errors / notices ─────────────────────────────── */}
      {provider?.status.reason&&!connected&&<p role="status" className="text-xs text-[var(--text-dim)]">{provider.status.reason}</p>}
      {error&&<p role="alert" className="text-xs text-[var(--bad)] break-words">{error}</p>}
      {notice&&<p role="status" className="text-xs text-[var(--signal)]">{notice}</p>}

      {/* ── loading state ────────────────────────────────── */}
      {!accounts||!provider?<p className="text-sm text-[var(--text-dim)]">Loading profiles…</p>:<>

        {/* ── empty state ──────────────────────────────── */}
        {!linked.length&&<div className="text-center py-6 space-y-3">
          <Users className="w-8 h-8 mx-auto text-[var(--text-faint)]"/>
          <p className="text-sm text-[var(--text-dim)]">No profiles linked yet</p>
          <p className="text-xs text-[var(--text-faint)]">Link your AliasMode profiles, verify the signed-in members, then start processing.</p>
          <button className="btn btn-primary mx-auto" onClick={()=>setShowAdd(true)}><Plus className="w-3.5 h-3.5"/>Add profile</button>
        </div>}

        {/* ── account cards ────────────────────────────── */}
        <div className="space-y-3">
          {linked.map(a=>{
            const {status,label:statusLabel,badge,dot}=accountStatus(a);
            return <div key={a.id} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)]" role="group" aria-label={a.label}>
              {/* card header */}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={dot}/>
                    <strong className="text-sm font-medium truncate">{a.label}</strong>
                    <span className={badge}>{statusLabel}</span>
                  </div>
                  <p className="text-xs text-[var(--text-dim)] truncate mt-0.5">
                    {a.signedIn?.name
                      ?<>{a.signedIn.profileUrl?<a href={a.signedIn.profileUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{a.signedIn.name}</a>:a.signedIn.name}</>
                      :<>Expected: {a.expectedMemberName||'Not set'}</>}
                  </p>
                </div>

                {/* actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* primary action */}
                  {a.processingEnabled||a.session?.diagnosticRequested==='warmup-experiment'
                    ?<button className="btn btn-outline !text-xs !py-1.5" onClick={()=>void run(a.id,()=>api('/api/linkedin-accounts',{id:a.id,action:'pause'}),'Paused.')}>
                      <Pause className="w-3.5 h-3.5"/>{a.session?.diagnosticRequested==='warmup-experiment'?'Stop':'Pause'}
                    </button>
                    :<button className="btn btn-primary !text-xs !py-1.5"
                      disabled={!!pending||!online||!connected||(accounts?.activeCount??0)===0||!a.enabled||!a.connectedAt||!!a.attentionReason||a.closePending||a.loginPending||(!!a.session&&['PROVISION','HOLD','RECOVERY'].includes(a.session.lifecycle.state))||a.status==='awaiting_login'}
                      onClick={()=>void run(a.id,()=>api('/api/linkedin-accounts',{id:a.id,action:'start'}),a.session?.lifecycle.state==='WARMUP'?'Warmup started.':'Processing started.')}>
                      <Play className="w-3.5 h-3.5"/>{a.session?.lifecycle.state==='WARMUP'?'Warmup':'Start'}
                    </button>}

                  {/* menu */}
                  <div className="relative">
                    <button type="button" className="btn btn-ghost !p-1.5" aria-label="More actions" onClick={()=>setMenuOpen(menuOpen===a.id?null:a.id)}>
                      <MoreVertical className="w-4 h-4"/>
                    </button>
                    {menuOpen===a.id&&<AccountMenu account={a} pending={!!pending} online={!!online}
                      onVerify={()=>{setMenuOpen(null);void run(a.id,()=>api('/api/linkedin-accounts',{id:a.id,action:'login'}),
                        'Review requested. Confirm the member in AliasMode; processing stays paused.');}}
                      onSetup={()=>{setMenuOpen(null);setShowSetup(a.id);}}
                      onClose={()=>{setMenuOpen(null);void run(a.id,()=>change({action:'close',accountId:a.id}),
                        'Profile closure requested. Sign-in preserved.');}}
                      onRemove={()=>{setMenuOpen(null);void run(a.id,()=>change({action:'bind',accountId:a.id,profileId:null,name:'',bindingRevision:a.bindingRevision||0}),
                        'Profile unlinked. History and holds retained.');}}
                      onDelete={()=>{setMenuOpen(null);if(!confirm(`Delete "${a.label}"? The account will be archived and removed from the list. Qualification history is preserved.`))return;void run(a.id,()=>change({action:'archive',accountId:a.id}),'Account deleted.');}}
                      onDismiss={()=>setMenuOpen(null)}/>}
                  </div>
                </div>
              </div>

              {/* card details row */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-3 text-xs text-[var(--text-faint)]">
                <span className="num">{a.dailyCount}/{a.dailyLimit} today</span>
                {a.browserOpen!==undefined&&<span>{a.browserOpen?'Browser open':'Browser closed'}</span>}
                {a.browserOpen&&a.browserMode&&<span>{a.browserMode==='headless'?'Headless':a.browserMode==='visible'?'Visible':'Mode unknown'}</span>}
                {a.nextEligibleAt&&<span>Next: {new Date(a.nextEligibleAt).toLocaleTimeString()}</span>}
              </div>

              {/* attention reasons */}
              {[...new Set([a.attentionReason,a.startupReason,a.reason].filter(Boolean))].map(reason=>
                <p key={reason} className={`px-4 pb-2 text-xs break-words ${a.attentionReason?'text-[var(--bad)]':'text-[var(--text-dim)]'}`}>{reason}</p>)}

              {/* session setup dialog trigger */}
              {showSetup===a.id&&provider&&<SessionSetupDialog account={a} provider={provider} pending={!!pending} online={!!online&&!!connected}
                onAction={body=>run(a.id,()=>change(body),'Session updated.')}
                onClose={()=>setShowSetup(null)}/>}
            </div>;
          })}
        </div>

        {/* ── add profile button ───────────────────────── */}
        {linked.length>0&&<button className="btn btn-outline w-full !text-xs" onClick={()=>setShowAdd(true)} disabled={!!pending}>
          <Plus className="w-3.5 h-3.5"/>Add another profile
        </button>}

        {/* ── unlinked accounts ────────────────────────── */}
        {unlinked.length>0&&<details>
          <summary className="cursor-pointer text-xs text-[var(--text-dim)]">
            {unlinked.length} saved account{unlinked.length!==1?'s':''} without a profile binding
          </summary>
          <div className="space-y-2 pt-2">
            <p className="field-hint">History and review holds are retained. Link an AliasMode profile to resume processing.</p>
            {unlinked.map(a=><div key={a.id} className="flex items-center justify-between gap-2 border-t border-[var(--line)] py-2 text-xs">
              <span>{a.label}{a.signedIn?.name?` · ${a.signedIn.name}`:''}</span>
              <div className="flex items-center gap-2">
                {a.attentionReason&&<span className="text-[var(--bad)]">{a.attentionReason}</span>}
                <button type="button" className="btn btn-ghost !text-xs !p-1 text-[var(--bad)]" title="Delete account"
                  disabled={!!pending||a.processingEnabled}
                  onClick={()=>{if(!confirm(`Delete "${a.label}"? The account will be archived. History is preserved.`))return;void run(a.id,()=>change({action:'archive',accountId:a.id}),'Account deleted.');}}>
                  <Trash2 className="w-3.5 h-3.5"/>
                </button>
              </div>
            </div>)}
          </div>
        </details>}

        {/* ── add profile dialog ───────────────────────── */}
        {showAdd&&provider&&<AddProfileDialog
          profiles={provider.profiles.filter(p=>!linked.some(a=>a.aliasmodeProfileId===p.id))}
          disabled={!!pending||!connected}
          defaultLimit={accounts?.defaultDailyLimit||300}
          onSave={body=>run('import',()=>change(body),'Profile linked. Verify the member before starting.')}
          onClose={()=>setShowAdd(false)}/>}
      </>}

      {/* ── pending indicator ────────────────────────────── */}
      {pending&&<p role="status" className="flex items-center gap-2 text-xs text-[var(--text-faint)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin"/>Saving…
      </p>}
    </div>

    <p className="panel-note">Visible processing by default · Each account keeps its own verified session, daily ceiling and 60–150s spacing. Start authorizes processing.</p>
  </section>;
}

/* ── account context menu ────────────────────────────────────────── */

function AccountMenu({account:a,pending,online,onVerify,onSetup,onClose,onRemove,onDelete,onDismiss}:{
  account:WorkerAccount;pending:boolean;online:boolean;
  onVerify:()=>void;onSetup:()=>void;onClose:()=>void;onRemove:()=>void;onDelete:()=>void;onDismiss:()=>void;
}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const handler=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))onDismiss();};
    document.addEventListener('mousedown',handler);
    return()=>document.removeEventListener('mousedown',handler);
  },[onDismiss]);

  return <div ref={ref} className="menu absolute right-0 top-full mt-1 z-50">
    <button type="button" className="menu-item w-full text-left"
      disabled={pending||!online||a.closePending||a.processingEnabled}
      onClick={onVerify}>
      <ExternalLink className="w-3.5 h-3.5"/>{a.attentionReason?'Open for review':'Verify session'}
    </button>
    <button type="button" className="menu-item w-full text-left"
      onClick={onSetup}>
      <Shield className="w-3.5 h-3.5"/>Session setup
    </button>
    <button type="button" className="menu-item w-full text-left"
      disabled={pending||!online||a.closePending}
      onClick={onClose}>
      <Unlink className="w-3.5 h-3.5"/>Close browser
    </button>
    <div className="menu-sep"/>
    <button type="button" className="menu-item w-full text-left"
      disabled={pending||a.processingEnabled||a.online}
      onClick={onRemove}>
      <Unlink className="w-3.5 h-3.5"/>Unlink profile
    </button>
    <button type="button" className="menu-item w-full text-left text-[var(--bad)]"
      disabled={pending||a.processingEnabled||a.online}
      onClick={onDelete}>
      <Trash2 className="w-3.5 h-3.5"/>Delete account
    </button>
  </div>;
}

/* ── connection settings (inline, toggleable) ────────────────────── */

function ConnectionSettings({provider,disabled,onSave,onRefresh,refreshDisabled,allowProcessing,onAllowChange,allowDisabled}:{
  provider:AliasModeSettings;disabled:boolean;
  onSave:(body:unknown)=>Promise<boolean>;onRefresh:()=>void;refreshDisabled:boolean;
  allowProcessing:boolean;onAllowChange:(enabled:boolean)=>void;allowDisabled:boolean;
}){
  const [address,setAddress]=useState(provider.baseUrl);
  return <div className="space-y-3 border border-[var(--line)] rounded-lg p-4 bg-[var(--surface-2)] fade-in">
    <p className="text-xs font-medium">Connection & settings</p>
    <form className="space-y-3" onSubmit={e=>{e.preventDefault();void onSave({baseUrl:address,revision:provider.revision});}}>
      <label className="block space-y-1">
        <span className="field-label">Local API address</span>
        <input className="field w-full" type="url" required value={address} onChange={e=>setAddress(e.target.value)} disabled={disabled}/>
      </label>
      <p className="field-hint">Keep AliasMode open. Visible processing is the default. No API key needed.</p>
      <button className="btn btn-outline !text-xs" disabled={disabled}>Save connection</button>
    </form>
    <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3">
      <button type="button" className="btn btn-outline !text-xs" disabled={refreshDisabled} onClick={onRefresh}>
        <RefreshCw className="w-3.5 h-3.5"/>Refresh profiles
      </button>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={allowProcessing} disabled={allowDisabled} onChange={e=>void onAllowChange(e.target.checked)}/>
        Allow processing
      </label>
    </div>
  </div>;
}

/* ── add profile dialog ──────────────────────────────────────────── */

function AddProfileDialog({profiles,disabled,defaultLimit,onSave,onClose}:{
  profiles:AliasModeSettings['profiles'];disabled:boolean;defaultLimit:number;
  onSave:(body:unknown)=>Promise<boolean>;onClose:()=>void;
}){
  const dialogRef=useRef<HTMLDialogElement>(null);
  const [id,setId]=useState('');
  const [member,setMember]=useState('');
  useEffect(()=>{dialogRef.current?.showModal();},[]);

  return <dialog ref={dialogRef} onCancel={onClose} onClose={onClose}
    className="m-auto p-0 w-[min(480px,calc(100vw-32px))] rounded-lg border border-[var(--line)] bg-[var(--surface-1)] text-[var(--text)] backdrop:bg-black/60">
    <form className="p-5 space-y-4" onSubmit={e=>{e.preventDefault();void onSave({action:'import',profileId:id,name:member.trim(),expectedMemberName:member.trim(),dailyLimit:defaultLimit}).then(ok=>{if(ok){setId('');setMember('');onClose();}});}}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Link an AliasMode profile</h3>
        <button type="button" className="btn btn-ghost !p-1" onClick={onClose}><X className="w-4 h-4"/></button>
      </div>
      <label className="block space-y-1">
        <span className="field-label">AliasMode profile</span>
        <select className="field w-full" required value={id} onChange={e=>setId(e.target.value)} disabled={disabled}>
          <option value="">Choose a profile</option>
          {profiles.map(p=><option key={p.id} value={p.id}>{p.number?`#${p.number} · `:''}{p.name} · {p.id}</option>)}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="field-label">Expected LinkedIn member name</span>
        <input className="field w-full" required maxLength={80} value={member} onChange={e=>setMember(e.target.value)} disabled={disabled} placeholder="Name on the signed-in LinkedIn account"/>
      </label>
      <p className="field-hint">Creates a paused account. Cookies and credentials stay in AliasMode.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={disabled||!id}>Link profile</button>
      </div>
    </form>
  </dialog>;
}

/* ── session setup dialog ────────────────────────────────────────── */

function SessionSetupDialog({account:a,provider:_provider,pending:disabled,online,onAction,onClose}:{
  account:WorkerAccount;provider:AliasModeSettings;pending:boolean;online:boolean;
  onAction:(body:unknown)=>Promise<boolean>;onClose:()=>void;
}){
  const dialogRef=useRef<HTMLDialogElement>(null);
  const s=a.session;
  const [engine,setEngine]=useState(s?.engine||'aliasmode-chromium');
  const [mode,setMode]=useState(s?.launchMode||'headful');
  const [proxy,setProxy]=useState(s?.proxyId||'');
  const [host,setHost]=useState(s?.proxyHost||'');
  const [port,setPort]=useState(s?.proxyPort?.toString()||'');
  const [country,setCountry]=useState(s?.proxyCountry||'');
  const [zone,setZone]=useState(s?.proxyTimezone||'');
  const [ip,setIp]=useState(s?.expectedExitIp||'');
  const [policy,setPolicy]=useState(s?.policy||{});
  const [reviewed,setReviewed]=useState(false);
  const [showAdvanced,setShowAdvanced]=useState(false);
  useEffect(()=>{dialogRef.current?.showModal();},[]);

  const busy=disabled||a.processingEnabled||a.online||a.closePending;
  const checkDisabled=disabled||!online||a.processingEnabled||!!a.attentionReason||a.closePending||a.loginPending||a.status==='awaiting_login'||!!s?.diagnosticRequested;
  const publishedWarnings=s?.gate?.sites?.flatMap(site=>site.website?.observations||[]).filter(o=>o.value==='FAIL'||o.value.startsWith('FAIL:')||/^Yes\b|^You are using a VPN\b/.test(o.value))||[];
  const settings:[string,string][]=[['warmupDays','Warmup days'],['warmupProfilesPerDay','Warmup profiles/day'],['rampStepDays','Days per ramp step'],['recoveryDays','Recovery days'],['minIntervalSeconds','Min spacing (s)'],['maxIntervalSeconds','Max spacing (s)'],['staggerSeconds','Startup stagger (s)'],['renderEvery','Render every Nth']];

  if(!s)return null;

  return <dialog ref={dialogRef} onCancel={onClose} onClose={onClose}
    className="m-auto p-0 w-[min(600px,calc(100vw-32px))] max-h-[85dvh] rounded-lg border border-[var(--line)] bg-[var(--surface-1)] text-[var(--text)] backdrop:bg-black/60 overflow-hidden">
    <div className="flex flex-col max-h-[85dvh]">
      {/* header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)] shrink-0">
        <h3 className="text-sm font-semibold">Session setup · {a.label}</h3>
        <button type="button" className="btn btn-ghost !p-1" onClick={onClose}><X className="w-4 h-4"/></button>
      </div>

      {/* body */}
      <div className="p-5 space-y-5 overflow-y-auto min-h-0">
        {/* status overview */}
        <div className="space-y-2">
          <p className="text-xs font-medium">Session status: {s.lifecycle.state}</p>
          <p className="text-xs text-[var(--text-dim)]">{s.lifecycle.reason}{s.lifecycle.resumeAt?` · Available after ${new Date(s.lifecycle.resumeAt).toLocaleString()}.`:''}</p>

          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <dt className="text-[var(--text-faint)]">Network</dt><dd>{String(s.network?.verdict||'Not checked')}</dd>
            <dt className="text-[var(--text-faint)]">Detector gate</dt><dd>{s.gate?.verdict||'Not checked'}</dd>
            {s.gate?.measurementVerdict&&<><dt className="text-[var(--text-faint)]">Raw checks</dt><dd>{s.gate.measurementVerdict}</dd></>}
            {s.gate&&<><dt className="text-[var(--text-faint)]">Warnings</dt><dd>{publishedWarnings.length?`${publishedWarnings.length} reported`:'Review results below'}</dd></>}
            <dt className="text-[var(--text-faint)]">Browser identity</dt><dd className="break-all">{s.drift?'Changed — review required':s.fingerprint?.hash||'Not captured'}</dd>
            {s.lifecycle.required&&<><dt className="text-[var(--text-faint)]">Warmup</dt><dd>{s.lifecycle.done||0}/{s.lifecycle.required} days</dd></>}
            {s.lifecycle.limit&&<><dt className="text-[var(--text-faint)]">Daily limit</dt><dd>{s.lifecycle.limit} / {a.dailyLimit} ceiling</dd></>}
          </dl>
          {typeof s.network?.reason==='string'&&<p className="field-hint">{s.network.reason}</p>}
          {s.commandError&&<div className="p-2.5 rounded bg-[var(--surface-2)] border border-[var(--bad)] text-xs text-[var(--bad)] font-medium flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0"/><span>Check failed: {s.commandError}</span></div>}
        </div>

        {/* verification actions */}
        <div className="space-y-2">
          <p className="text-xs font-medium">Verification</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-outline !text-xs" disabled={checkDisabled||!s.proxyId}
              onClick={()=>void onAction({action:'session-check',accountId:a.id,command:'preflight'})}>
              <Wifi className="w-3.5 h-3.5"/>Check network
            </button>
            <button type="button" className="btn btn-outline !text-xs" disabled={checkDisabled}
              onClick={()=>void onAction({action:'session-check',accountId:a.id,command:'approve-identity'})}>
              <Shield className="w-3.5 h-3.5"/>{s.drift?'Approve identity':'Capture identity'}
            </button>
            <button type="button" className="btn btn-outline !text-xs" disabled={checkDisabled||s.network?.verdict!=='PASS'||!s.fingerprint}
              onClick={()=>void onAction({action:'session-check',accountId:a.id,command:'diagnostics'})}>
              Run detectors
            </button>
          </div>
          {a.attentionReason&&<p className="field-hint"><AlertTriangle className="inline w-3 h-3 mr-1"/>Complete the LinkedIn review first.</p>}
          {s.diagnosticRequested&&<p className="field-hint">{s.diagnosticRequested} requested — agent runs this check.</p>}
          <a className="inline-block text-xs underline text-[var(--text-dim)]" href={`/api/aliasmode?evidence=${encodeURIComponent(a.id)}`} target="_blank" rel="noopener noreferrer">View saved evidence</a>
        </div>

        {/* UNKNOWN approval */}
        {s.gate?.verdict==='UNKNOWN'&&<div className="space-y-2 border border-[var(--line)] rounded-lg p-3">
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={reviewed} disabled={checkDisabled} onChange={e=>setReviewed(e.target.checked)}/>
            I reviewed this report and accept its unclear checks.
          </label>
          <button type="button" className="btn btn-outline !text-xs" disabled={checkDisabled||!reviewed||!s.gate.reportId}
            onClick={()=>void onAction({action:'approve-unclear',accountId:a.id,revision:s.revision,reportId:s.gate?.reportId})}>
            Approve unclear results
          </button>
          <p className="field-hint">Approval applies only to this report. It does not clear LinkedIn holds or start processing.</p>
        </div>}

        {/* detector evidence */}
        {s.gate&&<details>
          <summary className="cursor-pointer text-xs">Detector evidence</summary>
          <p className="field-hint mt-1">{s.gate.reason}</p>
          <ul className="space-y-2 py-2">{s.gate.sites?.map(site=><li key={site.url} className="text-xs break-words">
            <a href={site.url} target="_blank" rel="noopener noreferrer" className="underline">{new URL(site.url).hostname}</a> · Raw: {site.verdict}
            <p className="text-[var(--text-dim)]">{site.reason}</p>
            {site.admissionVerdict&&<p>Gate: {site.admissionVerdict}{site.admissionReasons?.length?` · ${site.admissionReasons.join(' ')}`:''}</p>}
            <p className="text-[var(--text-dim)]">Website: {site.website?.verdict||'Not captured'}{site.website?.value?` · ${site.website.value}`:''}</p>
            {site.website?.scope&&<p className="text-[var(--text-dim)]">{site.website.scope}</p>}
            {(site.website?.observations?.length??0)>0&&<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 pl-2">{site.website?.observations.map((o,i)=><div className="contents" key={`${o.name}-${i}`}><dt>{o.name}</dt><dd>{o.value}</dd></div>)}</dl>}
            {site.timezone&&<p className="text-[var(--text-dim)]">Timezone: {site.timezone}</p>}
          </li>)}</ul>
          <p className="field-hint">VPN warnings can reflect timezone mismatches, not actual VPN use. Incomplete tests stay UNKNOWN unless approved.</p>
          {s.gate.compatibility?.map(c=><p className="field-hint" key={c.id}>Compatibility: raw {c.rawVerdict} — {c.reason}</p>)}
          {s.gate.scope&&<p className="field-hint">{s.gate.scope}</p>}
        </details>}

        {/* stored browser identity */}
        {s.fingerprint&&<details>
          <summary className="cursor-pointer text-xs">Browser identity</summary>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] mt-1">{JSON.stringify(s.fingerprint.fields,null,2)}</pre>
          {s.drift&&<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px]">{JSON.stringify(s.drift,null,2)}</pre>}
        </details>}

        {/* proxy & engine config */}
        <form className="space-y-4" onSubmit={event=>{event.preventDefault();void onAction({action:'session-policy',accountId:a.id,revision:s.revision,engine,launchMode:mode,proxyId:proxy,proxyHost:host,proxyPort:port?Number(port):null,proxyCountry:country,proxyTimezone:zone,expectedExitIp:ip,policy});}}>
          <p className="text-xs font-medium">Proxy & engine configuration</p>
          <p className="field-hint">Configure the proxy in AliasMode first. Save its reference here for verification. No purchase is made.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1"><span className="field-label">Engine</span>
              <select className="field w-full" value={engine} disabled={busy} onChange={e=>setEngine(e.target.value as typeof engine)}>
                <option value="aliasmode-chromium">AliasMode Chromium</option><option value="cloakbrowser">CloakBrowser</option>
              </select>
            </label>
            <label className="space-y-1"><span className="field-label">Processing mode</span>
              <select className="field w-full" value={mode} disabled={busy} onChange={e=>setMode(e.target.value as typeof mode)}>
                <option value="headful">Visible · default</option><option value="headless">Headless</option>
              </select>
            </label>
            {([['Proxy reference',proxy,setProxy],['Proxy host',host,setHost],['Proxy port',port,setPort],['Country code',country,setCountry],['IANA timezone',zone,setZone],['Fixed exit IP',ip,setIp]] as const).map(([label,value,set])=>
              <label key={label} className="space-y-1"><span className="field-label">{label}</span>
                <input className="field w-full" value={value} disabled={busy} onChange={e=>(set as (v:string)=>void)(e.target.value)} required={!!proxy} maxLength={label==='Country code'?2:253}/>
              </label>)}
          </div>

          {/* advanced settings toggle */}
          <button type="button" className="flex items-center gap-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
            onClick={()=>setShowAdvanced(!showAdvanced)}>
            <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced?'rotate-180':''}`}/>
            Warmup, spacing & recovery
          </button>
          {showAdvanced&&<div className="grid gap-3 sm:grid-cols-2">{settings.map(([key,label])=>
            <label key={key} className="space-y-1"><span className="field-label">{label}</span>
              <input className="field w-full" type="number" min={key.includes('Interval')?60:key==='staggerSeconds'?0:key==='recoveryDays'?7:1} max={key.includes('Interval')?3600:key==='warmupProfilesPerDay'?20:key==='staggerSeconds'?120:key==='renderEvery'?100:90}
                value={policy[key]??''} disabled={busy} onChange={e=>setPolicy({...policy,[key]:Number(e.target.value)})}/>
            </label>
          )}</div>}

          <div className="flex gap-2">
            <button className="btn btn-primary !text-xs" type="submit" disabled={busy}>Save setup</button>
            {busy&&!disabled&&<p className="field-hint self-center">Pause and close the session first.</p>}
          </div>
        </form>
      </div>
    </div>
  </dialog>;
}
