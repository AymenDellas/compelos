# Native AliasMode identity repair — 30 October 2026

**Later separation investigation:** the [profile separation and Firefox trial](engine-profile-separation.md)
confirms that this active native-host mode shares device characteristics. The
successful observations below have single-profile diagnostic scope; they do not
clear a fleet of independent account identities. The user kept Firefox as testing
only, so no runtime migration or general account go-ahead follows from that trial.

This report supersedes the remaining-provider status in the 29 October
[repeatability investigation](engine-profile-repeatability.md). Those old failed,
partial and successful observations remain recorded. No old report is relabeled.

## What changed

The earlier patch removed image readback noise but retained generated hardware
composition. Fingerprint's published details on the retained proxy profile showed
an anomaly score of zero and anti-detect-browser recognition enabled; its Bot
field separately said Not detected. This explains why a clear Bot field did not
clear the modification warning. The gate still treats modification as a failure.

The new provider mode uses the browser core's native host identity. It removes
generated hardware flags instead of searching for a passing seed. Windows native
mode rejects the composable timezone switch, so the provider applies Chromium's
native timezone setting through a bounded connection before opening a page.
Page, cross-process frame and worker first-script fixtures check both Date and
Intl offsets. No page script, Runtime subscription, navigator override, stealth
library or browser binary modification is introduced.

New profiles created through normal AliasMode GUI, API and CLI paths select this
mode. Existing profiles are not migrated. The sole retained, unbound blank proxy
profile is explicitly selected while closed. Profile/cookie/proxy ownership stays
with AliasMode. The running manager confirms the configuration and clock for the
actual worker tab. Lost clock control stops only that profile; stale callbacks
cannot stop a replacement instance. Blank startup preserves saved cookies and
storage while keeping account documents from running before clock preparation.

Native identity exposes this machine's real hardware. Profiles can share those
characteristics; this does not provide unlinkability or permanent invisibility.
Changing hardware requires a fresh identity review. Existing account holds,
paused processing, unique proxy references, owner leases and identity checks
remain in force. Clock/provider evidence is versioned so stale reports cannot
authorize the changed configuration.

The complete [source patch, license and reproducible build](../provider/aliasmode-native-identity/README.md)
are published. The installed change replaces only the manager sidecar. The GUI,
official thin helper, Chromium executable/DLL, profile directories and locks are
unchanged. Both the vendor binary and the previous local sidecar are backed up.
Vendor updates require capability validation and a separately verified rebuild.

## Evidence boundaries

Three native reference batteries through the purchased proxy completed with
local admission PASS, raw 6 PASS / 1 FAIL / 0 UNKNOWN, clear Bot/modification
fields and all 23 DeviceAndBrowserInfo flags false. One used the actual corrected
clock watcher. These reference browsers do not certify a saved managed profile.

Development failures are retained: unsupported proxy URL formatting, terminated
worker requests and a paused-service-worker command deadlock. The repair retires
only requests for a confirmed detached target. Living-target timeouts still fail.
For a paused worker, the native timezone command is queued before resuming startup
and then awaited; first-script fixtures verify that ordering's actual effect.
No failure is removed or called a pass.

The seven-endpoint battery and admission policy are unchanged. The exact verified
legacy Incolumitas property-presence failure remains a raw FAIL under the existing
compatibility finding. Direct-probe and TLS-integrity results retain their stated
scope; they are not seven independent universal human verdicts. Public diagnostic
results cannot predict LinkedIn's decisions.

## Actual managed-profile confirmation

The predeclared study completed **three distinct profiles, two independent
restarts each**, including the retained purchased-proxy profile and two newly
created profiles. All six launches used the production CompelOS adapter and
the installed AliasMode manager, rather than the reference browser helper.
The unchanged repeatability assessor returns PASS with no findings. Both fresh
profiles selected host identity automatically through normal API creation.

| Configuration and profile | Local admission, both restarts | Automation flags | Bot / modification | Required results |
| --- | --- | --- | --- | --- |
| Previous readback-only, retained proxy profile | FAIL / FAIL | All 23 false | Not detected / Yes | Complete |
| Previous readback-only, first fresh profile | FAIL / FAIL | All 23 false | Not detected / Yes | Sannysoft timed out |
| Previous readback-only, second fresh profile | UNKNOWN / UNKNOWN | All 23 false | Both Not detected | Sannysoft timed out |
| Updated host identity, retained proxy profile | PASS / PASS | All 23 false | Both Not detected | Complete |
| Updated host identity, first fresh profile | PASS / PASS | All 23 false | Both Not detected | Complete |
| Updated host identity, second fresh profile | PASS / PASS | All 23 false | Both Not detected | Complete |

Every updated launch has raw **6 PASS / 1 FAIL / 0 UNKNOWN**, seven passing diagnostic
page clock contexts with independent Date/Intl offsets, the expected purchased exit IP and
the verified native provider metadata. The sole raw failure is the exact legacy
Incolumitas check described above. No detector or admission logic changed during
this repair. The historical positive automation finding remains recorded; these
negative observations do not establish its original cause or guarantee it can
never recur.

The old fresh-profile studies used the workstation's direct connection, on which
Sannysoft timed out. The new fixtures used the retained proxy profile's
provider-owned loopback relay. Thus the network-path improvement is separate
from the identity repair. No proxy credential was read, exported or duplicated.
The retained profile's own before/after modification observations use the same
purchased proxy. Temporary loopback references were diagnostic-only and were
removed with their newly created profiles after confirmed closure through the
official CLI. The original profile is retained closed and unmapped. Every actual
account's controls, evidence and exact hold are unchanged. No LinkedIn navigation,
sign-in or account processing occurred.

The retained blank profile is ready for supervised manual account setup and
testing. Existing restricted or held accounts remain paused. Account identity
verification, its own saved network/identity/diagnostic evidence, recovery and
warmup rules, and explicit Start remain required before unattended processing.
This diagnostic study cannot serve as a processing permit for another account.

Private PostgreSQL receipt: `managed-native-ed779c37-cb73-4689-a9eb-d4f1d2c535cb`.
The raw studies, failed development runs, exact profile identifiers and network
details remain under ignored `data/engine-v2/profile-diagnosis-20261030/`.

## Software and state verification

- Engine/workers/prospects/coach suite: **494 passed, zero failed or skipped**,
  with the workstation database configuration loaded and isolated fixture schemas.
- CRM PostgreSQL suite: **14 passed, zero failed or skipped**.
- Provider suite: **546 passed, two existing platform checks skipped, zero failed**;
  the final proxy-flag correction reran its launcher file: **199 passed, two skipped**.
- Root and provider type checks pass. Changed-file lint passes. Whole-tree lint
  retains the unrelated pre-existing **six errors and four warnings** in UI files.
- Real-browser local fixtures verify first-script page/frame/worker clocks and
  persisted service-worker restart behavior. The public clock fixture also verifies
  that the guardian sends no Runtime subscription/evaluation or injected-script call.
- The complete source patch applies cleanly to the pinned upstream commit. The
  [build receipt](../provider/aliasmode-native-identity/build-receipt.json) records
  the installed binary and unchanged GUI/helper/browser-core hashes.
- A fresh frozen **50-record** qualification replay has zero decision changes,
  zero evidence changes and zero errors. The full CRM digest and account controls
  match the before snapshot after the adapter and live confirmation phases.

The first broad test invocation lacked the database connection and recorded 36
connection failures. Its output is retained. The corrected invocation above
loads the existing runtime configuration without printing or changing secrets.
An initial CRM invocation skipped its two opt-in PostgreSQL tests; the final
invocation explicitly enabled them, producing the complete 14-pass result.
