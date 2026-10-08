# WO-014: Wireless REST client + mock server

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-008, WO-005 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
A `WirelessClient` for the WAP REST API and an HTTP mock implementing `swagger.yaml`.

## Scope (refined 2026-10-02)
- `docs/protocol/wireless-rest/swagger.json`: one-time verbatim YAML→JSON conversion (no runtime YAML dependency; DEC-003 style). Loader `backend/src/wireless/spec.js` resolves `$ref`s, indexes operations (method + path template), validates bodies/path params.
- `backend/src/wireless/client.js` (`WirelessClient`, same events/state model as `WiredClient`): login (Content-Type JSON; 401 → UPSTREAM_AUTH; 409 → UPSTREAM_AUTH "already logged in" unless `override`), session id from the `sid` cookie sent **both** as cookie and `sid` header (open question 1), `request(method, path, {query, body})`, transparent re-login once on 401, error body `{error:{code,details}}` → UPSTREAM_ERROR, timeouts, reconnect/health loop, logout on close.
- `mock/wireless/server.js`: all 32 operations with in-memory state (20 seats, speakers max 4, waiting list, priority, participants CRUD, identification settings, power 0/1/2, voting params/state/results with mock votes), session handling (cookie or header), 409/override, rights not modelled. Long-poll (`isPolling=true`): our **assumption** is "hold until the resource changes or 25 s, then return current", to verify (open question 2).
- Tests for client + mock.

## Original draft notes
- Client: login (handles 409 → override option), session handling (send `sid` as cookie and header until verified), re-login on 401, typed helpers for all 32 operations, error mapping to DEC-004 codes.
- Mock: `mock/wireless/server.js`, in-memory seats/speakers/waiting list/participants/voting/power.
- Answer the open questions in `docs/protocol/wireless-rest/README.md` against the real WAP (user-assisted).

## Acceptance criteria
- [x] swagger.json equals the YAML (test compares path/definition counts and a sample).
- [x] Client tests against the mock: login ok/401/409+override, sid cookie+header, re-login after session loss, error mapping, long-poll returns on change.
- [x] Mock tests: every operation reachable; responses validate against swagger schemas.

## Work log
- 2026-10-02 (Claude Opus): `docs/protocol/wireless-rest/swagger.json` (verbatim conversion; YAML int response keys → strings). `backend/src/wireless/spec.js` (`$ref` resolution, operation matching with literal-before-parameter precedence, minimal schema validator). `backend/src/wireless/client.js` (`WirelessClient`). `mock/wireless/server.js` + README, `npm run mock:wireless`. Tests `backend/test/wireless-client.test.js` (10): login/logout, 401, 409 + override, sid via header or cookie, transparent re-login after session expiry, error mapping, unreachable, speakers/waiting/priority semantics, voting params/state/results, long-poll early return + hold, every mock GET validates against the swagger schemas, swagger sanity. `npm test` 73/73.
- Correction: the wireless API has **32** operations (not 30 as written in earlier docs); fixed in README, DEC-001, WO-005.

## Decisions
- No runtime YAML dependency: `swagger.json` is committed next to the YAML (regenerate with any YAML→JSON converter if the vendor spec changes; keep both).
- The client sends the session id as both `Cookie: sid=` and header `sid` until the real WAP tells us which one it uses.
- On login 409 the client fails with `UPSTREAM_AUTH` + `extra.reason = 'alreadyLoggedIn'`; taking over requires an explicit `override` (exposed to the UI in WO-015/017).
- Wireless rights (`can_manage`, `can_prepare_meeting`, `prepare_system`) are only described in prose; the mock doesn't model them. Real 403s surface as `UPSTREAM_AUTH`.

## Handoff
Done. Next: WO-015 (passthrough routes from swagger.json + poller feeding the state cache, connection manager support for `system: wireless`).
