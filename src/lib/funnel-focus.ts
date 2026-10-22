import { z } from 'zod/v4';

// Separate from Copy Studio's current/focused/new writing contexts.
export const funnelFocusModeSchema = z.enum(['specific_offer', 'practice_wide']);
export type FunnelFocusMode = z.infer<typeof funnelFocusModeSchema>;
export const FOCUS_LABELS = { specific_offer: 'Specific Offer', practice_wide: 'Practice-wide' } as const;
export const positioningKeys = ['offerName', 'description', 'audience', 'problem', 'outcome'] as const;
export const practiceLabels = {
  offerName: 'Practice or coach name', description: 'How does your practice help?', audience: 'Who do you help?',
  problem: 'What are they struggling with?', outcome: 'What change do they want?',
} as const;
export const focusEvidenceSchema = z.object({ quote: z.string().min(1).max(3000), url: z.string().max(2000).default('') });
export const detectedServiceSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(200), description: z.string().max(1200),
  evidence: z.array(focusEvidenceSchema).min(1).max(8), included: z.boolean().default(true),
});
export type DetectedService = z.infer<typeof detectedServiceSchema>;
export const focusRecommendationSchema = z.object({
  mode: funnelFocusModeSchema.nullable(), rationale: z.string().max(1500),
  confidence: z.enum(['low', 'medium', 'high']), uncertainties: z.array(z.string().max(500)).max(8),
});
export const bookingChoicesSchema = z.object({
  enabled: z.boolean().default(false), confirmed: z.boolean().default(false),
  choices: z.array(z.object({ id: z.string().min(1).max(100), label: z.string().trim().min(1).max(200), serviceId: z.string().max(100).optional() })).max(20),
}).superRefine((value, ctx) => {
  if (new Set(value.choices.map(c => c.id)).size !== value.choices.length)
    ctx.addIssue({ code: 'custom', message: 'Booking choices need unique IDs.' });
  if (new Set(value.choices.map(c => c.label.toLowerCase())).size !== value.choices.length)
    ctx.addIssue({ code: 'custom', message: 'Give each booking choice a different name.' });
  if (value.enabled && value.confirmed && !value.choices.length)
    ctx.addIssue({ code: 'custom', message: 'Add a booking choice or turn service selection off.' });
});
export type BookingChoices = z.infer<typeof bookingChoicesSchema>;
export const funnelFocusSchema = z.object({
  version: z.literal(1).default(1), mode: funnelFocusModeSchema, approvedAt: z.string().datetime({ offset: true }).or(z.literal('')),
  recommendation: focusRecommendationSchema.nullable().default(null),
  services: z.array(detectedServiceSchema).max(12).default([]),
  booking: bookingChoicesSchema.default({ enabled: false, confirmed: false, choices: [] }),
}).superRefine((value, ctx) => {
  if (new Set(value.services.map(s => s.id)).size !== value.services.length)
    ctx.addIssue({ code: 'custom', message: 'Detected services need unique IDs.' });
  if (value.booking.choices.some(c => c.serviceId && !value.services.some(s => s.id === c.serviceId && s.included)))
    ctx.addIssue({ code: 'custom', message: 'Booking choices must refer to an included service.' });
});
export type FunnelFocus = z.infer<typeof funnelFocusSchema>;
export const focusAnalysisSchema = z.object({
  recommendation: focusRecommendationSchema,
  services: z.array(detectedServiceSchema).max(12),
  positioning: z.object({
    fields: z.partialRecord(z.enum([...positioningKeys, 'mechanism', 'coachBio', 'proof', 'nextStep']), z.string().max(480000)),
    evidence: z.array(z.object({ field: z.string().max(50), quote: z.string().min(1).max(3000) })).max(24),
  }),
});
export type FocusAnalysis = z.infer<typeof focusAnalysisSchema>;
export function newFunnelFocus(mode: FunnelFocusMode = 'specific_offer', analysis?: FocusAnalysis): FunnelFocus {
  return { version: 1, mode, approvedAt: '', recommendation: analysis?.recommendation || null,
    services: analysis?.services || [], booking: { enabled: false, confirmed: false,
      choices: (analysis?.services || []).filter(s => s.included).map(s => ({ id: `booking-${s.id}`, label: s.name, serviceId: s.id })) } };
}
export const isPracticeWide = (focus?: Pick<FunnelFocus, 'mode'> | null) => focus?.mode === 'practice_wide';

// Only these fields cross the public portal boundary. Strategy, rationale and sources stay internal.
export type ClientFunnelFocus = { mode: FunnelFocusMode; booking: BookingChoices; services?: { id: string; name: string; description: string }[] };
export function clientFunnelFocus(focus?: FunnelFocus): ClientFunnelFocus | undefined {
  return focus ? { mode: focus.mode, booking: isPracticeWide(focus) ? focus.booking : { enabled: false, confirmed: false, choices: [] },
    ...(isPracticeWide(focus) ? { services: focus.services.filter(s => s.included).map(({ id, name, description }) => ({ id, name, description })) } : {}) } : undefined;
}
/** Drafts may be incomplete. Moving past Going live requires an explicit confirmation. */
export function practiceBookingReady(focus?: Pick<ClientFunnelFocus, 'mode' | 'booking'>): boolean {
  if (!isPracticeWide(focus)) return true;
  const booking = focus?.booking;
  return Boolean(booking?.enabled && booking.confirmed && booking.choices.length
    && bookingChoicesSchema.safeParse(booking).success);
}
export function applyClientBooking(focus: FunnelFocus | undefined, patch: unknown): FunnelFocus {
  if (!isPracticeWide(focus) || !focus) throw new Error('Booking service choices are only available for practice-wide projects.');
  const booking = bookingChoicesSchema.strict().parse(patch);
  // The client can rename/remove/add choices, but cannot attach an arbitrary internal service.
  if (booking.choices.some(c => c.serviceId && !focus.services.some(s => s.id === c.serviceId && s.included)))
    throw new Error('Choose a service from this project or add a custom booking choice.');
  return { ...focus, booking };
}

/** Small factual handoff; internal recommendation/evidence are deliberately excluded from prompts. */
export function focusForGeneration(focus?: FunnelFocus) {
  if (!focus) return undefined;
  return { mode: focus.mode, services: isPracticeWide(focus) ? focus.services.filter(s => s.included).map(({ name, description }) => ({ name, description })) : [],
    booking: isPracticeWide(focus) ? focus.booking : { enabled: false, confirmed: false, choices: [] } };
}
