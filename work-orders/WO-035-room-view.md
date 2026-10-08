# WO-035: Room view: top view with drag & drop, live mics, cameras

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-034, WO-038 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
The operator's main screen (DEC-011).

## Scope
- SVG top view over the floor plan; seats and cameras as draggable icons (edit mode), positions saved via WO-034 API.
- Unplaced seats/cameras tray; zoom/fit; snap; rotate.
- Operate mode: seat colour = mic state (on/mute/request/off), name/screen line, click = mic on/off (domain speakers add/remove), right side: speaker/request list, camera tally (program/preview), director status (current shot, manual/auto).
- Shot assignment: select seat → choose camera + preset (links to camera settings).

## Acceptance criteria
- [x] ui:check scenario: place seats by drag, toggle a mic by click, see state change live, positions persisted.

## Work log
- 2026-10-03 (Claude Opus): `web/js/views/room.js`: SVG top view (floor plan image or grid), seats coloured by mic state (speaking/priority/muted/waiting/offline), facing marker, shot badge, on-camera ring; cameras with field of view and tally (program red, preview green). Operate: click seat = mic on/off (domain API), click camera = cut; sidebar automation toggle, current shot, on-air camera, Overview button, speakers/requests with 📷 manual shot. Edit: drag & drop (pointer events, saved per item), rotate ±15°, remove, unplaced tray, place-all grid, floor plan upload, per-seat shot editor (camera, preset, Test, Store position). Zoom/fit.
- ui:check `room` scenario (full workflow through the UI): add 2 simulated cameras + simulated switcher, jog, overview + seat shot + enable automation, place seats/cameras, drag a seat (position persisted), click seat → mic on → director cuts → camera tally red on the plan, mic off → back to overview. Screenshot reviewed. **Found a backend race:** "place all" fired 20 concurrent saves that raced on the temp file (HTTP 500) → room/device stores now serialise writes (regression test). ui:check now also fails on unexpected error toasts.

## Decisions

## Handoff
Done against simulated devices. Real camera/ATEM check: WO-041.
