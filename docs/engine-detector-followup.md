# Detector follow-up — 29 October 2026

**All-clear: NO.** This investigation preserves failed website findings and incomplete execution. No production browser code, detector verdict rule, profile configuration, proxy, account hold or processing intent changed.

## Full old/updated comparison

New anonymous AliasMode Chromium profile; same visible mode and unchanged settings. Website panels and screenshots were observed for up to 120 seconds.

| Check | Old setup | Updated setup |
| --- | --- | --- |
| BrowserScan | PASS — Normal | PASS — Normal |
| Incolumitas static checks | FAIL — detection-tests.fpscanner.WEBDRIVER | FAIL — detection-tests.fpscanner.WEBDRIVER |
| DeviceAndBrowserInfo | FAIL — bot detected | PASS — all 23 flags false |
| Fingerprint Bot | PASS — Bot field | PASS — Bot field |
| CreepJS score checks | PASS — headless 0%, stealth 0% | PASS — headless 0%, stealth 0% |
| Sannysoft | FAILED TO RUN | PASS — all rendered result checks clear |
| BrowserLeaks consistency | PASS | PASS |
| Fingerprint browser tampering | PASS — Not detected | PASS — Not detected |

## Fingerprint repeats

A separate fresh blank profile was tested in counterbalanced order: updated, old, old, updated. These repeats preceded the full battery and do not replace its findings.

| Run | Controller | Bot | Browser tampering | Developer tools | Suspect score |
| --- | --- | --- | --- | --- | --- |
| 1 | Updated | Not detected | Not detected | Not detected | 10 |
| 2 | Old | Not detected | Not detected | Yes 🔧 | 25 |
| 3 | Old | Not detected | Not detected | Yes 🔧 | 25 |
| 4 | Updated | Not detected | Not detected | Not detected | 10 |

Both updated repeats cleared all 23 DeviceAndBrowserInfo flags. Both old repeats retained the main/worker CDP and overall bot flags. All four repeats retained Incolumitas’s legacy FPScanner WEBDRIVER failure with native `navigator.webdriver === false` and property presence true.

The earlier tampering finding remains in the [original report](engine-vendor-results.md). It was not reproduced in the two counterbalanced updated runs; this does not establish its cause or guarantee it cannot recur. Fingerprint’s own published details previously identified an anti-detect-browser result rather than a high anomaly score. [Vendor documentation](https://docs.fingerprint.com/docs/smart-signals-reference#browser-tamper-detection).

## Why the WebDriver check disagrees

The current Incolumitas collector sets `webDriver` to `'webdriver' in navigator` and records `navigator.webdriver` separately as `webDriverValue`. Its older FPScanner Chrome branch declares a failure from the presence field alone. In the same page, newer webdriver checks are OK. The website’s literal FAIL is retained. [Collector](https://bot.incolumitas.com/fpCollect.min.js), [scanner](https://bot.incolumitas.com/fpScanner.js).

An offline compatibility reference on stock visible Chrome/146.0.7680.31 with the automation switch omitted and a nonzero debugging port observed property presence true and value false. The exact downloaded scanner branch still returned FAIL for those observations. This is evidence that this particular legacy rule flags a standard false-valued browser property. The reference ran only on about:blank; it is not a website verdict, a production provider switch or proof that all other browser signals match. The standard defines a false value when WebDriver control is inactive. [WebDriver interface](https://w3c.github.io/webdriver/#interface).

No browser property was deleted or spoofed, and this compatibility explanation does not turn the site’s failure into a pass.

## Sannysoft and remaining execution limits

A separate Node connection check reached Sannysoft with HTTP 200 during this follow-up. This did not establish that AliasMode could load it. Actual AliasMode execution: old FAIL, website verdict none; updated PASS, website verdict PASS. Old captured 0 primary rows and 0 scanner rows; updated captured 11 and 20. Each failed browser navigation attempt is retained.

A separate stock headless Chrome/146.0.7680.31 connectivity reference reached the real Sannysoft page with HTTP 200 on its first attempt and completed the result tables. Its own site result was FAIL, with User Agent (Old), WebDriver (New), HEADCHR_UA, CHR_MEMORY. This was a visibly separate diagnostic control using the stock renderer and its default automation/headless settings; it is neither the updated AliasMode setup nor a substitute passing result. The successful connection narrows the observed loading failure to the tested AliasMode path; its root cause is not isolated. No proxy, TLS, browser-security or provider settings were changed to force a result.

Old Incolumitas behavioral score: did not complete within 120 seconds. Its static checklist result above is recorded separately.

Updated Incolumitas behavioral score: did not complete within 120 seconds. Its static checklist result above is recorded separately.

Both runs recorded the behavioral script blocked by ORB, a failed backend fetch, and HTTP 502 from `/store2`. These are execution failures; disabling browser security or substituting a score would not establish a valid result.

CreepJS PASS means its published headless and stealth percentages are both zero, not a universal human verdict. Like-headless scores: 19% old / 19% updated. BrowserLeaks checks data consistency only. Fingerprint’s timezone/VPN warning remains: old You are using a VPN 🌐 (timezone mismatch); updated You are using a VPN 🌐 (timezone mismatch). No proxy route was configured or validated.

The attempted unmanaged AliasMode baseline could not be observed: the native window tool failed twice to bind to the diagnostic window, before any native input was sent. No unmanaged bot/human result or causal isolation is claimed. A CLI help request also unexpectedly created an unused blank profile; it was confirmed inactive and unmapped, then removed through the official CLI before the measured runs.

## Evidence, validation and account state

The original account-control hashes match and both temporary-profile rosters were restored, with confirmed official closure/deletion of only newly created unmapped diagnostic profiles. Authenticated LinkedIn pages were not opened. Automated detector runs blocked LinkedIn/LICDN resource requests. No maintenance account was started, no hold was cleared, and no proxy was purchased.

Two offline interpretation tests and one browser observation fixture passed. The fixture requires the Sannysoft scanner table to finish and preserves a positive failure in it; missing Fingerprint tampering fields cannot complete the observation. Required fields from all four counterbalanced runs were rechecked against the strict readiness rule. Runtime code was unchanged, so full application suites/builds were not rerun for this documentation and anonymous-diagnostic phase.

Full raw report: `context-comparison-4af74a67-cd73-4149-a181-6eb550fc651c`. Counterbalanced raw report: `context-comparison-b7ee17f1-ec18-47b6-ad35-2fda38ea1b40`. The interpreted follow-up report ID is listed below after persistence. Raw screenshots, model details, downloaded-source hashes, fixture output and the offline property reference remain private under ignored `data/engine-v2/vendor-investigation-20261029/`.

This is a diagnostic conclusion, not a verified repair of the earlier tampering finding. The remaining legacy failure is explained but remains a literal failure; the behavioral test is incomplete, and the timezone warning remains. The actual intended proxy/profile combination has not been tested. This report therefore does not give an all-clear for maintenance accounts.

Interpreted follow-up report: `vendor-followup-6c4c96f2-e0fe-4a89-8283-f0a2c2f0e46b`.
