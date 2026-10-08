# WO-069: dcn-bridge finds the DCN-SW folder; port follows a system switch in the launcher

| | |
|---|---|
| **Status** | review |
| **Phase** | 6 Windows API |
| **Depends on** | WO-061, WO-063, WO-068 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
Two problems the user reported on the first run on Windows:
1. `dcn-bridge.exe` without `--dll-dir` failed ("DCN-SW API not found: <exe folder>\Bosch.Dcn.Ecpc.Client.Api.Logic.dll")
   although DCN-SW is installed in its standard folder `C:\Program Files (x86)\Bosch\Digital Congress Network\DCN-SW`;
   `--dll-dir C:\Program Files (x86)\...` without quotes failed with "unexpected argument Files".
2. After switching the system to DCN in the launcher, the backend kept the DICENTIS port (31416) and did not connect
   until the port was changed in Settings → Connection.

## Context
WO-061 / WO-068 (bridge, `bridge/dcn/src/{Program,ApiHost}.cs`, README), WO-013 (settings precedence env > file),
WO-030 / WO-063 (launcher passes `DICENTIS_SYSTEM` always, `DICENTIS_PORT` only when set).

Root cause of 2: the launcher pins `system` through the environment but leaves `port` unpinned. `settings.json` keeps
the port that was saved while the system was wired, and pinned fields are never written to it, so on the next start
with `DICENTIS_SYSTEM=dcn` the backend restored 31416 without knowing it belonged to another system.

## Scope
- In:
  - Bridge: without `--dll-dir` / env / config, look for the API DLL next to the exe, then in the standard DCN-SW
    folder (`%ProgramFiles(x86)%` and `%ProgramFiles%` `\Bosch\Digital Congress Network\DCN-SW`), then a shallow search
    under `…\Bosch`; log which folder is used; the error lists where it looked.
  - Bridge: an unquoted path with spaces after `--dll-dir` / `--config` is joined back together (cmd splits it).
  - Example config and README: correct standard folder, quoting.
  - Backend: settings.json records which system the saved port belongs to (`portSystem`); a saved port of another
    system is ignored on load (legacy files without `portSystem`: ignored if it is another system's default port).
  - Launcher: switching the system clears a port field that holds the previous system's default.
  - Tests.
- Out: running against a live DCN-SW server (WO-065).

## Acceptance criteria
- [x] `dotnet build bridge/dcn -c Release` 0 warnings / 0 errors; `npm run bridge:test` 7/7.
- [x] Backend test: settings saved under wired, restarted with `DICENTIS_SYSTEM=dcn` → port 9480 (also for a legacy file): `backend/test/connection.test.js` 7/7.
- [x] Launcher test(s) green; `npm test` 200/200 (includes `launcher/test`).

## Work log
- 2026-10-05 (Claude Opus): created from the user's report (bridge console output + launcher port behaviour); root
  causes above.
- 2026-10-05 (Claude Opus): bridge: `ApiHost.FindDllDir` (exe folder → `%ProgramFiles(x86)%`/`%ProgramFiles%`
  `\Bosch\Digital Congress Network\DCN-SW` → search below `…\Bosch`, depth 4), used only when no dllDir is given by
  option/env/config; logs the folder; error names the places searched and says to quote. `Options`: words after
  `--dll-dir`/`--config` up to the next `--option` are joined with spaces. Example config had a guessed folder
  (`…\Bosch\DCN Conference Software`) → corrected. README: step 1 no longer suggests copying "the two DLLs" next to the
  exe (the API needs 13 DLLs + the remoting config of the DCN-SW folder). Checked with the net10 dev build:
  `--dll-dir <scratch>/Program Files "(x86)/x" --selftest` → error shows the joined path `…/Program Files (x86)/x/…`;
  no `--dll-dir` → searches and reports the standard folder; stray word → "values with spaces need quotes".
  Backend: `settings.json` gets `portSystem`; `ConnectionManager.load()` drops a saved port of another system
  (legacy files: if it equals another system's default). Launcher renderer: switching the system clears a port that
  equals the previous system's default (empty = default). Not run: the launcher window (no automated check exists
  for it; 3-line change reviewed by reading), the net48 exe on Windows.

## Decisions
- Auto-detection only when no folder is configured; an explicit `--dll-dir` that is wrong stays an error (no silent
  fallback to another installation).
- Joining unquoted words only for path options (`--dll-dir`, `--config`), not for `--token`: a token silently glued
  together from several words would just fail authentication later, which is harder to diagnose.
- `portSystem` instead of saving the pinned `system` in settings.json, so running without the launcher keeps its
  current behaviour.

## Handoff
Review: waiting for the user to confirm on Windows: `dcn-bridge.exe --selftest` from any folder should log
`DCN-SW API found in C:\Program Files (x86)\Bosch\Digital Congress Network\DCN-SW`; switching the launcher to DCN
should connect on 9480 without touching Settings. The existing `settings.json` on that PC is handled by the legacy
rule (31416 is the wired default). Rebuild needed: `dotnet build bridge/dcn -c Release`, copy `bin/Release/net48`.
