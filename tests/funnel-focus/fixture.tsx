import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CopyStudio from '../../src/components/copy-studio/App';
import { OnboardingBriefPrep } from '../../src/components/business/OnboardingBriefPrep';
import { ClientOnboardingWizard } from '../../src/components/business/ClientOnboardingWizard';
import { PublishingSetup } from '../../src/components/business/PublishingSetup';
import { buildProject, blankOpportunity, DEFAULT_OFFER } from '../../src/lib/business';
import { newOnboardingJourney } from '../../src/lib/onboarding-journey';
import { clientFunnelFocus } from '../../src/lib/funnel-focus';
import { practice, imported } from './samples';

const query = new URLSearchParams(location.search);
const data = buildProject({ ...blankOpportunity(), name: 'Example Coach', mode: 'CASE_STUDY', funnel: 'DIRECT_TO_CALL' }, DEFAULT_OFFER).onboarding!;
data.journey = { ...newOnboardingJourney(), briefPrepared: true };
Object.assign(data.form, { offerName: 'Clear Path Coaching', offer: 'Choose your next career move and handle difficult workplace decisions as a new manager.', audience: 'New managers', customerProblem: 'Difficult workplace decisions', desiredOutcome: 'Choose a clear next step', coachBio: 'Illustrative coach background for UI testing.' });
if (!query.has('specific')) data.funnelFocus = structuredClone(practice);
if (query.has('oldcapture')) { data.journey.reference = { ...structuredClone(imported), extractionVersion: 3 }; data.form.offer = 'Coaching for growth and transitions.'; }
if (query.has('step')) { data.journey.step = Number(query.get('step')); data.journey.offerConfirmed = true; }
const key = 'funnel-focus-isolated-portal';
let initial = JSON.parse(localStorage.getItem(key) || 'null') || { ...data, funnelFocus: clientFunnelFocus(data.funnelFocus) };
let revision = 0;
(window as any).qaRevision = revision;
(window as any).qaSaves = [];
async function save(form: FormData) {
  await new Promise(resolve => setTimeout(resolve, 40));
  if (Number(form.get('revision')) !== (window as any).qaRevision) return { ok: false as const, error: 'Revision conflict' };
  for (const [key, value] of form.entries()) if (key in initial.form) initial.form[key] = value;
  initial.journey = { ...initial.journey, ...JSON.parse(String(form.get('journeyPatch') || '{}')) };
  if (form.has('bookingChoices')) initial.funnelFocus.booking = JSON.parse(String(form.get('bookingChoices')));
  if (form.has('confirmOffer')) initial.journey.offerConfirmed = true;
  if (form.has('caseStudyConsentPresent')) initial.form.caseStudyConsent = form.get('caseStudyConsent') === 'accepted';
  if (form.get('intent') === 'complete') { initial.form.status = 'COMPLETE'; initial.scope.confirmed = form.has('confirmScope'); }
  (window as any).qaSaves.push(Object.fromEntries(form));
  localStorage.setItem(key, JSON.stringify(initial));
  return { ok: true as const, revision: ++(window as any).qaRevision };
}
function Prep() {
  const [current, setCurrent] = useState(data);
  (window as any).qaPrepared = current;
  return <div className="dashboard-app" style={{ padding: 32 }}><div style={{ maxWidth: 850, margin: 'auto' }}><OnboardingBriefPrep data={current} update={setCurrent} /><PublishingSetup data={current} update={setCurrent} /></div></div>;
}
createRoot(document.getElementById('root')!).render(query.has('studio') ? <div className="dashboard-app"><CopyStudio /></div> : query.has('prep') ? <Prep /> : <ClientOnboardingWizard initial={initial} token="11111111-1111-4111-8111-111111111111" revision={revision} save={save} signing={{ canSign: true, documentSha256: '0'.repeat(64), email: 'qa@example.com' }} />);
