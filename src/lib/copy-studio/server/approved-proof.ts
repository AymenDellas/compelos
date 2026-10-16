import type { Draft, GenerationInput } from '../shared/contracts';
import { approvedTestimonials } from '../shared/evidence';

export function exactExcerpt(quote: string, topic: string, limit: number): string {
  const text = quote.replace(/^[“"]|[”"]$/g, '').trim();
  const words = text.match(/\S+/g) || [];
  if (words.length <= limit) return text;
  const terms = [...new Set(topic.toLowerCase().match(/[\p{L}]{4,}/gu) || [])]
    .filter(term => !/^(?:coaching|coach|with|their|that|this|your|from|they|have|want|through|toward|customized)$/.test(term));
  const clauses = text.split(/(?<=[.!?])\s+|,\s+|\s+and\s+/).map(value => value.trim())
    .filter(value => value.split(/\s+/).length >= 8 && value.split(/\s+/).length <= limit);
  const score = (value: string) => terms.filter(term => value.toLowerCase().includes(term)).length;
  clauses.sort((a, b) => score(b) - score(a));
  if (clauses.length && score(clauses[0])) return clauses[0];
  const tokens = [...text.matchAll(/\S+/g)];
  const windows = tokens.map((token, index) => text.slice(token.index, (tokens[index + limit]?.index ?? text.length)).trim())
    .filter(value => value.split(/\s+/).length >= Math.min(8, limit));
  windows.sort((a, b) => score(b) - score(a));
  return windows[0] || words.slice(0, limit).join(' ');
}

/** Testimonials are approved source data. Never let the model rewrite their wording. */
export function restoreApprovedProof(draft: Draft, input: GenerationInput): Draft {
  const items = approvedTestimonials(input.brief.proof);
  if (!items.length) return draft;
  const requested = Number(input.context?.mustKeep.match(/at most (\d+) words/i)?.[1] || 32);
  const limit = Math.min(60, Math.max(8, requested));
  const count = /\bone\b.{0,24}testimonial/i.test(input.context?.mustKeep || '') ? 1 : 2;
  const topic = [input.brief.offerName, input.brief.outcome].join(' ');
  const extraProof = input.brief.proof.replace(/(?:^|\n)Quote:\n[\s\S]*?\nAttribution: [^\n]+(?:\nSource: [^\n]+)?/g, '').trim();
  const body = [items.slice(0, count).map(item => `“${exactExcerpt(item.quote, topic, limit)}”\n${item.attribution}`).join('\n\n'), extraProof].filter(Boolean).join('\n\n');
  return { ...draft, sections: draft.sections.map(section => section.id === 'proof'
    ? { ...section, body, bullets: [], cta: '' } : section) };
}
