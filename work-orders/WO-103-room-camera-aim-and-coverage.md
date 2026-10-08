# WO-103: Room plan: cameras turn toward the seat they show; seats tinted by the camera that has their preset

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-035, WO-039, WO-054, WO-071 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-08 |
| **Updated** | 2026-10-09 |

## Goal
User (2026-10-08): "id like the camera to draw a faint background under any seat that is linked with a preset and that
camera. id also like the camera to rotate and point in the direction of that seat."

## Context
`web/js/views/room.js` (`cameraNode`, `seatNode`, render order), `web/css/app.css`, topic `devices.cameras`
(`currentPreset` per camera, WO-054), `room.shots` (seat → { cameraId, preset }), `director.target`.

## Scope
- In:
  - Each camera gets a stable colour (palette by camera order on the plan; readable in light/dark).
  - **Coverage:** every seat with a shot gets a faint disc/halo in its camera's colour, drawn under the seats. Selecting
    or hovering a camera (inspector open) makes its seats' halos stronger and dims the others.
  - **Aim:** the camera's head (body + lens + field of view) turns toward the seat whose shot is (camera,
    `currentPreset.preset`); smooth CSS transition; the placed base rotation stays the "home" direction when the
    current preset belongs to no seat (overview, unknown, none). The FOV wedge follows; a thin dashed line from camera
    to that seat while it is on air / preview tinted with the tally colour.
  - Edit mode: unchanged dragging/rotation; the aim shows the stored rotation while editing that camera.
- Out: real pan/tilt feedback from cameras (we only know the last recalled preset).

## Acceptance criteria
- [x] Pure helper (`web/js/camera-aim.js`) with tests (`web/test/camera-aim.test.js`): angle to seat incl. camera
  rotation, shortest-turn angle across ±180°, colour assignment stable.
- [x] ui-check: plan with 2 cameras + shots, recall a preset → screenshot shows the camera pointing at that seat and
  the tinted seats; screenshots looked at.
- [x] `npm test` passes (see WO-101 log entry of the same day for the full run).

## Work log
- 2026-10-08 (Claude Opus): created (ready).
- 2026-10-08 (Claude Opus): in-progress → review. `web/js/camera-aim.js` (colours, bearing, relative aim, shortest turn,
  aimed seat = shot with this camera + current preset, director target first) + `web/test/camera-aim.test.js` 6/6.
  `room.js`: coverage layer under cameras/seats (halo per seat in its camera's colour, dashed aim line, tally-coloured
  when on program/preview), camera node = fixed base rotation + `.camera-head` turned by CSS transition (start angle kept
  per camera across re-renders, then set after a forced layout), colour dot on the camera, shot badge in the camera's
  colour, hover/selection emphasises that camera's seats. First ui-check run failed: the CSP blocks `style` attributes →
  styles set through the CSSOM (`styled()` helper). ui-check `room` (wired, light + dark) OK; new checks: aim line + halo
  present, cam-2 head rotated after seat 3 speaks. Screenshot `wired-room-scenario-light.png` looked at (cropped): Cam A
  points at seat 3, orange halo + badge on seat 3, overview camera at home direction.
- 2026-10-09 (Claude Opus): user: "something is wrong with the hover select in room operate, where in most cases only one
  cam is selected (highlighted). the highlight is too strong." Causes: (1) hover used pointerenter/pointerleave on each
  camera node, but the plan re-renders often (camera status, director) and replaces the nodes; a node removed under the
  pointer never gets pointerleave, so the last hovered camera stayed highlighted; (2) the camera whose inspector was open
  stayed emphasised in operate mode too. Fix: hover delegated on the plan SVG (`pointerover` → closest camera node,
  `pointerleave` → none); in operate mode only the hovered camera is emphasised (selection counts in edit mode only);
  softer contrast (halo .16 → focused .28 / others .09; aim line .45 → .7 / .25). ui-check `room` got hover steps
  (cam-2 → re-render → still cam-2 → floor → none → cam-1 → not cam-2 → leave → none): OK light + dark; screenshot
  looked at.

## Decisions
- Colour by position in the camera list (not a stored setting): no new data; reordering cameras changes colours.
- Edit mode with the camera selected shows its placed (home) direction, so rotating it is not confusing.

## Handoff
- Delivered as in Scope. Aim = last preset recalled through LikeABosch (WO-054); presets recalled from elsewhere (camera
  remote, DICENTIS) are not known. Halo strength is CSS (`.coverage-halo`).
