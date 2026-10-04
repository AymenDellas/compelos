import { createHash } from 'node:crypto';
import { notFound } from 'next/navigation';
import { Check, CircleAlert, FileText, KeyRound, LayoutList, UserRound } from 'lucide-react';
import {
    confirmClientScopeAction,
    markPortalAccessReceivedAction,
    saveClientPortalFormAction,
} from '@/app/actions/portal-actions';
import { pool } from '@/lib/pg_setup';
import { agreementPdf } from '@/lib/agreement-pdf';
import { AgreementSigningForm } from './AgreementSigningForm';
import { AgreementPdfViewer } from './AgreementPdfViewer';
import {
    CASE_STUDY_CONSENT_TEXT,
    normalizeOnboarding,
    onboardingBlockers,
    onboardingFormComplete,
    onboardingProgress,
    type OfferProfile,
    type OpportunityData,
    type ProjectData,
} from '@/lib/business';

export const dynamic = 'force-dynamic';

export default async function ClientPortalPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) notFound();
    const result = await pool.query(
        `SELECT p.data AS project, o.data AS opportunity, v.profile
         FROM business_projects p
         JOIN business_opportunities o ON o.id=p.opportunity_id
         JOIN business_offer_versions v ON v.version=p.offer_version
         WHERE p.data->'onboarding'->>'portalToken'=$1
         LIMIT 1`,
        [token],
    );
    if (!result.rows[0]) notFound();
    const project = result.rows[0].project as ProjectData;
    const data = normalizeOnboarding(
        project,
        result.rows[0].opportunity as OpportunityData,
        result.rows[0].profile as OfferProfile,
    );
    const blockers = onboardingBlockers(data);
    const progress = onboardingProgress(data);
    const clientSigned = Boolean(data.agreement.clientSignature);
    const agreementReady = Boolean(data.agreement.scope.trim() && data.agreement.deliverables.trim()) &&
        (data.projectType === 'CASE_STUDY' || data.payment.price !== null);
    const canSign = agreementReady && !clientSigned && !data.agreement.signedPdfData &&
        ['DRAFT', 'SENT', 'VIEWED'].includes(data.agreement.status);
    const documentSha256 = canSign
        ? createHash('sha256').update(Buffer.from(await agreementPdf(data).arrayBuffer())).digest('hex')
        : '';
    const requiredAccess = data.access.filter((item) => item.required && !item.nonBlocking);
    const tasks = [
        {
            label: 'Agreement',
            detail: data.agreement.status === 'FULLY_SIGNED' ? 'Fully signed' : clientSigned ? 'Your signature received' : 'Signature required',
            done: data.agreement.status === 'FULLY_SIGNED' || data.overrides.includes('agreement'),
            icon: FileText,
        },
        ...(data.projectType === 'PAID'
            ? [
                  {
                      label: 'Payment',
                      detail: data.payment.status.replaceAll('_', ' ').toLowerCase(),
                      done:
                          data.payment.status === 'FULLY_PAID' ||
                          (data.payment.structure !== 'FULL' && data.payment.status === 'DEPOSIT_PAID') ||
                          data.overrides.includes('payment'),
                      icon: FileText,
                  },
              ]
            : []),
        {
            label: 'Onboarding form',
            detail: data.form.status === 'COMPLETE' && !onboardingFormComplete(data)
                ? 'Needs required details'
                : data.form.status.replaceAll('_', ' ').toLowerCase(),
            done: onboardingFormComplete(data) || data.overrides.includes('form'),
            icon: LayoutList,
        },
        {
            label: 'Access requests',
            detail: `${requiredAccess.filter((item) => ['VERIFIED', 'NOT_NEEDED'].includes(item.status)).length} of ${requiredAccess.length} cleared`,
            done: !blockers.some((item) => item.key === 'access'),
            icon: KeyRound,
        },
        {
            label: 'Assets',
            detail: data.form.assets ? 'Received' : 'Optional',
            done: Boolean(data.form.assets),
            icon: FileText,
        },
        {
            label: 'Scope confirmation',
            detail: data.scope.confirmed ? 'Confirmed' : 'Review required',
            done: data.scope.confirmed || data.overrides.includes('scope'),
            icon: Check,
        },
    ];
    return (
        <main className="min-h-screen bg-[var(--surface-0)]">
            <header className="topbar h-[60px] px-5 flex items-center">
                <span className="w-8 h-8 rounded-lg bg-[var(--signal)] text-white flex items-center justify-center font-bold mr-2.5" aria-hidden>C</span>
                <span className="font-semibold">Compel</span>
                <span className="ml-auto text-xs text-[var(--text-faint)]">Client onboarding</span>
            </header>
            <div className="max-w-3xl mx-auto p-5 md:p-10 space-y-6">
                <section>
                    <p className="label-micro">{data.businessName || data.clientName}</p>
                    <h1 className="text-2xl font-semibold mt-2">Welcome, {data.clientName.split(' ')[0]}</h1>
                    <p className="text-[var(--text-dim)] mt-2">Everything needed to prepare {data.projectName}, in one place.</p>
                </section>
                <section className="panel p-5">
                    <div className="flex items-end justify-between gap-4 mb-3">
                        <div><p className="label-micro">Onboarding progress</p><p className="text-2xl num font-semibold mt-1">{progress}%</p></div>
                        <p className="text-sm text-[var(--text-dim)]">{blockers.length ? `${blockers.length} item${blockers.length === 1 ? '' : 's'} remaining` : 'Ready to build'}</p>
                    </div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${progress}%` }} /></div>
                </section>
                <section className={`panel p-5 ${blockers.length ? 'border-[rgba(232,177,76,.25)]' : 'border-[var(--signal-line)]'}`}>
                    <div className="flex gap-3">
                        {blockers.length ? <CircleAlert className="w-5 h-5 text-[var(--warn)] flex-none" /> : <Check className="w-5 h-5 text-[var(--signal)] flex-none" />}
                        <div>
                            <h2 className="font-medium">{blockers.length ? "Here's what we still need from you before the project can start." : 'You are all set. This project is ready to start.'}</h2>
                            {blockers.length > 0 && <ul className="mt-4 space-y-2">{blockers.map((item) => <li key={item.key}><p className="text-sm">{item.label}</p><p className="text-xs text-[var(--text-faint)]">{item.detail}</p></li>)}</ul>}
                        </div>
                    </div>
                </section>
                <section className="space-y-2">
                    {tasks.map((task) => <div key={task.label} className="panel px-4 py-4 flex items-center gap-3"><span className={`w-8 h-8 rounded-md flex items-center justify-center border ${task.done ? 'text-[var(--signal)] border-[var(--signal-line)] bg-[var(--signal-dim)]' : 'text-[var(--text-faint)] border-[var(--line-strong)]'}`}>{task.done ? <Check className="w-4 h-4" /> : <task.icon className="w-4 h-4" />}</span><span className="font-medium flex-1">{task.label}</span><span className="text-sm text-[var(--text-dim)] capitalize text-right">{task.detail}</span></div>)}
                </section>
                <section className="panel">
                    <div className="panel-head">Agreement</div>
                    <div className="panel-body space-y-5">
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex-1 min-w-48">
                                <p className="text-sm">{data.projectType === 'CASE_STUDY' ? 'Free case-study agreement' : 'Paid-client agreement'}</p>
                                <p className="text-xs text-[var(--text-faint)] mt-1">{data.agreement.status === 'FULLY_SIGNED' ? 'Fully signed' : clientSigned ? 'You signed · Compel signature pending' : 'Please review and sign below'}</p>
                            </div>
                            <a className="btn btn-outline" href={`/portal/${token}/agreement`} target="_blank" rel="noreferrer">Open PDF in new tab</a>
                        </div>
                        <AgreementPdfViewer url={`/portal/${token}/agreement?v=${encodeURIComponent(data.agreement.clientSignature?.signedAt || data.agreement.signedPdfName || data.agreement.status)}`} />
                        {clientSigned ? (
                            <p className="text-sm text-[var(--text-dim)]">
                                Signed by {data.agreement.clientSignature!.name} on {new Date(data.agreement.clientSignature!.signedAt).toLocaleDateString('en-US')}.
                                {' '}Your saved PDF is available above. Compel can see the signed copy in the project dashboard.
                            </p>
                        ) : canSign ? (
                            <AgreementSigningForm token={token} clientName={data.clientName} email={data.email} documentSha256={documentSha256} />
                        ) : !data.agreement.signedPdfData && data.agreement.status !== 'FULLY_SIGNED' ? (
                            <p className="text-sm text-[var(--warn)]">Compel is finalizing this agreement. Please return when the scope, deliverables, and fee are ready.</p>
                        ) : null}
                    </div>
                </section>
                {data.projectType === 'PAID' && (
                    <section className="panel">
                        <div className="panel-head">Payment</div>
                        <div className="panel-body flex flex-wrap items-center gap-3">
                            <div className="flex-1 min-w-48">
                                <p className="text-sm">{data.payment.currency} {data.payment.price ?? 'Price to be confirmed'} · {data.payment.structure.replaceAll('_', ' ').toLowerCase()}</p>
                                <p className="text-xs text-[var(--text-faint)] mt-1">Status: {data.payment.status.replaceAll('_', ' ').toLowerCase()}</p>
                            </div>
                            {data.payment.link && <a className="btn btn-primary" href={data.payment.link} target="_blank" rel="noreferrer">Open secure payment link</a>}
                        </div>
                    </section>
                )}
                <section className="panel">
                    <div className="panel-head">Onboarding form <span className="hint">Save and return at any time</span></div>
                    <form action={saveClientPortalFormAction} className="panel-body space-y-6">
                        <input type="hidden" name="token" value={token} />
                        <PortalGroup title="Offer and business">
                            <PortalField name="offer" label="Offer being promoted" value={data.form.offer} required />
                            <PortalField name="audience" label="Target audience" value={data.form.audience} required />
                            <PortalField name="trafficSources" label="Current traffic sources" value={data.form.trafficSources} />
                            <PortalField name="customerProblem" label="Main customer problem" value={data.form.customerProblem} multiline required />
                            <PortalField name="desiredOutcome" label="Desired outcome" value={data.form.desiredOutcome} multiline required />
                        </PortalGroup>
                        <PortalGroup title="Current funnel">
                            <PortalField name="landingPageUrl" label="Landing page URL" value={data.form.landingPageUrl} />
                            <PortalField name="bookingUrl" label="Booking URL" value={data.form.bookingUrl} />
                            <PortalField name="qualification" label="Current qualification" value={data.form.qualification} />
                            <PortalField name="nurture" label="Current nurture / follow-up" value={data.form.nurture} />
                            <PortalField name="traffic" label="Approximate traffic" value={data.form.traffic} />
                            <PortalField name="bookings" label="Approximate bookings" value={data.form.bookings} />
                            <PortalField name="showRate" label="Approximate show rate" value={data.form.showRate} />
                            <PortalField name="closeRate" label="Approximate clients / close rate" value={data.form.closeRate} />
                        </PortalGroup>
                        <PortalGroup title="Tools in use">
                            <PortalField name="bookingPlatform" label="Booking platform" value={data.form.bookingPlatform} />
                            <PortalField name="crm" label="CRM" value={data.form.crm} />
                            <PortalField name="emailPlatform" label="Email platform" value={data.form.emailPlatform} />
                            <PortalField name="analyticsPlatform" label="Analytics platform" value={data.form.analyticsPlatform} />
                            <PortalField name="hostingPlatform" label="Hosting platform" value={data.form.hostingPlatform} />
                            <PortalField name="domainProvider" label="Domain provider" value={data.form.domainProvider} />
                            <PortalField name="websitePlatform" label="Website platform" value={data.form.websitePlatform} />
                            <PortalField name="repositoryProvider" label="Repository provider" value={data.form.repositoryProvider} />
                        </PortalGroup>
                        <PortalGroup title="Assets and preferences">
                            <PortalField name="assets" label="Links to logos, photos, testimonials, case studies, certifications, and copy" value={data.form.assets} multiline />
                            <PortalField name="mustStay" label="Anything that must stay" value={data.form.mustStay} multiline />
                            <PortalField name="avoid" label="Anything you do not want changed" value={data.form.avoid} multiline />
                            <PortalField name="importantContext" label="Anything important that is not obvious" value={data.form.importantContext} multiline />
                        </PortalGroup>
                        {data.projectType === 'CASE_STUDY' && <fieldset className="rounded-md border border-[var(--line-strong)] p-4 space-y-3">
                            <legend className="text-sm font-medium px-1">Case-study permission <span className="text-[var(--bad)]">*</span></legend>
                            <label className="flex items-start gap-3 text-sm text-[var(--text-dim)]">
                                <input className="mt-1" type="checkbox" name="caseStudyConsent" value="accepted" defaultChecked={data.form.caseStudyConsent} required />
                                <span>{CASE_STUDY_CONSENT_TEXT}</span>
                            </label>
                        </fieldset>}
                        <div className="flex flex-wrap justify-end gap-2">
                            <button className="btn btn-outline" type="submit" name="intent" value="save" formNoValidate>Save progress</button>
                            <button className="btn btn-primary" type="submit" name="intent" value="complete">Submit onboarding form</button>
                        </div>
                    </form>
                </section>
                {data.access.some((item) => item.status !== 'VERIFIED' && item.status !== 'NOT_NEEDED') && (
                    <section className="panel">
                        <div className="panel-head">Access instructions</div>
                        <div className="panel-body divide-y divide-[var(--line)]">
                            {data.access.filter((item) => item.status !== 'VERIFIED' && item.status !== 'NOT_NEEDED').map((item) => (
                                <div key={item.id} className="py-4 first:pt-0 last:pb-0">
                                    <div className="flex items-center gap-2"><UserRound className="w-4 h-4 text-[var(--text-faint)]" /><p className="font-medium">{item.platform}</p><span className="ml-auto text-xs text-[var(--text-faint)] capitalize">{item.status.replaceAll('_', ' ').toLowerCase()}</span></div>
                                    <p className="text-sm text-[var(--text-dim)] mt-2">{item.reason}</p>
                                    <p className="text-sm mt-2">{item.instructions}</p>
                                    <div className="flex flex-wrap items-center gap-3 mt-3">
                                        <p className="text-xs text-[var(--text-faint)] flex-1">Requested permission: {item.permission}</p>
                                        {item.status !== 'RECEIVED' && <form action={markPortalAccessReceivedAction}><input type="hidden" name="token" value={token} /><input type="hidden" name="itemId" value={item.id} /><button className="btn btn-outline" type="submit">I granted this access</button></form>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
                <section className="panel">
                    <div className="panel-head">Scope confirmation</div>
                    <div className="panel-body space-y-4">
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div><p className="field-label">Included</p><p className="text-sm text-[var(--text-dim)] whitespace-pre-wrap">{data.scope.included || 'To be confirmed'}</p></div>
                            <div><p className="field-label">Not included</p><p className="text-sm text-[var(--text-dim)] whitespace-pre-wrap">{data.scope.excluded || 'Nothing recorded'}</p></div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div><p className="field-label">Target launch</p><p className="text-sm">{data.scope.targetLaunchDate || 'Not set'}</p></div>
                            <div><p className="field-label">Approval owner</p><p className="text-sm">{data.scope.approvalOwner || 'Not set'}</p></div>
                        </div>
                        <div><p className="field-label">Revision process</p><p className="text-sm text-[var(--text-dim)]">{data.scope.revisionProcess}</p></div>
                        <div><p className="field-label">Dependencies</p><p className="text-sm text-[var(--text-dim)]">{data.scope.dependencies}</p></div>
                        {data.scope.confirmed ? <p className="mark mark-ok">Scope confirmed</p> : <form action={confirmClientScopeAction}><input type="hidden" name="token" value={token} /><button className="btn btn-primary" type="submit">Confirm this scope</button></form>}
                    </div>
                </section>
                <p className="text-xs text-center text-[var(--text-faint)]">Need help with an item? Reply to your Compel project contact. Never send passwords by email.</p>
            </div>
        </main>
    );
}

function PortalGroup({ title, children }: { title: string; children: React.ReactNode }) {
    return <fieldset><legend className="label-micro border-b border-[var(--line)] pb-2 mb-4 w-full">{title}</legend><div className="grid sm:grid-cols-2 gap-4">{children}</div></fieldset>;
}

function PortalField({ name, label, value, multiline = false, required = false }: { name: string; label: string; value: string; multiline?: boolean; required?: boolean }) {
    return <label className="space-y-1.5 min-w-0"><span className="flex items-baseline justify-between gap-2 text-sm text-[var(--text-dim)]"><span>{label}{required ? ' *' : ''}</span>{!required && <span className="text-xs text-[var(--text-faint)]">Optional</span>}</span>{multiline ? <textarea className="field w-full min-h-24" name={name} defaultValue={value || ''} required={required} /> : <input className="field w-full" name={name} defaultValue={value || ''} required={required} />}</label>;
}
