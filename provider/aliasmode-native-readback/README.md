# AliasMode native image readback repair

**Scope correction:** [the repeatability study](../../docs/engine-profile-repeatability.md)
finds modification warnings on two profiles despite this patch being active.
Another profile clears them. This removes one identified trigger; it is not a
universal browser repair. The [remaining provider request](repair-request.md) is
prepared with all outcomes retained.

This is a local modification of AliasMode's Apache-2.0 source, not an official
vendor release. It keeps AliasMode as the profile/cookie/proxy owner and keeps
the installed Chromium binary, official CLI, Local API and plain Puppeteer.
It adds no page scripts or browser-global overrides.

Upstream: https://github.com/aliasmode/aliasmode

Pinned tag: `v0.1.0-beta.69`

Pinned commit: `9577c815e30af8958d5a604fe5c9820b6e400886`

Runtime/compiler: official Bun **1.2.21**, matching the installed sidecar.
The verified Windows baseline archive SHA-256 is
`23f2df1f40d963e5b6104e1a565df992aab8968da5004f460617073843b8b8be`.
The archive is available at
https://github.com/oven-sh/bun/releases/download/bun-v1.2.21/bun-windows-x64-baseline.zip.

The patch removes only `--fingerprint-noise` for an AliasMode Chromium profile
with the explicit tag `compelos-native-readback-v1`. Untagged profiles retain
their original flags. The profile's seed and other settings stay intact.
The rendering choice participates in the provider's certification-cache key
and CompelOS's frozen identity. Changing an existing reviewed profile requires
a new identity review; the patch does not migrate existing profiles.

Native readback exposes the machine's real canvas/WebGL image output. Profiles
on the same hardware can share those image characteristics. Clearing a
modification warning does not establish that profiles cannot be linked or that
automation is undetectable.

The official CLI gains these commands:

```powershell
aliasmode-mcp.exe profiles readback --mode capability --json
aliasmode-mcp.exe profiles readback --profile PROFILE_ID --mode status --json
aliasmode-mcp.exe profiles readback --profile PROFILE_ID --mode native --json
```

Capability and status are confirmed by the running manager, not inferred from
the helper executable. Configuration uses the existing version-fenced Cloud
profile editor and requires a closed, editable profile. Other tags and private
session/proxy data are preserved. No private payload is returned by the new
commands. `--mode seeded` reverses the opt-in after the profile is closed.

CompelOS creates new AliasMode Chromium profiles with this opt-in, after checking
the running manager's capability. Existing profiles are unchanged. Missing
support or changed configuration blocks attachment; there is no browser fallback.
Vendor updates can replace the local patch: revalidate and rebuild it against
the new version before running accounts.

## Reproduce the Windows sidecar build

Use a new checkout outside the installed application directory. Verify the
commit, archive hash and Bun version above before building. In that checkout:

```powershell
git checkout --detach 9577c815e30af8958d5a604fe5c9820b6e400886
git apply --unidiff-zero C:/path/to/compelos/provider/aliasmode-native-readback/aliasmode-beta69-native-readback.patch
& C:/path/to/bun.exe install --frozen-lockfile --ignore-scripts
& C:/path/to/bun.exe test fingerprint.test.ts agent-control.test.ts cloud-profile-editor.test.ts
& C:/path/to/bun.exe run ./node_modules/typescript/bin/tsc --noEmit
& C:/path/to/bun.exe build --compile --target=bun-windows-x64-baseline --define=ALIASMODE_COMPILED=true --external=playwright-core --external=chromium-bidi --external=electron sidecar-entry.ts --outfile ../candidate/aliasmode-sidecar.exe
```

Close every profile, confirm CompelOS has no active leases, then quit AliasMode
normally. Back up the original `aliasmode-sidecar.exe` and its hash before
replacing only that file. Keep `aliasmode.exe`, `aliasmode-mcp.exe`, all browser
cores, profiles and locks intact. Restart AliasMode and verify the running-manager
capability command. Retain the original sidecar for rollback while AliasMode is
closed. Never force-close an uncertain or externally owned profile.

The source patch and included license are published; executable builds and
private measurement data remain local. See
[the gate and provider validation report](../../docs/engine-gate-repair.md).
