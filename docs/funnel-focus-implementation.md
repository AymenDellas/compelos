# Funnel focus implementation

Implemented in the CompelOS repository. The production release includes the onboarding and Copy Studio changes without altering existing client records, sending email or configuring an external booking provider.

## Architecture

- `src/lib/funnel-focus.ts` defines the optional versioned plan, operator approval, recommendation/uncertainty, evidence-backed detected services, included services and validated booking choices. Older onboarding and version-2 Copy Studio libraries remain readable without a migration or altered legacy fingerprints.
- The existing website extraction requests focus analysis in the same model call. Passage IDs resolve to exact retained source quotations and route URLs. Unverified practice fields and invented umbrella names are omitted; unsupported coherence yields an explicit uncertain recommendation. Specific-offer extraction remains isolated until operator selection. The model never stores an approved focus.
- Internal preparation and Copy Studio reuse the existing import/review dialog. The operator can override the recommendation, review service evidence, choose relevant services, edit proposed positioning and approve the result. Changing the focus or relevant services reopens approval. Existing form answers are the canonical approved positioning, avoiding a duplicate positioning record that could diverge from client edits.
- The client retains exactly Your Offer, Story & Proof, Going Live, Scope & Agreement. Practice-wide adjusts the first screen's descriptions and adds optional editable booking choices inside Going Live. The public projection excludes recommendation, source evidence and approval controls. Client saves accept only the validated booking patch alongside existing allowlisted answers and use the existing ordered revision queue.
- Onboarding refresh is opt-in in Copy Studio. Individual field selection, optional focus/context/reference/template selection and the existing revision notice preserve unrelated operator work. current/focused/new remain independent saved writing contexts. Focus is retained in backups, fingerprints and generation snapshots and is consumed by strategy, generation, claim repair, persuasion review, rewrites and the design/booking handoff.
- Practice-wide generation uses one coherent audience/problem/value proposition and one Direct to Call action. Relevant included services provide supporting context. The writer is explicitly forbidden to invent an umbrella package, combine terms or universalize service-specific claims. Existing evidence/policy audits remain active; additional audits flag excluded services and fabricated bundles.
- Duplicate public write code was consolidated into token-scoped portal actions, and the four internal onboarding actions authenticate before data access. Signing preserves the reviewed-document hash, immutable PDF records and duplicate-signature checks. The existing signature form is connected to the last screen and updates the save revision. PDF rendering accepts the installed PDF.js interface while remaining compatible with the older declared version.

## Verification

| Check | Result |
|---|---|
| `npm run test:copy-studio` | 177 passed, including Read page and practice-specific copy checks |
| `node --import tsx --test tests/onboarding/*.test.ts tests/onboarding/*.test.cjs` | 39 passed |
| `npm run test:projects` | 19 passed |
| Isolated Playwright suite | 9 passed in installed headless Chrome, including welcome framing, retained-capture refresh and required booking confirmation |
| `node scripts/check-dashboard-auth.cjs` | Passed: 81 internal actions; worker endpoints |
| `node scripts/check-agreement-signing.cjs` | Passed: immutable PDFs, document-hash change and repeat rejection |
| `node scripts/check-agreement-pdf.cjs` | Passed: signature and document hash |
| `npx tsc --noEmit --incremental false` | Passed |
| `npm run build` | Passed, including production TypeScript/static generation |
| Desktop/mobile visual review | Inspected preparation/import and client booking controls; no horizontal overflow |
| Live-provider fictional extraction smoke test | Timed out at the separate 110-second smoke-test limit; no real client data used |
| `npm ci --dry-run --ignore-scripts` | Passed after reconciling the existing manifest/lockfile mismatch and pinning the tested runtime and PDF.js versions |

The browser suite covers four-step continuity, single-offer regression, client corrections, booking add/rename/remove/save/reload, internal overrides, source reuse without another import request, opt-in refresh preserving editorial direction, required introductions and another ordered save after signing. Backend tests exercise related/unrelated/uncertain source analysis, invalid evidence, invented practice names, field allowlists, malicious booking references, stale revisions, source retention, generation/rewrites/design handoff and old backups. Provider and database behavior in these regression suites uses explicit isolated fixtures.

The local Playwright package was absent from this checkout's installed dependencies. The suite ran using the already-installed declared test dependency in the adjacent workspace and installed Chrome. This browser verification did not change client storage. The release subsequently reconciled the existing manifest and lockfile. With dependencies installed consistently, the portable command is `npx playwright test -c playwright.funnel-focus.config.ts` (optionally set `PLAYWRIGHT_CHANNEL=chrome`).

## Remaining limitations and manual verification

Follow-up: the repeated real Read page failure was reproduced and corrected in the provider/CLI integration. See `docs/copy-studio.md`, October 22 verification, for the refusal → stderr-only timeout → misleading unreadable-response chain, native Responses migration, reasoning allowance and regression coverage. A full real public-site capture extraction passed through AgentRouter in 126.5 seconds; a fresh URL import also reached the source-evidence review in the actual isolated onboarding review. Its result was left unapplied.

1. Live Read page verification has now passed with the actual public website and the unchanged AgentRouter account. Operator review of source citations, shared positioning and testimonial relevance remains required before applying answers or sending onboarding. The original fictional smoke test predates the provider fix.
2. Check the chosen booking platform's supported question types and configure the approved choices deliberately. Saving choices does not configure a provider or verify an integration. Booking choices are implemented and persisted as requested; platform configuration is outside this change.
3. The release reconciles the manifest and lockfile, pins the tested Next/React/PDF.js versions and requires Node.js 22. A clean-install dry run passes; the hosted build checks the resolved dependencies.

## Files changed

- `docs/copy-studio.md`
- `docs/guided-onboarding.md`
- `playwright.funnel-focus.config.ts`
- `scripts/check-agreement-signing.cjs`
- `src/app/actions/business-actions.ts`
- `src/app/actions/portal-actions.ts`
- `src/app/portal/[token]/AgreementPdfViewer.tsx`
- `src/app/portal/[token]/page.tsx`
- `src/components/business/BookingChoicesEditor.tsx`
- `src/components/business/ClientOnboardingWizard.tsx`
- `src/components/business/FunnelFocusControls.tsx`
- `src/components/business/OnboardingBriefPrep.tsx`
- `src/components/business/OnboardingWorkspace.tsx`
- `src/components/business/PublishingSetup.tsx`
- `src/components/business/client-onboarding.css`
- `src/components/business/funnel-focus.css`
- `src/components/copy-studio/App.tsx`
- `src/components/copy-studio/BriefPanel.tsx`
- `src/components/copy-studio/EvidenceRecoveryDialog.tsx`
- `src/components/copy-studio/ImportDialog.tsx`
- `src/components/copy-studio/OnboardingDialog.tsx`
- `src/lib/business-validation.ts`
- `src/lib/business.ts`
- `src/lib/copy-studio/server/engine.ts`
- `src/lib/copy-studio/server/focus-extraction.ts`
- `src/lib/copy-studio/server/persuasion-review.ts`
- `src/lib/copy-studio/shared/contracts.ts`
- `src/lib/copy-studio/shared/design-prompt.ts`
- `src/lib/copy-studio/shared/onboarding.ts`
- `src/lib/copy-studio/shared/quality.ts`
- `src/lib/funnel-focus.ts`
- `src/lib/onboarding-journey.ts`
- `tests/copy-studio/funnel-focus.test.ts`
- `tests/funnel-focus/fixture.tsx`
- `tests/funnel-focus/funnel-focus.spec.ts`
- `tests/funnel-focus/samples.ts`
- `tests/funnel-focus/serve.cjs`
- `tests/onboarding/actions.test.cjs`
- `tests/onboarding/guided-actions.test.cjs`

## Practice-wide client confirmation follow-up

The welcome screen now explains the client’s outcome-led practice focus and included services in an orange notice directly below Review my brief, with discovery-booking framing and a Step 3 editing P.S. Step 1 contains the brief review. Going live displays the service list and an explicit required booking confirmation; editing requires reconfirmation and unfinished later sessions resume there. Both client navigation and server completion reject an unconfirmed, disabled or empty booking selection, while draft saves remain possible. Internal edits never silently confirm for the client. Public service summaries omit source evidence and internal strategy. The live practice-wide generation diagnostic completed strategy, draft, claim repair and editorial review in 237 seconds with zero remaining issues. Shared specificity instructions and an editorial repair regression protect against generic umbrella copy without inventing a niche. No real client records, external booking configuration or production deployment were changed.

The practice-description extraction instruction now leads with a short, concrete supported benefit instead of the original website’s broad coaching-category tagline. Extraction version 4 retires older reusable proposals; explicit retained-capture refresh keeps existing approved answers intact until application. The generation and editorial rules require the same outcome-led positioning.
