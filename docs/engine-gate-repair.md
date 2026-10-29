# Local diagnostic gate and AliasMode repair — 29 October 2026

**Later proxy-bound validation is blocked:** [a new blank profile](engine-proxy-profile-validation.md) passes its actual proxy/clock checks but reports browser modification on two observations, with native readback confirmed and the noise flag absent. A first automation finding clears on repeat and remains recorded. The profile is closed and not approved for account use. Earlier successful anonymous results below do not establish readiness for this new setup.

The user authorized correcting the gate and repairing the browser modification
warning. Raw website verdicts remain intact. The local admission decision is
now separate from those measurements; it is not a LinkedIn account clearance.

## Gate correction

`DIRECT_SIGNALS_V5` records the original aggregate as `measurementVerdict`, the
unchanged raw per-site results/counts, and a separate
`LOCAL_DIAGNOSTIC_ADMISSION_V1` assessment. The dashboard labels both results
and shows the compatibility explanation and published warning fields.

One narrow compatibility finding covers Incolumitas's legacy FPScanner
`WEBDRIVER` failure. The previously inspected scanner tests for the presence of
the standard property, even when its value is `false`. Admission requires all
nine current checks to be OK, that exact legacy failure alone, a direct false
value and present property, the exact endpoint with HTTP 200, and the two
verified public source hashes:

| Public source | SHA-256 |
| --- | --- |
| [fpScanner.js](https://bot.incolumitas.com/fpScanner.js) | `f91e05ce0587f825ba072c296022882371e598b9d159fa1d3104dd25390e65a2` |
| [fpCollect.min.js](https://bot.incolumitas.com/fpCollect.min.js) | `9c826cdc6b72f6d0c6f18a140ba215e3a7cf94b21abe75b0d6824158e0a2de2e` |

The browser fetches those public sources without credentials and with bounded
time/size. Missing or changed hashes, another failure, a positive WebDriver/CDP
signal, or a redirect prevents the exception. The site's raw FAIL is retained.
This does not override any LinkedIn response, hold, or identity failure.

Fingerprint's separate browser-modification warning now blocks local admission
even if its Bot field passes. Missing required website results remain UNKNOWN.
Human approval of an exact current UNKNOWN report recomputes the local findings
and cannot override a modification warning or another confirmed failure. The
new reader/admission versions invalidate old gate approvals without erasing them.

BrowserScan and CreepJS are explicitly direct-probe contexts in this routine
battery, not captured website human verdicts. TLS checks establish capture
integrity and HTTP/browser UA coherence, not equality with a reference Chrome
TLS fingerprint. Incolumitas's behavioral score remains separate from its static
checklist. These limits are visible rather than represented as seven universal
human-verdict passes.

## Browser repair

The [previous controlled study](engine-provider-repair.md) reproduced the known
warning twice with readback noise enabled and cleared it twice with that flag
omitted, using the same previously failing anonymous seed. The feature was
unconditionally enabled by the manager; passing `--fingerprint-noise=false`
still enabled it. The clock issue had already been resolved by correcting the
[IANA reference](engine-clock-reference.md), without changing the browser clock.

The installed repair is a small, published local patch of AliasMode beta.69,
not an official vendor release. It makes native canvas/WebGL image readback an
explicit, persistent per-profile opt-in. See the
[source patch, license and reproducible build instructions](../provider/aliasmode-native-readback/README.md).

Only the manager sidecar is replaced, with its original executable/hash backed
up locally. The GUI, thin official CLI helper, Chromium executable/DLL/ICU data,
installed Puppeteer and CDP controller remain intact. No browser-global
injection, stealth library, proxy configuration or existing profile is changed.
The running manager confirms the patch capability and actual profile setting.
The helper cannot certify an unpatched manager from its own version alone.

New CompelOS-created AliasMode Chromium profiles opt into native readback before
their first browser launch. The closed-profile change uses the existing Cloud
editor with version/edit/active-open fences and preserves other tags, cookies
and credentials. Existing untagged profiles keep their original launch flags
and saved identity hashes. An explicit rendering change participates in frozen
identity and requires review; setting saves never authorize processing. Missing
provider support or configuration changes during launch block attachment.

Use the existing `scripts/engine-provision-profile.cjs` path when provisioning
a new CompelOS account browser: its creation call now applies this configuration
before the first launch. A profile created directly in the AliasMode interface
is not automatically opted in. It needs the documented closed-profile native
configuration before its initial identity review. Existing held profiles must
not be silently changed or replaced.

Native image output can be shared by profiles on the same hardware. Removing
the modification trigger does not prove profile unlinkability or an
undetectable browser. A provider update can replace this local patch; capability
checks then block work until the new provider version is separately validated.

## Validation and account boundary

The pre-change PostgreSQL manifest is
`session-control-20261029-82751798-57f0-4c87-b875-0de2923e7443`.
Its 50 saved qualification decisions and evidence replay without changes;
account controls and the complete CRM digest remain unchanged. Private snapshots,
binary backups, build receipts and raw measurements stay under ignored
`data/engine-v2/gate-repair-20261029/`; PostgreSQL retains benchmark manifests.

The first anonymous before/after study is
`native-readback-validation-49ba6b1e-bc49-454c-874e-13cd2e33095e`.
It retains a partial native pass because Sannysoft returned
`net::ERR_CONNECTION_TIMED_OUT`. The following native pass completed every
required endpoint and passed local admission. Both native observations reported
Fingerprint Bot and browser tampering Not detected, with all 23
DeviceAndBrowserInfo flags false. The new seed's baseline was also clear: this
pair confirms managed configuration and current results, while causation comes
from the earlier controlled failing-seed study. The partial study's strict
two-pass acceptance remains false; it is not relabeled.

The separate default-native confirmation study is
`native-readback-confirmation-40726c38-b36a-4c0b-93f7-24b3e4966c19`.
It creates another blank profile through the normal default configuration path
and schedules two complete confirmation passes. Both pass strict confirmation
acceptance. No prior attempt is overwritten or omitted:

| Observation | Local admission | Raw PASS / FAIL / UNKNOWN | Fingerprint Bot / modification | Device flags | Sannysoft |
| --- | --- | --- | --- | --- | --- |
| Original mode, new diagnostic seed | PASS | 6 / 1 / 0 | Both Not detected | All 23 false | All 31 clear |
| Native mode, first pass | UNKNOWN | 5 / 1 / 1 | Both Not detected | All 23 false | Connection timed out |
| Native mode, repeat | PASS | 6 / 1 / 0 | Both Not detected | All 23 false | All 31 clear |
| New default-native profile, confirmation 1 | PASS | 6 / 1 / 0 | Both Not detected | All 23 false | All 31 clear |
| Same default-native profile, confirmation 2 | PASS | 6 / 1 / 0 | Both Not detected | All 23 false | All 31 clear |

Every raw FAIL in that table is the retained, source-verified legacy property
check. All seven endpoint clocks in each completed pass agree with current IANA
rules. The unavailable endpoint has no inferred clock or detector pass. The
observed browser launch drops the noise flag only in native mode; the Chromium
executable, DLL and ICU hashes match across all five observations. Developer
tools remains Not detected. Fingerprint's separate timezone/VPN label and suspect
score of 10 remain visible and unchanged; the location label is not evidence of
a bot or proof that a VPN is enabled. Real profile admission separately requires
matching configured exit IP, country, timezone and both clock readings.

Both temporary profiles were confirmed stopped and deleted through the official
CLI after verifying they remained unmapped. Original provider rosters and every
account control/evidence field match their before snapshots. No live LinkedIn
request was performed.

Software verification:

| Check | Result |
| --- | --- |
| Engine, prospect and coach fixtures, serial full rerun | 482 passed; 0 failed/skipped |
| CRM tests with PostgreSQL enabled | 14 passed; 0 failed/skipped |
| AliasMode source fixtures | 62 passed; 0 failed |
| AliasMode TypeScript and compiled sidecar build | Passed |
| CompelOS `tsc --noEmit` and changed-file lint | Passed |
| Production application build | Passed |
| Installed working-app copy, focused admission/provider/identity checks | 34 passed; 0 failed/skipped |
| Build privacy trace audit | 92 traces; 0 private-data/secret-file inclusions |
| Stored-evidence replay | 50 records; 0 decision/evidence changes; CRM and controls unchanged |

The first engine run retained one failure from a pre-existing concurrency test
that assumed the first submitted claimant always won. Its corrected assertion
requires exactly one winner with the expected run ID, regardless of completion
order. The focused check and the complete rerun pass; queue behavior is unchanged.

Whole-tree lint still reports the previously recorded six errors and four
warnings in unrelated UI files. Those are not fixed or claimed green here;
changed-file lint passes. The successful build retains its existing module-type
and broad filesystem-pattern warnings; the separate privacy audit confirms that
private diagnostic data and secret files are excluded.

All 26 changed files were installed into the user's working application after
checking that their prior contents still matched the expected baseline. The
installation preserves unrelated edits. The installed-copy replay again retains
all 50 decisions/evidence, the complete CRM digest and every account control.

Existing accounts remain paused and exact holds remain intact. No proxy is
currently bound. The final proxy/profile combination needs its own network,
clock, identity and diagnostic checks, then the applicable review/recovery and
explicit account-start rules. Anonymous diagnostic evidence cannot approve a
real account, clear John's restriction, re-arm an experiment, or create a
replacement LinkedIn account.
