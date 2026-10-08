# DEC-005: One upstream session per system; backend caches state and pushes to browsers via SSE

- **Status:** accepted (proposed by Claude 2026-10-02; revisable); amended by DEC-008 (credentials may come from the launcher; backend never persists the password)
- **WO:** WO-001 (implemented in WO-012, WO-015)

## Context
- Wired events carry **no data**. Each event fires once and is re-armed only when the client
  fetches the related data (or re-registers). See `docs/protocol/conference/README.md`.
- Wireless has no events at all; data must be polled.
- Browsers should not each hold a DICENTIS session (licence/seat limits, duplicated logic).

## Decision
- The backend holds **one** upstream connection/session per configured system, logged in with
  the credentials configured in the backend (settings UI / `.env`).
- Wired: after login the backend registers for all events. On each event it calls the
  corresponding Get operation (which re-arms the event), updates an in-memory **state cache**,
  and broadcasts `{ topic, data }` to browsers over **SSE** (`GET /api/events`).
- Wireless: a poller refreshes the same cache topics at a configurable interval and broadcasts
  only on change.
- Browsers fetch the initial snapshot from the cache, then apply SSE updates.

## Consequences
- All browser users act with the permissions of the backend's DICENTIS account. Per-user
  upstream sessions are a possible future change and would need a superseding DEC.
- The web UI itself has no authentication at first: it is meant for a trusted LAN. Adding UI auth
  gets its own WO in Phase 4.
