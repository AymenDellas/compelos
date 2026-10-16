import type { Source } from '../shared/contracts';

export type SourceTestimonial = { id: string; attribution: string; quote: string; page: string };
const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

/** Keep a testimonial's short author heading with its adjacent feedback paragraph. */
export function findTestimonials(source: Source, target: string): SourceTestimonial[] {
  const terms = [...new Set(normalize(target).match(/[\p{L}\p{N}]{3,}/gu) || [])]
    .filter(term => !/^(?:the|and|for|with|offer|program|programme|coaching|coach|service|sprint)$/.test(term));
  const found: (SourceTestimonial & { score: number })[] = [];
  for (const page of source.text.split(/(?=^SOURCE PAGE: )/m)) {
    const header = page.match(/^SOURCE PAGE: ([^\n]+)\n(?:TITLE: ([^\n]*)\n)?/);
    const url = header?.[1] || source.url;
    if (!/testimonial|review|success.stor|case.stud|client.result/i.test(`${url} ${header?.[2] || source.title}`)) continue;
    const body = header ? page.slice(header[0].length) : page;
    const paragraphs = body.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean);
    for (let i = 1; i < paragraphs.length; i++) {
      const attribution = paragraphs[i - 1], quote = paragraphs[i];
      if (attribution.length > 220 || attribution.length < 3 || quote.length < 35 || quote.length > 1200) continue;
      if (/testimonial|recommendations|clients have to say|^skip to|^source page:|^title:/i.test(attribution)) continue;
      if (!/\b(?:I|my|me|we|our)\b|recommend|helped|support|thank/i.test(quote)) continue;
      if (!/[.!?”"']$/.test(quote)) continue; // Exclude a visibly cut-off capture tail.
      if (found.some(item => normalize(item.quote) === normalize(quote))) continue;
      const matches = terms.filter(term => normalize(quote + ' ' + attribution).includes(term)).length;
      found.push({ id: '', attribution, quote, page: url,
        score: matches * 20 + (/\bcoaching\b|career|business|confidence/i.test(quote) ? 4 : 0) });
    }
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 3)
    .map(({ score: _score, ...item }, index) => ({ ...item, id: `T${index + 1}` }));
}

export function testimonialProof(items: SourceTestimonial[]) {
  return items.map(item => `Quote:\n${item.quote}\nAttribution: ${item.attribution}\nSource: ${item.page}`).join('\n\n');
}

