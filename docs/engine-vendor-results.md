# Rendered website comparison — 29 October 2026

**Current findings:** the [latest local repairs and provider measurements](engine-diagnostic-readers.md) reproduce Fingerprint tampering on additional fresh profiles and find an incorrect clock offset in AliasMode Chromium. A native correction failed. CloakBrowser's clock is correct in a focused trial, but tampering remains. The regular readers now retain the real published failures and warnings. Earlier clear observations below are preserved; they do not establish a lasting repair or all-clear.

**Later follow-up:** the [counterbalanced repeats and fresh full battery](engine-detector-followup.md) cleared Fingerprint Bot and Browser Tampering in all three updated observations across two new profiles. Updated Sannysoft also completed with all 11 primary and 20 scanner checks clear. Incolumitas retains its legacy WebDriver failure and incomplete behavioral score; the timezone warning remains. The legacy source also fails a stock-browser false-valued-property reference. That explains this particular incompatibility without changing the site's result to PASS. No all-clear or account restart follows. The original findings below remain preserved.

Fresh anonymous AliasMode Chromium profile, visible Chrome/155.0.8059.85. Old and updated controls used the same profile and unchanged browser settings. Actual result panels were observed for up to 120 seconds, with screenshots. Production detector code and its verdict rules were not changed.

| Test | Old setup | Updated setup |
| --- | --- | --- |
| BrowserScan | PASS — Normal | PASS — Normal |
| Incolumitas | FAIL — FPScanner WEBDRIVER | FAIL — FPScanner WEBDRIVER |
| DeviceAndBrowserInfo | FAIL — You are a bot | PASS — Human; all 23 flags false |
| Fingerprint Bot field | PASS — Not detected | PASS — Not detected |
| CreepJS headless/stealth scores | PASS — 0% headless, 0% stealth | PASS — 0% headless, 0% stealth |
| Sannysoft | FAIL to run | FAIL to run |
| BrowserLeaks TLS consistency | PASS | PASS |

Both setups fail the complete evaluation. Incolumitas publishes a real FPScanner WEBDRIVER failure in both. Sannysoft fails execution, which is not a bot/human classification. No incomplete output is called a pass.

## Incolumitas: all captured static checks

| Published check | Old | Updated |
| --- | --- | --- |
| `new-tests.puppeteerEvaluationScript` | OK | OK |
| `new-tests.webdriverPresent` | OK | OK |
| `new-tests.connectionRTT` | OK | OK |
| `new-tests.refMatch` | OK | OK |
| `new-tests.overrideTest` | OK | OK |
| `new-tests.overflowTest` | OK | OK |
| `new-tests.puppeteerExtraStealthUsed` | OK | OK |
| `new-tests.inconsistentWebWorkerNavigatorPropery` | OK | OK |
| `new-tests.inconsistentServiceWorkerNavigatorPropery` | OK | OK |
| `detection-tests.intoli.userAgent` | OK | OK |
| `detection-tests.intoli.webDriver` | OK | OK |
| `detection-tests.intoli.webDriverAdvanced` | OK | OK |
| `detection-tests.intoli.pluginsLength` | OK | OK |
| `detection-tests.intoli.pluginArray` | OK | OK |
| `detection-tests.intoli.languages` | OK | OK |
| `detection-tests.fpscanner.PHANTOM_UA` | OK | OK |
| `detection-tests.fpscanner.PHANTOM_PROPERTIES` | OK | OK |
| `detection-tests.fpscanner.PHANTOM_ETSL` | OK | OK |
| `detection-tests.fpscanner.PHANTOM_LANGUAGE` | OK | OK |
| `detection-tests.fpscanner.PHANTOM_WEBSOCKET` | OK | OK |
| `detection-tests.fpscanner.MQ_SCREEN` | OK | OK |
| `detection-tests.fpscanner.PHANTOM_OVERFLOW` | OK | OK |
| `detection-tests.fpscanner.PHANTOM_WINDOW_HEIGHT` | OK | OK |
| `detection-tests.fpscanner.HEADCHR_UA` | OK | OK |
| `detection-tests.fpscanner.WEBDRIVER` | FAIL | FAIL |
| `detection-tests.fpscanner.HEADCHR_CHROME_OBJ` | OK | OK |
| `detection-tests.fpscanner.HEADCHR_PERMISSIONS` | OK | OK |
| `detection-tests.fpscanner.HEADCHR_PLUGINS` | OK | OK |
| `detection-tests.fpscanner.HEADCHR_IFRAME` | OK | OK |
| `detection-tests.fpscanner.CHR_DEBUG_TOOLS` | OK | OK |
| `detection-tests.fpscanner.SELENIUM_DRIVER` | OK | OK |
| `detection-tests.fpscanner.CHR_BATTERY` | OK | OK |
| `detection-tests.fpscanner.CHR_MEMORY` | OK | OK |
| `detection-tests.fpscanner.TRANSPARENT_PIXEL` | OK | OK |
| `detection-tests.fpscanner.SEQUENTUM` | OK | OK |
| `detection-tests.fpscanner.VIDEO_CODECS` | OK | OK |

The behavioral score did not appear after 120 seconds in either setup. `abs.incolumitas.com/lib.js` was blocked by ORB, backend fetches failed, and `/store2` returned HTTP 502. The captured static checklist contains 36 checks: 35 OK and 1 FAIL in each setup.

## DeviceAndBrowserInfo: all 23 flags

| Flag | Old | Updated |
| --- | --- | --- |
| `hasBotUserAgent` | false | false |
| `hasWebdriverTrue` | false | false |
| `hasWebdriverInFrameTrue` | false | false |
| `isPlaywright` | false | false |
| `hasInconsistentChromeObject` | false | false |
| `isPhantom` | false | false |
| `isNightmare` | false | false |
| `isSequentum` | false | false |
| `isSeleniumChromeDefault` | false | false |
| `isHeadlessChrome` | false | false |
| `isWebGLInconsistent` | false | false |
| `hasInconsistentWebGLShaderLang` | false | false |
| `hasInconsistentTimingResolution` | false | false |
| `isAutomatedWithCDP` | true | false |
| `isAutomatedWithCDPInWebWorker` | true | false |
| `hasInconsistentClientHints` | false | false |
| `hasInconsistentGPUFeatures` | false | false |
| `isIframeOverridden` | false | false |
| `hasInconsistentWorkerValues` | false | false |
| `hasHighHardwareConcurrency` | false | false |
| `hasHeadlessChromeDefaultScreenResolution` | false | false |
| `hasSuspiciousWeakSignals` | false | false |
| `isBot` | true | false |

## Fingerprint additional published signals

| Signal | Old setup | Updated setup |
| --- | --- | --- |
| Bot | Not detected | Not detected |
| Browser tampering | Not detected | **Detected** |
| Developer tools | Detected | Not detected |
| VPN / timezone warning | Present | Present |
| Suspect score | 25 | 15 |

The updated Bot field passes, but the site is not all-clear: it reported browser tampering and the timezone warning. The suspect score is a reported number, not a percentage or a universal pass threshold.

## Other observations

CreepJS completed in both setups. Its like-headless score is 25% before and 25% after; headless and stealth scores are both zero in both. PASS in the table applies to the headless/stealth score checks only, not every CreepJS property or a universal human verdict.

Fingerprint reports Bot not detected in both setups. Its full published fields and screenshots are retained in the private JSON report, including any timezone/VPN warnings. BrowserLeaks is a connection-data consistency test, not a bot detector, and no trusted normal-Chrome fingerprint comparison was performed.

Sannysoft attempts are retained individually: two HTTPS attempts and an HTTP fallback in each setup. All failed. An independent TCP connection check to its port 443 also failed from this computer. Browser/network failures are kept separate from positive bot findings.

All saved account controls remained unchanged; the original AliasMode roster was restored. The temporary test profile was confirmed stopped/deleted. No LinkedIn navigation or authentication occurred. Raw public-page screenshots and full machine-readable evidence remain under ignored `data/engine-v2/vendor-results-20261029/`.

## Evidence and scope

Raw observation benchmark: `context-comparison-1b9ae46d-97d7-47dd-bd53-d34b6acb4d7e`. Interpreted result benchmark: `vendor-rendered-results-45850560-f863-45f4-ad58-999cfe652877`. Raw screenshots and original observations are retained unchanged; the BrowserScan Normal classification is read from its rendered Test Results heading. All 36 Incolumitas status strings, including the legacy FPScanner finding, are listed above.

CreepJS reports separate percentages, rather than a universal human verdict; the table explicitly evaluates its published headless/stealth score panels. [Author source](https://github.com/abrahamjuliot/creepjs/blob/master/src/headless/index.ts). Incolumitas separately publishes its behavioral score and Intoli/FPScanner checklists. [Test page](https://bot.incolumitas.com/).
