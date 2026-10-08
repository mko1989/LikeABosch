# WO-012: Wired event bridge, state cache and SSE

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-009, WO-006, WO-010 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Browsers receive live state: the backend reacts to DICENTIS events, refetches data, caches it,
and streams updates via SSE (DEC-005).

## Scope
- In: `backend/src/lib/sse.js` (hub: clients, heartbeat, `broadcast(topic, data)`);
  `backend/src/state/cache.js` (topic → {data, updatedAt}, change detection);
  `backend/src/wired/events.js` (on `loggedIn`: `GetPermissions`, `RegisterEvents(all)`, initial
  fetch of all topics the permissions allow; on event: refresh per `events.json`, coalesce bursts,
  update cache; on refresh error: log + keep last value);
  `GET /api/events` (SSE; first sends `snapshot` with all cached topics);
  `GET /api/state/:topic` (cached value).
- Out: wireless poller (WO-015).

## Acceptance criteria
- [x] Test: mock triggers `seatsChanged` → SSE client receives `seats` topic with new data; the event re-arms (second change also arrives).
- [x] Topics skipped when the permission is missing (no error spam).
- [x] Reconnect: after upstream reconnect, events are re-registered and the cache is refreshed.

## Work log
- 2026-10-02 (Claude Opus): Implemented `backend/src/state/cache.js` (StateCache: deep-equal change detection, `unavailable` reasons), `backend/src/lib/sse.js` (hub with heartbeat + retry hint), `backend/src/wired/events.js` (WiredEventBridge: attach/detach to a client, resync on every `loggedIn`, coalesced refresh queue, serialised work), `backend/src/state/routes.js` (`/api/events`, `/api/state`, `/api/state/:topic`). Wired up in `server.js`/`app.js`. Tests `backend/test/wired-events.test.js` (7): initial sync of all topics, re-arm (two successive changes both arrive), alsoRefreshTopics, permission gating + permissionsChanged re-evaluation, notifications, re-registration after reconnect, SSE snapshot/topic + state endpoints. `npm test` 39/39. Docs: `docs/api/live-state.md`.

- 2026-10-02 (Claude Opus, during WO-020/024): two bridge bugs fixed with regression tests: failed refresh now explicitly re-arms its event via RegisterEvents; `detach()` resets the refresh timer handle (a stale handle blocked all event processing after a quick disconnect/connect).

## Decisions
- Permission gating uses the operation's `permissions` from the spec; licences can't be checked up front, so licence failures show up as `unavailable` with the server's message.
- `permissionsChanged` triggers re-evaluation of **all** topics (newly permitted → fetched; lost → removed + unavailable).
- Events within 50 ms are coalesced; refreshes run serialised after any running resync.
- Topic removal is broadcast as `topic` with `data: null`.
- The cache is **not** cleared on connection loss (stale data stays visible; the UI must show connection state). WO-013 clears it on an explicit disconnect or system change.

## Handoff
Done. WO-013 should: create/attach the bridge per client (`bridge.attach(client)`), clear the cache on disconnect/settings change, and broadcast `connection` SSE events.
