# Guided client onboarding

## Prepare before sharing

In Onboarding → Form, use **Read the current website** to reuse Copy Studio’s website extraction, offer selection, and field review. Alternatively choose a saved Copy Studio brief from this browser. No extraction is run automatically when a client opens their portal.

Apply and review the prefill, then **Save onboarding** before sharing the client link, or choose **Open local portal** to save and inspect the real client route. Missing facts may remain as explicit client questions; the final five essentials are still required before the client can confirm the offer. An unprepared portal shows a simple preparation message. Existing agreement and project URLs remain available.

The original source capture is retained with the prepared onboarding. When using this onboarding in Copy Studio, an explicit checkbox can attach that capture as the original voice/context reference. Existing Copy Studio references are replaced only when selected. Coach background, full proof, and requested changes also flow back into Copy Studio.

## Client flow

The client portal uses a centered column on one continuous light background. There is no navbar, sidebar, percentage dashboard, separate task list, or repeated scope section.

The welcome screen introduces the prepared brief with one action. Four focused screens follow:

1. **Your offer:** review the five essentials, with an individual Edit action for each answer. Missing facts appear as questions.
2. **Story & proof:** review short source-based previews of the coach's background, differentiation, and up to three attributed testimonial excerpts. Full originals are available on demand. Audience details, assets, preferences, and additional changes use optional disclosures.
3. **Going live:** choose the website manager and publisher, share the booking link, and reveal relevant contact, introduction, tool, or access details. Contact details expand and fade into place, with reduced-motion support. If another person manages or publishes the website, the coach must send the introduction in their email app and check **I’ve sent the introduction email and copied Aymen** before continuing. The portal records this confirmation; opening the email app alone does not count as sending. An unchecked confirmation opens the introduction automatically. Client and server checks enforce the requirement while allowing unfinished drafts to save.
4. **Scope & agreement:** review the deliverables, exclusions, timing, agreement PDF, applicable payment, and case-study permission. Scope confirmation and brief submission save atomically. Scope confirmation does not sign the agreement or verify publishing access.

Client edits to the short supporting summaries are stored separately under `journey.reviewSummaries`; automatic previews never overwrite original proof or background. Reviewed background and differentiation flow into Copy Studio, while proof corrections are included as explicit context alongside the complete original testimony. No additional AI request runs when a client opens their portal.

Answers and the current step save automatically and through explicit Save buttons. Saves are queued and revision checked. Failed saves preserve the visible draft and provide retry/copy recovery. Back navigation remains available without requiring a successful network save. Partial drafts can contain unfinished contact details; completion requires a valid contact when a website person is involved.

Legacy reporting, technical and preference fields remain stored. They are no longer separate client questions. Metrics can still be recorded in the internal baseline section. Existing signed documents and agreement terms retain their prior handling.

## Publishing handoff

Onboarding → Access contains the per-project access choices and Compel’s verification control. Domain connection is the default; website editing, booking configuration, email follow-up and tracking can be enabled for the actual scope.

If someone else manages the website, the coach gets an editable introduction with **Copy message** and **Open in email**. The mail draft goes to the provided contact and copies Aymen. Opening it does not send it or mark it as sent. The coach can explicitly report that they sent the introduction.

Contact details, an introduction, and a submitted brief never independently complete publishing readiness. Compel must confirm responsibility and verify the access or developer arrangement. Changing the contact, publisher, manager or relevant platforms reopens verification. Unneeded generated access requests are retained as non-blocking history; manual requests remain under operator control.

## Open the actual client portal locally

**Open local portal** opens the real `/portal/[token]` route on localhost, even when the configured sharing domain points to production. It saves an edited onboarding draft first, including its prefilled source, story and proof. Copy client link continues to use the configured public domain for sharing. A failed save leaves the draft in the editor and does not open a stale portal.

Applying a page prefill or Copy Studio brief marks that imported summary ready for client review; an additional approval click is not required. The real client must still confirm the five essentials. A genuinely empty, unsaved onboarding continues to show the preparation message. Local browser-only Copy Studio projects do not appear in a portal until they have been applied and saved to that client's onboarding.

Use the actual client route to review the process. Existing PDF documents and payment links retain their real behavior. Access receipts use the same revision-checked save queue as the answers. Baseline capture remains an internal Compel task. `journey.flowVersion: 3` distinguishes the welcome and four focused screens. Saved progress from the former final-review and agreement screens maps to the new last screen; unfinished website introductions return to Going live. Stored answers remain intact.

## Redesign verification · 2026-10-22

- Onboarding model, source preview, Copy Studio bridge, and isolated action tests cover source retention, summary corrections, old/new progress, consent, scope confirmation, and access receipt permissions.
- Browser checks use isolated sample data for all editing and submission actions. They cover desktop/mobile layouts, all screens, reload/resume, individual edits, missing answers, invalid contact details, introduction content, save recovery, access receipts, paid-client and unprepared states.
- The actual local client route is inspected read-only. No real client records are changed by the UI checks.
- Screenshots: `output/client-onboarding-redesign/`. Test logs: `tmp/onboarding-redesign-*`.

## Implementation and verification

The workflow is stored as optional versioned JSON under `onboarding.journey`; no new database tables or bulk record migration are needed. New standalone onboardings get the guided setup. Existing answers and legacy fields survive partial client saves. Only client-owned fields are accepted by the public save action; prepared-source data, required-access selections and internal verification flags are excluded.

Verified locally on 2026-10-21:

- 14 onboarding model/template tests and 9 isolated server-action tests passed.
- All 150 Copy Studio regression tests passed.
- TypeScript and the final production build passed.
- Browser checks covered saved Copy Studio prefill, approval, the existing website-prefill review dialog, all four client steps, missing essential validation, complete proof retention, publishing branches and email draft contents, and desktop/mobile layout.
- The real local portal displayed the unprepared-summary guard correctly.
- The browser walkthrough used unsaved client preview data. No real client records were edited, no email was sent, and no deployment was performed.

Screenshots: `output/onboarding-guided-2026-10-21/`. Test/build logs: `tmp/onboarding-guided-*`, `tmp/onboarding-actions-final.log`, and `tmp/onboarding-copy-studio.log`.

## Specific Offer and Practice-wide positioning

Funnel focus is an explicit operator decision, separate from Copy Studio's current/focused/new writing contexts. New website extraction returns a source-grounded recommendation, rationale, uncertainty, detected services and a proposed overall positioning brief. The recommendation never approves a strategy. Specific Offer remains selected until the operator chooses otherwise and applies or confirms that choice.

For Practice-wide, the existing five essentials describe the real practice/coach name, overall work, audience, problem and desired change. They do not define an invented umbrella program or combined package. Review and edit the proposed facts in the same import dialog or existing internal form. Included services retain their own source quotations and route URLs. Selecting another offer or reviewing focus reuses the saved capture; no new crawl is required. Older captures offer an explicit analysis of the saved text.

The approved plan lives in `onboarding.funnelFocus`: version, mode, approval time, recommendation, evidence-backed services and structured booking choices. The existing form remains the canonical approved positioning and receives client corrections; there is no second copy of the essentials to fall out of sync. Existing records with no plan keep Specific Offer behavior and require no migration.

Clients keep exactly the same four steps and cannot change the strategy. Practice-wide has a prominent orange note on the welcome screen directly below Review my brief. It emphasizes the actual outcome-led page focus, lists the services in readable rows, explains choosing a service when booking a discovery call, and includes a P.S. pointing to editing in Step 3: Going live. The note is not repeated in Step 1. Step 3 always displays the editable service choices and a required confirmation checkbox. Leaving Going live or completing onboarding requires at least one valid choice, enabled service selection and explicit confirmation, enforced in the client and token-scoped server action. Edits clear the confirmation; internal editing cannot auto-confirm on the client’s behalf. Incomplete drafts remain saveable, and unfinished sessions beyond Going live resume there when confirmation is missing. Re-including a detected service restores its suggested booking choice.

Booking choices use the same revision queue as other client answers. The public page receives mode, booking choices and included service IDs/names/descriptions; recommendation, evidence and strategy-approval controls remain internal. The public save accepts only the booking patch. Saved choices are implementation data: the booking provider still needs to be checked and configured. Specific Offer does not receive the practice note or required service confirmation.

Copy Studio's onboarding picker offers the approved focus and booking choices as an explicit checkbox, alongside individually selectable updated answers. Unselected fields, creative direction and references remain untouched. The identity/revision link flags newer answers for review. Copy projects and version-2 backups optionally retain their own funnelFocus. Fingerprints, strategy, drafting, claim repair, persuasion review, section revisions and design handoff carry it separately from writing-context mode. Practice-wide instructions keep a coherent value proposition and one Direct to Call action; included services are supporting context rather than separate sales pitches. Claim checks flag excluded services and invented bundles. Existing single-offer isolation, proof approval and policy checks remain active.

Internal onboarding writes authenticate through the dashboard gate. Duplicate public write implementations were removed from internal business actions; the token-scoped portal actions own field allowlists, revisions, consent, scope, access receipts and booking validation. Existing signing still checks the reviewed PDF hash, stores immutable reviewed/signed documents and rejects repeat signing. Signing returns its new revision to the existing wizard before another save.

### Verification for funnel focus

Run `npm run test:copy-studio`, `node --import tsx --test tests/onboarding/*.test.ts tests/onboarding/*.test.cjs`, `npm run test:projects`, `node scripts/check-dashboard-auth.cjs`, `node scripts/check-agreement-signing.cjs`, `node scripts/check-agreement-pdf.cjs`, `npx tsc --noEmit --incremental false`, and `npm run build`.

`npx playwright test -c playwright.funnel-focus.config.ts` starts an isolated fixture using the real preparation, import, studio and client components. Its server actions, provider responses and agreement preview use explicit test fixtures; it never opens the production database or sends an email. Set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome instead of a downloaded test browser. The suite exercises both focuses, four steps, client corrections, booking restoration, operator overrides, opt-in onboarding refresh, required introduction and ordered saves after signing. Screenshots are written beneath tmp.

Before real use, the operator should review a representative client's source citations, positioning and proof, then check the chosen booking platform's actual capabilities before configuring approved service choices. Automated provider fixtures verify request/response contracts. On October 22, an unsaved live AgentRouter diagnostic using the example coach’s captured public facts completed practice-wide strategy, drafting, claim repair and editorial review in 237 seconds, with no remaining issues. Its opening used the actual job/workplace difficulties and communication approach; no real onboarding record was edited.

### Required practice-wide booking review — October 22, 2026

177 Copy Studio checks, 39 onboarding checks, nine isolated browser workflows, TypeScript and the production build passed. Desktop/mobile renders of the welcome-screen note and always-visible booking section were inspected. Tests cover an unchecked confirmation blocking continuation, edits requiring reconfirmation, draft saves, reload/resume, server-side skipping attempts, restored detected-service choices and unchanged single-offer behavior. Generation and rewriting share explicit practice-specificity rules with the independent editorial reviewer: retain the actual audience, common situation, problem, approach and service details without inventing a narrower niche or fictional umbrella package. A generic hero regression exercises the actual editorial repair path. Logs and screenshots: `tmp/practice-wide-*` and `tmp/funnel-focus-page-plan-*`.

### Welcome framing and outcome-led practice proposals

The current practice proposal leads with a concrete supported desired change in one short sentence, rather than copying a generic service-category tagline. Generation and editorial review apply the same outcome-led requirement to the main proposition and hero. Source evidence, audience breadth and operator approval still apply; missing facts cannot be invented to sound specific. Extraction version 4 prevents silent reuse of older generic proposals. Internal preparation exposes Refresh proposed practice focus for those proposals; the import dialog can refresh analysis directly from the retained capture without recrawling or replacing reviewed answers until Apply. Nine browser workflows and the production build passed. Screenshots: `tmp/practice-wide-welcome-desktop.png` and `tmp/practice-wide-welcome-mobile.png`.
