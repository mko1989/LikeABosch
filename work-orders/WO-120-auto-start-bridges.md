# WO-120: Launcher starts the bridges by itself when the Bosch DLLs are installed (DEC-037)

| | |
|---|---|
| **Status** | review |
| **Phase** | 3 Web UI |
| **Depends on** | WO-080 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-12 |
| **Updated** | 2026-10-12 |

## Goal
On Windows the launcher finds the DICENTIS / DCN-SW software and starts the matching bridge at app start, and the
backend uses it, without a setting.

## Context
User request 2026-10-12 (next.md). DEC-022, DEC-037, WO-080 (launcher runs bridges), WO-069 (bridge DLL search).

## Scope
- In: `launcher/lib/bosch-apis.js` (DLL detection, pure, testable), `neededBridges` with auto bridges, bridges started
  at app start and kept across server restarts, backend env (`DICENTIS_DCNM_BRIDGE`), launcher UI line, tests.
- Out: a Windows test run (needs a Windows PC with the Bosch software: WO-082 / WO-065).

## Acceptance criteria
- [x] Unit tests: detection (standard folders, search, configured folder, nothing found, non-Windows), needed bridges
      (auto on/off, manageBridges off, remote bridge host), backend env.
- [x] `npm test` passes; launcher smoke test passes.

## Work log
- 2026-10-12 (Claude Opus): created as ready.
- 2026-10-12 (Claude Opus): `launcher/lib/bosch-apis.js` (detection like the bridges' FindDllDir: configured folder,
  standard folder, search below Program Files\Bosch depth 4; DLL names from ApiHost/DcnmHost), `neededBridges(…, { found })`
  (auto bridges, configured ones keep priority / port, remote bridge hosts respected, `autoBridges` + `manageBridges`),
  `backendEnv(…, { dcnmAuto })`; main.js: detection + bridge start at app start (Windows), unchanged bridges keep running
  on server restarts (command-line key), server stop keeps the bridges, quit stops them; launcher UI: "Also start a bridge
  when its Bosch software is installed" + "Found on this PC: …", pills "(auto)".
- Evidence: launcher tests 21/21 (7 new in launcher/test/bosch-apis.test.js, fake Windows file system); `npm run smoke`
  in launcher/ SMOKE TEST OK; screenshot checked.

## Handoff
- Delivered: auto-start of the dicentis-bridge / dcn-bridge when their Bosch DLLs are installed (Windows), used by a
  wired connection automatically.
- Not run on Windows (no Windows PC here): check on the DICENTIS PC that the bridge starts with the app and the
  backend connects (WO-082).
