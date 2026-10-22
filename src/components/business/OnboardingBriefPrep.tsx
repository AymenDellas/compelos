'use client';
import { FunnelFocusControls } from './FunnelFocusControls';
import { isPracticeWide, newFunnelFocus, type FunnelFocus } from '@/lib/funnel-focus';
import { useState } from 'react';
import { ImportDialog } from '../copy-studio/ImportDialog';
import { loadProjects } from '../copy-studio/storage';
import { briefSchema, EXTRACTION_VERSION, type BriefKey, type ImportResult, type Project } from '@/lib/copy-studio/shared/contracts';
import { clientBriefReady, journeyFor } from '@/lib/onboarding-journey';
import type { OnboardingData } from '@/lib/business';
import '../copy-studio/copy-studio.css';
import './onboarding-journey.css';

const mapping = { offerName: 'offerName', description: 'offer', audience: 'audience', problem: 'customerProblem', outcome: 'desiredOutcome', mechanism: 'differentiation', coachBio: 'coachBio', proof: 'proof' } as const;
export function OnboardingBriefPrep({ data, update }: { data: OnboardingData; update: (fn: (d: OnboardingData) => OnboardingData) => void }) {
    const [importing, setImporting] = useState(false);
    const [projects, setProjects] = useState<Project[]>([]);
    const [selected, setSelected] = useState('');
    const [notice, setNotice] = useState('');
    const journey = journeyFor(data);
    const current = briefSchema.parse(Object.fromEntries(Object.entries(mapping).map(([brief, form]) => [brief, data.form[form] || ''])));
    function apply(fields: Partial<typeof current>, keys: BriefKey[], reference: ImportResult | null, label: string, focus?: FunnelFocus, replacePractice = false) {
        update(old => {
            const form = { ...old.form, ...(isPracticeWide(focus) && replacePractice ? Object.fromEntries(Object.values(mapping).map(k => [k, ''])) : {}), status: old.form.status === 'COMPLETE' ? 'IN_PROGRESS' as const : old.form.status };
            for (const [brief, key] of Object.entries(mapping)) if (keys.includes(brief as BriefKey) && fields[brief as BriefKey] !== undefined) form[key as keyof typeof mapping & keyof typeof form] = fields[brief as BriefKey]!;
            return { ...old, ...(focus ? { funnelFocus: focus } : {}), form, journey: { ...journeyFor(old), briefPrepared: true, preparedAt: new Date().toISOString(), offerConfirmed: false, offerConfirmedAt: '', flowVersion: 3, reviewSummaries: {}, step: 0, reference, sourceLabel: label } };
        });
        setNotice('Brief prefilled, including available client details, story and full proof. Save onboarding or open the portal to save and review the actual client flow.');
    }
    return <div className="onboarding-prep">
        <div><h3 className="font-medium">Prepare the client’s offer summary</h3><p className="text-sm text-[var(--text-dim)] mt-2">Read their page or reuse a Copy Studio brief. Choose a funnel focus, review the facts, then send a prefilled onboarding.</p></div>
        <div className="flex flex-wrap gap-2"><button className="btn btn-outline" onClick={() => setImporting(true)}>Read the current website</button><button className="btn btn-outline" onClick={() => { const loaded = loadProjects(); setProjects(loaded.projects.filter(p => Object.keys(mapping).some(k => p.brief[k as BriefKey]?.trim()))); setNotice(loaded.error || 'Choose a saved Copy Studio project. Its answers will replace the matching fields when you apply it.'); }}>Choose a Copy Studio brief</button></div>
        {projects.length > 0 && <div className="flex flex-wrap gap-2"><select aria-label="Copy Studio brief to use" className="field flex-1" value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose a project</option>{projects.map(p => <option value={p.id} key={p.id}>{p.name} · {p.brief.offerName || 'Offer not named'}</option>)}</select><button className="btn btn-outline" disabled={!selected} onClick={() => { const p = projects.find(p => p.id === selected); if (p) apply(p.brief, Object.keys(mapping).filter(k => Boolean(p.brief[k as BriefKey])) as BriefKey[], p.source, p.name, p.funnelFocus); }}>Use selected brief</button></div>}
        <FunnelFocusControls value={data.funnelFocus} analysis={journey.reference?.focusAnalysis} onChange={focus => update(old => ({ ...old, funnelFocus: focus, journey: { ...journeyFor(old), briefPrepared: false, offerConfirmed: false, offerConfirmedAt: '' } }))}
          onApprove={() => update(old => ({ ...old, funnelFocus: { ...(old.funnelFocus || newFunnelFocus('specific_offer', journey.reference?.focusAnalysis)), approvedAt: new Date().toISOString() } }))} />
        {isPracticeWide(data.funnelFocus) && journey.reference?.focusAnalysis && <button className="btn btn-outline" onClick={() => {
            if (journey.reference?.extractionVersion !== EXTRACTION_VERSION) { setImporting(true); return; }
            const positioning = journey.reference!.focusAnalysis!.positioning;
            apply(positioning.fields, Object.keys(positioning.fields) as BriefKey[], journey.reference!, journey.sourceLabel, { ...data.funnelFocus!, approvedAt: new Date().toISOString() }, true);
        }}>{journey.reference.extractionVersion === EXTRACTION_VERSION ? 'Use proposed practice positioning' : 'Refresh proposed practice focus'}</button>}
        {notice && <p className="text-sm text-[var(--text-dim)]" role="status">{notice}</p>}
        {journey.sourceLabel && <p className="text-xs text-[var(--text-faint)]">Prepared from: {journey.sourceLabel}</p>}
        <div className="flex items-center flex-wrap gap-3"><span className={`mark ${clientBriefReady(data) ? 'mark-ok' : 'mark-warn'}`}>{clientBriefReady(data) ? 'Summary ready for the client' : 'Review required before sharing'}</span><button className="btn btn-primary" disabled={data.form.offerName.trim().length < 3 || Boolean(data.funnelFocus && !data.funnelFocus.approvedAt)} onClick={() => { update(old => ({ ...old, journey: { ...journeyFor(old), briefPrepared: true, preparedAt: new Date().toISOString() } })); setNotice('Summary approved. Save onboarding to make this version available in the client portal.'); }}>Approve prefilled summary</button></div>
        <p className="text-xs text-[var(--text-faint)]">Name the offer or existing practice and review the known facts before sharing. Any missing facts stay as questions for the client; all five must be completed before they can confirm their offer.</p>
        {journey.offerConfirmed && <p className="text-sm text-[var(--success)]">The client has confirmed this offer.</p>}
        {importing && <div className="copy-studio"><ImportDialog current={current} initial={journey.reference} funnelFocus={data.funnelFocus} initialUrl={data.form.landingPageUrl || data.website} onClose={() => setImporting(false)} onApply={(source, keys, separate) => { apply(source.extraction.fields, keys, source, source.selectedOffer || source.source.title || source.source.url || 'Pasted page', source.funnelFocus, separate); setImporting(false); }} /></div>}
    </div>;
}
