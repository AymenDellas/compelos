# Diagnostic readers and timezone evidence — 29 October 2026

The user requested the remaining local repairs before buying a proxy and configuring fresh profiles. The earlier anonymous browser comparisons are retained in [the follow-up report](engine-detector-followup.md).

## Repairs

The regular Incolumitas reader required two obsolete field names and consequently missed the current nine-field checklist. It now accepts either complete known schema, waits for the legacy scanner when that panel exists, and retains all published static statuses. A literal legacy FAIL reaches the existing failure assessment. The behavioral score stays explicitly unavailable when the remote test does not finish; no score is invented.

Sannysoft previously read only six primary cells. It now reads all 11 primary cells and the 20 scanner rows when the actual scanner panel exists. A pending scanner cannot yield a complete pass, and a known primary-table failure survives while the scanner is pending. Older six-cell fixtures remain supported when they do not contain the scanner panel.

Fingerprint's Bot-field assessment is unchanged. Browser tampering, the website's VPN warning, developer-tools output and suspect score are retained as separate published observations. The dashboard displays those observations and a visible count of published warnings, alongside each website result. A Bot-field PASS no longer hides its other fields in the dashboard summary.

The diagnostic probe now records the browser's actual current timezone offset in addition to its timezone name. Frozen fingerprint/hash fields are unchanged. No clock, timezone, browser property, proxy, TLS or provider setting is changed by this observation.

Network preflight now verifies the actual offset against the configured timezone's current daylight-saving rules. A matching name with the wrong clock fails; a missing offset stays UNKNOWN. The dashboard displays the reason. Repeating preflight also retains the previous gate report instead of erasing it after the first retry. This validates configuration and does not repair a browser-core clock implementation.

Reports are versioned `DIRECT_SIGNALS_V3`. The evidence key includes this version, so evidence captured by older readers cannot authorize the updated setup. Existing reports, account controls, holds, browser identity and recovery history remain stored unchanged; fresh checks are required. A configuration save or installation still cannot start accounts.

The direct-signal assessment, site-result combination and TLS assessment functions are unchanged. Completed vendor statuses now reach those existing rules. No failure is relabeled PASS and no compatibility exception is enabled.

## Why a VPN warning can appear without a VPN

In the preceding saved test, Windows/browser timezone was `Africa/Casablanca` while Fingerprint placed the public connection in Algeria, with timezone `Africa/Algiers`. Its additional fields reported `proxy=false`, `public_vpn=false`, `ml_prediction=false`, low VPN confidence and a timezone mismatch. This is a location disagreement, not proof that the user enabled a proxy or VPN. IP-location databases and provider routing can produce this disagreement.

Fingerprint documents that its country-specific timezone comparison can flag two locations even when their UTC offsets agree. Low-confidence cases can reflect a provider registered in, or routing through, a different location. [Vendor reference](https://docs.fingerprint.com/docs/smart-signals-reference#vpn-methods).

Do not change the Windows clock merely to satisfy an internet-location estimate. The intended future AliasMode profile must be configured against its actual chosen proxy and verified in that exact setup. These repairs do not verify a proxy that has not been configured.

## Offline verification

| Check | Result |
| --- | --- |
| Complete engine/prospect/coach run | 464 passed, 0 failed, 0 skipped |
| Final reader/admission/ownership/browser/clock checks | 26 passed, 0 failed, 0 skipped |
| PostgreSQL CRM suite | 14 passed, 0 failed, 0 skipped |
| TypeScript | Passed; final production build also passed its typecheck |
| Scoped ESLint | Passed |
| Workspace lint | Existing 6 errors and 4 warnings in untouched UI files |
| Final production build | Passed |
| Build privacy verification | 45 manifests; 0 private runtime entries |
| Stored-evidence replay | 50 records; 0 decision changes, 0 evidence changes, 0 errors |
| Saved account controls and full CRM digest | Unchanged |

The full 464-case run preceded the final legacy-status propagation, version-binding and clock-validation additions. Those final changes are covered by the 26-case affected-suite run, including real browser fixtures and PostgreSQL approval/ownership/preflight cases. The final production build follows those changes. Tests do not visit authenticated LinkedIn.

The new negative fixtures require a literal legacy FAIL to reach the normal failure assessment, a failure in Sannysoft's second table to survive green primary cells, missing/unfinished fields to remain unavailable, and tampering/VPN warnings to survive a separate Bot-field PASS. Old saved keys cannot admit the new reader version, and none of these checks clears an exact account hold.

Before editing behavior, 50 already-decided records and account controls were frozen under ignored `data/engine-v2/diagnostic-readers-20261029/`. PostgreSQL regression manifest: `session-control-20261029-9628e5cc-873a-40d2-ab2c-32a3b659e42b`. Baseline, reader and version-binding phases replay unchanged. Private logs and full lead evidence stay ignored.

No authenticated LinkedIn validation, account start, hold clearing, proxy purchase, stealth injection, browser-library change or profile migration is part of this repair.

## Fresh measurements and unresolved provider findings

**No all-clear.** The local reader/preflight defects are repaired; a clock fault and recurring browser-tampering finding remain in the provider measurements. No compatibility exception was enabled, and the old test's literal failure remains blocking.

| Anonymous setup | Browser clock for Casablanca | DeviceAndBrowserInfo | Fingerprint browser tampering |
| --- | --- | --- | --- |
| Old Page control, AliasMode Chromium 155, profile A | UTC+0; expected UTC+1 | FAIL; main/worker CDP and overall bot flags | Not detected |
| Updated control, same profile A | UTC+0; expected UTC+1 | PASS; all 23 flags false | Not detected |
| Updated control, fresh AliasMode profile B | UTC+0; expected UTC+1 | PASS; all 23 flags false | Detected |
| Same profile B after native timezone correction trial | UTC+0; expected UTC+1 | PASS; all 23 flags false | Detected |
| Updated control, fresh CloakBrowser 146 through AliasMode | UTC+1; matches Windows/reference | PASS; all 23 flags false | Detected |

The old/updated full V3 measurement used Chrome/155.0.8059.85 and confirms all other 20 DeviceAndBrowserInfo flags, browser identity/version and direct device checks unchanged. Both completed Sannysoft with all 31 primary/scanner checks clear. Incolumitas now reports its literal `legacy.fpscanner.WEBDRIVER` failure through the regular reader, rather than losing it to the obsolete field-name requirement. The updated regular battery is FAIL, with six passing endpoint checks and one failed endpoint. BrowserScan and CreepJS in this regular battery remain direct-probe contexts; their earlier actual UI results are in the linked historical report. These six passes are not six universal human verdicts.

The additional clock trial confirms that Chromium's native `Emulation.setTimezoneOverride`, using the same declared Casablanca zone, did not correct this AliasMode core's observed offset. No such override was added to the production controller. Its Fingerprint tampering result remained positive before and after; the Bot field was separately Not detected. This is a failed correction attempt, not a successful repair.

The supported CloakBrowser core, Chrome/146.0.7680.177, reports the correct current clock and all 23 flags false in this focused trial. Fingerprint still reports browser tampering. This is not an all-pass replacement recommendation or an account-engine migration. The trial covers clock consistency and two vendor pages, not a complete seven-endpoint comparison.

The installed AliasMode Cloud API returned HTTP 503 for its native profile-editor route, so the attempted profile-setting study measured no scenarios and changed no settings. Only a new unmapped diagnostic profile was involved; it was confirmed closed/deleted. No unsupported endpoint, saved credential or provider binary was modified to bypass this limitation.

The extra free network lookup in the V3 measurement returned no usable location fields. It supplies no successful fresh network-preflight evidence. The earlier saved Fingerprint country/timezone disagreement remains documented separately; the user reports no proxy or VPN in use, and the website's low-confidence warning does not establish either.

Buying a proxy does not repair the observed browser-core clock behavior or the recurring tampering result. The provider issue needs a supported configuration or provider repair demonstrated by new measurements. The exact future proxy/profile combination is still untested, and existing account holds remain in force.

## Measurement records

| Measurement | PostgreSQL report |
| --- | --- |
| Regular old/updated V3 battery | `context-comparison-7c67c6f4-2b17-4069-a341-d059a07bc648` |
| Native clock correction, before/after | `context-comparison-5caa7619-125c-4ea6-8e57-0dc2fcc35b0e` |
| Focused supported CloakBrowser core | `context-comparison-72aac799-e40c-4a12-af67-9c7eefe2ff20` |
| Unavailable Cloud profile editor | `clock-editor-unavailable-f92a48f5-cb84-4911-93d4-fe9cd97e5162` |
| Interpreted follow-up | `reader-clock-followup-48243ad8-fce4-480f-8a19-2e1fd5ec542a` |

All four studies confirm unchanged saved account controls and restoration of the original AliasMode roster. Only their newly created unmapped diagnostic profiles were closed/deleted through the official CLI. The stored-evidence replay after clock validation again shows 50 records, zero decision/evidence changes/errors, unchanged account controls and unchanged full CRM digest. No authenticated LinkedIn page was opened.
