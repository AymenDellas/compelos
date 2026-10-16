export function approvedTestimonials(proof: string): { quote: string; attribution: string }[] {
  return [...proof.matchAll(/(?:^|\n)Quote:\n([\s\S]*?)\nAttribution: ([^\n]+)/g)]
    .map(match => ({ quote: match[1], attribution: match[2] }));
}
