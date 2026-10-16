import type { Draft, GenerationInput } from '../shared/contracts';
import { approvedTestimonials } from '../shared/evidence';
import { findTestimonials } from './testimonials';

export function approvedProofEntries(input: GenerationInput) {
  const captured = input.reference ? findTestimonials(input.reference, input.brief.offerName) : [];
  return approvedTestimonials(input.brief.proof).map((item, index) => ({
    ...item, id: `E${index + 1}`,
    category: item.category || captured.find(candidate => candidate.attribution === item.attribution
      && candidate.quote === item.quote)?.category || 'Client experience',
  })).sort((a, b) => Number(a.category !== 'Client experience') - Number(b.category !== 'Client experience'));
}

export function testimonialWordLimit(input: GenerationInput): number | undefined {
  const instructions = [input.context?.mustKeep, input.context?.direction].filter(Boolean).join('\n');
  const match = instructions.match(/(?:testimonial|quote|excerpt)[^.!?\n]{0,70}?(?:at most|maximum of|no more than) (\d+) words/i)
    || instructions.match(/(?:at most|maximum of|no more than) (\d+) words[^.!?\n]{0,70}?(?:testimonial|quote|excerpt)/i);
  return match ? Math.max(1, Number(match[1])) : undefined;
}

export function exactExcerpt(quote: string, topic: string, limit: number): string {
  const text = quote.replace(/^[“"]|[”"]$/g, '').trim();
  const words = text.match(/\S+/g) || [];
  if (words.length <= limit) return text;
  const terms = [...new Set(topic.toLowerCase().match(/[\p{L}]{4,}/gu) || [])]
    .filter(term => !/^(?:coaching|coach|with|their|that|this|your|from|they|have|want|through|toward|customized)$/.test(term));
  const sentences = text.split(/(?<=[.!?])\s+/).map(value => value.trim()).filter(Boolean);
  const score = (value: string) => terms.filter(term => value.toLowerCase().includes(term)).length;
  const candidates: string[] = [];
  for (let start = 0; start < sentences.length; start++) {
    for (let end = start; end < sentences.length; end++) {
      const excerpt = sentences.slice(start, end + 1).join(' ');
      if (excerpt.split(/\s+/).length > limit) break;
      candidates.push(excerpt);
    }
  }
  candidates.sort((a, b) => score(b) - score(a) || b.length - a.length);
  // An impossible cap is a review issue, never permission to cut a sentence into a claim fragment.
  return candidates[0] || text;
}

/** Testimonials are approved source data. Never let the model rewrite their wording. */
export function restoreApprovedProof(draft: Draft, input: GenerationInput): Draft {
  const items = approvedProofEntries(input);
  if (!items.length) return draft;
  const limit = testimonialWordLimit(input);
  const count = /\b(?:one|1)\b.{0,24}testimonial/i.test(input.context?.mustKeep || '') ? 1 : items.length;
  const topic = [input.brief.offerName, input.brief.outcome].join(' ');
  const extraProof = input.brief.proof.replace(/(?:^|\n)Quote:\n[\s\S]*?\nAttribution: [^\n]+(?:\nSource: [^\n]+)?(?:\nCategory: [^\n]+)?/g, '').trim();
  const notes = draft.notes.filter(note => !/testimonial excerpt (?:used|trimmed)|excerpt.*\b\d+ words\b/i.test(note));
  if (limit && limit < 40) notes.push(`The brief requests testimonial excerpts of at most ${limit} words. This can remove useful context; remove that note for fuller social proof. Complete sentences are preserved even if a cap is too short.`);
  const sections = draft.sections.map(section => {
    if (section.id !== 'proof') return section;
    const parts = section.proofFraming?.introduction.trim() ? [section.proofFraming.introduction.trim()] : [];
    for (const item of items.slice(0, count)) {
      const heading = section.proofFraming?.items.find(frame => frame.id === item.id)?.heading.trim();
      const label = item.category === 'Professional recommendation'
        ? heading && !/professional recommendation/i.test(heading) ? `Professional recommendation: ${heading}` : heading || item.category
        : heading || item.category;
      const quote = limit ? exactExcerpt(item.quote, topic, limit) : item.quote.replace(/^[“"]|[”"]$/g, '').trim();
      const block = `${label}\n\n“${quote}”\n${item.attribution}`;
      if ([...parts, block, extraProof].filter(Boolean).join('\n\n').length <= 6000) parts.push(block);
      else notes.push(`The complete testimonial attributed to ${item.attribution} did not fit this section's size limit. It remains in the approved brief; select fewer testimonials or request a complete-sentence excerpt.`);
    }
    if (extraProof) parts.push(extraProof);
    return { ...section, body: parts.join('\n\n'), bullets: [], cta: '' };
  });
  return { ...draft, sections, notes: [...new Set(notes)].slice(-12) };
}
