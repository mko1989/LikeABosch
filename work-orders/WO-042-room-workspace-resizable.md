# WO-042: Room view: unbounded workspace, resizable room outline

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-035 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
User feedback (2026-10-03): "the layout itself seems to have a fixed size even though it can be zoomed in and out".
The room plan was a fixed 1600×1000 SVG scaled by zoom, and items were clamped inside it. The room must be resizable,
and the workspace must not end at the room's edges.

## Context
WO-034 (room model/API), WO-035 (room view), DEC-011.

## Scope
- In: backend `room.canvas` gets an origin `{x, y, width, height}` (old room.json files load with x = y = 0);
  `PUT /api/room/canvas` accepts optional x/y (±10000).
- In: room view: SVG fills the stage; pan/zoom via viewBox (centre + zoom); drag empty space = pan, Ctrl/⌘ + scroll or
  trackpad pinch = zoom at cursor, scroll = pan, two-finger pinch on touch; − / % / + / Fit; view kept across tab switches.
- In: edit mode: room outline with edge + corner resize handles (snap 10 units), size label in metres, "Room size" panel
  (width/depth in m, "Fit room around items"); uploading a floor plan sets the room to the image's aspect ratio.
- In: no clamping of seats/cameras to the room (cameras often stand outside it); new items appear in the middle of the view.
- Out: auto-growing the room when an item is dropped outside (deliberately not done: cameras may stand outside the room).

## Deliverables
`backend/src/room/store.js`, `backend/src/room/routes.js`, `backend/test/room.test.js`, `web/js/views/room.js`,
`web/css/app.css`, `scripts/ui-check-electron.cjs`.

## Acceptance criteria
- [x] Room size can be changed by dragging an edge and by typing metres; persisted; old room.json still loads.
- [x] Items can be placed outside the room; workspace pans and zooms beyond the room.
- [x] `npm test` (131) and `npm run ui:check` pass; room scenario resizes the room via the handle and pans.

## Work log
- 2026-10-03 (Claude Opus): implemented as scoped. 1 unit ≈ 1 cm (seat Ø 60, grid 50). The ui:check room scenario now
  drags the right edge handle (asserts the saved width and the on-plan size label) and pans by dragging empty space (asserts
  the viewBox moved). **Found:** `capturePage()` on the hidden check window returned a stale frame (screenshot showed the
  old layout although the DOM was updated) → the scenario screenshot helper now calls `webContents.invalidate()` first.

## Decisions
- No automatic room growth; the room outline is just a drawn rectangle with its own origin, so it can grow in any direction
  without moving items.

## Handoff
Done. Possible later: keyboard nudging of the selected item, snap-to-grid toggle, multi-select.
