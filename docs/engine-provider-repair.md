# AliasMode provider repair evidence — 29 October 2026

**Clock assessment superseded:** [the clock reference correction](engine-clock-reference.md) establishes that AliasMode's Casablanca UTC+0 is correct under current IANA rules. Our old Node reference incorrectly expected UTC+1. The clock-only managed check now passes without browser changes. The remaining provider issue in this report is the image-noise modification warning. Historical raw readings and original assessments are preserved below; there is no account-operation all-clear.

**Not cleared for account operation.** The user chose to keep AliasMode after an ordinary Chromium reference passed the focused browser checks. No provider replacement, profile migration, proxy purchase, account start or hold clearing is authorized by this study.

The remaining provider repair is to make native readback noise optional without changing existing profile identities. It has a repeatable positive/negative control. A supported managed correction for that feature has not been installed or demonstrated. The earlier request to repair the browser's timezone rules was mistaken; that portion is resolved by correcting our reference.

## Ordinary Chromium reference

Two fresh visible stock Chromium 146 processes used the current explicit-context controller and pinned Puppeteer, with a nonzero debugging port and no automation switch or property injection. Both completed DeviceAndBrowserInfo and Fingerprint:

| Published observation | Reference run 1 | Reference run 2 |
| --- | --- | --- |
| DeviceAndBrowserInfo, all 23 flags | All false | All false |
| Fingerprint Bot | Not detected | Not detected |
| Fingerprint browser tampering | Not detected | Not detected |
| Fingerprint developer tools | Not detected | Not detected |
| Browser timezone / Date offset | Casablanca / UTC+1 | Casablanca / UTC+1 |
| Fingerprint timezone-location warning | Present | Present |

These are two focused website checks, not a full battery or proof of undetectability. Ordinary Chromium remains a diagnostic reference, not an active account provider. The existing [old/updated comparisons](engine-diagnostic-readers.md) remain unchanged.

## Reproduced modification warning

AliasMode's public manager source unconditionally adds `--fingerprint-noise` for its Chromium runtime. The browser's own switch reference describes that feature as detectable and recommends leaving it disabled unless separate readback hashes are required. [Manager source inspected at commit c12c9b0](https://github.com/aliasmode/aliasmode/blob/c12c9b0e252b8b822778ccbb2ac3c5f73f9475e4/fingerprint.ts), [pinned browser switch reference](https://github.com/aliasmode/aliasmode-chromium/blob/v155.0.8059.85-aliasmode.4/docs/reference/switches.mdx#fingerprint-noise).

The first predeclared study used one fixed diagnostic seed, noise disabled/enabled, and host mode, each twice. All six runs cleared the focused Bot/tampering checks; all six retained the wrong clock. A separate fresh manager-created profile also cleared those checks before and after bringing its window forward. These observations alone did not reproduce or repair the earlier warning.

The decisive study then recovered the deterministic seed `2756906926` of the **already deleted anonymous test profile** that previously reported tampering twice. It did not reopen or reconstruct a real account profile. The same pinned browser, seed, declared platform, screen, locale, timezone and launch settings were used in new temporary directories. The only comparison change was presence of `--fingerprint-noise`. The claimed Iris Xe renderer matched the earlier failing identity.

| Previously failing diagnostic identity | Noise disabled, run 1 | Noise enabled, run 1 | Noise disabled, run 2 | Noise enabled, run 2 |
| --- | --- | --- | --- | --- |
| DeviceAndBrowserInfo, all 23 flags | All false | All false | All false | All false |
| Fingerprint Bot | Not detected | Not detected | Not detected | Not detected |
| Fingerprint browser tampering | **Not detected** | **Detected** | **Not detected** | **Detected** |
| Fingerprint developer tools | Not detected | Not detected | Not detected | Not detected |
| Fingerprint suspect score | 10 | 15 | 10 | 15 |
| Browser timezone / Date offset | Casablanca / UTC+0 | Casablanca / UTC+0 | Casablanca / UTC+0 | Casablanca / UTC+0 |

This establishes a reproducible cause and correction for that specific tampering finding. It does not establish that every provider identity or detector will pass. The raw Fingerprint Bot-field assessment remains PASS in all four runs; tampering is retained separately. No production detector verdict was rewritten to create this comparison.

The manager's supported launcher rejects arbitrary identity-changing arguments; its official CLI does not expose a noise toggle. Passing `--fingerprint-noise=false` would still enable the feature because the engine checks the switch's presence. No unsupported argument, unsigned manager replacement or browser-global patch was installed. [Manager launch validation](https://github.com/aliasmode/aliasmode/blob/c12c9b0e252b8b822778ccbb2ac3c5f73f9475e4/launcher.ts).

For a provider reproduction, the common identity arguments were:

```text
--fingerprint=2756906926 --fingerprint-platform=windows
--fingerprint-screen-width=1920 --fingerprint-screen-height=1080
--fingerprint-timezone=Africa/Casablanca --fingerprint-locale=ar-MA
--ignore-gpu-blocklist --force-device-scale-factor=1
--force-webrtc-ip-handling-policy=default_public_interface_only
--window-size=1248,972 --disable-renderer-backgrounding
```

Each trial also used its own newly generated temporary data directory, a nonzero localhost debugging port, `--no-first-run` and `--no-default-browser-check`. The positive control adds `--fingerprint-noise`; the negative control omits it. Never use a managed account's real data directory for this reproduction. The raw site values and screenshots are retained privately; no detector response or browser property was altered.

## Historical clock diagnosis — superseded

The installed browser is AliasMode Chromium `155.0.8059.85-aliasmode.4`, also the latest published Windows release inspected for this study. Installed executable and library hashes match the downloaded build manifest:

| File | SHA-256 |
| --- | --- |
| `chrome.exe` | `0ef4de1bef7c12534031318e07ac89fa7942916a3abc89057985aafefbca619f` |
| `chrome.dll` | `a8cdf152a1748f5d21d5c9ef20f8f591041fa91a026ec7f1d3a1968175031be4` |

[Published release](https://github.com/aliasmode/aliasmode-chromium/releases/tag/v155.0.8059.85-aliasmode.4).

Windows and the local Node timezone reference both report Casablanca at UTC+1 on 29 October. Local blank-page trials isolated the browser's two clock surfaces:

| Native diagnostic configuration | Date clock | Intl formatted clock | Original assessment with stale reference |
| --- | --- | --- | --- |
| Default host mode | UTC+0 | UTC+0 | FAIL |
| Explicit ICU timezone data | UTC+0 | UTC+0 | FAIL |
| Windows timezone data for Date | UTC+1 | UTC+0 | **FAIL; clocks disagree** |

The last setting was never applied to a managed profile. It introduces a stale Windows Date reading while Intl remains correct. The original UTC+1 expectation in this table came from old host rules; current IANA data requires UTC+0, which the default browser already supplies. The corrected managed verification is in the linked clock report.

The local preflight previously checked the timezone name and Date offset alone. It now also records and verifies the Intl offset. A known mismatch in either clock fails; absent readings remain UNKNOWN. Reports use `DIRECT_SIGNALS_V4`, so older approvals cannot authorize the stronger check. Frozen fingerprint fields, saved evidence, exact holds and processing intent remain unchanged. The seven direct detector assessments and vendor verdict logic are unchanged.

## Required supported repair and verification

1. Expose a persistent per-profile noise setting in AliasMode, preserving existing profile identities. Demonstrate the disabled setting through its actual CLI-managed launch. Disabling noise can make readback values shared across profiles on one computer; passing this check does not prove that accounts cannot be linked.
2. **Clock portion resolved:** the unchanged browser passes Date, Intl and an unattached worker against the corrected current IANA reference. No browser-core clock patch is required. Both clocks must still match the configured timezone and current rules; the old raw assessments remain retained.
3. Repeat the same failing diagnostic identity, then the full unchanged battery through the production managed path. Preserve failures, missing results and raw vendor warnings. The previous legacy Incolumitas WebDriver FAIL remains visible and is not exempted here.
4. Verify the exact future proxy/profile setup after configuration. This study uses the existing connection, whose country/timezone estimate still disagrees with the browser's zone. No proxy has been bought or validated.

CloakBrowser through AliasMode previously matched the old host clock but retained the tampering warning. Matching that outdated reference did not establish a correct current clock; see the clock correction above. AliasMode also documents that CloakBrowser profiles on one computer may be linkable. It is not selected as an all-pass alternative. [AliasMode documentation](https://aliasmode.com/docs/).

No message or issue has been sent to the provider. This report is the reproducible repair handoff; a provider release and managed-path verification are still required before an all-clear.

## Verification and records

All browser trials used fresh anonymous diagnostic directories or a new unmapped AliasMode profile. LinkedIn/LICDN navigation and subresources were blocked. The managed profile was confirmed closed/deleted through the official CLI, the original roster was restored, and saved account controls were unchanged. No authenticated LinkedIn page was visited.

A fresh 50-record decided-lead snapshot and account/CRM digests were taken before changing local preflight behavior. Private evidence, screenshots, scripts and test output remain under ignored `data/engine-v2/fingerprint-root-cause-20261029/`; PostgreSQL retains the diagnostic reports and regression manifest. Completed validation and report identifiers are appended after the final checks.

| Local verification | Result |
| --- | --- |
| Full engine/prospect/coach suite | **468 passed, 0 failed, 0 skipped** |
| PostgreSQL CRM suite | **14 passed, 0 failed, 0 skipped** |
| TypeScript | Passed |
| Scoped source lint | Passed |
| Whole workspace lint | **FAIL: 6 existing errors, 4 warnings in untouched UI files** |
| Final V4 reader against real local browsers and unattached workers | Stock clocks PASS; provider default FAIL; Date-only workaround FAIL, exactly as expected |
| Stored-evidence replay | 50 records; 0 decision changes, 0 evidence changes, 0 errors |
| Saved account controls and full CRM digest | Unchanged |

The first affected-test invocation lacked the runtime database configuration and failed six PostgreSQL cases with connection refused. That failed output is retained. Loading the existing configuration correctly produced the complete 468-case passing run above; no credentials were read into a report or copied. No authenticated LinkedIn or live vendor measurement was part of these software suites.

These local test passes verify software behavior, including retaining failures. They do not mean that the provider clocks passed, that the full vendor battery passed, or that the future proxy/profile setup is ready.

| Measurement | PostgreSQL report |
| --- | --- |
| Ordinary Chromium reference, two runs | `provider-repair-stock-reference-0f1452ec-d028-45a6-a3d8-e61980dd7c5c` |
| Fixed-seed noise/host matrix, six runs | `provider-repair-native-core-9962e13f-0158-4e66-adb4-909519926ff7` |
| Previously failing seed, noise disabled/enabled twice | `provider-repair-failing-seed-noise-eac2cc7f-579c-4b0e-bf2a-afac98f5a0d5` |
| Fresh managed launch and revealed window | `context-comparison-81909108-d5d6-428d-b60e-7048623e9c74` |
| Native clock isolation, three cases | `provider-repair-clock-isolation-8c640f7a-0aea-4adb-a2b7-2d09de556827` |
| Final V4 real-browser/worker clock verification | `provider-repair-clock-v4-f8de90e2-0ca4-40ba-bff0-b0e1b25f20dc` |
| Fresh 50-record regression manifest | `session-control-20261029-dc0f9a30-01ce-4a5b-ad0e-1b79fd6d783b` |

The managed observation used the older full-comparison harness for its ownership/cleanup controls. Its inherited two-run/full-battery acceptance is **false**, as expected for this single-run focused study; its four completed site observations cannot satisfy that different acceptance criterion. No comparison acceptance or overall all-clear is inferred from the observation's separate Bot-field PASS values. All raw findings remain saved.
