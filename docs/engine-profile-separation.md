# Profile separation and Firefox trial — 30 October 2026

**Decision: testing only.** After the anonymous Firefox trial, the user explicitly
chose to keep it as testing only. CompelOS still uses the installed AliasMode
Chromium adapter. No Firefox integration, new default, account migration,
detector exception or account go-ahead is enabled by this study.

The preceding [native identity repair](engine-native-identity.md) cleared the
measured bot/modification findings for its sampled Chromium profiles. It also
exposes the host's shared hardware and rendering characteristics. That is a real
linkage surface; the repair did not establish independent device identities.
Its single-profile results must not be read as multi-account separation.

## Comparison

| Setup | Measured separation | Bot / modification evidence | Status |
| --- | --- | --- | --- |
| Installed Chromium host identity | Shared host hardware and rendering | Previous six managed launches: all 23 automation flags false; Bot and modification both Not detected | Active implementation; shared-device issue unresolved |
| Chromium generated hardware, native readback | Hardware labels differ; sampled canvas, WebGL, audio and font output still shared | Earlier profile-dependent modification findings remain recorded | Insufficient separation; not adopted as a repair |
| Chromium generated hardware with native readback noise | Sampled rendering differs and repeats within each fixed identity | Four new reference launches: modification Yes in all four, Bot Not detected | Fails the unchanged modification gate; not installed |
| AliasMode Firefox, two profiles restarted twice each, US proxy | Actual canvas pixels, WebGL, font measurements and composite stable within each profile and different across profiles; published visitor IDs also stable and distinct | All four: 23 automation flags false, Bot and modification both Not detected; US clocks pass | Promising anonymous trial; testing only; existing gate remains FAIL |

The Chromium local comparison completed ten launches: one host configuration and
two fixed generated configurations, each with noise off/on, restarted twice.
The four noise-enabled public reference runs used those already selected
identities. Identities were not regenerated until a passing result appeared.
These reference launches are distinct from the preceding six managed-profile
confirmations. Different network paths and browser families prevent attributing
every external difference to one setting.

AliasMode beta.70 uses the same Windows Chromium `.4` build as the tested
beta.69 installation, so a manager version bump alone does not supply a different
core. The engine's own [identity documentation](https://github.com/aliasmode/aliasmode-chromium/blob/8aa0a24c0638ed926f8c12f9bb1350d97cbf75aa/docs/concepts/seeds-and-identity.mdx)
and [known gaps](https://github.com/aliasmode/aliasmode-chromium/blob/8aa0a24c0638ed926f8c12f9bb1350d97cbf75aa/docs/known-gaps.mdx)
describe the limits of host identity, seed-only composition and noise. Those
documents describe source commit `8aa0a24c`; the tested released Windows core
remains `155.0.8059.85-aliasmode.4`.

## Firefox confirmation: successes and remaining findings

The final managed trial used two newly created, anonymous AliasMode Firefox
profiles and two independent browser restarts per profile. The installed core is
`156.0.1-beta.36-r11`, executable SHA-256
`cf60060ac7664bdf954353a18f358d7f251b68272119a5b3a6d3f11abd8bbb4f`.
The official manager and its existing Firefox MCP controls managed all four
launches. No new browser library or page-global spoofing was installed.

Both profiles used the same purchased US egress through an existing
provider-owned loopback relay. Credentials remained in AliasMode. Temporary
references contained no username/password. The externally open retained Chromium
browser was not attached, inspected, changed, closed or adopted. Browser-routed
IPify and IPWho checks agreed on the exit; IPWho reported US and
`America/New_York` in all four confirmations.

| Observation | All four proxy-bound launches |
| --- | --- |
| Independent Date / Intl clock offsets | Both 240 minutes west of UTC, matching pinned IANA tzdb 2026f |
| Clocks on the seven diagnostic page contexts | Seven PASS per launch |
| DeviceAndBrowserInfo | All 23 boolean flags false, including both CDP flags and `isBot` |
| Fingerprint Bot | Not detected |
| Fingerprint Browser tampering | Not detected |
| Fingerprint VPN warning | **Still present: public VPN IP / OS mismatch** |
| Fingerprint suspect score | **12**, not zero |
| Published visitor ID | Stable across restarts within each profile; different between the two profiles despite the shared proxy |
| Endpoint responses | All seven HTTP 200 |
| Unchanged Chrome-oriented raw aggregate | **1 PASS / 6 FAIL / 0 UNKNOWN** per launch |
| Unchanged local admission | **FAIL** per launch |

The six raw failures contain the direct check named `chrome`: Firefox does not
provide the Chrome-specific object. This explains the observation without adding
a detector exception. Sannysoft completes all 31 cells: 30 pass and its
Chrome-object cell fails. Its literal failure remains visible. Incolumitas's
supported published checklist does not complete on Firefox and remains
**UNKNOWN**. BrowserScan and CreepJS also have no supported published verdict in
this collector; their direct-context results must not be represented as website
human verdicts. TLS capture integrity passes. Zero UNKNOWN in the aggregate
does **not** mean every website published a supported verdict.

The unchanged battery's metadata labels its controller `CDP`, because it was
written for Chromium. The Firefox harness separately records the actual
`ALIASMODE_FIREFOX_MCP` transport. This metadata mismatch is disclosed, not used
as evidence that Firefox was controlled through CDP. The test bridge lacks the
production adapter's complete event, ownership and reactive-stop contract; it is
not an account-processing replacement.

## Measurement corrections and partial runs

The readback fixture draws a complete canvas image and a WebGL shader, reads
their full pixel buffers, renders an audio sample and measures several fonts.
On Firefox it runs as a normal script in its own locally served fixture page;
the controller reads the completed DOM result. An initial sandbox-only typed
array access failed through Firefox's Xray wrappers. That instrumentation failure
is retained and is not called a browser failure or a passing measurement.

The first collector hashed the PNG encoding. Firefox's PNG session metadata
changed between restarts, initially suggesting canvas drift. Decoding the saved
PNG IDAT buffers showed identical pixels within each reference profile and
different pixels across profiles; the differing chunk was the 16-byte `deBG`
metadata. The final `RENDERED_READBACK_V2` collector hashes the actual pixel
arrays and records the encoding hash separately. V1 and V2 hashes are not
compared. The [upstream persistence discussion](https://github.com/daijro/camoufox/issues/442)
also cautions that forcing nonstandard persistence can change ordinary Firefox
behavior. The final managed trial uses default privacy preferences; the two
reference-only preference experiments were not installed or adopted.

All unsuccessful and incomplete attempts remain in the evidence inventory:

- The first Chromium proxy attempt refused an externally open profile and ran
  zero tests. Its manifest is corrected to `DIAGNOSTIC_PARTIAL`; the error remains.
- Firefox discovery closed its temporary profile successfully; close had already
  moved it to Trash, so a redundant delete returned an error. The raw error is
  retained. A separate check confirms the profile is absent from the active
  roster and unmapped to an account.
- Three early local fixture attempts failed during route-guard or sandbox
  instrumentation. A reference harness also stopped after mistakenly treating
  an awaited void-returning close operation as a false result. None is counted
  as a complete four-run confirmation.
- Four unproxied Firefox launches really fail the **Casablanca clock** check:
  Date and Intl report UTC+1 while the current IANA reference expects UTC+0.
  The later New York proxy-clock passes do not repair or relabel this failure.
  All four unproxied Sannysoft navigations time out; two CreepJS reads also
  encounter a transient provider-running-state error. Their partial results stay
  recorded.
- The first Firefox proxy attempt stops before the battery because IPAPI returns
  an IP without country/timezone fields. Its initial wording about differing
  geography was imprecise: this was missing evidence, not a confirmed bad proxy.
  The separate final trial uses IPWho with its
  [documented country/timezone fields](https://ipwhois.io/documentation).
- The four Chromium noise-enabled reference runs retain their modification
  failures and the first run's Sannysoft timeout.

No failed verdict is converted to PASS. Database `DIAGNOSTIC_COMPLETE` describes
execution completeness, not successful admission. This distinction also applies
to a completed run containing an external failure or unsupported result.

## Evidence and operational boundary

The [sanitized receipt](measurements/profile-separation-20261030.json) lists all
15 raw-study hashes, execution states and the final four-run measurements.
Private full reports, local harnesses, fixture PNGs and source checkouts remain
under ignored `data/engine-v2/profile-separation-20261030/`. PostgreSQL stores
every raw study with separate audit annotations. The final confirmation ID is
`firefox-public-proxy-4666577f-0c8b-451c-9d95-1b1d9a8c915b`; derived summary ID is
`profile-separation-summary-20261030`.

Four offline assertions pass: strict tool-result parsing, correct profile/status
targeting, a LinkedIn/LICDN-blocking route guard exercised without a sandbox URL
global, and a pixel test distinguishing PNG-metadata changes from pixel changes.
Offline packaging also verifies every stated final-run result and comparison
directly against the saved evidence. These checks do not change runtime behavior.

The before-study snapshot contains 50 decided records under PostgreSQL manifest
`session-control-20261029-880c60f2-27a5-4d01-a437-4558ed953a37`. Final stored-evidence
replay has zero decision changes, evidence changes or errors. Account controls,
exact holds and the complete CRM digest remain unchanged. New anonymous managed
Firefox fixtures were confirmed closed and removed through official controls;
the original active profile roster is restored. No LinkedIn navigation, account
sign-in, account creation or processing was performed.

**The active Chromium setup still has shared-device characteristics. Firefox
has not been integrated or approved for account processing.** Separation in two
profiles and two restarts is a limited diagnostic result, not proof that sites
cannot link accounts or that future account operations will be accepted. The
remaining Chromium issue needs a provider-level repair with repeatable evidence;
the prepared [provider request](../provider/aliasmode-native-readback/repair-request.md)
has been updated but not sent.
