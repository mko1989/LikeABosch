# WO-013: Connection management and settings

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-009, WO-012 |
| **Assignee** | Claude Opus or Haiku |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
The UI can configure, connect, disconnect and observe the connection to a DICENTIS system without restarting the backend.

## Scope
- In: `GET /api/connection` (system type, host, state, logged-in user, permissions, last error);
  `PUT /api/connection/settings` (system `wired|wireless`, host, port, user, password, tlsInsecure, persisted to `data/settings.json` **without the password**: the password is held in memory only and comes from env (`.env` or the launcher, DEC-008) or this endpoint; it is never returned);
  `POST /api/connection/connect`, `POST /api/connection/disconnect`;
  connection state also pushed on SSE topic `connection`; auto-connect on start if settings exist.
- Out: UI (WO-018).

## Acceptance criteria
- [x] Tests against mock: settings round-trip (password masked), connect/disconnect, wrong password → state with error.
- [x] ~~`.env` values act as defaults; saved settings override.~~ Changed: env-provided fields are **pinned** (see Decisions); unpinned fields are saved and reloaded.

## Work log
- 2026-10-02 (Claude Opus): Scope adjusted per DEC-008: password is never persisted by the backend.
- 2026-10-02 (Claude Opus): Implemented `backend/src/connection/{manager,routes}.js`; `config.js` now reports `pinned` fields (set via env). `server.js`'s temporary autoconnect (WO-011) replaced by `ConnectionManager.start()`. SSE: `connection` event sent first to new clients and on every state/settings/permissions change. Test helpers: throwaway `DATA_DIR`, `startConnectedBackend(mock)`. Tests `backend/test/connection.test.js` (6): settings round-trip (no password in response or file), validation details, connect/disconnect (cache cleared, passthrough 503 after), wrong password → 401 + status.lastError, missing host / wireless → 400, pinned fields read-only + reload after restart, SSE connection events. `npm test` 45/45.

## Decisions
- **Settings precedence: environment > saved file > defaults.** Fields given via env (launcher or `.env`) are *pinned*: the settings API rejects changes to them, and `GET /settings` lists them in `pinned` so the UI can show them read-only ("managed by launcher"). This replaces the original "saved settings override .env": otherwise a stale UI-saved host would silently override what the operator entered in the launcher (DEC-008). One owner per field.
- Settings changes take effect on the next `POST /connect` (no implicit reconnect). `connect` always closes the previous client first.
- Changing `system` resets `port` to that system's default unless the port is given or pinned.
- `POST /connect` waits for the login result: auth failure → 401 `UPSTREAM_AUTH`; network failure → 503 `NOT_CONNECTED`, and the client keeps retrying in the background (visible in `state: reconnecting`).
- Wireless: `connect` returns 400 until WO-014/015.

## Handoff
Done. Launcher (WO-030) should pass connection settings as env (they become pinned), or leave fields empty to let the web UI manage them. Endpoint summary is in `backend/src/connection/routes.js`; add it to the API docs in WO-016.
