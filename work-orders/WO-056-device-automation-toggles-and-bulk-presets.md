# WO-056: Automation on/off per camera + switcher; assign camera presets to many seats at once

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-038, WO-039, WO-040, WO-055 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
User request (2026-10-05):
1. "When adding cameras and video switchers there needs to be a toggle so the operator can turn automations
   connected to cameras/switcher on and off."
2. "In edit mode for the camera-seats relationship I need a selection option so I can choose a camera, then
   multi-seat setup: drag multiple seats, put a start preset and from which side to count them. Example: camera 2,
   seats 12 to 24, start from preset 10 → seat 12 gets camera 2 preset 10, seat 13 preset 11 and so on."

## Context
DEC-012 (director), DEC-015 (this WO's semantics), WO-039 (director), WO-040 (settings UI), WO-055 (room multi-select,
group panel, `PATCH /api/room/placements`, undo).

## Scope
- In (backend): `automation` field for cameras and switcher (default true); `PATCH /api/devices/switcher` partial
  update; director honours the flags (DEC-015); `PATCH /api/room/shots {seatId: {cameraId, preset} | null}` bulk.
  Tests for all three.
- In (UI): Settings → Cameras: "Use in camera automation" checkbox in the camera form, "manual" tag in the list,
  "Automatic cuts" toggle on the switcher card. Room: camera inspector automation switch, plan marks manual
  cameras, automation side panel shows/toggles switcher automatic cuts.
- In (UI): room edit group panel → "Camera presets for these seats": camera, start preset, step, count from
  (seat name ↑/↓, left→right, right→left, front→back, back→front, selection order); preview of preset numbers on
  the plan with START; Apply in one call; "Clear shots" for the selection; undo covers shots.
- Out: per-seat automation switches; driver-specific preset range validation beyond a hint.

## Deliverables
backend: devices/manager.js, devices/routes.js, director/decide.js, director/director.js, room/store.js,
room/routes.js + tests. web: views/cameras.js, views/room.js, arrange.js (seat ordering), css. ui-check steps. DEC-015.

## Acceptance criteria
- [x] Camera with automation off: director doesn't recall/cut it automatically (seat → overview); test.
- [x] Switcher automation off: presets recalled, no cuts; safe strategy doesn't move the on-air camera; test.
- [x] Manual Take still works with flags off; test.
- [x] `PATCH /api/devices/switcher {automation}` doesn't reconnect; `PATCH /api/room/shots` bulk + validation; tests.
- [x] UI: toggles in Settings and room; bulk preset assignment with preview; ui-check scenario + screenshots looked at.
- [x] `npm test` green, `npm run ui:check` OK.

## Work log
- 2026-10-05 (Claude Opus): WO + DEC-015 created; read director, device manager, cameras/automation views.

- 2026-10-05 (Claude Opus): Backend: `automation` in CAMERA_FIELDS/SWITCHER_FIELDS (public objects always carry it,
  missing = true); `DeviceManager.cameraAutomation(id)`, `switcherAutomation`, `updateSwitcher(patch)` (reconnects
  only on driver/host/port/me change) + `PATCH /api/devices/switcher`. `decide.js`: `automaticRoom(room, usable)` and
  `plan({ …, cuts })`. Director uses the automatic room for automatic shots only; manual Take uses the full room and
  always cuts. `RoomStore.setShots` + `PATCH /api/room/shots`. Tests: director.test.js (2 pure + 2 end-to-end:
  manual camera → overview and manual Take still works; switcher automation off → camera follows, no cut, same
  driver object = no reconnect), room.test.js bulk shots. One test bug of mine (wrong seat in an assertion) fixed.
- 2026-10-05 (Claude Opus): UI: Settings → Cameras: Auto/Manual switch per camera row, "Use in camera automation"
  in the add/edit form, "Automatic cuts" checkbox on the switcher card (PATCH). Room: manual cameras dashed + "MANUAL"
  on the plan, inspector checkbox, "Switcher cuts" Auto/Manual + "Manual cameras" in the automation side panel.
  Group panel: "Camera presets for these seats" (camera, first preset, step, count from: name ↑/↓, left→right,
  right→left, top→bottom, bottom→top, selection order) with P-number tags + START on the plan, "Assign presets",
  "Clear shots (n)"; ONVIF/Panasonic hints. `orderSeats` + `COUNT_FROM` in arrange.js (+ test).
- 2026-10-05 (Claude Opus): Bugs found by ui-check and fixed: (1) undo entry was pushed after the request resolved,
  so a fast Undo undid the previous change → now pushed before the request, dropped on failure (also for WO-055
  placements); (2) the arrange section could rebuild closed when its toggle event hadn't fired yet → rebuilding
  from inside the section sets it open; the ui-check waits 100 ms after opening a <details>. (3) Layout: arrange and
  presets sections are an accordion (one preview on the plan at a time); camera list shows the switcher input in
  the sub-line (names were squeezed); switcher hint on its own line.
- 2026-10-05 (Claude Opus): Evidence: `npm test` 152/152 pass. `node scripts/ui-check.mjs` (both systems, all routes):
  UI CHECK OK. New ui-check steps: Cam A automation off → API false → "Manual" in list; switcher automatic cuts off
  → API false; both back on; seats 12–16 selected (click + 4 Ctrl-clicks), Cam A, first preset 10 → 5 tags, START P10
  → Assign → API seat-12 = cam-2/10, seat-16 = cam-2/14 → Undo → shots gone. Screenshots looked at:
  `wired-cameras-automation-scenario-light.png`, `wired-room-bulk-presets-scenario-light.png`.

## Decisions
- See DEC-015 for the automation semantics.
- Bulk shot assignment lives in the WO-055 group panel (same box selection), presets are numbers
  `start + i × step`; ONVIF cameras use tokens, so the UI warns that numbers only work if the tokens are numeric.

## Handoff
Delivered: per-camera and switcher automation switches (Settings + room), director semantics per DEC-015, bulk
camera-preset assignment for a box/Ctrl-click selection with counting order and preview, bulk shots API.
Status `review`: waiting for the user to try it. Not verified on real hardware (ATEM, PTZ): DEC-015 behaviour is
only tested against mock devices (WO-041 covers hardware).
Open question for the user: should a manual camera's seats fall back to the overview (current, DEC-015 §2) or keep
the current shot?
