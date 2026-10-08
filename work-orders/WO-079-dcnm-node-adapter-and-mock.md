# WO-079: DCNM Node adapter, mock bridge, second connection next to the Conference Protocol

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-077, WO-078 (BRIDGE.md) |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
The backend talks to a dicentis-bridge (or the mock) next to the Conference Protocol: passthrough for every DCNM API
method, properties, and a generic state mirror of every event, so the full API is reachable over HTTP/SSE (DEC-021 §4–5).

## Context
DEC-021, DEC-020 (pattern for a secondary connection), `backend/src/dcn/` (client to reuse), BRIDGE.md (WO-078).

## Scope
- In: `backend/src/dcnm/` (client on a shared bridge client base, spec, routes `/api/dcnm/...`, event mirror → topics
  `dcnm.<Api>.<Event>`, status topic `dcnmStatus`, initial `Request…Async` sweep); connection manager + config
  (`dcnmBridge`, `dcnmHost`, `dcnmPort`, `dcnmDevice`, env `DICENTIS_DCNM_*`), `/api/connection` → `dcnm`;
  `mock/dcnm/` (bridge protocol, spec-driven defaults + a few behaviours), `npm run mock:dcnm`; tests; docs
  (`docs/api.md` if present, architecture).
- Out: DICENTIS semantics in the domain/UI (WO-081), launcher (WO-080).

## Acceptance criteria
- [x] Backend tests against `mock/dcnm` pass (`backend/test/dcnm.test.js` 8/8): spec, connect sequence, errors,
  DICENTIS away/back (re-open), connection status, sweep + mirror, passthrough call/props, validation (400/404),
  data-class arguments, handles + callbacks over HTTP, bridge failure isolation (wired stays loggedIn).
- [x] The backend works against the real dicentis-bridge in `--fake` mode (last test of the bridge conformance).
- [x] `npm test` passes (219/219).

## Work log
- 2026-10-07 (Claude Opus): created (ready).
- 2026-10-07 (Claude Opus): done. `backend/src/lib/bridge-socket.js` (NDJSON transport shared with DcnClient; DcnClient
  moved onto it, dcn tests and dcn-bridge conformance unchanged green); `backend/src/dcnm/` client (connect sequence,
  loggedIn = open + authenticated, re-open when DICENTIS drops, heartbeat, reconnect), spec (keys like the bridge,
  inherited members, light validation, sweep list without the VU meter stream), mirror (topics `dcnm.<Api>.<Event>`,
  `dcnmStatus`, `dcnmCallback`, `dcnmSweep`; coalescing ≥100 ms; removed on disconnect), routes `/api/dcnm/*`;
  config/env `DICENTIS_DCNM_*`, manager `dcnmClient` + `status().dcnm`; `mock/dcnm/server.js` (`npm run mock:dcnm`);
  docs `docs/api/dcnm-passthrough.md`, architecture. One test fix: waiting for "the next event" caught a late
  OpenStateChanged → wait for the named event.

- 2026-10-07 (Claude Opus): status `seq` handling + honest sweep counts (race found by repeated bridge runs, see WO-078);
  new test "a status older than one already seen is ignored". `backend/test/dcnm.test.js` 9/9.

## Decisions
- Generic mirror instead of per-event topics: 169 events without per-event code; DICENTIS semantics on top in WO-081.
- Bridge credentials = the wired user/password (one DICENTIS user); the bridge token setting is shared with DCN.
- Default bridge host 127.0.0.1 (the launcher starts it, DEC-022).

## Handoff
- `/api/dcnm/*` + SSE topics give the whole DCNM API to the UI and scripts. No UI yet (WO-081); launcher: WO-080.
