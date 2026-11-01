# Native AliasMode Firefox integration — 1 November 2026

The user authorized integration after the earlier test-only trial. Firefox can
be linked through AliasMode's existing native Playwright transport; it does not
require CDP. New profiles now default to Firefox. Existing accounts keep their
saved engine, identity, proxy binding, evidence and processing intent.

The [published provider repair](../provider/aliasmode-firefox-control/README.md)
exposes the Firefox worker's existing connection safely. CompelOS validates
the exact native client/core, profile, PID, generation and actual launch mode,
then adapts its native page events and operations to the existing readers.
AliasMode owns profiles, cookies, proxies and browser lifecycle. No new browser
package, credential copy, fallback browser or injected stealth script is added.

Fresh controlled profiles start blank even after a restart. Saved sign-in data
is retained, while restored tabs and platform home pages cannot bypass the
existing atomic profile reservation. Closed legacy Firefox profiles lacking
these controls fail before launch. PostgreSQL ownership, one sequential tab per
account, daily allowance, spacing, recovery, reactive stops and manual holds
continue to apply. Chromium keeps both Puppeteer target filters and its
documented Runtime.enable requirement.

Firefox identity baselines additionally freeze actual canvas, WebGL, audio and
font hashes at the existing secure identity origin. Encoded PNG metadata is
recorded separately and does not define pixel identity. Two fresh profiles in
the installed-browser fixture had different canvas pixels, WebGL and fonts;
each was stable over two visible launches. Reconnect, cookie persistence,
blank startup, native same-origin navigation headers, bounded waits/dwell,
security events and the unchanged synthetic Voyager profile/activity/contact
reader passed. No authenticated LinkedIn request was made.

Changing visible/hidden mode changed canvas readback in an earlier fixture.
That failure is retained. Identity evidence includes the mode, so this does not
silently reuse a visible-mode baseline for hidden processing. The fixture's
first reconnect harness also retained a retired context object; that failed
measurement is saved separately from the corrected run. Earlier isolated-world
binary read failures and the prior provider test failure remain archived.

Raw diagnostic verdicts remain unchanged. Firefox lacks a Chrome-only object;
the local Firefox interpretation recognizes only the pinned, complete matching
case, retaining its raw FAIL and all other website warnings. A positive
automation flag, browser modification, extra scanner failure or bad TLS still
fails. An incomplete required endpoint remains UNKNOWN and cannot become an
automated PASS. Configuration and diagnostic review never start processing.

Validation and the final anonymous public measurements are recorded in the
[sanitized receipt](engine-firefox-native-receipt.json). All four public runs
cleared all 23 automation flags, Bot and Browser tampering, and the New York
Date/Intl clock checks. Seven endpoints returned HTTP 200 each time. The raw
counts remain one PASS/six FAIL because six direct contexts expect a Chrome
object; Sannysoft separately retains its one literal Chrome-only cell failure.
The incomplete Incolumitas checklist remains UNKNOWN. TLS integrity and browser
identity agreement pass; the local TLS interpretation was corrected to avoid
requiring a console challenge that its collector deliberately does not run.

**Account separation is not fully resolved:** Fingerprint assigned both new
profiles the same published visitor ID in this direct-connection run, despite
their different sampled rendering. The prior proxy-bound MCP trial had different
visitor IDs. These studies differ in connection, generated profiles and transport;
they do not isolate a cause. No proxy-country alignment was measured in this
run, and no account go-ahead is issued. Do not label this outcome fully fixed or
universally unlinkable.

| Setup | Sampled rendering | Bot/modification | Published visitor IDs |
| --- | --- | --- | --- |
| Previous Chromium native host setup | Shared host traits | Clear in its recorded confirmations | Separation not established |
| Previous Firefox MCP proxy trial | Stable and distinct | Clear, four runs | Distinct, four runs |
| Integrated Firefox native transport, direct connection | Stable and distinct | Clear, four runs | Same across both profiles — separation FAIL |

The engine suite passed 516 tests, CRM passed 14, and the provider passed 726
with two platform skips. Subsequent affected native/diagnostic tests passed 20
and supervisor tests passed 11. Types, the production build and changed-file
lint passed. Whole-repository lint still reports six errors/four warnings in
unchanged copy-studio components. All 92 deployment traces exclude private
runtime assets. The initial build failure from bundling a desktop-only native
dependency is retained; the final build uses Node's installed-module loader.

Private raw reports and the 50-record stored-CRM
replay are kept under ignored `data/engine-v2/` and archived in PostgreSQL.
Passing sampled diagnostics cannot prove universal unlinkability or establish
the cause of LinkedIn identity verification. There is no automatic replacement
account, hold clearing, or account go-ahead in this change.
