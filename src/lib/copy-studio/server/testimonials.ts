import type { Source } from '../shared/contracts';

export type SourceTestimonial = { id: string; attribution: string; quote: string; page: string; category?: string };
const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
const categoryHeading = (value: string) => /^(?:personal|professional) recommendations?\s*$/i.test(value);
const authorHeading = (value: string) => value.length >= 3 && value.length <= 220
  && !categoryHeading(value) && !/testimonial|clients have to say|^skip to|^source page:|^title:/i.test(value)
  && !/^[“"']|^(?:I\b|My\b|We\b|Our\b|With\b|This\b|Very\b|All in all\b|Lisa[’']s\b)/i.test(value)
  && !/\b(?:recommend|helped|thank|support helped|was able)\b/i.test(value);

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
    let group = '';
    for (let i = 1; i < paragraphs.length; i++) {
      if (categoryHeading(paragraphs[i - 1])) { group = paragraphs[i - 1]; continue; }
      const attribution = paragraphs[i - 1], quote = paragraphs[i];
      if (!authorHeading(attribution) || quote.length < 35 || quote.length > 3000) continue;
      if (!/\b(?:I|my|me|we|our)\b|recommend|helped|support|thank/i.test(quote)) continue;
      if (!/[.!?”"']$/.test(quote)) continue; // Exclude a visibly cut-off capture tail.
      let fullQuote = quote;
      // Preserve a second paragraph belonging to the same speaker, without consuming the next author.
      while (i + 1 < paragraphs.length && !categoryHeading(paragraphs[i + 1]) && !authorHeading(paragraphs[i + 1])
        && /[.!?”"']$/.test(paragraphs[i + 1]) && (fullQuote + '\n\n' + paragraphs[i + 1]).length <= 3000) {
        fullQuote += '\n\n' + paragraphs[++i];
      }
      if (found.some(item => normalize(item.quote) === normalize(fullQuote))) continue;
      const training = /\btraining|\bworkshop|\bcourse|bullying|harassment/i.test(attribution + ' ' + fullQuote);
      const category = training ? 'Training feedback' : /professional/i.test(group) ? 'Professional recommendation' : 'Client experience';
      if (training && !/training|workshop|course|bullying|harassment/i.test(target)) continue;
      const matches = terms.filter(term => normalize(fullQuote + ' ' + attribution).includes(term)).length;
      found.push({ id: '', attribution, quote: fullQuote, page: url, category,
        score: matches * 20 + (/\bcoaching\b|career|business|confidence/i.test(fullQuote) ? 4 : 0) });
    }
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 8)
    .map(({ score: _score, ...item }, index) => ({ ...item, id: `T${index + 1}` }));
}

export function testimonialProof(items: SourceTestimonial[]) {
  return items.map(item => `Quote:\n${item.quote}\nAttribution: ${item.attribution}\nSource: ${item.page}${item.category ? `\nCategory: ${item.category}` : ''}`).join('\n\n');
}

