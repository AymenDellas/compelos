# AliasMode native identity and clock

This local Apache-2.0 source modification keeps AliasMode as the browser,
profile, cookie and proxy owner. It is not an official vendor release.

Pinned upstream: `aliasmode/aliasmode`, `v0.1.0-beta.69`, commit
`9577c815e30af8958d5a604fe5c9820b6e400886`. Compiler: Bun **1.2.21**, Windows
x64 baseline. The verified compiler archive hash and download are documented
in [the earlier readback repair](../aliasmode-native-readback/README.md).

New profiles created through the normal GUI, Local API or CLI use Chromium's
native `--fingerprint=host` mode. Existing profiles are unchanged. The explicit
`compelos-native-identity-v1` tag selects this mode. It avoids synthetic hardware
composition and image readback noise; it does not reroll seeds to find a passing
fingerprint. Real hardware characteristics are shared by profiles on this
machine. This provides neither unlinkable identities nor guaranteed invisibility.
Moving to different hardware requires a new identity review.

The native mode starts with a blank window while preserving saved cookies and
storage. A bounded, provider-owned connection applies Chromium's native timezone
setting before page scripts execute, including workers and cross-process frames.
It runs no injected JavaScript and does not subscribe to Runtime events. A lost
connection or failed setting stops only the affected profile. An unguarded
surviving native profile cannot be adopted as healthy. CompelOS confirms the
running manager, launch generation, clock and its own page before navigation.
Puppeteer's normal Runtime support remains intact.

The official helper forwards these commands to the running manager:

```powershell
aliasmode-mcp.exe profiles identity --mode capability --json
aliasmode-mcp.exe profiles identity --profile PROFILE_ID --mode status --json
aliasmode-mcp.exe profiles identity --profile PROFILE_ID --mode host --timezone America/New_York --json
```

Configuration requires a closed, editable profile and the current version fence.
Other tags, proxy credentials and private session data are preserved. Status
returns no secrets. To reverse selection, close the profile and use `--mode
composed`; this changes its identity and requires fresh review. Capability or
clock errors block work. Existing holds and paused intent remain unchanged.

## Reproduce

The patch below includes the earlier readback repair. Apply it alone to a clean
checkout at the pinned commit; do not apply both patches.

```powershell
git checkout --detach 9577c815e30af8958d5a604fe5c9820b6e400886
git apply --unidiff-zero C:/path/to/compelos/provider/aliasmode-native-identity/aliasmode-beta69-native-identity.patch
& C:/path/to/bun.exe install --frozen-lockfile --ignore-scripts
& C:/path/to/bun.exe test native-clock.test.ts fingerprint.test.ts create.test.ts agent-control.test.ts cloud-profile-editor.test.ts adspower-users.test.ts launcher.test.ts ui.test.ts
& C:/path/to/bun.exe run ./node_modules/typescript/bin/tsc --noEmit
& C:/path/to/bun.exe build --compile --target=bun-windows-x64-baseline --define=ALIASMODE_COMPILED=true --external=playwright-core --external=chromium-bidi --external=electron sidecar-entry.ts --outfile ../candidate/aliasmode-sidecar.exe
```

The standalone `native-clock.ts` matches the source included in the patch. Its
real-browser fixture checks the first script's Date and Intl values in the main
page, a cross-origin frame and dedicated/shared/service workers. Provider tests
also check fault isolation and stale callbacks.

Close every profile, confirm no active CompelOS leases, then quit AliasMode
normally. Back up the installed sidecar and its hash. Replace only
`aliasmode-sidecar.exe`; keep the GUI, official helper, browser cores, profile
directories and locks intact. Restart and verify capability through the official
helper. Rollback uses the saved sidecar while the manager and profiles are closed.
Vendor updates may replace this local build; revalidate before account use.

Executable builds, profile identifiers, proxy details and full measurement reports
remain local. Published results must distinguish reference browsers from actual
managed profiles and retain failed or partial measurements.
