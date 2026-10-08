# DEC-022: The launcher runs the Windows bridges as child processes when needed

- **Status:** accepted (requested by the user 2026-10-07: "the final app should run the bridge apps as subprocesses
  when needed (of course windows only)"; design by Claude)
- **WO:** WO-080
- **Extends:** DEC-008 (launcher spawns the backend), DEC-017 (dcn-bridge), DEC-021 (dicentis-bridge)

## Context
Until now the dcn-bridge had to be started by hand on the DCN-SW PC. With the dicentis-bridge there are two Windows
helpers. When LikeABosch itself runs on that Windows PC, the launcher can start and stop them.

## Decision
1. On **Windows only**, before starting the backend, the launcher starts the bridge the configuration needs:
   - `system: "dcn"` and the bridge host is local (`''`, `localhost`, `127.0.0.1`, `::1` or this PC's name) → dcn-bridge;
   - `system: "wired"` with `dcnmBridge` on and a local `dcnmHost` → dicentis-bridge.
   On other platforms, or with a remote host, nothing is started (the bridge runs elsewhere, as before).
2. **Executables**: `bridges/dcn/dcn-bridge.exe` and `bridges/dicentis/dicentis-bridge.exe` next to the launcher
   (packaged build), or the build output `bridge/<name>/bin/Release/net48/` (development); a launcher setting can point
   to another path. Missing exe → a clear launcher message, the backend still starts (the bridge connection then just
   keeps reconnecting).
3. **Process**: `lib/bridge-process.js` (pure Node, testable like `server-process.js`): spawn with
   `--listen 127.0.0.1 --port <configured port>` (+ `--dll-dir` if set), `windowsHide`, wait for the bridge's
   `READY port=<n>` stdout line (timeout), keep the last log lines, show state and log in the launcher. Stopped together
   with the backend and on quit (graceful, then kill). A crash is shown and restarted with backoff while the server runs.
4. Settings (launcher): `dcnmBridge`, `dcnmHost`, `dcnmPort`, `dcnmDevice`, plus `dcnBridgeDllDir`, `dcnmDllDir`,
   `dcnBridgeExe`, `dcnmExe` (empty = default). The backend gets the matching `DICENTIS_*` environment.

## Consequences
- On a Windows PC with DCN-SW or DICENTIS installed, "Start" in the launcher brings up everything; no manual bridge.
- A bridge started by the launcher listens on 127.0.0.1 only, so the "no token" default (DEC-019) is safe there.
- Packaging (WO-029) must copy the bridge build outputs into `bridges/`.

## Alternatives considered
- **Backend spawns the bridges:** the backend is also run without the launcher (`npm start`, other OS). Keeping
  process management in the launcher matches DEC-008. Rejected.
- **Windows services for the bridges:** survives logoff, but needs installation/admin rights. Possible later (WO-029).
