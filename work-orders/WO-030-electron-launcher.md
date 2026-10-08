# WO-030: Electron launcher (setup, credentials, start server, launch GUI)

| | |
|---|---|
| **Status** | done |
| **Phase** | 3 Web UI |
| **Depends on** | WO-008, WO-013 |
| **Assignee** | — |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
A small desktop app that lets an operator enter DICENTIS connection settings and credentials,
start/stop the backend, and open the web UI with one click (DEC-008).

## Context
Read DEC-008 (design), DEC-002 (stack), WO-008 (env variable names), WO-013 (connection endpoints).

## Scope
- In:
  - `launcher/package.json` (electron as devDependency, `npm start` → `electron .`), `launcher/main.js`,
    `launcher/preload.js` (contextBridge API: `getSettings`, `saveSettings`, `startServer`,
    `stopServer`, `serverStatus`, `launchGui`, `openInBrowser`, `onLog`), `launcher/renderer/index.html|css|js`.
  - Settings form: system type, host, port (default 31416 for wired), TLS-insecure, username,
    password (masked, show/hide), web UI port (default 3000). Validation of required fields.
  - Persistence: non-secret settings as JSON in `app.getPath('userData')`; password via `safeStorage`.
    If `safeStorage.isEncryptionAvailable()` is false, don't persist the password and say so in the UI.
  - Server lifecycle: spawn the backend with `ELECTRON_RUN_AS_NODE=1`, pass env, pipe stdout/stderr
    to a log panel (last ~500 lines), detect readiness via `/api/health`, stop on Stop or app quit
    (SIGTERM, then kill after timeout), and show a clear error if the port is in use.
  - Status: server state (stopped/starting/running/crashed) and DICENTIS connection state from `/api/connection`.
  - Launch GUI: BrowserWindow to `http://localhost:<port>/` (enabled only while running), plus "Open in browser".
  - `launcher/README.md`: how to run in dev.
- Out: installers/code signing (WO-029); any DICENTIS logic in the launcher (it only configures the backend).

## Acceptance criteria
- [x] `cd launcher && npm install && npm start` opens the launcher.
- [x] Save → restart launcher → settings restored; password not visible in any plaintext file (grep userData).
- [x] Start → backend reachable at `/api/health`; Stop/quit → no orphan node process.
- [x] With the wired mock running, the status shows the connection as logged in.
- [x] Launch GUI opens the web UI.

## Work log
- 2026-10-02 (Claude Opus): Implemented `launcher/` (Electron 44.5.1 devDependency in `launcher/package.json`): `main.js`, `preload.cjs`, `renderer/{index.html,style.css,app.js}`, `lib/settings-store.js`, `lib/server-process.js`, `run-electron.cjs`, `README.md`. Electron-free logic is tested with node:test in `launcher/test/launcher-lib.test.js` (6 tests, included in root `npm test`): settings store + encrypted password (no plaintext on disk), no-safeStorage fallback, env building, start/health/stop with no orphan, port-in-use → crashed, backend started with launcher env logs in to the wired mock (fields pinned). `npm run smoke` (headless Electron): preload bridge present, backend spawned via `ELECTRON_RUN_AS_NODE`, health ok, GUI window loads the web UI, clean stop → `SMOKE TEST OK`. Root `npm test` 51/51.
- Problems found and fixed: (1) health-check `fetch` had no timeout and hung forever when another process held the port without answering, so all launcher fetches now time out. (2) `ELECTRON_RUN_AS_NODE=1` is set in VS Code's terminal and broke `electron .`; `run-electron.cjs` clears it. (3) `isMain` checks in `backend/src/server.js` / `mock/wired/server.js` built `file://` URLs by string concat (broken on Windows paths), now `pathToFileURL`.
- Visual check via `LAUNCHER_SCREENSHOT`: moved Start/Launch GUI into a sticky footer because Launch GUI was below the fold.

- 2026-10-03 (Claude Opus): User request: Launch GUI opens the **system browser** instead of an Electron window (DEC-011). Removed the GUI window, the IPC `gui:openExternal` and the "Open in browser" link; smoke test now checks the served page. `npm run smoke` OK.

## Decisions
- The launcher passes only **non-empty** connection fields as env → they're pinned in the web UI; empty ones are web-UI-managed (consistent with WO-013).
- "Allow access from other computers" (BIND_HOST 0.0.0.0) is off by default and shows a warning (no UI auth yet, DEC-005).
- Saving while the server runs offers "Restart server" instead of silently restarting.
- The GUI window only navigates within the backend origin; other links open in the system browser.

## Handoff
Done. Interactive behaviour (typing, buttons) was verified through the libs' tests and the smoke test, not by clicking; the user should give it a manual try with `cd launcher && npm start`. Packaging is WO-029.
