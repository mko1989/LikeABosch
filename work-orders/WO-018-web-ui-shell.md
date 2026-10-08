# WO-018: Web UI shell, API client and live store

| | |
|---|---|
| **Status** | done |
| **Phase** | 3 Web UI |
| **Depends on** | WO-013, WO-012 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
App skeleton in `web/`: layout + navigation, connection/settings page (WO-013 endpoints), `api.js` (envelope handling, errors → toasts), `store.js` (EventSource on /api/events, snapshot + topic updates, subscribe API), permission-aware rendering helper. **Must start with a DEC on UI structure** (module pattern, routing via hash, CSS approach, component conventions) since there is no framework.

## Scope (refined 2026-10-02)
- DEC-009 (UI structure), then: `web/index.html`, `css/app.css`, `js/{main,api,store,store-core,router,dom}.js`.
- Views: **Overview** (room, meeting + state, power mode, master volume, discussion summary, voting state; read-only) and
  **Connection** (status, settings form honouring `pinned`, password field, connect/disconnect, permissions list).
- Nav entries for upcoming views (Seats & discussion, Meetings, Voting, Participants, Interpretation, System) shown as "coming soon".
- Header: room name, active meeting, connection pill; toasts for API errors and `notification` events; banner when disconnected / SSE lost.
- Backend: CSP header for static files.
- Tests: `web/test/store-core.test.js` (node:test); `scripts/ui-check.cjs` (Electron: load, screenshot, fail on console errors).

## Original draft notes
- Read DEC-002 (plain HTML/JS, no framework) and the UI conventions decided in WO-018.
- Use only `web/js/api.js` + the SSE store for data; never call DICENTIS directly.
- Hide or disable controls the current permissions don't allow (`GET /api/connection` → permissions).
- Test manually against the mock and note the steps in the work log; real-server check goes into WO-028.

## Acceptance criteria
- [x] `npm test` includes and passes web store tests.
- [x] `scripts/ui-check.cjs` against backend + mock: no console errors; Overview shows mock room/meeting data; screenshot reviewed.
- [x] Connection view can save settings, connect, disconnect; pinned fields read-only.
- [x] A change on the mock (e.g. volume) appears in the UI without reload.
- [x] No `innerHTML` with dynamic data (grep check).

## Work log
- 2026-10-02 (Claude Opus): Refined draft → scope above; wrote DEC-009 (UI structure). Implemented `web/index.html`, `web/css/app.css` (tokens, light/dark, responsive nav), `web/js/{main,api,store,store-core,router,dom}.js`, views `overview.js` + `connection.js`, "soon" placeholders for WO-019…024. Backend: CSP + nosniff headers for static files. Tests: `web/test/store-core.test.js` (4, in `npm test`, now 55/55). `npm run ui:check` (`scripts/ui-check.mjs` + `ui-check-electron.cjs`): starts mock + backend, headless Electron (from `launcher/node_modules`), light + dark: visits views, screenshots, fails on console errors; clicks Disconnect/Connect and waits for the header pill via SSE; changes volume via API and waits for the Overview to update (no reload). All OK. Screenshots reviewed (Overview light, Connection dark): layout fine, pinned fields shown read-only with explanation. `grep innerHTML web/` → only the warning comment.

## Decisions
- DEC-009 (structure, rendering, data flow, testing).
- Header shows room + meeting; a banner explains when DICENTIS or the backend stream is not connected and links to Connection.
- The UI never changes state optimistically; it waits for SSE.
- Views not yet built are listed in the nav as "soon" so the operator can see the roadmap.

## Handoff
Done. For the next view WOs: copy the pattern in `views/overview.js` (card + subscribe) or `views/connection.js` (forms + actions); register the view in `web/js/main.js` (replace its `soon(...)` entry). Run `npm test` and `npm run ui:check -- <outDir> <route>` and look at the screenshots before marking a UI WO done.
