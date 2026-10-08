# LikeABosch Launcher (Electron)

Desktop launcher for LikeABosch: configures the DICENTIS connection, start/stop the backend, and open the web UI
(WO-030, DEC-008).

```
cd launcher
npm install
npm start          # opens the launcher
npm run smoke      # headless self-test: loads UI, starts backend, checks the web UI is served, stops; exit 0/1
LAUNCHER_SCREENSHOT=/tmp/l.png npm run smoke   # also saves a screenshot of the launcher window
```

The backend's own dependencies must be installed at the repo root (`npm install` there).

## How it works
- `main.js`: Electron main process. IPC handlers for settings and server; **Launch GUI opens the system browser**; quits the backend on exit.
- `preload.cjs`: the only bridge to the renderer (`window.launcher.*`). contextIsolation + sandbox, no nodeIntegration.
- `renderer/`: plain HTML/CSS/JS form (CSP: self only).
- `lib/settings-store.js`: settings in `<userData>/launcher-settings.json`; password **encrypted** with
  Electron `safeStorage` in `<userData>/dicentis-password.bin` (never plaintext). `backendEnv()` builds the
  backend environment.
- `lib/server-process.js`: spawns `backend/src/server.js` with Electron's bundled Node (`ELECTRON_RUN_AS_NODE=1`),
  waits for `/api/health`, collects the log, stops with SIGTERM then SIGKILL, and reports "port in use".
- The backend's data dir is `<userData>/backend-data`. `userData` on macOS is `~/Library/Application Support/likeabosch-launcher`.

## Settings ownership
Connection fields filled in here are passed as environment variables and become **pinned** (read-only)
in the web UI's settings. Leave a field empty to manage it from the web UI instead (WO-013).

## Gotcha
If `ELECTRON_RUN_AS_NODE` is set in your shell (it is in VS Code's integrated terminal), plain `electron .`
runs `main.js` as Node and fails with *"electron does not provide an export named BrowserWindow"*.
`npm start` uses `run-electron.cjs`, which clears the variable.

## Not yet
Installers / code signing: WO-029.

## Windows bridges (DEC-022, WO-080)
On Windows the launcher starts the bridge your settings need **on this PC**, before the backend, and stops it with the
backend and on quit:
- system **DICENTIS (wired)** with "Full DICENTIS API through the dicentis-bridge" and an empty (or local) bridge host →
  `dicentis-bridge.exe` (needs the DICENTIS software on this PC, DEC-021);
- system **DCN … via dcn-bridge** with host `localhost` (or this PC) → `dcn-bridge.exe` (needs DCN-SW on this PC).
A bridge started by the launcher listens on 127.0.0.1 only; the bridge token (if set) is passed to it. The exe is looked
up in `resources/bridges/<dcn|dicentis>/` (packaged app), `bridges/<…>/` next to the launcher, then the build output
`bridge/<…>/bin/Release/net48/`; "Bridges (Windows)" in the launcher overrides the path or turns this off. State and
log lines appear next to the server's (pills at the top, "Server log"). A crashed bridge is restarted with backoff; one
that fails at start (e.g. DLLs not found) is reported and the backend keeps trying to reach it. On macOS/Linux nothing is
started (run the bridge on the Windows PC and enter its host).
