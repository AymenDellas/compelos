# Native AliasMode identity repair — 30 October 2026

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

Managed-profile confirmation and the final verification receipt are recorded
below only after completion. No LinkedIn navigation, sign-in or account processing
is part of this repair's validation.
