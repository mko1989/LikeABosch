# WO-109: Web UI reconnects to the backend by itself

| | |
|---|---|
| **Status** | done |
| **Phase** | 4 Hardening |
| **Depends on** | WO-012, WO-018 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-10 |
| **Updated** | 2026-10-10 |

## Goal
The web UI never needs a page refresh to get its live connection back (user, next.md 2026-10-10: "the webui loses
connection to the backend sometimes which is bad. needs a refresh of the webui").

## Context
DEC-005 (one SSE stream per browser). `web/js/store.js` opened one `EventSource` and relied on its built-in retry;
`backend/src/lib/sse.js` sends a `: ping` comment every 25 s.
Failure modes of plain `EventSource`: (1) an HTTP error or non-`text/event-stream` answer on a reconnect (backend
restarting, a proxy) closes it for good (`readyState` CLOSED, no more retries) → banner "Lost connection… retrying"
forever; (2) a dead TCP connection (computer slept, Wi-Fi/network change) is not noticed: no error, the UI silently
stops updating. Comment lines are invisible to page scripts, so the client cannot use the heartbeat.

## Scope
- In: backend heartbeat as a named `ping` event (15 s); `web/js/live-stream.js` (pure, testable): reopen with backoff
  when the browser gave up, reopen when nothing (incl. ping) arrived for 40 s, check on tab visible / reopen on
  `online`; `store.start()` uses it; unit tests with a fake EventSource and mocked timers.
- Out: HTTP/2 (6-connections-per-host limit with many tabs), auth (WO-029).

## Deliverables
`web/js/live-stream.js`, `web/js/store.js`, `backend/src/lib/sse.js`, `web/test/live-stream.test.js`, backend SSE test.

## Acceptance criteria
- [x] Unit tests: CLOSED → reopened with backoff; silent stream → reopened after `staleMs`; pings keep it alive; reset of backoff after open.
- [x] Backend sends `event: ping` (test).
- [x] Manual: backend stopped and started again → UI recovers without refresh (ui:check or scripted check, described here).
- [x] `npm test` green.

## Work log
- 2026-10-10 (Claude Opus): Created from next.md; failure modes analysed (see Context). Status ready → in-progress.
- 2026-10-10 (Claude Opus): `backend/src/lib/sse.js`: heartbeat 25 s comment → 15 s `event: ping`. New
  `web/js/live-stream.js` (`openLiveStream`): own EventSource lifecycle; on error with `readyState` CLOSED → reopen
  after 1 s, 2 s, 4 s … max 10 s (reset on open); watchdog every 5 s reopens when no event for 40 s; events of a
  replaced source are ignored. `store.start()` uses it, calls `check()` when the tab becomes visible and `reconnect()`
  on `online`. Tests: `web/test/live-stream.test.js` (4, fake EventSource + mocked timers/Date),
  `backend/test/sse.test.js` (ping on the wire). `npm test` 322/322; `npm run ui:check` OK (all systems, live updates).
- 2026-10-10 (Claude Opus): Scripted browser check (headless Electron, scratch script, not committed): UI connected →
  backend closed → a stub answers **503** on the same port for 4 s (like a backend that is still starting) → backend
  started again. New code: pill `lost` → `loggedIn` ~1 s after the backend was back. Old `store.js` (swapped back
  temporarily): stays `lost` for 45 s, i.e. needs a refresh. This is the reported failure mode. The dead-connection
  case (sleep/Wi-Fi) is covered by the watchdog unit test only.
- 2026-10-10 (Claude Opus): Status → done.

## Decisions
- Client-side watchdog instead of relying on `EventSource` retry; heartbeat becomes a named event (old clients ignore it).

## Handoff
Delivered: self-healing SSE stream (reopen after the browser gave up, watchdog on silence, tab visible / online),
named `ping` heartbeat. Banner/pill unchanged ("Lost connection to the backend, retrying…" now really retries).
Known gaps: many tabs on one backend can still hit the browser's 6-connections-per-host limit (one SSE per tab); not
reported, not addressed. No follow-up WOs.
