# AliasMode native Firefox control

This is an Apache-2.0 source repair for AliasMode **v0.1.0-beta.69**, upstream
commit `9577c815e30af8958d5a604fe5c9820b6e400886`. It reuses the installed
Playwright Core **1.58.2** client and unchanged Firefox **156.0.1-beta.36** core.
Firefox is connected with its native protocol. Chromium's Puppeteer/CDP path
is unchanged. [Playwright documents both connection methods](https://playwright.dev/docs/api/class-browsertype).

The patch is self-contained and includes the preceding native-host/clock repair.
Apply it **alone to the clean pinned upstream commit**, not on top of an older
CompelOS patch. It publishes no browser binaries, cookies, proxy credentials,
profile databases or private endpoints. See `build-receipt.json` for installed
and source hashes and the bundled `LICENSE` for upstream licensing.

The manager exposes versioned `firefox.connectionCapability` and
`firefox.connection` calls. It certifies profile, generation, PID and actual mode
before returning the worker's existing random-path loopback native endpoint.
The owner token and profile directory never leave the manager. The CompelOS
adapter checks these values again after attaching, uses exactly one persistent
context, and reuses a worker tab only when its durable account-owned receipt
matches. Disconnect closes the transport; AliasMode retains lifecycle control.

Only newly created Firefox profiles receive `compelos-firefox-native-v1` and
the Firefox core's explicit `allowMainWorld` page-query opt-in. Ordinary DOM,
fetch and binary rendering reads use its existing `mw:` interface. This does
not disable world isolation, install scripts or change browser globals.
These profiles start blank on every launch; cookies and storage are retained,
but saved, home and requested startup URLs cannot create unreserved visits.
Legacy profiles are not rewritten. Missing capability, tag, mode or ownership
evidence blocks attachment. The installed native client also supports
`discoverRuntime({launch:false})` to prevent an implicit second app launch.

Rebuild in a clean pinned AliasMode checkout after applying the patch:

```powershell
git apply --check <path-to>/aliasmode-beta69-firefox-control.patch
git apply <path-to>/aliasmode-beta69-firefox-control.patch
bun install --frozen-lockfile
bun run typecheck
bun test native-clock.test.ts fingerprint.test.ts create.test.ts agent-control.test.ts agent/runtime-client-no-launch.test.ts cloud-profile-editor.test.ts adspower-users.test.ts launcher.test.ts ui.test.ts firefox-control.test.ts cloud-browser.test.ts
bun build --compile --target=bun-windows-x64-baseline --define=ALIASMODE_COMPILED=true --external=playwright-core --external=chromium-bidi --external=electron sidecar-entry.ts --outfile aliasmode-sidecar.exe
```

The recorded build uses Bun **1.2.21**. Stop the CompelOS agent gracefully,
verify zero live account leases and all profiles closed, and quit AliasMode
normally before replacing its sidecar and `playwright/agent/runtime-client.mjs`.
Compare-and-swap the previous installed hashes, retain private backups, verify
new hashes, then relaunch the existing app. Never remove real profile locks or
directories, overwrite a changed installation, or force-stop unknown owners.

The anonymous integration measurement is explicitly invoked with
`node scripts/engine-firefox-fixture.cjs` from a configured local runtime.
It creates only disposable unmapped profiles, checks native navigation,
reconnect, blank restart, synthetic sign-in persistence and intercepted Voyager
reads, and removes only its own confirmed-closed profiles through AliasMode.
It does not contact LinkedIn or authorize an account start.
