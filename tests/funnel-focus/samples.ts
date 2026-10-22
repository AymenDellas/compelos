import { newFunnelFocus, type FunnelFocus } from '../../src/lib/funnel-focus';
import { EXTRACTION_VERSION, type ImportResult } from '../../src/lib/copy-studio/shared/contracts';
export const practice: FunnelFocus = {
  ...newFunnelFocus('practice_wide'), approvedAt: '2026-10-22T10:00:00Z',
  recommendation: { mode: 'practice_wide', rationale: 'Both services help new managers make workplace decisions.', confidence: 'high', uncertainties: [] },
  services: ['Career Coaching', 'Leadership Coaching'].map((name, index) => ({ id: `service-${index}`, name, description: `${name} for new managers.`, evidence: [{ quote: `${name} for new managers.`, url: 'https://example.com/' }], included: true })),
  booking: { enabled: false, confirmed: false, choices: [{ id: 'career', label: 'Career Coaching', serviceId: 'service-0' }, { id: 'leadership', label: 'Leadership Coaching', serviceId: 'service-1' }] },
};
export const imported: ImportResult = {
  extractionVersion: EXTRACTION_VERSION,
  source: { title: 'Clear Path Coaching', url: 'https://example.com/', headings: [], text: 'Clear Path Coaching helps new managers with difficult workplace decisions. Career Coaching for new managers. Leadership Coaching for new managers. The goal is to choose a clear next step.' },
  extraction: { offers: practice.services.map(s => ({ name: s.name, summary: s.description, quote: s.evidence[0].quote })), fields: {}, evidence: [], warnings: [] },
  focusAnalysis: { recommendation: practice.recommendation!, services: practice.services,
    positioning: { fields: { offerName: 'Clear Path Coaching', description: 'Choose your next career move and handle difficult workplace decisions as a new manager.', audience: 'New managers', problem: 'Difficult workplace decisions', outcome: 'Choose a clear next step' },
      evidence: [{ field: 'offerName', quote: 'Clear Path Coaching helps new managers with difficult workplace decisions.' }] } },
};
