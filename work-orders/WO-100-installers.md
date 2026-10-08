# WO-100: Installers: Windows setup (NSIS), macOS dmg, app icon

| | |
|---|---|
| **Status** | review |
| **Phase** | 4 Hardening |
| **Depends on** | WO-097 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-08 |
| **Updated** | 2026-10-08 |

## Goal
User (2026-10-08): "create a proper dist with installer". `npm run dist` produces installable builds: a Windows
setup .exe (install folder choice, Start menu + desktop shortcut, uninstaller in "Apps"), a macOS dmg with the
Applications link, both with a LikeABosch app icon and a plain release version, plus the portable zips from WO-097.

## Context
WO-097 (test build script `scripts/dist/build.mjs`, electron-builder in the launcher's devDependencies) left the
Windows installer out because it assumed Wine is needed on macOS. electron-builder ships a native macOS `makensis`, so
the NSIS installer builds here. DEC-008 (launcher), DEC-016 (per-user data folder: nothing is written to the install
folder, so `Program Files` is fine), DEC-022 (bridges in `resources/bridges`). Signing/notarisation, service install
and UI auth stay in WO-029 (no Apple / Authenticode certificate on this machine).

## Scope
- In: app icon (SVG source → 1024 px PNG; electron-builder derives .icns/.ico); NSIS assisted installer (per-user or
  all users, choose folder, shortcuts, uninstaller keeps the user's data); release vs test version (`--test` keeps the
  WO-097 `-test.<date>` suffix); exe icon + version resources when possible; installer licence/readme text; tester /
  operator notes updated (`dist/README.txt`); build verified on this Mac.
- Out: code signing, notarisation, auto-update, Windows service, MSI (WO-029).

## Deliverables
`launcher/build/icon.svg` + `icon.png`, `scripts/dist/build.mjs`, `dist/README.txt`, this WO.

## Acceptance criteria
- [x] `npm run dist` builds `LikeABosch-<v>-win-x64-setup.exe`, the Windows zip, and macOS x64 + arm64 dmg/zip.
- [x] The setup .exe is a valid NSIS installer containing the app, the backend, and both bridges (listing checked).
- [x] macOS app carries the icon (`.icns` in the bundle); packaged app verified (see log: `--smoke-test` blocked by a
  keychain prompt on this dev Mac, verified by running the bundled backend instead).
- [x] Windows exe has the LikeABosch icon and version info.
- [x] `npm test` still passes.
- [ ] Setup .exe installed and started on a Windows PC (user/testers).

## Work log
- 2026-10-08 (Claude Opus): WO created from the user's request; WO-029 keeps signing/service/auth.
- 2026-10-08 (Claude Opus): app icon `launcher/build/icon.svg` (conference desk unit + gooseneck mic with lit ring, UI
  accent blue; nothing from Bosch's branding) → `icon.png` 1024 px with rsvg-convert; checked at 1024 and 128 px (first
  draft had the mic head sideways, redrawn along the gooseneck tangent).
  `scripts/dist/build.mjs`: `icon`, `copyright`, win targets `nsis` + `zip`, `nsis` options, `signExecutable: false`
  instead of `signAndEditExecutable: false` (electron-builder 26 edits exe resources with resedit, no Wine; the cache has
  a native macOS makensis), release version by default (`--test` = WO-097 naming), macOS x64 + arm64 by default,
  `dist/README.txt` (install / update / uninstall / first start) replaces README-TEST.txt.
  `npm run dist`: built mac-x64 dmg/zip (141 MB), win-x64 zip (161 MB), win-x64-setup.exe (118 MB); then
  `npm run dist -- --mac --arm64`. Checks:
  - setup.exe listed with the cached 7zz: NSIS stubs + `app-64.7z` (2136 files) containing LikeABosch.exe,
    resources/app/{backend/src/server.js, launcher/main.js, mock/wired/certs, docs/protocol, node_modules/express},
    resources/bridges/dcn/dcn-bridge.exe, resources/bridges/dicentis/dicentis-bridge.exe; uninstaller included.
  - win-unpacked/LikeABosch.exe read with resedit: VersionInfo ProductName/CompanyName LikeABosch, FileVersion 0.1.0,
    © 2026; icon group 16…256 px; the 256 px image is our icon (looked at it).
  - mac x64 + arm64: `Contents/Resources/icon.icns`, CFBundleShortVersionString 0.1.0, ad-hoc signature valid, arm64
    binary is Mach-O arm64; dmg mounted: LikeABosch.app + `Applications -> /Applications`.
  - Packaged `--smoke-test` hung on this Mac: SecurityAgent was up — the `LikeABosch Safe Storage` keychain item was
    created 2026-10-07 by the WO-097 build, the new ad-hoc signature differs, so macOS asks before safeStorage can use
    it (also with a fresh --user-data-dir, the item is per app name). Not a build defect; did not delete the item (it
    holds the key of the user's saved password). Unpackaged `npm run smoke`: SMOKE TEST OK. Packaged backend (bundle's
    Electron as Node, scratch DATA_DIR): `/api/health` up, `/` serves the LikeABosch page, `LIKEABOSCH_SIMULATE=wired:12`
    → state loggedIn, simulated "DICENTIS demo" 12 seats, 52 topics. Install notes tell users about the one-time
    keychain prompt after an update.
  - `npm test`: 272 pass, 0 fail.
  README.md, CLAUDE.md (build line), architecture.md (launcher/build) updated.

## Decisions
- Windows: NSIS assisted installer (not one-click): user picks "only me" (no admin) or all users, and the folder;
  shortcuts on desktop + Start menu; runs after finish; user data kept on uninstall (`deleteAppDataOnUninstall: false`).
  Portable zip still built for installs without rights.
- Default version is the plain package version (0.1.0); `--test` keeps `-test.<yyyymmdd>`. Bump `package.json` for a
  new release; electron-builder writes it into the exe / Info.plist.
- macOS default builds both x64 and arm64 (WO-097 built only this Mac's arch) so one run produces the full set.
- Icon is a project asset (SVG source + rendered PNG committed); no new dependency (rsvg-convert only needed to re-render).

## Handoff
Delivered: `npm run dist` → `dist/LikeABosch-0.1.0-win-x64-setup.exe` (+ zip), `LikeABosch-0.1.0-mac-{x64,arm64}.dmg`
(+ zip), `dist/README.txt`; app icon in `launcher/build/`. Status `review`.
Open:
- Install the setup .exe on a Windows PC (only me / all users, shortcut, start, uninstall keeps %APPDATA%\LikeABosch),
  and start the arm64 dmg on an Apple Silicon Mac (user/testers).
- On this Mac, the first start of the new build shows a keychain prompt (unsigned rebuild): allow it once, then
  `--smoke-test` runs unattended again.
- Unsigned: SmartScreen / Gatekeeper warnings and the keychain prompt after every macOS update disappear only with
  Authenticode + Developer ID signing and notarisation (WO-029). The Windows firewall prompt could be avoided with an
  installer-added rule for all-users installs (WO-029).
- `dist/` still holds the WO-097 `-test.20261007` artefacts; delete them when no longer needed.
