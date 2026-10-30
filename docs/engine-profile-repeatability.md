# Profile repeatability investigation — 29 October 2026

**Not cleared for account operation.** The predeclared study tested the retained
purchased-proxy profile and two new anonymous profiles, with two complete browser
launches per profile. Every launch attempted the unchanged seven-endpoint battery.
All six DeviceAndBrowserInfo results have all 23 flags false. The earlier
positive automation result remains recorded and its cause is not established.
The published collector was subsequently exercised on one additional fresh
profile, with two launches. Those also clear all 23 flags and the Bot/modification
fields; Sannysoft times out in both, leaving their local result UNKNOWN.

| Profile | Automation flags, both launches | Fingerprint Bot, both launches | Modification, both launches | Sannysoft |
| --- | --- | --- | --- | --- |
| Retained proxy profile | All false | Not detected | Yes | Both completed |
| First new profile | All false | Not detected | Yes | Both connection timeouts |
| Second new profile | All false | Not detected | Not detected | Both connection timeouts |
| Additional published-command confirmation | All false | Not detected | Not detected | Both connection timeouts |

The first profile has two raw 6 PASS / 1 FAIL / 0 UNKNOWN batteries. Each fresh
profile has two raw 5 PASS / 1 FAIL / 1 UNKNOWN batteries. Each raw FAIL is the
retained, exactly verified legacy property-presence check. The first two profiles
fail local admission because of the separate modification warning; the third is
UNKNOWN because Sannysoft did not complete. No timeout is represented as bot
detection or as a website pass. The configured proxy profile's clocks pass against
its expected US timezone. Available fresh-profile clock readings also pass.

## What the findings establish

Modification and Bot are separate published fields. Fingerprint documents
[anomalous attributes and anti-detect-browser recognition](https://github.com/fingerprintjs/fingerprint-pro-server-api-go-sdk/blob/main/docs/Tampering.md)
as possible sources of a tampering result. A warning does not by itself establish
a LinkedIn decision. Our existing conservative admission policy still blocks it;
this investigation does not change that policy or fabricate a compatibility case.

The installed native-readback patch is confirmed, and actual launch observations
show the noise flag absent. It does not resolve every profile's warning. The
different profiles' Intel/NVIDIA rendering identities correlate with the observed
warning in this small sample. This is **not proof of a GPU cause**: their seeds
and other generated properties also differ, and the actual machine has AMD
hardware. No seed, renderer, proxy or verdict was changed to select a passing
identity.

Host-side protocol counts record no `Runtime.enable` during the instrumented
controller sessions. Instrumentation begins after Puppeteer connects; it cannot
exclude earlier provider work, other clients or explain the old positive result.
Puppeteer's own Runtime tracking remains intact. Neither the connection nor a
detector's negative result proves permanent undetectability.

An additional four-run composed/host/host/composed reference study cleared the
DeviceAndBrowserInfo flags, but Fingerprint's published result was unavailable
in all four. Its raw direct-probe PASS values cannot establish a Fingerprint Bot
or modification PASS. That incomplete comparison does not localize the warning.

Native host mode is not an installed repair. Local fixtures show it inherits
the host timezone despite a child-process TZ setting. Adding the expected
timezone switch in host mode is explicitly rejected by this browser build.
Composed mode retains the correct timezone. No host-clock change, unsupported
browser override or profile migration was applied.

## Reproduce and evaluate

`scripts/engine-profile-reliability.cjs --run --fresh` creates **one** anonymous
profile through the normal AliasMode creation path, measures two independent
launches, confirms closure and deletes only its newly created, still-unmapped
fixture. It refuses arbitrary existing profile IDs. LinkedIn/LICDN requests are
blocked, including incidental detector resources. It never enables processing.
Run only on the configured local workstation while actual accounts are paused:

```powershell
node scripts/engine-profile-reliability.cjs --run --fresh
```

Private evidence is saved under ignored `data/engine-v2/profile-reliability/` and
in PostgreSQL. It includes every launch, raw vendor findings, available clock and
identity evidence, bounded protocol method counts and cleanup. Counts contain
method names only, never CDP payloads, cookies or proxy credentials. The newly
created fixture has no proxy; it cannot approve another profile's proxy binding.

The separate `--assess SAVED_REPORT FRESH_REPORT FRESH_REPORT` command reads three
private JSON reports and recomputes the existing admission policy. It requires
three distinct profiles, two launches each, at least two newly created profiles,
stable per-profile identity/configuration, complete clocks, confirmed cleanup and
unchanged account controls. A clean later launch cannot erase an earlier failure.
This is a study result, **not a new runtime gate or account-start permit**.
The original six-launch assessment remains FAIL after the additional clear
modification observations; they do not replace its failed measurements.

The [provider repair request](../provider/aliasmode-native-readback/repair-request.md)
contains the reproducible remaining problem and acceptance criteria. It is a
prepared handoff; no issue, message or private evidence has been sent externally.

## Preserved state and evidence

The retained purchased-proxy profile is closed and retained. Both newly created
study fixtures and the additional published-command fixture were confirmed
closed and deleted through the official CLI. No real
profile was deleted or changed. Every actual account's controls, evidence and
exact hold match the before snapshot; no LinkedIn navigation or account sign-in
occurred. The new repeatability assessor is diagnostic-only; raw vendor logic,
runtime admission, account ownership, pacing and qualification remain unchanged.

Private PostgreSQL studies:

- Retained profile: `profile-reliability-2b5183de-8c3d-4847-833e-ccbccbdec2b0`.
- First fresh profile: `profile-reliability-9659d903-a6ef-42be-9bf1-8a9b58485d14`.
- Second fresh profile: `profile-reliability-e8effd41-9d8a-49e7-895a-d743dd5b2fc7`.
- Incomplete native reference: `provider-native-identity-69762a2b-9ece-4f9a-8013-e889a96ad054`.
- Published-command confirmation: `profile-reliability-536396d4-18cf-48c5-ad67-d8d607853ab2`.
- Failure-preserving summary: `profile-reliability-summary-afe8db96-ceaf-45a8-990c-b4b60e44a19b`.
- Frozen 50-record regression: `session-control-20261029-c558abc9-252e-4e4a-9a43-7a6aa1f07546`.

The implementation-phase replay has zero decision/evidence changes or errors;
the complete CRM digest and saved account controls are unchanged.

## Software verification

| Check | Result |
| --- | --- |
| Complete serial engine/prospect/coach fixtures | 488 passed, 0 failed/skipped |
| CRM fixtures with PostgreSQL enabled | 14 passed, 0 failed/skipped |
| Type checking and changed-file lint | Passed |
| Whole-project lint | Existing 6 errors and 4 warnings in unrelated UI files |
| New study coverage, failure retention, CLI and cleanup checks | 6 passed |
| Stored-evidence replay | 50 records, 0 decision/evidence changes/errors |

The first focused test command omitted the runtime database configuration and
one existing PostgreSQL case failed with connection refused. That output is
retained. The complete 488-case run loaded the existing runtime configuration
and passed without skips. No environment file was copied or edited. Software
fixture passes do not turn the external browser findings into passes.
