# Session checklist audit — 28 October 2026

**Latest clock correction:** [current IANA clock reference](engine-clock-reference.md). The earlier UTC+1 expectation was outdated; AliasMode's Casablanca UTC+0 is correct from 20 September 2026. The unchanged managed browser passes both clocks and all 14 main/worker samples with the corrected reference. Browser tampering remains a separate unresolved issue; there is no account-operation all-clear. Earlier clock claims below are superseded.

**Latest provider investigation:** [reproduced image-noise warning and clock fault](engine-provider-repair.md). Disabling the provider's readback-noise feature cleared the previously failing diagnostic identity in both controlled repetitions; enabling it reproduced the warning in both. Ordinary Chromium passed the focused reference checks, but the user chose to keep AliasMode. A supported provider repair is still required. No all-clear or account start is authorized.

**Latest repair:** [reader corrections and clock evidence](engine-diagnostic-readers.md) make the regular checks retain current/legacy results, all Sannysoft rows and Fingerprint warnings. Timezone preflight now checks the actual clock offset. The latest provider studies reproduce a clock inconsistency in AliasMode Chromium and browser tampering on fresh profiles in both supported cores; a native clock correction failed. These are unresolved findings. No account is cleared, and no compatibility exception or production browser override is enabled.

**29 October update:** the user subsequently authorized replacing account-tab context tracking. The current controller and fresh measurements are documented in [explicit browser contexts](engine-explicit-contexts.md). That implementation supersedes this audit's requirement to retain a native Puppeteer Page/Runtime subscription; the installed library, historical results and detector verdict logic remain unchanged. The results below describe the earlier worker-filter-only implementation.

**Latest follow-up:** [counterbalanced repeats and a fresh full battery](engine-detector-followup.md) cleared Fingerprint Bot and Browser Tampering in all three new updated observations; updated Sannysoft also completed with 31 clear result checks. The [preceding tampering finding](engine-vendor-results.md) remains preserved and unexplained. Incolumitas retains its legacy WebDriver failure and unfinished behavioral test; the timezone warning remains. An offline stock-browser reference confirms that the legacy rule flags a standard present-but-false property, without relabeling the site's FAIL. No all-clear is issued. Earlier six-pass counts combined direct probes and connection checks, rather than six completed website bot verdicts. Account holds and processing intent remain unchanged.

The follow-up checklist audits the implementation already on `compelos/main`. It does not authorize an authenticated LinkedIn run, clear a hold or re-arm either consumed John manifest. The previous [navigation implementation](engine-session-navigation.md) and [worker-target measurement](engine-worker-targets.md) remain documented with their original results.

## Structural checks and corrections

| Requirement | Verified implementation |
| --- | --- |
| Worker filter on both connections | Both plain `puppeteer.connect` calls in `aliasmode-browser.cjs` pass the same `targetFilter`. It rejects raw CDP worker/service_worker/shared_worker kinds, including a dedicated worker exposed publicly as `other`. |
| Installed option support | Installed Puppeteer and Puppeteer Core are both lockfile-pinned 24.38.0. `lib/types.d.ts` declares `targetFilter`; `cdp/BrowserConnector.js` forwards it. The local worker fixture verifies workers still execute while Puppeteer does not attach to them. |
| Page execution contexts retained | `Runtime.enable` remains enabled, with the existing explanatory comment. No CDP-command interception, browser-global patch, detector-verdict change or stealth injection was added. |
| Native profile navigation | The actual helper is `navigateProfile`: visible same-tab link input or browser-context `location.assign`. Only feed entry/return uses `goto`. |
| Complete profile load | The helper now defaults to a **60,000 ms** `load` wait; the humanizer no longer overrides it with 20,000 ms. The rendered reader's former 45,000 ms default is also replaced. |
| Timeout propagation | The original navigation promise is awaited. Its early rejection handler only prevents an unhandled rejection while input is in flight; it does not convert a failure to null. Both entrypoints have negative-control tests that require the identical TimeoutError to propagate before readiness/evidence work. |
| Scroll before pointer input | `pressControl` awaits `controlPoint`, which awaits `scrollIntoView` before measuring bounds. Pinned Puppeteer's `Mouse.click` then calls `Mouse.move`. Unit sequencing and an actual native pointer event on an initially offscreen fixture link verify this order. |
| Database reservation preserved | `engine-daily-policy.cjs` still locks the account row and writes `next_profile_at = clock_timestamp() + interval` in PostgreSQL. JavaScript supplies only the sampled interval. These reservation/store files are unchanged by this audit. |
| Timing evidence and scope | The experiment still samples its 60–400-second censored log-normal interval and records `intervalMs`, `referer`, `secFetchSite`, `dwellMs` and `scrollCount`. Ordinary qualification timing remains unchanged. |

The existing session-end lookahead is updated from 120 to 190 seconds to include the longer profile load, bounded settle, maximum dwell, header observation and final feed load. This adjusts the existing 20–40-minute session target; it adds no new account permit or rolling budget. A boundary fixture verifies the session returns to the feed without reserving another profile when only 150 seconds remain.

## Fixture integrity

The HTTPS fixture resolves the canonical LinkedIn fixture origin directly to a loopback TLS server, blocks other hosts and never rewrites headers. Both server-observed and CDP-observed values must equal the literal `same-origin` and the literal expected Referer: `/feed/` for the first profile and the preceding canonical profile for the next one. A non-null assertion alone cannot satisfy these checks. The separate SPA test requires null document headers when no HTTP document navigation occurs.

The seeded distribution test names and asserts p50, p90 and p99: p50 lies between 87–93 seconds, p90 between 195–220 seconds, and p99 exceeds 360 seconds. It also checks bounds and logarithmic quantile symmetry. No `|| true` escape is present in these timing/header fixtures.

Two concurrent real PostgreSQL reservations with a 400-second interval must produce exactly one charged start and one paced result. The loser must receive the winner's database deadline and consume no daily slot; the persisted timestamp must match that deadline. This checks the spacing operation itself under concurrency, in addition to the existing daily-cap tests.

Native pointer ordering is observed inside the synthetic fixture without wrapping or delaying Puppeteer's input commands. An initial instrumentation attempt delayed `Mouse.move` and invalidated its own click sequence; it was replaced with passive native-event observation. A fixture-script quoting error was also corrected. Those failed development runs are not counted as passing gates.

## Preserved evidence

Before behavior changes, a fresh 50-record decided-lead snapshot was preserved under ignored `data/engine-v2/checklist-audit-20261028/`. PostgreSQL manifest `session-checklist-20261028-48bc7515-0baa-4492-9e68-c7602aa57d90` stores the regression reports. Baseline and implementation-phase replay each have zero decision changes, evidence changes or errors; the saved account controls/holds and complete CRM digest are unchanged. Qualification policy, follower/location routing, proxy configuration and consumed experiment history are untouched.

## Completed offline gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed before the full test command |
| `npm run test:workers -- tests/prospects/*.test.cjs tests/coach-prospecting/*.test.cjs` | **454 passed, 0 failed, 0 skipped** in a clean complete run |
| `CRM_TEST_POSTGRES=1 npm run test:crm` | **14 passed, 0 failed, 0 skipped** |
| ESLint on changed source/tests | Passed |
| `npm run lint` | 6 existing errors / 4 warnings in untouched UI files in this clean checkout |

The npm worker script expands to the required sequential Node command over all three test folders. Its complete passing output is retained in ignored `engine-tests.tap`; CRM and lint output are retained beside it. No gate is inferred from a partial test run.

The six workspace lint errors are in teleprompter, WorkspaceCommandMenu, business CoachProspectingWorkspace, business OnboardingWorkspace, EvidenceRecoveryDialog and copy-studio OnboardingDialog. These UI sources are unchanged from the audited main commit. The earlier report's 5 errors / 7 warnings came from the original working checkout with separate uncommitted UI work; this audit reports the clean destination checkout's actual result.

## Fresh anonymous detector evidence

Both measurements ran after all fixture/type/lint commands finished, with new blank AliasMode Chromium profiles, the production adapter, isolated PostgreSQL diagnostic leases and blocked LinkedIn navigation. The control removes only `targetFilter`; the filtered pass uses the unchanged normal adapter. No mapped account browser, proxy configuration or detector verdict logic was changed.

The first fresh seven-endpoint battery returned a completed worker flag `true` in the control, but its filtered DeviceAndBrowserInfo page did not produce completed vendor JSON in the normal eight-second result window. Its worker flag is **null/UNKNOWN**, not false. That incomplete result and the other external differences remain preserved in PostgreSQL benchmark `worker-target-filter-d843b844-fbb0-4182-a9d2-325cdc437d4c` and ignored `data/engine-v2/worker-target-filter/comparison-5139d3a9-e02f-4dac-8dbf-657f270f1613.json`.

One separate focused comparison then observed only DeviceAndBrowserInfo, with the same 60-second load and 60-second vendor-result deadlines in both passes. It reuses the existing exported `siteResult`, `probe` and `assessSite` functions; production detector/parser/verdict code and normal battery deadlines remain unchanged. The private harness records this different observation window rather than replacing the incomplete battery result.

| Focused DeviceAndBrowserInfo result | Control | Worker filter |
| --- | --- | --- |
| `isAutomatedWithCDPInWebWorker` | **true** | **false** |
| All 22 other boolean fields | Identical | Identical |
| All seven direct checks | Identical | Identical |
| `isAutomatedWithCDP` | true | true |
| `isBot` | true | true |
| Site verdict | FAIL | FAIL |

The focused scope passed its explicit `focusedAcceptance` condition. The generic seven-endpoint comparator retains `completed: false` and `acceptance: false` for that one-endpoint run, because it did not execute all seven endpoints; these fields are not changed into a full-battery pass. This proves the requested worker flag and stable other DeviceAndBrowserInfo fields in the focused measurement, not an unchanged or passing complete battery.

PostgreSQL benchmark `worker-target-focused-a169377e-04ee-46f0-b5f0-01724103f002` stores the focused report with zero lead jobs. Full evidence is ignored at `data/engine-v2/checklist-worker-focused/comparison-2eaad181-5941-4b40-9753-c6b9d88678eb.json`; the bounded private runner is retained in the checklist audit directory. Both diagnostic profiles were confirmed stopped and deleted through the supported CLI. Both reports confirm unchanged account-control hashes and restoration of the original AliasMode profile roster. John's hold and consumed experiment history remain unchanged; no authenticated LinkedIn validation or agent restart occurred.
