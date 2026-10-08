# WO-097: Test distribution build (macOS + Windows)

| | |
|---|---|
| **Status** | review |
| **Phase** | 4 Hardening |
| **Depends on** | WO-030, WO-080, WO-095 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
User (2026-10-07): "id like a \"simulate\" version too with different systems. exporting and importing such projects with the ability to match the connected system with the simulated project would be great. i also want to package it for test dist" Part 3: packaged test builds of the launcher + backend + web UI + simulations.

## Context
DEC-008 (launcher), DEC-022 (bridges), WO-029 (security/packaging, still draft for signing, service, auth).

## Scope
- In: `scripts/dist/build.mjs` (`npm run dist [-- --mac|--win] [--arm64|--x64|--universal]`): stage (backend/src, web, mock, docs/protocol, launcher, runtime deps via `npm ci --omit=dev`), electron-builder (launcher dev dependency): macOS zip + dmg (ad-hoc signed), Windows x64 portable zip with the built bridges in resources/bridges; `dist/README-TEST.txt` for testers.
- Out: code signing/notarisation, Windows installer (needs Wine on macOS or a Windows build machine), auto-update.

## Acceptance criteria
- [x] macOS x64 + arm64 zip/dmg, Windows x64 zip built (2026-10-07; sizes 135–161 MB).
- [x] Packaged app `--smoke-test`: "SMOKE TEST OK" (backend starts, GUI page served) on this Mac (x64).
- [x] Packaged backend (Electron as Node) runs a simulated wired system (12 seats) and links its project.
- [ ] Windows zip started on a Windows PC; arm64 build started on an Apple Silicon Mac (user/testers).

## Work log
- 2026-10-07 (Claude Opus): electron-builder 26.15.3 added to launcher devDependencies (build tool, not shipped:
  WO decision instead of a DEC). First build packaged twice (targets passed wrongly → stray `mac-undefined`): now the
  platforms are passed CLI-style and targets come from the config. Hardened runtime off (ad-hoc signature). The smoke
  test first said "bad option": the shell inherits ELECTRON_RUN_AS_NODE from VS Code; without it: SMOKE TEST OK.
  Checked the Windows zip contents (exe, backend, specs, mock certs, both bridges).

## Decisions
- asar off: the backend runs from the files as a child process (Electron as Node).
- Version `<package version>-test.<yyyymmdd>`; artefacts `LikeABosch-<version>-<os>-<arch>.<ext>` in `dist/` (gitignored).
- Windows as portable zip (no installer) so it builds on macOS without Wine.

## Handoff
Delivered: `dist/` test builds + tester notes. Status `review`. Open: try the Windows zip on a Windows PC (the bridges included are the last local builds of WO-061/078); unsigned → OS warnings (described in README-TEST.txt); a proper installer/signing stays with WO-029.
