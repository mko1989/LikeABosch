# DEC-008: Electron desktop launcher for setup, credentials and starting the app

- **Status:** accepted (launcher requested by user 2026-10-02; design proposed by Claude, revisable); amended by DEC-011 (Launch GUI opens the system browser)
- **WO:** WO-030
- **Amends:** DEC-002 (adds Electron and a second package.json), DEC-005 (where credentials come from)

## Context
Operators should not edit `.env` files or use a terminal. The user asked for a small Electron
launcher with basic setup, DICENTIS login credentials, and a "Launch GUI" button.

## Decision
- `launcher/` is a separate Electron app with **its own `package.json`**, so the heavy Electron
  dependency is not installed for headless/server deployments of the backend. This is the only
  exception to DEC-002's single-package rule.
- The launcher window is plain HTML/JS like the rest of the project, with a strict
  contextIsolation + preload bridge and no `nodeIntegration` in renderers. Its form holds:
  system type (wired/wireless), host, port, TLS-insecure toggle, DICENTIS username + password,
  web UI port. Buttons: **Save**, **Start/Stop server**, **Launch GUI**. It shows server and
  DICENTIS connection status (polls `GET /api/health` and `GET /api/connection`) and a log tail.
- **Server process:** the launcher spawns the backend (`backend/src/server.js`) as a child process
  using Electron's bundled Node (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`), so no separate
  Node install is needed. Config is passed as environment variables (same names as `.env`, WO-008),
  and the child is stopped when the launcher quits.
- **Credentials:** the password is encrypted with Electron `safeStorage` (OS keychain) in the
  launcher's userData. It is never written in plaintext to disk and is only passed to the child via env.
- **Launch GUI:** opens the web UI (`http://localhost:<port>/`) in an Electron window; a secondary
  "Open in browser" uses the system browser.
- Installers/packaging (electron-builder) are not part of WO-030; they belong to WO-029.

## Consequences
- The backend must accept all connection settings via env (WO-008) and must **not persist the
  password** in `data/settings.json` (WO-013 adjusted: password held in memory only).
- The headless mode (`npm start` at repo root + `.env`) stays fully supported.
