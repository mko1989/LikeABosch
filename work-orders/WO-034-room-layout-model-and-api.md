# WO-034: Room layout model, persistence and API

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-033 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
Backend storage for the room top view (DEC-012 §3).

## Scope
- `backend/src/room/store.js`: `data/room.json` (versioned): floor plan image (stored in data dir), canvas size, seat placements `{seatId, x, y, rotation, label?}`, camera placements `{cameraId, x, y, rotation}`, seat → `{cameraId, preset}` shot assignment, overview shot, director settings.
- API: `GET/PUT /api/room` (validated), `PUT /api/room/background` (image upload ≤ 5 MB, served at `/api/room/background`), SSE topic `room`.
- Tests.

## Acceptance criteria
- [x] Round trip + validation tests; layout survives restart; topic pushed on change.

## Work log
- 2026-10-03 (Claude Opus): `backend/src/room/{store,routes}.js`: room.json (canvas, background PNG/JPEG/WebP ≤ 5 MB — no SVG, could carry scripts; seat/camera placements, shots, overview, director settings incl. settleMs); per-item endpoints for cheap drag & drop; removing a camera drops its shots/overview; topic `room`. Tests `backend/test/room.test.js` (4) incl. restart persistence.

## Decisions

## Handoff
Done (backend). UI: WO-035 / WO-040.
