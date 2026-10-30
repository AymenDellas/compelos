# Draft provider repair request: profile-dependent modification findings

## 30 October follow-up: Chromium profile separation remains unresolved

The [native-host repair](../../docs/engine-native-identity.md) subsequently cleared
Bot/modification findings in six managed launches with correct native clocks.
It resolves the preceding clock limitation below, but exposes shared host device
characteristics. The [new separation study](../../docs/engine-profile-separation.md)
retains all prior failures and records these additional findings:

- Ten local Chromium launches confirm seed-only hardware composition leaves the
  sampled canvas, WebGL, audio and font rendering shared. Native noise separates
  the sampled rendering but brings back the modification warning in four of four
  public reference launches using two fixed identities.
- Beta.70 still uses the same Windows Chromium `.4` core. Please provide a native
  repair with stable, internally coherent per-profile rendering and hardware,
  working clocks and documented limitations. A manager version change alone
  does not establish that repair.
- The existing AliasMode Firefox core demonstrates stable, distinct actual pixel
  identities and published visitor IDs across two profiles restarted twice each,
  with clear Bot/modification results and passing US clocks. It still shows a
  VPN/OS warning; unproxied Casablanca clocks fail. The user explicitly kept
  Firefox as testing only. No production adapter/default change was made.

Acceptance still requires preserving every raw warning, unsuccessful attempt,
existing account identity and exact hold. No renderer injection, detector-verdict
rewrite or guarantee of unlinkability is requested. This remains an unsent draft.
The reproduction and limitations below describe the earlier readback-only patch.

## Earlier reproduction

This is a prepared reproduction, not an externally submitted issue. No account,
proxy credential, purchased address, cookie, private endpoint or profile ID is
included. No LinkedIn account operation is required to reproduce it.

Environment: Windows x64, physical AMD Radeon RX 480, AliasMode beta.69,
Chromium `155.0.8059.85-aliasmode.4`, unchanged Puppeteer Core 24.38.0. The
published local native-readback patch is installed and opt-in confirmed before
launch. The actual browser launch omits `--fingerprint-noise`.

Observed through the normal official-CLI/Local-API path and explicit owned page:

- One retained blank proxy profile: modification Yes on two launches, Bot Not
  detected, all 23 DeviceAndBrowserInfo flags false; correct US clock.
- One fresh unproxied profile: modification Yes on two launches, Bot Not
  detected, all 23 DeviceAndBrowserInfo flags false.
- Another fresh unproxied profile: modification Not detected on two launches,
  Bot Not detected, all 23 DeviceAndBrowserInfo flags false.
- The warning correlates with generated Intel versus NVIDIA identities in this
  sample, but seed and other fields differ. GPU causation is not established.
- An earlier launch of the retained profile showed both CDP flags true. The
  unchanged follow-up and six-launch study do not reproduce that finding. It
  remains unexplained, rather than relabeled a false positive.

Please identify whether the modification finding reflects a concrete browser
inconsistency or recognition of the browser, and repair confirmed inconsistencies
through supported persistent profile configuration. Please also provide a way
to attribute transient instrumentation to active client sessions/startup helpers.
No detector-response rewrite or page-global injection is requested.

The existing patch only removes readback noise. It is insufficient as a universal
repair. Full native host mode is also insufficient: the current build rejects
the timezone switch there, and setting child-process TZ did not produce the
required US timezone on Windows. Retain working per-profile clocks and isolation.

Reproduction in CompelOS, with the published patch capability available:

```powershell
node scripts/engine-profile-reliability.cjs --run --fresh
```

Each invocation creates one anonymous profile and records two independent
launches before confirmed cleanup. Preserve all output, including failing
profiles; do not reroll identities until one passes. Exact configured proxy
validation remains a separate controlled test; credentials stay in AliasMode.

Acceptance: explain and resolve the reproduced warning without changing existing
reviewed identities, retain correct clocks, demonstrate repeated launches of
multiple freshly created profiles through the normal managed path, retain all raw
findings and partial results, and document remaining detection limitations. A
negative public test is not a guarantee about LinkedIn or permanent invisibility.
