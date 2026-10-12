# DEC-035: Quick-actions API for Bitfocus Companion (`/api/quick`)

- **Status:** accepted (requested by the user 2026-10-12 in next.md: "an api designed for bitfocus companion use, quick
  actions activating/deactivating seats (microphones)"; design by Claude, revisable)
- **WO:** WO-117
- **Extends:** DEC-010 (domain layer), DEC-027 (Companion: LikeABosch → Companion). This is the other direction.

## Context
Companion users want one button per seat: microphone on / off / toggle, with the button lit while the seat speaks. The
domain API needs JSON bodies and system-specific ids, and the SSE stream sends every topic. Companion's Generic HTTP
module can only send a URL (+ optional body) and poll.

## Decision
1. **`/api/quick`**, system-independent (wired, wireless, CCS 1000 D, DCN through the bridge), no body needed:
   `GET /api/quick` (compact state), `GET /api/quick/events` (SSE `state` events, 30 ms debounce, ping every 15 s),
   `GET /api/quick/seats/:seat`, `POST /api/quick/seats/:seat/{mic|request|priority}/{on|off|toggle}`,
   `POST /api/quick/mics/off`, `/requests/clear`, `/discussion/clear`, `/next`.
2. **Seat reference** = seat id, else seat name (case-insensitive), else 1-based position in the seat list, so a button
   can say `/seats/Chairman/mic/toggle` or `/seats/3/…` on any system.
3. **Compact seat** `{ number, id, name, person, connected, mic: on|muted|request|off, priority, canPrio, requestPosition }`
   plus `speakers`, `requests`, `latestSpeaker`, `firstRequest`, `connected`, `system`.
4. Actions are idempotent (`on` when already on does nothing) and go through the same domain implementations as the UI
   (shared `createDomainActions`, so no second code path). "Clear" falls back to one removal per seat where the system
   has no clear (wired).
5. No authentication yet, like the rest of the API (WO-029); the server binds to 127.0.0.1 unless LAN access is on.

## Consequences
- The `likeabosch` Companion module (WO-118) is a thin client of this API; anything else (Stream Deck plugins, scripts)
  can use it too.

## Alternatives considered
- **Companion polling `/api/state`:** heavy (every topic) and system-specific shapes. Rejected.
- **GET for actions** (easy in a browser): unsafe (prefetch, crawlers). Rejected.
