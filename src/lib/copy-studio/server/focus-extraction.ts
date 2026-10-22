import { z } from 'zod/v4';
import { focusRecommendationSchema, positioningKeys, type FocusAnalysis } from '../../funnel-focus';
import { extractionSchema, type Extraction, type Source } from '../shared/contracts';
import { testimonialProof, type SourceTestimonial } from './testimonials';

const citation = z.object({ field: z.string().max(50), passageId: z.string().max(30) });
export const rawFocusSchema = z.object({
  recommendation: focusRecommendationSchema,
  rationalePassageIds: z.array(z.string().max(30)).max(12).default([]),
  positioning: z.object({
    fields: extractionSchema.shape.fields,
    evidence: z.array(citation).max(64),
    testimonialIds: z.array(z.string().max(30)).max(128).default([]),
  }),
});
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
export function resolveFocusAnalysis(raw: z.infer<typeof rawFocusSchema> | undefined, extraction: Extraction,
  source: Source, quotes: Map<string, string>, testimonials: SourceTestimonial[]): FocusAnalysis {
  const sourceText = normalize(source.text);
  const verified = (quote?: string): quote is string => Boolean(quote?.trim() && sourceText.includes(normalize(quote)));
  const evidenceUrl = (quote: string) => {
    const index = source.text.indexOf(quote);
    const routes = [...source.text.slice(0, index < 0 ? undefined : index).matchAll(/^SOURCE PAGE: ([^\n]+)/gm)];
    const route = routes.at(-1)?.[1]?.trim();
    return route && /^https?:\/\//.test(route) ? route : source.url;
  };
  const services = (extraction.offers || []).map((o, index) => ({ id: `service-${index + 1}`, name: o.name,
    description: o.summary, included: true, evidence: [{ quote: o.quote, url: evidenceUrl(o.quote) }] }));
  const evidence = (raw?.positioning.evidence || []).flatMap(e => {
    const quote = quotes.get(e.passageId);
    return verified(quote) ? [{ field: e.field, quote }] : [];
  });
  const fields: FocusAnalysis['positioning']['fields'] = {};
  for (const key of [...positioningKeys, 'mechanism', 'coachBio', 'nextStep'] as const) {
    const value = raw?.positioning.fields[key]?.trim();
    if (value && value.length <= 6000 && evidence.some(e => e.field === key)
      && (key !== 'offerName' || sourceText.includes(normalize(value)))) fields[key] = value;
  }
  // Practice names must exist in the source. No synthesized umbrella program.
  const selectedIds = raw?.positioning.testimonialIds || [];
  const approved = testimonials.filter(t => selectedIds.includes(t.id) && verified(t.quote) && verified(t.attribution));
  if (approved.length) {
    fields.proof = testimonialProof(approved);
    evidence.push(...approved.map(t => ({ field: 'proof', quote: t.quote.length <= 3000 ? t.quote : t.attribution })));
  }
  let recommendation: FocusAnalysis['recommendation'] = raw?.recommendation || {
    mode: services.length === 1 ? 'specific_offer' : null,
    rationale: services.length === 1 ? 'One source-supported offer was detected. A page focused on that offer is a reasonable starting point.' : 'The relationship between these services has not been established. Review the source and choose the focus.',
    confidence: services.length === 1 ? 'medium' : 'low', uncertainties: services.length === 1 ? [] : ['A coherent shared audience and problem have not been verified.'],
  };
  if (recommendation.mode === 'practice_wide' && (!fields.audience || !fields.problem || !fields.outcome
    || !raw?.rationalePassageIds.some(id => verified(quotes.get(id))))) {
    recommendation = { mode: null, rationale: 'The source does not provide enough verified common positioning to recommend a practice-wide page.',
      confidence: 'low', uncertainties: ['Review whether the services share an audience, problem and desired change.', ...recommendation.uncertainties].slice(0, 8) };
  }
  return { recommendation, services, positioning: { fields, evidence: evidence.slice(0, 24) } };
}

export const focusExtractionInstruction = `Also assess FUNNEL FOCUS, separately from extracting a selected offer. The operator makes the final decision. Specific Offer promotes one defined service. Practice-wide positions the existing coach/practice around a coherent shared audience, difficulty and desired change; services support that positioning and the primary action is one discovery call, not a services directory. One offer generally suggests specific_offer. Multiple closely related services may support practice_wide. Unrelated audiences/services generally suggest specific_offer. These are evidence-based guidelines, never a count-only rule. Set recommendation.mode to null and disclose uncertainty when evidence is insufficient. Cite rationalePassageIds supporting any practice-wide recommendation.
For positioning.fields.description, write a concise OUTCOME-LED PRACTICE FOCUS: one plain-language sentence, 12–28 words. For this field only, frame the verified facts as a clear benefit statement for operator review. Start with a concrete active outcome: what can change in the reader's actual career, work, relationships or other source-supported situation? Use recognizable decisions or results rather than abstract qualities, stacked adjectives or hedges such as move toward. Keep explanations of delivery, approach and service lists in their own fields, not a second sentence. Do not copy a website slogan or return a category list such as coaching for career growth, workplace wellness and life transitions. Do not settle for helping people grow, gain clarity or reach their potential when the source states a more recognizable decision or result. Preserve the real audience breadth and use only its supported common thread. Cite the passages establishing the situation and desired change as description evidence; a generic tagline alone is insufficient support. An aspirational benefit must not become a guarantee, a new branded program, invented niche, quantified claim, or an unsupported bundle. Omit the proposition and disclose what is missing if the source cannot support one.
Return optional focusAnalysis: {"recommendation":{"mode":"specific_offer or practice_wide or null","rationale":"concise reason based on the actual services/audience","confidence":"low or medium or high","uncertainties":[]},"rationalePassageIds":["P1"],"positioning":{"fields":{"offerName":"actual existing practice or coach name","description":"concise outcome-led practice focus grounded in the actual situation and desired change","audience":"explicit common audience","problem":"source-supported shared difficulty","outcome":"source-supported desired change","mechanism":"shared approach if supported","coachBio":"actual provider","nextStep":"explicit discovery-call expectations only"},"evidence":[{"field":"description","passageId":"P1"},{"field":"audience","passageId":"P1"}],"testimonialIds":["T1"]}}.
Only propose practice positioning if supported by the supplied sources. Omit unknown fields. Do not synthesize a branded umbrella program, combined package, service promise, price, guarantee, commitment policy or fictional audience by merging unrelated offerings. Every proposed practice field needs its own supplied passageId. The practice/coach name must be an exact existing name from the source, not a new offer name. Select only testimonials whose actual subject supports this shared positioning; training feedback must not become coaching results. Leave practice proof empty if relevance is uncertain. Keep the complete detected offers list with its evidence even if targetOffer was supplied. Never change the single-offer extraction rules or select the funnel focus for the operator.`;
