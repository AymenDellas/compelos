# Session checklist audit — 28 October 2026

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
