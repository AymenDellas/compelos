# Diagnostic readers and timezone evidence — 29 October 2026

The user requested the remaining local repairs before buying a proxy and configuring fresh profiles. The earlier anonymous browser comparisons are retained in [the follow-up report](engine-detector-followup.md).

## Repairs

The regular Incolumitas reader required two obsolete field names and consequently missed the current nine-field checklist. It now accepts either complete known schema, waits for the legacy scanner when that panel exists, and retains all published static statuses. A literal legacy FAIL reaches the existing failure assessment. The behavioral score stays explicitly unavailable when the remote test does not finish; no score is invented.

Sannysoft previously read only six primary cells. It now reads all 11 primary cells and the 20 scanner rows when the actual scanner panel exists. A pending scanner cannot yield a complete pass, and a known primary-table failure survives while the scanner is pending. Older six-cell fixtures remain supported when they do not contain the scanner panel.

Fingerprint's Bot-field assessment is unchanged. Browser tampering, the website's VPN warning, developer-tools output and suspect score are retained as separate published observations. The dashboard displays those observations and a visible count of published warnings, alongside each website result. A Bot-field PASS no longer hides its other fields in the dashboard summary.

The diagnostic probe now records the browser's actual current timezone offset in addition to its timezone name. Frozen fingerprint/hash fields are unchanged. No clock, timezone, browser property, proxy, TLS or provider setting is changed by this observation.

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
| Final reader/admission/ownership/browser checks | 24 passed, 0 failed, 0 skipped |
| PostgreSQL CRM suite | 14 passed, 0 failed, 0 skipped |
| TypeScript | Passed; final production build also passed its typecheck |
| Scoped ESLint | Passed |
| Workspace lint | Existing 6 errors and 4 warnings in untouched UI files |
| Final production build | Passed |
| Build privacy verification | 45 manifests; 0 private runtime entries |
| Stored-evidence replay | 50 records; 0 decision changes, 0 evidence changes, 0 errors |
| Saved account controls and full CRM digest | Unchanged |

The full 464-case run preceded the final legacy-status propagation and version-binding additions. Those final changes are covered by the 24-case affected-suite run, including real browser fixtures and PostgreSQL approval/ownership cases. The final production build follows those changes. Tests do not visit authenticated LinkedIn.

The new negative fixtures require a literal legacy FAIL to reach the normal failure assessment, a failure in Sannysoft's second table to survive green primary cells, missing/unfinished fields to remain unavailable, and tampering/VPN warnings to survive a separate Bot-field PASS. Old saved keys cannot admit the new reader version, and none of these checks clears an exact account hold.

Before editing behavior, 50 already-decided records and account controls were frozen under ignored `data/engine-v2/diagnostic-readers-20261029/`. PostgreSQL regression manifest: `session-control-20261029-9628e5cc-873a-40d2-ab2c-32a3b659e42b`. Baseline, reader and version-binding phases replay unchanged. Private logs and full lead evidence stay ignored.

No authenticated LinkedIn validation, account start, hold clearing, proxy purchase, stealth injection, browser-library change or profile migration is part of this repair.
