import { z } from 'zod/v4';

const text = z.string().trim().max(6000);
export const briefSchema = z.object({
  offerName: text.default(''),
  description: text.default(''),
  audience: text.default(''),
  problem: text.default(''),
  outcome: text.default(''),
  mechanism: text.default(''),
  deliverables: text.default(''),
  proof: text.default(''),
  objections: text.default(''),
  price: text.default(''),
  guarantee: text.default(''),
  urgency: text.default(''),
  cta: text.default(''),
  voice: text.default('Clear, warm, and direct'),
  customerLanguage: text.default(''),
  nextStep: text.default(''),
});
export type Brief = z.infer<typeof briefSchema>;
export type BriefKey = keyof Brief;
export const templateIdSchema = z.enum(['direct_to_call', 'lead_magnet', 'vsl']);
export type TemplateId = z.infer<typeof templateIdSchema>;
export const formulaSchema = z.enum(['recommended', 'pas', 'aida', 'bab', 'star', 'fourps']);
export type FormulaId = z.infer<typeof formulaSchema>;
export const requiredKeys = ['offerName', 'description', 'audience', 'problem', 'outcome'] as const;
export const fieldLabels: Record<BriefKey, string> = {
  offerName: 'Offer name',
  description: 'What are you offering?',
  audience: 'Who is it for?',
  problem: 'What problem are they facing?',
  outcome: 'What outcome do they want?',
  mechanism: 'Why does your approach work?',
  deliverables: 'What is included?',
  proof: 'Evidence & testimonials',
  objections: 'Reasons they might hesitate',
  price: 'Price & payment terms',
  guarantee: 'Guarantee or refund terms',
  urgency: 'Real deadlines or capacity limits',
  cta: 'Primary button label',
  voice: 'Brand voice',
  customerLanguage: 'Words your customers use',
  nextStep: 'What happens after they click?',
};
export const generationSchema = z.object({
  brief: briefSchema.refine(
    (b) => requiredKeys.every((k) => b[k].length >= 3),
    'Complete all five essential brief fields (at least 3 characters each).',
  ),
  template: templateIdSchema,
  formula: formulaSchema.default('recommended'),
});
export type GenerationInput = z.infer<typeof generationSchema>;
export const sectionSchema = z.object({
  id: z.string().min(1).max(80),
  headline: z.string().max(250),
  body: z.string().max(6000),
  bullets: z.array(z.string().max(800)).max(8),
  cta: z.string().max(120),
});
export type Section = z.infer<typeof sectionSchema>;
export const strategySchema = z.object({
  angle: z.string().min(5).max(1200),
  promise: z.string().min(5).max(1200),
  objection: z.string().max(1200),
  action: z.string().min(2).max(400),
  missingEvidence: z.array(z.string().max(500)).max(10),
});
export type Strategy = z.infer<typeof strategySchema>;
export const draftSchema = z.object({
  strategy: strategySchema,
  sections: z.array(sectionSchema).min(1).max(15),
  notes: z.array(z.string().max(1000)).max(12),
});
export type Draft = z.infer<typeof draftSchema>;
export const issueSchema = z.object({
  sectionId: z.string(),
  severity: z.enum(['review', 'warning']),
  message: z.string(),
});
export type Issue = z.infer<typeof issueSchema>;
export const resultSchema = z.object({ draft: draftSchema, issues: z.array(issueSchema) });
export type GenerationResult = z.infer<typeof resultSchema>;
export const extractionSchema = z.object({
  fields: z.partialRecord(z.enum(Object.keys(fieldLabels) as [BriefKey, ...BriefKey[]]), text),
  evidence: z
    .array(
      z.object({
        field: z.enum(Object.keys(fieldLabels) as [BriefKey, ...BriefKey[]]),
        quote: z.string().min(1).max(1200),
      }),
    )
    .max(24),
  warnings: z.array(z.string().max(500)).max(10),
});
export type Extraction = z.infer<typeof extractionSchema>;
export const sourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  text: z.string(),
  headings: z.array(z.string()),
});
export type Source = z.infer<typeof sourceSchema>;
export const importResultSchema = z.object({ source: sourceSchema, extraction: extractionSchema });
export type ImportResult = z.infer<typeof importResultSchema>;
export const revisionSchema = generationSchema.extend({
  draft: draftSchema,
  sectionId: z.string().max(80),
  direction: z.enum(['clearer', 'shorter', 'stronger', 'alternative']),
});
export type RevisionInput = z.infer<typeof revisionSchema>;
export const revisionResultSchema = z.object({
  section: sectionSchema,
  issues: z.array(issueSchema),
});
export const projectSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(200),
  updatedAt: z.string(),
  brief: briefSchema,
  template: templateIdSchema,
  formula: formulaSchema,
  result: resultSchema.nullable(),
  source: importResultSchema.nullable(),
  generatedFrom: z.string().nullable(),
  history: z.array(z.object({ result: resultSchema, generatedFrom: z.string().nullable() })).max(8),
});
export type Project = z.infer<typeof projectSchema>;
export const librarySchema = z.object({
  version: z.literal(2),
  projects: z.array(projectSchema).max(100),
});
export function fingerprint(input: GenerationInput): string {
  return JSON.stringify({
    brief: briefSchema.parse(input.brief),
    template: input.template,
    formula: input.formula,
  });
}
