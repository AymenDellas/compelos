'use client';

import Image from 'next/image';
import { ArrowLeft, ArrowUpRight, CircleDot, Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Dossier, Overview, RunSummary } from '@/lib/origin/read-model';
import type { Settings } from '@/lib/origin/policy';
import './origin-workspace.css';

const tabs = ['Overview', 'Discovery', 'Opportunities', 'Rejections', 'Operations'] as const;
type Tab = typeof tabs[number];
const activeStates = ['QUEUED', 'RUNNING', 'PAUSED'];
const human = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());
const stamp = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

async function request<T>(path = '', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/origin${path}`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  } : { cache: 'no-store', signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'ORIGIN request failed.');
  return data;
}

function State({ value }: { value: string }) { return <span className="origin-state" data-value={value}>{human(value)}</span>; }
function External({ url, children }: { url: string; children: React.ReactNode }) {
  return <a href={url} target="_blank" rel="noreferrer">{children} <ArrowUpRight size={13} aria-hidden /></a>;
}

export default function OriginWorkspace() {
  const [data, setData] = useState<Overview>();
  const [tab, selectTab] = useState<Tab>('Overview');
  const [dossierId, setDossierId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const mutating = useRef(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (mutating.current) return;
    const call = ++sequence.current;
    try {
      const next = await request<Overview>('', undefined, signal);
      if (call === sequence.current && !signal?.aborted) { setData(next); setError(''); }
    } catch (err) {
      if (call === sequence.current && !signal?.aborted) setError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = setInterval(() => void refresh(controller.signal), 12_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [refresh]);

  async function mutate(body: unknown) {
    if (mutating.current) return;
    mutating.current = true;
    ++sequence.current;
    setBusy(true);
    setError('');
    try { setData(await request<Overview>('', body)); }
    catch (err) { setError((err as Error).message); }
    finally { mutating.current = false; setBusy(false); }
  }

  const active = data?.runs.find(run => activeStates.includes(run.state));
  const latest = data?.runs[0];
  return <section className="origin-workspace" aria-label="ORIGIN workstation">
    <div className="origin-toolbar">
      <nav className="origin-tabs" aria-label="ORIGIN sections">
        {tabs.map(item => <button key={item} aria-current={item === tab ? 'page' : undefined} onClick={() => { selectTab(item); setDossierId(null); }}>{item}</button>)}
      </nav>
      <div className="origin-actions">
        <span className="origin-health" data-online={Boolean(data?.online)}><CircleDot size={13} aria-hidden />{data ? data.online ? 'Worker online' : 'Worker offline' : 'Checking worker'}</span>
        <button className="origin-primary" disabled={Boolean(!data || active || busy)} onClick={() => void mutate({ action: 'start' })}><Play size={14} aria-hidden /> Start run</button>
      </div>
    </div>
    {error && <p role="alert" className="origin-error">{error} <button onClick={() => void refresh()}>Refresh</button></p>}
    {!data && !error && <p className="origin-empty" role="status">Loading investigations…</p>}
    {data && !data.acquisitionReady && !dossierId && <p className="origin-note" role="status">
      <strong>Discovery only.</strong> Qualification requires two independent publisher feeds. Check setup with <code>node origin.cjs doctor</code>.
    </p>}
    {data && dossierId && <DossierView key={dossierId} id={dossierId} close={() => setDossierId(null)} />}
    {data && !dossierId && <>
      {tab === 'Overview' && <>
        <div className="origin-metrics">
          <Metric label="Candidates in latest run" value={Object.values(latest?.counts ?? {}).reduce((sum, value) => sum + value, 0)} />
          <Metric label="Rejected" value={latest?.counts.REJECTED ?? 0} />
          <Metric label="Unresolved" value={latest?.counts.UNRESOLVED ?? 0} />
          <Metric label="Ready opportunities" value={data.opportunities.length} accent />
        </div>
        <section className="origin-section">
          <div className="origin-heading"><h2>Investigation runs</h2>{active && <RunActions run={active} busy={busy} mutate={mutate} />}</div>
          {!data.online && <p className="origin-note">Start the local agent from Engine or run <code>npm run worker</code>. Queued runs are saved in PostgreSQL.</p>}
          {data.runs.length ? <div className="origin-scroll"><table><thead><tr><th>Queued at</th><th>Status</th><th>Investigations</th><th>Completed</th><th>Finished at</th></tr></thead>
            <tbody>{data.runs.map(run => <tr key={run.id} title={run.error ?? undefined}>
              <td>{stamp(run.created_at)}</td><td><State value={run.state} /></td><td>{Object.values(run.counts).reduce((sum, count) => sum + count, 0)}</td>
              <td>{(run.counts.QUALIFIED ?? 0) + (run.counts.REJECTED ?? 0) + (run.counts.UNRESOLVED ?? 0)}</td><td>{stamp(run.finished_at)}</td>
            </tr>)}</tbody></table></div> : <p className="origin-empty">There are no investigation runs yet.</p>}
        </section>
      </>}
      {tab === 'Discovery' && <Discovery data={data} />}
      {tab === 'Opportunities' && <Opportunities data={data} open={setDossierId} />}
      {tab === 'Rejections' && <Findings data={data} open={setDossierId} />}
      {tab === 'Operations' && <div className="origin-operations">
        <SettingsForm key={JSON.stringify(data.config)} config={data.config} busy={busy} save={settings => mutate({ action: 'settings', settings })} />
        <section className="origin-section">
          <div className="origin-heading"><h2>Operations</h2>{active && <RunActions run={active} busy={busy} mutate={mutate} />}</div>
          <dl className="origin-detail"><dt>Worker heartbeat</dt><dd>{stamp(data.worker_seen_at)}</dd><dt>Scheduled run</dt><dd>{data.next_run_at ? stamp(data.next_run_at) : 'Disabled'}</dd>
            <dt>AgentRouter</dt><dd>{data.configured ? 'Configured' : 'No verified per-request cost ceiling configured'}</dd>
            <dt>Requests reserved today</dt><dd>{data.usage.calls}</dd><dt>Budget reserved today</dt><dd>{money(data.usage.reserved_cents)}</dd>
            <dt>Provider-reported cost</dt><dd>{data.usage.provider_cents == null ? 'Unavailable' : money(data.usage.provider_cents)}</dd>
            <dt>Provider-reported tokens</dt><dd>{data.usage.tokens ?? 'Unavailable'}</dd><dt>Last provider status</dt><dd>{data.usage.last_status ? human(data.usage.last_status) : 'No requests'}</dd>
            <dt>Latest run error</dt><dd>{data.runs.find(run => run.error)?.error ?? 'None recorded'}</dd></dl>
        </section>
      </div>}
    </>}
  </section>;
}

function Metric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return <div><span>{label}</span><strong data-accent={accent}>{value}</strong></div>;
}

function RunActions({ run, busy, mutate }: { run: RunSummary; busy: boolean; mutate: (body: unknown) => Promise<void> }) {
  return <div className="origin-actions"><State value={run.state} />
    <button disabled={busy} onClick={() => void mutate({ action: run.state === 'PAUSED' ? 'resume' : 'pause', id: run.id })}>{run.state === 'PAUSED' ? 'Resume' : 'Pause'}</button>
    <button disabled={busy} onClick={() => void mutate({ action: 'cancel', id: run.id })}>Cancel run</button>
  </div>;
}

function Discovery({ data }: { data: Overview }) {
  const names = [...new Set(data.sources.map(source => source.adapter))];
  const methods = [
    ['ECHO', 'Find coaches explicitly linked in configured publisher feeds.'],
    ['CONSTELLATION', 'Expand from named contributors on the same publisher record.'],
    ['IGNITION', 'Revisit businesses and compare saved offer and booking snapshots.'],
    ['VOID', 'Trace direct booking links and independently recheck reported failures.'],
    ['FRONTIER', 'Allocate discovery by corroborated identities and elapsed time, with exploration of underused sources.'],
  ];
  return <div className="origin-operations">
    <section className="origin-section"><div className="origin-heading"><h2>Discovery sources</h2></div>
      {names.length ? <div className="origin-scroll"><table><thead><tr><th>Adapter</th><th>Latest status</th><th>Records returned</th><th>Identities verified</th><th>Failures</th></tr></thead>
        <tbody>{names.map(name => {
          const history = data.sources.filter(source => source.adapter === name);
          return <tr key={name}><td>{name}</td><td><State value={history[0].status} />{history[0].code && <small>{human(history[0].code)}</small>}
            {history[0].retryAt && <small>Retry after {stamp(history[0].retryAt)}</small>}</td>
          <td>{history.reduce((sum, item) => sum + item.discovered, 0)}</td><td>{data.quality.find(item => item.adapter === name)?.identities ?? 0}</td><td>{history.filter(item => item.status === 'FAILED').length}</td></tr>;
        })}</tbody></table></div> : <p className="origin-empty">Source activity will appear after the first run. Wikidata is available by default.</p>}
    </section>
    <section className="origin-section"><div className="origin-heading"><h2>Research methods</h2></div>
      <dl className="origin-detail">{methods.map(([name, description]) => <div key={name}><dt>{name}</dt><dd>{description}</dd></div>)}</dl>
    </section>
  </div>;
}

function Opportunities({ data, open }: { data: Overview; open: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [sort, setSort] = useState('sources');
  const rows = data.opportunities.filter(item => (!country || item.country === country) &&
    `${item.name} ${item.offer}`.toLowerCase().includes(search.trim().toLowerCase()));
  if (sort === 'recent') rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return <section className="origin-section">
    <div className="origin-heading"><h2>Qualified opportunities</h2><span>{rows.length} shown</span></div>
    <div className="origin-filters">
      <label>Business or offer<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search opportunities" /></label>
      <label>Market<select value={country} onChange={event => setCountry(event.target.value)}><option value="">All markets</option><option value="US">United States</option><option value="UK">United Kingdom</option><option value="CA">Canada</option></select></label>
      <label>Sort by<select value={sort} onChange={event => setSort(event.target.value)}><option value="sources">Acquisition evidence</option><option value="recent">Latest investigation</option></select></label>
    </div>
    {rows.length ? <div className="origin-scroll"><table><thead><tr><th>Business</th><th>Market</th><th>Opportunity</th><th>Evidence valid until</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}><td><button className="origin-text-action" onClick={() => open(row.id)}>{row.name}</button><small>{row.offer}</small></td><td>{row.country}</td><td>{row.opportunity}</td><td>{stamp(row.expires_at)}</td></tr>)}</tbody></table></div>
      : <p className="origin-empty">{data.opportunities.length ? 'No opportunities match these filters.' : 'No opportunities currently pass all seven gates.'}</p>}
  </section>;
}

function Findings({ data, open }: { data: Overview; open: (id: string) => void }) {
  const [filter, setFilter] = useState('all');
  const completed = data.findings.filter(row => row.outcome || row.stage === 'FAILED');
  const rows = completed.filter(row => filter === 'all' || (row.outcome || row.stage) === filter);
  const reasons = new Map<string, number>();
  for (const row of rows) if (row.reason) reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1);
  return <section className="origin-section"><div className="origin-heading"><h2>Rejections and unresolved cases</h2><span>Recent investigations</span></div>
    <div className="origin-filters"><label>Outcome<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All outcomes</option>
      <option value="REJECTED">Rejected</option><option value="UNRESOLVED">Unresolved</option><option value="FAILED">Failed</option></select></label></div>
    {!!reasons.size && <ul className="origin-reasons">{[...reasons].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => <li key={reason}><strong>{count}</strong> {reason}</li>)}</ul>}
    {rows.length ? <div className="origin-scroll"><table><thead><tr><th>Business</th><th>Outcome</th><th>Reason</th><th>Investigated</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}><td><button className="origin-text-action" onClick={() => open(row.id)}>{row.name}</button></td>
        <td><State value={row.outcome || row.stage} /></td><td>{row.reason ?? 'See investigation evidence.'}</td><td>{stamp(row.updated_at)}</td></tr>)}</tbody></table></div>
      : <p className="origin-empty">No recent investigations match this outcome.</p>}
  </section>;
}

function DossierView({ id, close }: { id: string; close: () => void }) {
  const [entry, setEntry] = useState<Dossier>();
  const [viewedAt, setViewedAt] = useState(() => Date.now());
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => void request<Dossier>(`?id=${id}`, undefined, controller.signal).then(record => {
      if (controller.signal.aborted) return;
      setEntry(record);
      setViewedAt(Date.now());
      setError('');
    }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    refresh();
    const interval = setInterval(refresh, 12_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [id]);
  const checkpoint = entry?.checkpoint;
  const fresh = entry?.decision?.expiresAt && Date.parse(entry.decision.expiresAt) > viewedAt;
  return <article className="origin-dossier">
    <button className="origin-text-action" onClick={close}><ArrowLeft size={15} aria-hidden /> Back to results</button>
    {error && <p className="origin-error" role="alert">{error}</p>}
    {!entry && !error && <p className="origin-empty" role="status">Loading evidence…</p>}
    {entry && checkpoint && <>
      <div className="origin-dossier-header"><div><h2>{entry.name}</h2><External url={entry.website}>{new URL(entry.website).hostname}</External></div>
        <State value={entry.suppressed ? 'SUPPRESSED' : entry.decision?.outcome === 'QUALIFIED' && !fresh ? 'STALE' : entry.decision?.outcome ?? entry.stage} /></div>
      <dl className="origin-detail"><dt>Offer</dt><dd>{checkpoint.offer ?? 'Unverified'}</dd><dt>Market</dt><dd>{checkpoint.country ?? 'Unverified'}</dd>
        <dt>Business contact</dt><dd>{entry.suppressed ? 'Suppressed in Compel OS' : checkpoint.contact ?? 'Unverified'}</dd><dt>Last investigated</dt><dd>{stamp(entry.updated_at)}</dd>
        <dt>Qualification policy</dt><dd>{entry.decision?.version ?? 'No decision yet'}</dd></dl>
      <section className="origin-section"><div className="origin-heading"><h3>Qualification evidence</h3></div>
        {(entry.decision?.gates ?? checkpoint.gates).map(gate => <div className="origin-gate" key={gate.name}>
          <div><strong>{human(gate.name)}</strong><State value={gate.state} /></div><p>{gate.assertion}</p>
          {gate.evidence.map((evidence, index) => <a key={evidence} href={`#evidence-${evidence}`}>Evidence {index + 1}</a>)}
        </div>)}
      </section>
      {!!checkpoint.journey.length && <section className="origin-section"><div className="origin-heading"><h3>Public journey</h3></div>
        <ol className="origin-journey">{checkpoint.journey.map(step => <li key={step.evidence}><External url={step.url}>{step.label}</External><State value={step.result} /></li>)}</ol>
      </section>}
      {!!entry.artifacts.length && <section className="origin-section"><div className="origin-heading"><h3>Browser captures</h3></div>
        <div className="origin-captures">{entry.artifacts.map(item => <figure key={item.id}>
          {item.available ? <a href={`/api/origin?id=${id}&artifact=${item.id}`} target="_blank" rel="noreferrer">
            <Image unoptimized src={`/api/origin?id=${id}&artifact=${item.id}`} width={550} height={325} alt={`${human(item.device)} view of the public offer`} />
          </a> : <p>Image retention expired.</p>}<figcaption>{human(item.device)} · <External url={item.url}>Source</External></figcaption>
        </figure>)}</div></section>}
      <section className="origin-section"><div className="origin-heading"><h3>Evidence ledger</h3></div>
        {checkpoint.evidence.map(item => <div className="origin-entry" id={`evidence-${item.id}`} key={item.id}>
          <div><strong>{item.method}</strong><span>{stamp(item.observedAt)}</span></div><p>{item.excerpt}</p><External url={item.url}>{new URL(item.url).hostname}</External>
          <details><summary>Evidence identifier</summary><code>{item.id}</code><code>SHA-256 {item.digest}</code></details>
        </div>)}
      </section>
    </>}
  </article>;
}

function SettingsForm({ config, busy, save }: { config: Settings; busy: boolean; save: (value: Settings) => Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const interval = Number(fields.get('intervalMinutes'));
    void save({ intervalMinutes: interval || null, browser: fields.has('browser'), candidateLimit: Number(fields.get('candidateLimit')),
      runMinutes: Number(fields.get('runMinutes')), activityDays: Number(fields.get('activityDays')), modelCalls: Number(fields.get('modelCalls')),
      runBudgetCents: Math.round(Number(fields.get('runBudgetCents')) * 100), dailyBudgetCents: Math.round(Number(fields.get('dailyBudgetCents')) * 100),
      monthlyBudgetCents: Math.round(Number(fields.get('monthlyBudgetCents')) * 100) });
  };
  return <form className="origin-section" onSubmit={submit}><div className="origin-heading"><h2>Research settings</h2></div>
    <div className="origin-fields">
      <label>Schedule interval (minutes)<input name="intervalMinutes" type="number" min="60" max="43200" placeholder="Off" defaultValue={config.intervalMinutes ?? ''} /></label>
      <label>Candidates per run<input required name="candidateLimit" type="number" min="1" max="24" defaultValue={config.candidateLimit} /></label>
      <label>Time budget (minutes)<input required name="runMinutes" type="number" min="2" max="30" defaultValue={config.runMinutes} /></label>
      <label>Acquisition lookback (days)<input required name="activityDays" type="number" min="30" max="180" defaultValue={config.activityDays} /></label>
      <label>Model requests per run<input required name="modelCalls" type="number" min="0" max="5" defaultValue={config.modelCalls} /></label>
      <label>Per-run budget (USD)<input required name="runBudgetCents" type="number" min="0" max="100" step="0.01" defaultValue={config.runBudgetCents / 100} /></label>
      <label>Daily budget (USD)<input required name="dailyBudgetCents" type="number" min="0" max="500" step="0.01" defaultValue={config.dailyBudgetCents / 100} /></label>
      <label>Monthly budget (USD)<input required name="monthlyBudgetCents" type="number" min="0" max="2500" step="0.01" defaultValue={config.monthlyBudgetCents / 100} /></label>
      <label className="origin-checkbox"><input name="browser" type="checkbox" defaultChecked={config.browser} /> Capture desktop and mobile views</label>
    </div>
    <div className="origin-form-footer"><span>Applies to new runs.</span><button className="origin-primary" disabled={busy}>Save settings</button></div>
  </form>;
}
