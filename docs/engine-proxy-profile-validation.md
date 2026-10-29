# Proxy-bound profile validation — 29 October 2026

**The new blank profile is not cleared for account use.** Its proxy connection
and clock pass, but Fingerprint reports browser modification in both the full
battery and an unchanged focused repeat. The earlier anonymous native-readback
passes are retained; they do not establish that every new profile will pass.

The user authorized testing a purchased proxy and creating one profile if the
combined preliminary evidence supported a controlled test. Historical spam
records and provider-wide risk scores are advisory rather than automatic
rejection. Missing reputation reports remain UNKNOWN. Proxy recognition alone
is expected for this product and does not establish current abuse.

## Connection and provisioning

The supplied endpoint rejects authenticated HTTP with status 407. SOCKS5 with
the same supplied login works. Three independent HTTPS checks observe the same
US exit, with valid TLS. Credentials are saved only in AliasMode; none is in
source, command-line arguments or this report. The proxy address, profile ID,
private credentials and raw evidence stay in the private manifests.

One fresh AliasMode Chromium profile was created through the official Local API
with the SOCKS5 proxy configured. The official CLI applied and confirmed the
native-readback opt-in before the first launch. No existing profile was migrated.
Provider creation/proxy fixtures passed 35 tests before browser validation.

The actual saved browser profile independently reached all three HTTPS check
endpoints through the expected exit. The observed country and
`America/New_York` timezone match. Date and Intl offsets both pass the current
IANA reference. A subsequent launch confirms `--fingerprint-noise` is absent;
no clock workaround is present.

## Published browser findings

| Finding | Full seven-endpoint battery | Unchanged two-endpoint repeat |
| --- | --- | --- |
| DeviceAndBrowserInfo bot result | FAIL | PASS |
| Main/worker CDP flags | Both true | Both false |
| Other 20 DeviceAndBrowserInfo flags | All false | All false |
| Fingerprint Bot field | Not detected | Not detected |
| Fingerprint browser modification | Yes | Yes |
| Local admission | FAIL | FAIL |
| Network/clock checks | Passed | Passed |

The full raw battery has five passing endpoints and two failures: the retained
source-verified legacy Incolumitas property check and DeviceAndBrowserInfo.
Fingerprint's separate modification warning also blocks local admission despite
its raw Bot-field PASS. The focused repeat has two raw PASS results, but its
local verdict remains FAIL because modification persists. It is not relabeled
as a complete passing battery.

BrowserScan and CreepJS remain direct-probe contexts, and TLS remains a
capture/coherence check. Sannysoft completes successfully in the full pass. The
first automation finding is retained even though it does not recur on repeat.
The cause of the new modification finding is not established; replacing the
proxy or changing more browser identity settings is not a verified remedy.

## State and evidence

The new profile is retained and confirmed closed. It has no LinkedIn sign-in and
was not imported as a real CompelOS account. Public browser validation used a
separate isolated PostgreSQL diagnostic lease; LinkedIn/LICDN requests were
blocked. No account processing was enabled and all existing account controls,
evidence and exact holds match the before snapshot. No detector verdict was
changed to admit this result.

Private PostgreSQL reports:

- Full validation: `proxy-profile-3d5ecfcd-da2b-4ca9-8972-602ea7beb8e7`.
- Focused repeat: `proxy-profile-8b0c3b1b-fbc4-4fdb-8eb1-10cad6c6227b`.

Redacted connection results, raw diagnostics and confirmed launch flags remain
under ignored `data/engine-v2/proxy-assessment-20261029/`. A development attempt
to compile the repeat harness failed before launching a browser; it is retained
separately and is not counted as an executed test.
