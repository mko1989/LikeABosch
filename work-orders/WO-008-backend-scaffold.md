# WO-008: Backend scaffold

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-001 |
| **Assignee** | Claude Opus or Haiku |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
A runnable, tested, empty backend skeleton matching docs/architecture.md and DEC-002.

## Scope
- In: root `package.json` (`"type": "module"`, engines node>=22, scripts `start`, `dev`
  (`node --watch --env-file-if-exists=.env`), `test` (`node --test`)); deps `express@5`, `ws`;
  `backend/src/server.js` (Express app factory + listen, graceful shutdown);
  `backend/src/config.js` (env: `PORT`, `DICENTIS_WIRED_HOST`, `DICENTIS_WIRED_PORT`=31416,
  `DICENTIS_USER`, `DICENTIS_PASSWORD`, `DICENTIS_TLS_INSECURE`=true, `DICENTIS_WIRELESS_URL`, …);
  `backend/src/lib/errors.js` (envelope + codes from DEC-004, Express error middleware);
  `backend/src/lib/logger.js` (levels, timestamps, never logs passwords);
  `GET /api/health`; static serving of `web/` with a placeholder `index.html`;
  `.env.example`, `.gitignore` (node_modules, .env, data/); first test (`/api/health` 200 envelope).
- Out: any DICENTIS logic.

## Acceptance criteria
- [x] `npm install && npm test` passes.
- [x] `npm start` serves `/` and `/api/health` → `{ ok: true, data: { status: "up" } }`.
- [x] Unknown `/api/*` → 404 envelope; thrown error → 500 envelope.

## Work log
- 2026-10-02 (Claude Opus): Implemented. express 5.2.1, ws 8.22.0. Files: `package.json` (scripts start/dev/test/spec:check/docs:spec), `.gitignore`, `.env.example`, `backend/src/{config,app,server}.js`, `backend/src/lib/{errors,logger}.js`, `web/index.html` placeholder, `backend/test/scaffold.test.js` + `helpers/start.js`. `npm test`: 6/6 pass. Manual: `PORT=3917 node backend/src/server.js` → `/api/health` ok, SIGTERM shuts down cleanly.

## Decisions
- Env var names simplified vs. the original scope text: one set `DICENTIS_SYSTEM`, `DICENTIS_HOST`, `DICENTIS_PORT` (default 31416 wired / 80 wireless), `DICENTIS_USER`, `DICENTIS_PASSWORD`, `DICENTIS_TLS_INSECURE`, `DICENTIS_AUTOCONNECT`, plus `PORT`, `BIND_HOST`, `LOG_LEVEL`, `DATA_DIR`. `.env.example` is the reference. The launcher (WO-030) must use these names.
- `BIND_HOST` defaults to `127.0.0.1`: the UI has no auth (DEC-005), so LAN exposure must be an explicit choice.
- `app.js` = Express app factory (routes mounted here: feature WOs add routers to the `api` router before `apiNotFound`); `server.js` exports `start(config)` → `{server, url, close}` for tests and the launcher.
- Tests start the backend through `backend/test/helpers/start.js` (random port, silent logs, autoconnect off).

## Handoff
Done. Conventions for later WOs: throw `AppError(code, msg, extra)` from routes (Express 5 handles async throws); respond with `ok(data)`; new routers mount in `createApp`.
