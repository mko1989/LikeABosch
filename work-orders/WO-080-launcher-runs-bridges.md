# WO-080: Launcher starts the Windows bridges as child processes (DEC-022)

| | |
|---|---|
| **Status** | review |
| **Phase** | 3 Web UI |
| **Depends on** | WO-030, WO-078, WO-079, WO-069 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
On Windows, the launcher starts dcn-bridge / dicentis-bridge when the configuration needs a local bridge, shows their
state and log, and stops them with the backend (DEC-022).

## Context
DEC-022, DEC-008, `launcher/lib/server-process.js` (pattern), `launcher/lib/settings-store.js`, bridge READMEs.

## Scope
- In: `launcher/lib/bridge-process.js` (spawn, READY line, log ring, stop, restart with backoff), `launcher/lib/bridges.js`
  (which bridges are needed for given settings and platform, exe path resolution), settings (`dcnmBridge`, `dcnmHost`,
  `dcnmPort`, `dcnmDevice`, `dcnBridgeDllDir`, `dcnmDllDir`, `dcnBridgeExe`, `dcnmExe`) + `backendEnv`, main.js wiring,
  renderer (DICENTIS bridge settings for wired, bridge status/log lines), tests with a fake bridge executable (Node script).
- Out: packaging the exe files (WO-029), Windows services.

## Acceptance criteria
- [x] Unit tests (`launcher/test/bridges.test.js` 7/7): isLocalHost, neededBridges (platform, system, local/remote host,
  manageBridges off, token, DLL folder), resolveExe (configured, packaged, launcher dir, build output, missing),
  bridgeArgs, backendEnv, BridgeProcess with a fake bridge (READY → running + logs + stop; fails at start → crashed with
  the reason, no restart; crash while running → restart).
- [x] `npm test` passes; launcher smoke test passes on macOS ("SMOKE TEST OK", no bridge started).
- [x] Screenshots checked: `data/ui-check/launcher-bridges.png` (default), `launcher-bridges-on.png` (wired + bridge on,
  temporary user-data folder so the real launcher settings were not touched).
- Not verified: an actual start of the exe on Windows (no Windows here) → status review, with WO-082.

## Work log
- 2026-10-07 (Claude Opus): created (ready).
- 2026-10-07 (Claude Opus): in-progress → review. `launcher/lib/bridges.js` (what to start, exe lookup, args: loopback,
  port, `--dll-dir`, `--token`), `launcher/lib/bridge-process.js` (spawn, READY line, log ring, restart with backoff,
  stop), settings (`dcnmBridge`, `dcnmHost`, `dcnmPort`, `dcnmDevice`, `dcnmServer`, `manageBridges`, `dcnBridgeDllDir`,
  `dcnmDllDir`, `dcnBridgeExe`, `dcnmExe`) + `backendEnv` (DICENTIS_DCNM_*, token also for wired + bridge), main.js
  (bridges started before the backend, stopped with it and on quit, state → `bridges:state`, logs into the server log),
  preload, renderer (DICENTIS bridge fields for wired, DCN-SW folder for dcn, token row for both, "Bridges (Windows)"
  panel, bridge pills), README section. Test problem: the restart timer was `unref`'d, so a test (and in theory the
  launcher between windows) could end while a restart was pending → kept referenced.

## Decisions
- A bridge that fails at start is not restarted (wrong DLL folder etc. would just loop); a crash while running is.
- The web UI Connection view does not show the dicentis-bridge settings yet (the backend settings API accepts them);
  left for WO-081 together with the DCNM features.

## Handoff
- On Windows with DICENTIS (or DCN-SW) installed: build the bridges (`dotnet build bridge/dicentis -c Release`,
  `bridge/dcn`), switch the bridge on in the launcher, Start. Check WO-082 for the first real run.
- Packaging (WO-029) must copy `bridge/*/bin/Release/net48/` into `resources/bridges/<dcn|dicentis>/`.
