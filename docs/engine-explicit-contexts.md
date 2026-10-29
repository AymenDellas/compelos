# Explicit browser contexts — 29 October 2026

The user authorized replacing the browser-control approach to address the remaining detection result. This supersedes the earlier request to keep Puppeteer's Runtime subscription for account tabs. It does not authorize clearing John's restriction, re-arming either consumed experiment, buying a proxy, creating a LinkedIn account or treating a detector pass as proof against restriction.

**Latest result:** the [expanded website-panel comparison](engine-vendor-results.md) finds an Incolumitas FPScanner `WEBDRIVER` failure in both setups, plus a Fingerprint browser-tampering finding in the updated run. Both complete evaluations fail. The DeviceAndBrowserInfo flags still clear, BrowserScan reports Normal, and CreepJS completes with zero headless/stealth scores. Fingerprint's Bot field remains clear while its timezone/VPN warning remains. Sannysoft fails execution after network retries; no bot/human verdict is claimed for it. The earlier six-pass counts below represent direct-probe/TLS checks, not six independent website passes. No new account is cleared by this anonymous evidence.

## Controller

`aliasmode-page.cjs` uses the installed Puppeteer 24.38.0 connection and explicitly owned CDP sessions. CDP remains the declared transport and AliasMode remains the profile provider. Instead of constructing a Puppeteer Page and then breaking its context tracking, account targets use a bounded controller that resolves its own main-world object handles after navigation. The installed library is unchanged.

The connection excludes automatic page/tab/worker attachment. The controller enables page lifecycle/network observations and resolves objects with ordinary Runtime evaluation calls; it does not subscribe to Runtime context/console events and never sends `Runtime.enable` or `Runtime.disable`. `Runtime.runIfWaitingForDebugger` resumes only the explicitly owned target if discovery paused it during creation. No browser globals, prototypes, user agent, hardware fields, detector JSON or verdict logic are overwritten. No new browser library or stealth plugin is installed.

The controller retains native pointer input, scrolling before clicks, full-document and same-document navigation, bounded waits, visible DOM handles, network/security response events, request interception for diagnostic fixtures and explicit teardown. A pinned-version guard refuses unverified future Puppeteer Core versions. The public website renderer remains separate and unchanged.

The existing profile/evidence readers retain their call ordering and paths. The controller's result envelope allows JSON encoding overhead around the readers' existing 2 MiB evidence limits. Rendered handles, active requests, navigation metadata and diagnostic history are bounded. Error diagnostics omit URL credentials, queries, fragments and non-HTTP payloads.

## Development evidence

The local fixture verifies repeated document/context changes, native link clicks, SPA routing, dedicated and blob workers, worker fetches while request monitoring is enabled, HTTP failures/redirects, bounded unresolved waits, ownership lookup and isolated shutdown. Protocol observation asserts that none of these operations sends Runtime enable/disable commands. This is observation, not command interception or suppression.

Two initial external candidate trials timed out and are retained as partial results. The second trace exposed background script requests stalled by incorrect correlation between Fetch and Network events. Some worker/blob requests never produce matching Network events on the page. The controller now resumes those requests using Fetch's metadata and retains redirect information when the separate Network stream arrives. Local fixtures cover both monitored blob workers and delayed redirect metadata. Failed trials are not counted as passes.

The third isolated trial compared the previous control with the explicit-context candidate in the same fresh blank AliasMode profile and headful mode, using the unchanged DeviceAndBrowserInfo parser and assessment functions. Both passes used bounded 60-second navigation/result waits. All account controls and the original profile roster were preserved, and the temporary profile was confirmed stopped/deleted through the official CLI.

| DeviceAndBrowserInfo field | Previous control | Explicit contexts |
| --- | --- | --- |
| `isAutomatedWithCDP` | true | false |
| `isAutomatedWithCDPInWebWorker` | true | false |
| `isBot` | true | false |
| Other 20 boolean fields | false | false |
| Site verdict | FAIL | PASS |
| Seven direct browser checks | Identical | Identical |

Focused evidence is stored privately in `data/engine-v2/control-transport-v3/comparison-423c248c-fdd1-460a-b8a9-5d279093f66b.json`, with PostgreSQL benchmark `control-transport-v3-40130917-e567-4379-83a7-550bd3ec488d`. Its endpoint-specific acceptance passed. The generic seven-site comparator correctly remains incomplete for this one-site experiment. This result is not a full detector battery, authenticated LinkedIn validation or restriction-cause finding.

Before behavior changes, 50 decided CRM records and their stored reasons/evidence were frozen under ignored `data/engine-v2/control-transport-20261028/`; candidate-phase replay has zero decision/evidence changes and zero errors, with account controls and the complete CRM digest unchanged. A fresh integration snapshot was also frozen under ignored `data/engine-v2/control-integration-20261029/` as PostgreSQL manifest `session-control-20261029-b2d35d3f-db5b-462a-b9a6-ad889dc8da31`.

## Production integration

Both AliasMode connections apply the same target filter. Only the saved, owner-fenced target ID can be restored; otherwise the controller creates its own tab. PID/mode checks, human tabs, profile sign-in and confirmed provider stop remain protected. Controller failures invalidate that page for reuse and use account-local connection recovery. Late redirect metadata reconciles against a bounded 64-request completion history rather than losing an observed response after loading finishes.

The evidence key includes `CDP_EXPLICIT_CONTEXT_V1`. Reports from the previous controller cannot authorize this one. This invalidates admission without rewriting saved evidence, clearing a hold, resetting warmup history or starting an account. Each configured profile needs a current check after its proxy/mode/identity are configured.

Native-header and SPA fixtures now exercise the actual explicit controller. Disposable browser fixtures retain saved-session and three-browser isolation assertions using their synthetic cookie stores; the production controller adds no cookie-reading/export API. The existing Voyager fixture still performs its six declared reads on one feed document with unchanged member/follower/location ordering.

Run the repeatable anonymous comparison separately from tests/builds:

```powershell
node scripts/engine-context-comparison.cjs --run
```

It creates one new blank AliasMode Chromium profile, runs the previous Page controller and the production controller in the same visible mode, and uses the unchanged detector/parser/verdict code. Acceptance requires measured main/worker/isBot signals to change from true to false, unchanged other DeviceAndBrowserInfo flags/direct checks/browser identity/version, and a completed passing seven-endpoint candidate battery. Original account controls and the profile roster must remain unchanged; the temporary profile must be confirmed stopped/deleted. Partial runs are retained in PostgreSQL as `DIAGNOSTIC_PARTIAL`, never reported as passes.

The two initial timed-out prototypes are additionally retained under PostgreSQL IDs `control-transport-partial-3563a3e7-6eef-49d8-bdbd-1941e0ee2d96` and `control-transport-partial-455bf042-6d6f-4faf-8bf3-9bf60c5a71c0`. Both preserve their timeout outcomes, unchanged controls and confirmed temporary-profile cleanup.

The first integrated seven-endpoint comparison independently confirmed the same three cleared DeviceAndBrowserInfo flags, all other 20 flags unchanged, identical direct checks and browser identity/version. Its candidate battery remained UNKNOWN: Sannysoft timed out in both controls, while BrowserScan and Incolumitas exposed missing HTTP response metadata in the new controller. These outcomes remain unchanged in PostgreSQL `context-comparison-1c50ddc1-257c-4281-b3ef-4236b3a74960` and ignored `data/engine-v2/context-comparison/comparison-8b4a0e4a-d133-4eb0-ba50-f6fd3eaf0476.json`. Account controls/roster were unchanged and the diagnostic profile was confirmed closed/deleted.

A document can call `history.replaceState` while parsing, before its requested load event. That same-document event previously resolved the document navigation as null. After a full-document commit, the controller now retains its real response and waits for the requested lifecycle. True SPA-only navigation still returns null. A local early-routing fixture requires the literal HTTP 200 response and completed title; the existing SPA/header fixtures remain passing. No detector assessment or endpoint is changed to accommodate the UNKNOWN results.

The next comparison confirmed BrowserScan's HTTP response but found another timing case at Incolumitas. Its complete evidence remains in PostgreSQL `context-comparison-f206ab3a-3fe3-465f-8d9b-6c3e712eaa86` and ignored `comparison-3a3bb5f4-9f8d-4025-94b9-aae49108df35.json`: five candidate endpoints passed, Incolumitas had missing navigation metadata, and Sannysoft timed out in both passes. The three device flags again cleared with other flags/identity unchanged; account controls/roster and confirmed cleanup were preserved.

An old page can route asynchronously while the next page's HTTP response is pending. A new fixture deliberately reproduced the null response before the fix, observing the old route rather than assuming the race occurred. Explicit `goto` now matches the loader returned by its own `Page.navigate` command; unrelated old-page routing cannot finish it. Hash-only navigation waits for its matching URL event. Local assertions require HTTP 200, the requested document title, the observed competing route and correct hash navigation, with no Runtime subscription. After this last correction, all **31 affected browser/adapter/comparison checks** and **7 detector fixtures** pass, and the default production build/privacy check pass again. The full 460-case run preceded this last loader correction; it was not repeated afterward.

## Completed offline gates

| Gate | Result |
| --- | --- |
| Complete sequential engine/prospect/coach suite | **460 passed, 0 failed, 0 skipped** |
| PostgreSQL CRM suite | **14 passed, 0 failed, 0 skipped** |
| TypeScript | Passed, including the production build's check |
| Lint on changed source/tests | Passed |
| Full workspace lint | Existing 6 errors / 4 warnings in untouched UI sources |
| Default `npm run build` | Passed |
| Deployment trace privacy | **45 manifests, 0 private runtime entries** |
| Frozen 50-record replay through the navigation correction | Zero decision/evidence changes or errors; complete CRM and account controls unchanged |

The final clean engine output is retained privately as `control-integration-20261029/engine-tests-certified.tap`; CRM output is `crm-final.tap`. The latest controller's passing focused checks are `loader-navigation-certified.tap` and `detector-fixtures-final.tap`; its successful default build is `build-final-controller.log`. An earlier full run had one Chrome fixture startup crash; its three-case file passed on rerun, and the later complete 460-case run passed without failures. Earlier fixture-interface/redirect failures were corrected and are not counted as passes.

The verification checkout initially shared dependencies through a directory junction, which Turbopack rejected. The alternative webpack builder also rejected the existing PostCSS module export. A physical copy of the same installed dependencies allowed the unchanged default builder to complete; no package versions, browser library or permanent build-root settings changed. The packaging audit then found the worktree's `.git` metadata file in two Finder route traces. Excluding the root file as well as Git directories removes both entries; the subsequent complete default build and privacy audit pass. No environment file was copied or included.

## Final public comparison

The final production-controller run follows the loader correction and the completed browser fixtures/build. PostgreSQL report `context-comparison-2bc565ce-557c-4055-94f8-3b132a87c70e` retains complete evidence at ignored `data/engine-v2/context-comparison/comparison-39602252-cdd4-408a-9c1f-a25ef2091812.json`.

| Endpoint | Production controller |
| --- | --- |
| BrowserScan | PASS, HTTP 200 |
| Incolumitas | PASS, HTTP 200 |
| DeviceAndBrowserInfo | PASS, HTTP 200; all 23 boolean flags false |
| Fingerprint | PASS, HTTP 200 |
| CreepJS | PASS, HTTP 200 |
| Sannysoft | UNKNOWN, connection timeout in both controllers |
| BrowserLeaks TLS | PASS, HTTP 200; capture/coherence scope only |

`isAutomatedWithCDP`, `isAutomatedWithCDPInWebWorker` and `isBot` each changed from literal true to literal false. The other 20 device flags, all seven direct checks, browser identity and browser version were identical. BrowserScan and Incolumitas now retain their real HTTP responses. Raw TLS extension-order differences remain in the report; no reference-browser TLS match is claimed.

The overall result remains UNKNOWN and strict seven-endpoint acceptance remains false because Sannysoft was unavailable. No endpoint or verdict rule was removed, weakened or overridden. Original account-control hashes were unchanged, the original AliasMode roster was restored, and the new diagnostic profile was confirmed stopped/deleted. There was no LinkedIn navigation/authentication or lead work.

## Configuring a profile after installation

Anonymous diagnostic results cannot approve another profile. Configure the dedicated proxy credentials in AliasMode, bind its reference and expected exit IP/country/timezone in CompelOS, then obtain fresh browser/network/identity evidence for that exact configured profile. Manual sign-in confirms the intended member and leaves processing paused. Confirmed failures and LinkedIn holds still block processing; exact current UNKNOWN reports retain the existing human-review/recovery policy.

Use an explicit Start only after the displayed prerequisites are satisfied. Existing rendered warmup, ramp, daily ceilings and reactive stops still apply. John's restriction and consumed experiments remain untouched. This work creates no LinkedIn account and makes no authenticated LinkedIn test or assurance that a future account will avoid restriction.

## Local installation

The verified files were applied to the original local project after confirming that all 19 selected sources were unchanged by other work. Their previous bytes are preserved privately; unrelated UI edits and environment files were untouched. The old worker stopped gracefully before source replacement, and the new worker launched with an absolute entry path. Its fresh database heartbeat and process ownership are verified, with `CDP_EXPLICIT_CONTEXT_V1` loaded, zero processing accounts, zero pending manual commands and all four active-account holds retained. No account browser was opened for this restart.

The final installed replay under PostgreSQL manifest `session-control-20261029-b2d35d3f-db5b-462a-b9a6-ad889dc8da31` has zero decision changes, evidence changes or errors across the 50 frozen records. The complete CRM digest and every saved account-control row are unchanged. Private source receipts, worker health, logs and `final-installed-regression.json` are retained under `data/engine-v2/control-integration-20261029/`.
