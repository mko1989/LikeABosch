# WO-038: Device manager: camera/switcher config, connections, API

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-036, WO-037 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
Configure cameras and the switcher, keep connections, expose control and status (DEC-012 §3, §6).

## Scope
- `backend/src/devices/manager.js`: `data/devices.json` (cameras: id, name, driver, host, port, transport, framing, username/password (stored, never returned), switcher input; switcher: driver, host, M/E); connect/reconnect; status.
- API: `GET/POST/PUT/DELETE /api/devices/cameras[/:id]`, `POST /api/devices/cameras/:id/{recall,store,move,stop,test}`, `GET/PUT /api/devices/switcher`, `POST /api/devices/switcher/cut`; SSE topics `devices.cameras`, `devices.switcher`.
- Tests against mocks.

## Acceptance criteria
- [x] CRUD + control endpoints tested against camera/switcher mocks; passwords never returned.

## Work log
- 2026-10-03 (Claude Opus): `backend/src/devices/{manager,routes}.js` wired into server/app. devices.json (mode 0600; camera passwords stored for unattended automation, never returned), background reconnect every 10 s, topics devices.cameras / devices.switcher, `program` events forwarded. Tests `backend/test/devices.test.js` (4).

## Decisions

## Handoff
Done (backend). UI: WO-035 / WO-040.
