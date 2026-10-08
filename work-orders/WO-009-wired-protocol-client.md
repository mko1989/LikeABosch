# WO-009: Wired protocol client (WebSocket)

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-008, WO-003 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
A robust `WiredClient` that speaks the Conference Protocol: connect, login, request/response
matching, events, errors, timeouts, reconnect.

## Context
`docs/protocol/conference/README.md` (transport, message format, errors, events, auth).

## Scope
- In: `backend/src/wired/client.js` (EventEmitter):
  - `connect({host, port, user, password, tlsInsecure})` → opens `wss://host:port/Dicentis/API`,
    subprotocol `DICENTIS_1_0`, then `Login`; rejects if `loggedIn` false.
  - `request(operation, parameters = {}, {timeoutMs})` → Promise of response `parameters`;
    messageIds start at 1 and never use 0; `operation === "error"` → rejects with `UpstreamError`.
  - Emits `event` (array of names) for messageId 0 / operation `event`; `state` changes
    (`disconnected|connecting|connected|loggedIn|reconnecting`); `error`.
  - Malformed-request close / network drop → reject all pending, auto-reconnect with backoff
    (configurable, off in tests), re-login, re-emit `loggedIn` so subscribers re-register events.
  - `close()` sends `Logout` (best effort) then closes.
- Out: HTTP routes (WO-011), event→refresh logic (WO-012), mock server (WO-010; may be developed in parallel; tests need it).

## Acceptance criteria
- [x] Unit tests against the mock (WO-010): login ok/fail, request/response matching with interleaved events, error op, timeout, reconnect.
- [x] No unhandled promise rejections on disconnect.
- [x] JSDoc on public API.

## Work log
- 2026-10-02 (Claude Opus): Implemented `backend/src/wired/client.js` (`WiredClient`, EventEmitter). Tests `backend/test/wired-client.test.js` (9) against the mock: connect/login, wrong password → UPSTREAM_AUTH without reconnect, unreachable → NOT_CONNECTED, server error → UPSTREAM_ERROR (+`extra.upstream`), request before connect, events interleaved with responses, timeout, connection drop → pending rejected + auto-reconnect + re-login (`loggedIn` emitted again), close() stops reconnecting. All pass; no unhandled rejections reported by node:test.
- Found during implementation: a login timeout used to leave the socket open while scheduling a reconnect. Fixed by detaching/terminating the socket in connect()'s error path.

## Decisions
- Errors are thrown as `AppError` with DEC-004 codes directly from the client, so routes can pass them through unchanged.
- `connect()` rejects on failure **and** keeps reconnecting in the background (unless auth failed or reconnect is disabled). Callers should observe `state` rather than retrying themselves.
- Reconnect backoff: min 1 s doubling to max 30 s (configurable). `loggedIn` fires after every login: consumers (WO-012) re-register events there.
- A `Login` response with `loggedIn: false` is treated as auth failure. Whether the real server instead returns an `error` is unknown; both end up as an error (to verify in WO-028).

## Handoff
Done. API: `new WiredClient({host, port, user, password, tlsInsecure, requestTimeoutMs, connectTimeoutMs, reconnect, log})`, `connect()`, `request(op, params, {timeoutMs})`, `close()`, `state`, `lastError`; events `state`, `loggedIn`, `event`.
