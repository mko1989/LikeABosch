# WO-055: Room edit mode: box selection, group move, arrange seats in shapes

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-035, WO-042 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
User feedback (2026-10-05): "editing layout lacks the ability to choose multiple seats to position them as a whole. I'd
also like an option to choose multiple seats and auto-arrange them in a shape I want, e.g. U-shape, rectangle or line.
For shapes like the U it needs a setting of e.g. 15 seats in this part, 10 in this etc., with a 'start from here'
indication." And: "selecting should be done by dragging a selection tool. Way more important than dragging the whole view."

## Context
Read WO-035 (room view), WO-042 (unbounded workspace, pan/zoom), WO-034 (room API), DEC-009 (UI rules), DEC-011.
Units: 1 workspace unit ≈ 1 cm. Seat rotation 0 = facing up (−y), clockwise positive (SVG rotate).

## Scope
- In (backend): `PATCH /api/room/placements { seats?, cameras?, desks? }`: many placements in one atomic save
  (one file write, one `room` topic update); a `null` value removes that item from the plan. Tests.
- In (UI, edit mode):
  - Drag on empty floor = **box (marquee) selection** of seats. Shift/Ctrl/⌘ + box adds to the selection;
    Shift/Ctrl/⌘ + click toggles one seat. Esc clears, Ctrl/⌘ + A selects all placed seats.
  - Panning in edit mode moves to: scroll / trackpad, Space + drag, middle-mouse drag, two-finger drag on touch.
    Operate mode keeps drag-to-pan.
  - Drag any selected seat = move the whole group (saved in one PATCH).
  - Group panel: count, rotate group ±15° around its centre, remove group from plan, undo (Ctrl/⌘ + Z).
  - "Arrange in a shape": Line, U-shape, Rectangle, Grid. Per-segment seat counts (U: left arm / base / right arm;
    rectangle: top / right / bottom / left) with "split evenly" and a sum check; start point (U/line: which end;
    rectangle: start corner + direction; grid: start corner); seat order by seat name (natural) or by selection order;
    facing inward/outward; spacing (cm); rotation (°). Live preview on the plan: numbered ghost seats, seat 1
    highlighted, path line showing the order. Apply keeps the group centred where it was.
  - Pure geometry module `web/js/arrange.js` with node:test tests.
- Out: multi-selecting cameras/desks (seats only); arc/hemicycle shape; arrow-key nudging; snapping/alignment guides
  (follow-up WO if wanted).

## Deliverables
`backend/src/room/store.js`, `backend/src/room/routes.js`, `backend/test/room.test.js`, `web/js/api.js` (patch),
`web/js/arrange.js`, `web/test/arrange.test.js`, `web/js/views/room.js`, `web/css/app.css`.

## Acceptance criteria
- [x] `PATCH /api/room/placements` places/removes many items in one save; validation rejects bad entries without
      changing anything; test in `backend/test/room.test.js`.
- [x] `web/test/arrange.test.js`: counts per segment, start/direction, facing, spacing, rotation, centring.
- [x] Edit mode: box selection selects the seats inside; additive with a modifier; panning still possible (Space/middle/scroll).
- [x] Dragging a selected seat moves the whole group; one PATCH; undo restores.
- [x] Arrange: U-shape with custom counts previews and applies correctly; start marker visible.
- [x] `npm test` green; `npm run ui:check` clean and screenshots looked at.

## Work log
- 2026-10-05 (Claude Opus): WO created from user feedback; read room.js, room store/routes. Box selection replaces
  drag-to-pan in edit mode per the user's follow-up ("way more important than dragging the whole view").

- 2026-10-05 (Claude Opus): Backend `RoomStore.placeMany` + `PATCH /api/room/placements` (validate all, then one
  mutate; unplacing a camera drops its shots/overview like the single DELETE; shared via `#dropCameraRefs`).
  `api.patch` added. Test "bulk placements…" in room.test.js passes.
- 2026-10-05 (Claude Opus): `web/js/arrange.js` (line / U / rectangle / grid, rotateAround, boxCenter, natural name
  order) + `web/test/arrange.test.js` (8 tests). Rounded to integers with no -0 (deepEqual tripped on -0).
- 2026-10-05 (Claude Opus): room.js: `multi` selection set, marquee (`drag.kind = 'marquee'`), group drag
  (`'group'`), pan on middle button / Space / two-finger (pinch now also pans), group panel (rotate ±15°, undo,
  remove), arrange section with live preview (ghost seats with names, START label, arrows along the order; ghosts
  hidden once the arrangement is applied), keys Esc / Ctrl⌘+A / Ctrl⌘+Z. A non-moved press on a group member selects
  just that seat in endPointer (pointer capture means the click may not reach the seat).
- 2026-10-05 (Claude Opus): ui-check: the edit-mode pan step now uses the middle button; new wired room steps: box
  select all → "20 seats selected", group drag (all seats moved), U-shape with left arm +2 / right arm −2, start at
  the right arm → preview (20 ghosts + START) → Apply (≥ 3 distinct rotations) → Undo (all back to 0°) → Esc.
  First attempt put the steps into the wireless scenario list by mistake; moved. `npm test`: 146/146 pass.
  `node scripts/ui-check.mjs` (both systems, all routes): UI CHECK OK. Screenshots looked at:
  `wired-room-arrange-preview-scenario-light.png` (8/8/4 U, START at the right arm, arrows), `wired-room-arranged-…`.

## Decisions
- Edit mode: left-drag on empty floor = box selection (user, 2026-10-05). Pan = scroll, Space+drag, middle-drag,
  two-finger touch. Operate mode unchanged (drag = pan). Changes the WO-042 interaction for edit mode only.
- Bulk API is `PATCH /api/room/placements` (merge semantics; `null` = unplace) instead of N single PUTs: one atomic
  write and one SSE update for a 40-seat move; also makes undo a single call.
- Arrangement is centred on the bounding-box centre of the selected seats, so re-applying with other settings
  doesn't drift. Corners of U/rectangle stay empty (arms start one spacing away from the base row).

## Handoff
Delivered: box selection + group move/rotate/remove/undo + arrange in Line / U-shape / Rectangle / Grid with per-segment
counts, start point, direction, seat order, facing, spacing, rotation and a live preview; bulk placements API.
Status `review`: waiting for the user to try it hands-on. Not verified by hand: Space+drag and two-finger pan on a
real touch screen (only middle-button pan is in ui-check).
Known gaps / follow-ups (not created yet, ask the user): arc/hemicycle shape, multi-select of cameras/desks,
arrow-key nudging, alignment guides/snapping between seats, persisting arrange settings across reloads.
