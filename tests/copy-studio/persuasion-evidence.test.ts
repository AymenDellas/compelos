import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFramework } from '../../src/lib/copy-studio/shared/persuasion';
import { templates } from '../../src/lib/copy-studio/shared/templates';
import { draftSchema, fingerprint, projectSchema, EXTRACTION_VERSION } from '../../src/lib/copy-studio/shared/contracts';
import { findTestimonials, testimonialProof } from '../../src/lib/copy-studio/server/testimonials';
import { auditDraft } from '../../src/lib/copy-studio/shared/quality';
import { extract, generate, revise } from '../../src/lib/copy-studio/server/engine';
import { exportMarkdown } from '../../src/components/copy-studio/export';
import { extractionContext, byteSize } from '../../src/lib/copy-studio/server/source-context';
import { draft, input, strategy } from './fixtures';

const quote = 'Coaching helped me choose a new career and make a practical plan. I recommend this support 100%.';
const source = { title: 'Coach', url: 'https://coach.example/', headings: [], text: `SOURCE PAGE: https://coach.example/\nTITLE: Career Coaching\n\nCareer Coaching helps people choose their next role.\n\nOur workplace training has a 97% approval rating.\n\nSOURCE PAGE: https://coach.example/testimonials\nTITLE: Testimonials\n\nPersonal Recommendations\n\nSam R., Bristol\n\n${quote}\n\nTraining Attendee, London\n\nThis training explained workplace safety and helped our team follow the rules.` };

test('named recommendations follow the page goal and explicit framework choices always win', () => {
  assert.equal(resolveFramework(input).id, 'pas');
  assert.equal(resolveFramework({ ...input, template: 'lead_magnet' }).id, 'aida');
  assert.equal(resolveFramework({ ...input, template: 'vsl' }).id, 'aida');
  assert.equal(resolveFramework({ ...input, template: 'vsl', brief: { ...input.brief, proof: 'A documented case study.' } }).id, 'fourps');
  for (const template of Object.keys(templates) as (keyof typeof templates)[]) {
    for (const formula of ['pas', 'aida', 'bab', 'star', 'fourps'] as const) {
      const result = resolveFramework({ ...input, template, formula });
      assert.equal(result.id, formula);
      assert.equal(result.recommended, false);
      assert.ok(result.stages.length >= 3);
      assert.ok(result.stages.flatMap(stage => stage.sectionIds).every(id => templates[template].sections.some(section => section.id === id)));
    }
  }
});

test('a short author heading stays attached to its own testimonial on a separate route', () => {
  const found = findTestimonials(source, 'Career Coaching');
  assert.equal(found[0].attribution, 'Sam R., Bristol');
  assert.equal(found[0].quote, quote);
  assert.equal(found[0].page, 'https://coach.example/testimonials');
  assert.notEqual(found[1]?.attribution, found[0].attribution);
  const article = { ...source, text: source.text + '\n\nSOURCE PAGE: https://coach.example/business-consulting\nTITLE: Business Success with Consulting\n\nWhy Business Success Matters\n\nI provide career coaching and business coaching to help my clients succeed.' };
  assert.ok(findTestimonials(article, 'Career Coaching').every(item => item.page.endsWith('/testimonials')));
});

test('excluding an unrelated numerical metric preserves relevant verbatim feedback, attribution and endorsement numbers', async () => {
  const result = await extract(Object.assign(async (_system: string, prompt: string) => {
    const data = JSON.parse(prompt.split('SOURCE DATA: ')[1]);
    const testimonial = data.testimonials.find((item: { attribution: string }) => item.attribution === 'Sam R., Bristol');
    return JSON.stringify({ offers: [{ name: 'Career Coaching', summary: 'Career decisions', quote: 'Career Coaching helps people choose their next role.' }],
      fields: { offerName: 'Career Coaching', proof: '97% approval rating' }, selectedTestimonialIds: [testimonial.id, 'T-invalid'],
      evidence: [{ field: 'offerName', quote: 'Career Coaching helps people choose their next role.' }, { field: 'proof', quote: 'Our workplace training has a 97% approval rating.' }], warnings: [] });
  }, { inputByteLimit: 20_000 }), source, new AbortController().signal, 'Career Coaching');
  assert.match(result.extraction.fields.proof!, /Sam R., Bristol/);
  assert.ok(result.extraction.fields.proof!.includes(quote));
  assert.doesNotMatch(result.extraction.fields.proof!, /97%/);
  assert.match(result.extraction.fields.proof!, /100%/); // Personal endorsement, not a program success rate.
  assert.equal(result.extractionVersion, EXTRACTION_VERSION);
  assert.ok(result.extraction.evidence.filter(item => item.field === 'proof').every(item => source.text.includes(item.quote)));
});

test('ambiguous offers cannot import selected testimonials into an unchosen brief', async () => {
  const result = await extract(async () => JSON.stringify({ offers: [
    { name: 'Career Coaching', summary: '', quote: 'Career Coaching helps people choose their next role.' },
    { name: 'workplace training', summary: '', quote: 'Our workplace training has a 97% approval rating.' },
  ], fields: {}, evidence: [], selectedTestimonialIds: ['T1'], warnings: [] }), source, new AbortController().signal);
  assert.deepEqual(result.extraction.fields, {});
});

test('indexed testimonials leave room for the homepage outcome and next-step passages', () => {
  const goal = 'Together we explore your goals and create a practical plan for your career aspirations.';
  const large = { ...source, text: source.text.replace('Our workplace training', goal + '\n\nOur workplace training')
    + Array.from({ length: 80 }, (_, i) => `\n\nSOURCE PAGE: https://coach.example/articles/${i}\nTITLE: Career article\n\n${'An article about careers and coaching. '.repeat(60)}`).join('') };
  const selected = extractionContext(large, 12_000, 'Career Coaching');
  assert.ok(selected.value.passages.some(passage => passage.text.includes(goal)));
  assert.ok(selected.value.testimonials.some(item => item.attribution === 'Sam R., Bristol'));
  assert.ok(byteSize(JSON.stringify(selected.value)) <= 12_000);
});

test('a paraphrased essential citation is rechecked once against the original passages', async () => {
  let calls = 0;
  const result = await extract(async () => {
    calls++;
    return JSON.stringify({ offers: [], fields: { offerName: 'Career Coaching', outcome: 'Choose a next role.' },
      evidence: [{ field: 'offerName', quote: 'Career Coaching' }, { field: 'outcome', quote: calls === 1 ? 'A made-up paraphrased quotation.' : 'Career Coaching helps people choose their next role.' }], warnings: [] });
  }, source, new AbortController().signal, 'Career Coaching');
  assert.equal(calls, 2);
  assert.equal(result.extraction.fields.outcome, 'Choose a next role.');
});

test('the resolved framework and offer-specific stage plan reach strategy, copy and rewrites', async () => {
  const prompts: any[] = [];
  const responses = [strategy, draft, draft.sections[0]];
  const complete = async (_system: string, prompt: string) => {
    const data = JSON.parse(prompt.split('BRIEF DATA: ')[1].split('\nCURRENT PAGE DATA:')[0]);
    prompts.push(data);
    return JSON.stringify(responses.shift());
  };
  const result = await generate(complete, input, new AbortController().signal, () => {});
  await revise(complete, { ...input, draft: result.draft, sectionId: 'hero', direction: 'clearer' }, new AbortController().signal);
  assert.equal(result.draft.strategy.framework?.id, 'pas');
  assert.equal(result.draft.strategy.frameworkPlan?.length, 3);
  assert.ok(prompts.every(data => data.persuasion.id === 'pas'));
  assert.ok(prompts.every(data => data.outline.every((section: object) => !('name' in section))));
  assert.equal(result.draft.strategy.frameworkPlan?.[2].sectionIds.includes('cta'), true);
  assert.equal(draftSchema.parse(result.draft).strategy.framework?.id, 'pas');
  assert.equal(draftSchema.parse({ ...draft, strategy: { ...strategy, framework: undefined, frameworkPlan: undefined } }).strategy.framework, undefined);
});

test('a strategy that omits or reorders framework stages is regenerated before drafting', async () => {
  const bad = { ...strategy, frameworkPlan: [...strategy.frameworkPlan].reverse() };
  const responses = [bad, strategy, draft];
  const result = await generate(async () => JSON.stringify(responses.shift()), input, new AbortController().signal, () => {});
  assert.equal(result.draft.strategy.frameworkPlan?.[0].stage, 'Problem');
  assert.equal(responses.length, 0);
});

test('an explicitly selected AIDA is planned and persisted instead of the default PAS', async () => {
  const chosen = { ...input, formula: 'aida' as const };
  const framework = resolveFramework(chosen);
  const selectedStrategy = { ...strategy, frameworkPlan: framework.stages.map(step => ({
    stage: step.stage, application: `Use the approved customer conversation review to explain the ${step.stage.toLowerCase()} stage of this positioning offer.`, sectionIds: step.sectionIds,
  })) };
  const responses = [selectedStrategy, draft];
  const result = await generate(async () => JSON.stringify(responses.shift()), chosen, new AbortController().signal, () => {});
  assert.equal(result.draft.strategy.framework?.id, 'aida');
  assert.equal(result.draft.strategy.framework?.recommended, false);
  assert.deepEqual(result.draft.strategy.frameworkPlan?.map(step => step.stage), ['Attention', 'Interest', 'Desire', 'Action']);
});

test('approved testimonials cannot be silently omitted and changed quotations are flagged', async () => {
  const proof = testimonialProof(findTestimonials(source, 'Career Coaching').slice(0, 1));
  const withProof = { ...input, brief: { ...input.brief, proof } };
  const completeDraft = structuredClone(draft);
  completeDraft.sections.find(section => section.id === 'proof')!.headline = 'A client’s career decision';
  completeDraft.sections.find(section => section.id === 'proof')!.body = `“${quote}”\nSam R., Bristol`;
  const responses = [strategy, draft, completeDraft];
  const result = await generate(async () => JSON.stringify(responses.shift()), withProof, new AbortController().signal, () => {});
  assert.ok(result.draft.sections.find(section => section.id === 'proof')!.body.includes(quote));
  assert.equal(result.issues.length, 0);
  const changed = structuredClone(completeDraft);
  changed.sections.find(section => section.id === 'proof')!.body = '“This coaching doubled my income in a week.”\nSam R., Bristol';
  assert.ok(auditDraft(changed, withProof.brief).some(issue => /quotation was changed or invented/.test(issue.message)));
});

test('copy exports contain generated public headings without extra template-label headings', () => {
  const saved = projectSchema.parse({ id: 'test', name: 'Example', updatedAt: '', ...input, result: { draft, issues: [] }, source: null, generatedFrom: fingerprint(input), history: [] });
  const text = exportMarkdown(saved);
  assert.match(text, /## The cost of unclear messaging/);
  assert.doesNotMatch(text, /## The problem\n/);
  assert.doesNotMatch(text, /### /);
});
