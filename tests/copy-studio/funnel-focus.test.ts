import test from 'node:test';
import assert from 'node:assert/strict';
import { newFunnelFocus, applyClientBooking, clientFunnelFocus, practiceBookingReady, funnelFocusSchema, type FunnelFocus } from '../../src/lib/funnel-focus';
import { briefSchema, generationSchema, generationPayload, fingerprint, librarySchema, type Project } from '../../src/lib/copy-studio/shared/contracts';
import { extract, generate, revise } from './reviewed-engine';
import { input, draft, strategy } from './fixtures';
import { buildDesignPrompt } from '../../src/lib/copy-studio/shared/design-prompt';
import { auditDraft } from '../../src/lib/copy-studio/shared/quality';
import { changeOfferContext } from '../../src/lib/copy-studio/shared/workspace';
import { blankOpportunity, buildProject, DEFAULT_OFFER, normalizeOnboarding } from '../../src/lib/business';
import { newOnboardingJourney, clientBriefReady, clientJourneyStep } from '../../src/lib/onboarding-journey';
import { toOnboardingBrief, onboardingBriefSchema } from '../../src/lib/copy-studio/shared/onboarding';

const source = { title: 'Clear Path Coaching', url: 'https://example.com/', headings: [], text: `SOURCE PAGE: https://example.com/\nTITLE: Clear Path Coaching\nClear Path Coaching helps new managers facing difficult workplace decisions. Our career and leadership coaching helps new managers choose a clear next step. Discovery conversations explore your situation and whether coaching fits.\n\nSOURCE PAGE: https://example.com/career\nCareer Coaching: private coaching for new managers facing career decisions.\n\nSOURCE PAGE: https://example.com/leadership\nLeadership Coaching: private coaching for new managers making workplace decisions.` };
const essentials = { offerName: 'Clear Path Coaching', description: 'Career and leadership coaching for new managers.', audience: 'New managers', problem: 'Difficult workplace decisions', outcome: 'Choose a clear next step' };
const services = [
  { id: 'service-1', name: 'Career Coaching', description: 'Private coaching for career decisions.', evidence: [{ quote: 'Career Coaching: private coaching for new managers facing career decisions.', url: 'https://example.com/career' }], included: true },
  { id: 'service-2', name: 'Leadership Coaching', description: 'Private coaching for workplace decisions.', evidence: [{ quote: 'Leadership Coaching: private coaching for new managers making workplace decisions.', url: 'https://example.com/leadership' }], included: true },
];
const practice: FunnelFocus = { ...newFunnelFocus('practice_wide'), approvedAt: '2026-10-22T10:00:00Z', services,
  booking: { enabled: true, confirmed: true, choices: services.map(s => ({ id: `b-${s.id}`, label: s.name, serviceId: s.id })) } };
function extractionResponse(prompt: string, related = true) {
  const data = JSON.parse(prompt.split('SOURCE DATA: ')[1]);
  const passage = (term: string) => data.passages.find((p: {text: string}) => p.text.includes(term)).id;
  return { offers: [
    { name: 'Career Coaching', summary: services[0].description, passageId: passage('Career Coaching:') },
    { name: 'Leadership Coaching', summary: services[1].description, passageId: passage('Leadership Coaching:') },
  ], fields: {}, evidence: [], selectedTestimonialIds: [], warnings: [], focusAnalysis: {
    recommendation: { mode: related ? 'practice_wide' : 'specific_offer', rationale: related ? 'Both services address workplace decisions for new managers.' : 'The audiences and problems differ. Focus on a single service.', confidence: 'high', uncertainties: [] },
    rationalePassageIds: [passage('Clear Path Coaching helps')],
    positioning: { fields: related ? essentials : {}, evidence: related ? Object.keys(essentials).map(field => ({ field, passageId: passage('Clear Path Coaching helps') })) : [], testimonialIds: [] },
  } };
}

test('related multi-service extraction requests an outcome-led focus without selecting it or mixing single-offer facts', async () => {
  const result = await extract(async (_system, prompt) => {
    assert.match(prompt, /OUTCOME-LED PRACTICE FOCUS/);
    assert.match(prompt, /a generic tagline alone is insufficient support/);
    return JSON.stringify(extractionResponse(prompt));
  }, source, new AbortController().signal);
  assert.equal(result.focusAnalysis?.recommendation.mode, 'practice_wide');
  assert.equal(result.focusAnalysis?.services.length, 2);
  assert.equal(result.focusAnalysis?.services[1].evidence[0].url, 'https://example.com/leadership');
  assert.deepEqual(result.extraction.fields, {});
  assert.equal(result.funnelFocus, undefined, 'The model cannot approve the operator decision');
  assert.equal(result.focusAnalysis?.positioning.fields.offerName, 'Clear Path Coaching');
  assert.equal(result.source.text, source.text);
});
test('unrelated services and uncertain output are never automatically combined', async () => {
  const unrelated = { ...source, text: source.text.replaceAll('Leadership Coaching', 'Nutrition Coaching').replace('private coaching for new managers making workplace decisions.', 'meal planning for athletes.') };
  const result = await extract(async (_system, prompt) => {
    const response = extractionResponse(prompt.replaceAll('Nutrition Coaching', 'Leadership Coaching'), false);
    response.offers[1].name = 'Nutrition Coaching';
    return JSON.stringify(response);
  }, unrelated, new AbortController().signal);
  assert.equal(result.focusAnalysis?.recommendation.mode, 'specific_offer');
  assert.deepEqual(result.focusAnalysis?.positioning.fields, {});
  const uncertain = await extract(async (_s, prompt) => {
    const value = extractionResponse(prompt); value.focusAnalysis.rationalePassageIds = ['invented'];
    return JSON.stringify(value);
  }, source, new AbortController().signal);
  assert.equal(uncertain.focusAnalysis?.recommendation.mode, null);
  assert.equal(uncertain.focusAnalysis?.recommendation.confidence, 'low');
});
test('practice prefill rejects invented umbrella names and unverified field evidence', async () => {
  const result = await extract(async (_s, prompt) => {
    const value = extractionResponse(prompt); value.focusAnalysis.positioning.fields.offerName = 'The Total Transformation Bundle';
    value.focusAnalysis.positioning.evidence = value.focusAnalysis.positioning.evidence.map(e => e.field === 'outcome' ? { ...e, passageId: 'invented' } : e);
    return JSON.stringify(value);
  }, source, new AbortController().signal);
  assert.equal(result.focusAnalysis?.positioning.fields.offerName, undefined);
  assert.equal(result.focusAnalysis?.positioning.fields.outcome, undefined);
  assert.equal(result.focusAnalysis?.recommendation.mode, null);
});
test('operator override is durable and independent of current/focused/new contexts', () => {
  const overridden = { ...practice, mode: 'specific_offer' as const, recommendation: { mode: 'practice_wide' as const, rationale: 'Related services.', confidence: 'high' as const, uncertainties: [] } };
  const p = project(overridden);
  const restored = librarySchema.parse({ version: 2, projects: [p] }).projects[0];
  assert.equal(restored.funnelFocus?.mode, 'specific_offer');
  const changed = changeOfferContext(restored, { mode: 'focused', direction: '', background: '', mustKeep: '', avoid: '' });
  assert.deepEqual(changed.funnelFocus, overridden);
  assert.throws(() => generationSchema.parse({ ...input, funnelFocus: { ...practice, approvedAt: '' } }), /Confirm the funnel focus/);
});
test('booking choices can be renamed, removed, added, disabled and restored without changing strategy', () => {
  const updated = applyClientBooking(practice, { enabled: true, confirmed: true, choices: [
    { ...practice.booking.choices[0], label: 'Career decisions' }, { id: 'custom', label: 'Unsure where to start' },
  ] });
  assert.equal(updated.mode, 'practice_wide');
  assert.deepEqual(updated.services, practice.services);
  const stored = funnelFocusSchema.parse(JSON.parse(JSON.stringify(updated)));
  assert.deepEqual(stored.booking.choices.map(c => c.label), ['Career decisions', 'Unsure where to start']);
  assert.equal(applyClientBooking(stored, { ...stored.booking, enabled: false }).booking.enabled, false);
  assert.throws(() => applyClientBooking(undefined, stored.booking), /only available/);
  assert.throws(() => applyClientBooking(practice, { ...stored.booking, mode: 'specific_offer' }), /Unrecognized key/);
  assert.throws(() => applyClientBooking(practice, { ...stored.booking, choices: [{ id: 'x', label: 'New service', serviceId: 'secret' }] }), /service/);
});
test('the public projection omits internal recommendations, service evidence and approval controls', () => {
  const view = clientFunnelFocus(practice)!;
  assert.deepEqual(Object.keys(view).sort(), ['booking', 'mode', 'services']);
  assert.deepEqual(view.services, practice.services.filter(s => s.included).map(({ id, name, description }) => ({ id, name, description })));
  assert.equal('evidence' in view.services![0], false); assert.equal('approvedAt' in view, false);
  assert.equal('recommendation' in view, false);
  assert.equal(clientFunnelFocus(undefined), undefined);
});

test('practice-wide progress requires valid booking choices and explicit confirmation while drafts and specific offers stay compatible', () => {
  assert.equal(practiceBookingReady(undefined), true);
  assert.equal(practiceBookingReady({ ...practice, mode: 'specific_offer', booking: { enabled: false, confirmed: false, choices: [] } }), true);
  assert.equal(practiceBookingReady(practice), true);
  for (const booking of [
    { ...practice.booking, enabled: false }, { ...practice.booking, confirmed: false },
    { ...practice.booking, choices: [] },
    { ...practice.booking, choices: [{ id: 'empty', label: ' ' }] },
    { ...practice.booking, choices: [{ id: 'one', label: 'Same' }, { id: 'two', label: 'same' }] },
  ]) assert.equal(practiceBookingReady({ ...practice, booking }), false);
});
test('client corrections and booking choices reach Copy Studio while older onboarding stays compatible', () => {
  const data = buildProject({ ...blankOpportunity(), name: 'Example Coach', funnel: 'DIRECT_TO_CALL' }, DEFAULT_OFFER);
  data.onboarding!.funnelFocus = practice;
  data.onboarding!.journey = { ...newOnboardingJourney(), briefPrepared: true };
  Object.assign(data.onboarding!.form, { offerName: essentials.offerName, offer: 'Client-corrected overall practice description.', audience: 'Newly promoted managers', customerProblem: essentials.problem, desiredOutcome: essentials.outcome });
  const normalized = normalizeOnboarding(data);
  assert.deepEqual(normalized.funnelFocus, practice);
  assert.equal(clientBriefReady(normalized), true);
  assert.deepEqual([1, 2, 3, 4].map(n => clientJourneyStep(n, 3)), [0, 1, 2, 3], 'Exactly four existing steps');
  const record = toOnboardingBrief({ id: 'p', revision: 2, updatedAt: '', data } as never)!;
  assert.equal(record.brief.description, data.onboarding!.form.offer);
  assert.equal(record.brief.audience, 'Newly promoted managers');
  assert.deepEqual(record.funnelFocus?.booking, practice.booking);
  assert.equal(onboardingBriefSchema.parse(record).funnelFocus?.mode, 'practice_wide');
  delete data.onboarding!.funnelFocus;
  assert.equal(toOnboardingBrief({ id: 'p', revision: 2, updatedAt: '', data } as never)!.funnelFocus, undefined);
});
test('practice focus reaches strategy, draft generation, revision and design handoff; specific offer isolation remains', async () => {
  const prompts: string[] = [];
  const writing = { ...input, funnelFocus: practice };
  let call = 0;
  const result = await generate(async (system, prompt) => {
    assert.match(system, /specific_offer.*never borrow/s);
    assert.match(system, /practice_wide.*not a fictional package/s);
    assert.match(system, /Practice-wide does not mean generic/);
    assert.match(system, /recognizable situation or decision/);
    assert.match(prompt, /"funnelFocus":\{"mode":"practice_wide"/);
    assert.match(prompt, /Career Coaching/);
    assert.doesNotMatch(prompt, /"recommendation"|rationalePassageIds/);
    prompts.push(prompt); return JSON.stringify(++call === 1 ? strategy : draft);
  }, writing, new AbortController().signal, () => {});
  assert.equal(prompts.length, 2);
  await revise(async (_system, prompt) => {
    assert.match(prompt, /"mode":"practice_wide"/);
    return JSON.stringify(draft.sections[0]);
  }, { ...writing, draft: result.draft, sectionId: 'hero', direction: 'clearer' }, new AbortController().signal);
  const p = { ...project(practice), brief: input.brief, result, generatedFrom: fingerprint(writing) };
  const design = buildDesignPrompt(p);
  assert.match(design, /one coherent practice-wide page/);
  assert.match(design, /Career Coaching/);
  assert.match(design, /platform supports/);
  assert.equal(generationPayload(writing).funnelFocus?.mode, 'practice_wide');
  assert.notEqual(fingerprint(input), fingerprint(writing));
});
test('claim checks reject excluded services, fabricated bundles and unsupported booking policies', () => {
  const focus = { ...practice, services: practice.services.map(s => ({ ...s, included: s.id !== 'service-2' })), booking: { ...practice.booking, choices: practice.booking.choices.slice(0, 1) } };
  const messages = auditDraft({ ...draft, sections: [{ ...draft.sections[0], body: 'Leadership Coaching is an all-in-one program. Book a free no-obligation call.' }] }, input.brief, focus).map(i => i.message).join(' ');
  assert.match(messages, /excluded services/); assert.match(messages, /umbrella program/); assert.match(messages, /not confirmed|does not confirm/);
});
test('old Copy Studio backups and their unchanged generation fingerprints remain compatible', () => {
  const original = project(); delete original.funnelFocus;
  const restored = librarySchema.parse({ version: 2, projects: [original] }).projects[0];
  assert.equal(restored.funnelFocus, undefined);
  assert.equal(fingerprint(restored), fingerprint(original));
  assert.equal(generationPayload(restored).funnelFocus, undefined);
});
function project(funnelFocus?: FunnelFocus): Project {
  return { id: 'fixture-project', name: 'Example', updatedAt: '', brief: briefSchema.parse(essentials), template: 'direct_to_call', formula: 'recommended', result: null, source: null, onboarding: null, funnelFocus, generatedFrom: null, history: [] };
}
