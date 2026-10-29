# Clock reference correction — 29 October 2026

**Clock verification passes in the unchanged AliasMode browser.** The preceding diagnosis was wrong: our reference used outdated host timezone rules and incorrectly required Casablanca to be UTC+1. The current IANA rules put it at UTC+0 from 20 September 2026. AliasMode already reports that correct value through Date, Intl and an unattached worker.

The user requested the clock issue alone be repaired while keeping AliasMode and leaving the modification warning for later. This change repairs the reference, preserves the actual readings and leaves that second issue unchanged. It is not an all-clear for account operation.

## Cause and correction

IANA's Africa source records Morocco's move from UTC+1 to UTC+0 on **20 September 2026 at 02:00 local time**, equivalent to 01:00 UTC. [IANA source](https://data.iana.org/time-zones/tzdb/africa). The inspected current release is 2026f. [IANA release notes](https://data.iana.org/time-zones/tzdb/NEWS).

The local Node 22.14.0 runtime carries ICU 76.1 / tzdb **2024b**. Its Intl reference still returns UTC+1. Windows and the stock Chromium 146 reference also returned the old offset; their agreement was not an authoritative reference. AliasMode's installed ICU data carries **2026c**, which already includes the Moroccan change.

`clock-reference.cjs` now reads the full packaged IANA database from exact-pinned `moment-timezone@0.6.6`, data version **2026f**. It performs no network lookup at runtime and has no Casablanca-specific offset exception. The same reference covers other zones, DST transitions and fractional offsets. [Library data provenance](https://momentjs.com/timezone/guides/#/data-and-calculations/data-source/), [offset API](https://momentjs.com/timezone/docs/#/zone-object/offset/).

Both observed clock offsets must still match the configured timezone and current rules. A mismatch in either remains FAIL; missing readings or unknown reference data remain UNKNOWN. The source version is recorded with the clock result and bound into the evidence key, so an approval captured against the outdated reference cannot authorize this setup. Prior evidence and exact holds remain stored.

This is server-side reference data only. The browser, Puppeteer, controller, browser properties, image-noise setting, proxy configuration and profile identities are unchanged. No clock override or replacement browser core was installed.

## Managed before/after evidence

After the focused fixtures passed, one new blank AliasMode Chromium profile was opened through the official CLI and attached through the normal production controller. Both assessments below use **the same raw probe from that unchanged browser**:

| Clock observation | Previous host reference | Corrected IANA reference |
| --- | --- | --- |
| Browser timezone | Africa/Casablanca | Africa/Casablanca |
| Observed Date offset | UTC+0 | UTC+0 |
| Observed Intl offset | UTC+0 | UTC+0 |
| Expected offset | UTC+1, stale tzdb 2024b | UTC+0, tzdb 2026f |
| Clock verification | FAIL, erroneous expectation | **PASS** |

The exact previous clock function was loaded from commit `efe5d10` for this comparison; the raw observations were not edited. Seven predetermined instants were checked on the main page and in a dedicated unattached worker: both sides of the February Ramadan change, March restoration and September policy change, plus the current time. **All 14 native clock samples match the updated reference.**

The managed launch still has `--fingerprint-noise` and has no `--no-icu-timezone-data` workaround. Thus the separate modification-warning feature is unchanged. Its vendor detector was not rerun as part of this clock-only verification.

Installed file hashes before and during managed validation are unchanged:

| File | SHA-256 |
| --- | --- |
| `chrome.exe` | `0ef4de1bef7c12534031318e07ac89fa7942916a3abc89057985aafefbca619f` |
| `chrome.dll` | `a8cdf152a1748f5d21d5c9ef20f8f591041fa91a026ec7f1d3a1968175031be4` |
| `icudtl.dat` | `495c45cc7a65562ec461f860c310c6b66e006acd96833f61d1aa31f77fe18cf1` |

The earlier Date-only workaround is still rejected, for the corrected reason: it makes Date follow stale Windows UTC+1 while Intl correctly stays at UTC+0. Likewise, a browser with both readings at stale UTC+1 now fails. This is not a blanket acceptance of matching clocks.

## Preserved state and unsuccessful attempts

The first managed attempt could not reach the Local API because AliasMode was closed. It created no profile. Starting the installed official application restored access, and the clock study then completed. No existing account profile was opened.

Before correcting the reference, an official ICU timezone-resource update was tried on an isolated copy of the browser. Of 2,360 resources, only three timezone resources changed; the fourth timezone resource was already identical. The candidate still returned UTC+0, which is correct under current rules. That copy and the downloaded tools remain ignored diagnostics. **Nothing from the candidate was installed in AliasMode.**

The temporary managed profile was confirmed closed and deleted through the official CLI after checking that it was new and unmapped. The original roster was restored, and actual account controls remained unchanged. There was no authenticated LinkedIn navigation, account start, hold clearing, browser migration, credential copy or paid usage.

The previous reports are retained as historical observations. Their claimed UTC+1 expectation is superseded by this correction. The image-noise finding in [the provider repair report](engine-provider-repair.md) remains unresolved. The legacy Incolumitas failure and earlier external findings are not reclassified here; neither the full vendor battery nor a future proxy/profile combination is cleared by this clock-only result.

## Verification and records

The focused 20-case run passes, including current-rule boundaries, split-clock failures, stale-reference invalidation and PostgreSQL preflight remaining paused after a correct clock result. The complete verification is:

| Check | Result |
| --- | --- |
| Full engine/prospect/coach suite | **472 passed, 0 failed, 0 skipped** |
| Focused clock/reference/ownership suite | 20 passed, 0 failed, 0 skipped |
| PostgreSQL CRM suite | 14 passed, 0 failed, 0 skipped |
| TypeScript | Passed |
| Scoped source lint | Passed |
| Whole workspace lint | Existing 6 errors and 4 warnings in untouched UI files |
| CLI-managed clock measurement | PASS; all 14 native main/worker samples match current rules |
| Stored-evidence replay | 50 records; 0 decision changes, 0 evidence changes, 0 errors |
| Actual account controls and full CRM digest | Unchanged |

The managed measurement runs separately from the software suites. These results establish the clock-only repair, not a full vendor-battery pass or readiness to operate accounts.

Before changing behavior, 50 decided CRM records were frozen with reasons/evidence. Private source copies, probes, test output and resource experiments remain under ignored `data/engine-v2/clock-repair-20261029/`.

| Record | PostgreSQL identifier |
| --- | --- |
| Fresh 50-record snapshot and replay manifest | `session-control-20261029-f6a57d37-2134-4808-b678-b563b7baff0d` |
| Successful CLI-managed clock-only measurement | `managed-clock-verification-9a77da55-3b96-4801-b9ed-ca30fe94cd5f` |
