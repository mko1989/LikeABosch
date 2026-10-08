# WO-052: Operate mode: inspector cog on every plan item

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-047, WO-048, WO-051 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
User (2026-10-03): "when in operate mode there needs to be a way to view the inspector of an item. little cog icon next
to it. bottom right." In operate mode a click acts (seat = mic, camera = cut), so the inspector needs its own handle.

## Scope
- In: a small cog button at the bottom right of every placed seat and camera (HTML overlay, constant size, follows
  pan/zoom, positioned from the rendered shape so rotation is handled); for interpreter desks the cog sits at the right
  end of the desk's control strip; click opens the item's inspector in the side panel (selected item highlighted).
- In: camera inspector (both modes): status/last error, driver and address, switcher input + tally, seats whose shot
  uses it, overview role, "Cut to camera", recall a preset, link to Settings → Cameras; edit mode keeps rotate/remove.
- In (user, mid-task): dragging a cog moves its item (operate mode), saved on release.
- Out: right-click / I for seats stays as a shortcut.

## Acceptance criteria
- [x] Cog on every seat/camera/desk in operate mode (none in edit mode); click opens the right inspector.
- [x] Cogs stay at the item's bottom right after pan/zoom; `npm test`, `npm run ui:check` pass; screenshot reviewed.

## Work log
- 2026-10-03 (Claude Opus): `room.js`: inspector cogs in the HTML overlay (operate mode only): one per placed seat and
  camera, positioned on the bottom right of the rendered shape (`getBoundingClientRect` of the seat disc / camera body, so
  rotation and zoom are exact), size scales with zoom (14–22 px, `--cog-size`) so the plan stays readable zoomed out;
  desks carry their cog at the right end of the control strip. Click (or Enter) = inspector; the selected item's cog is
  highlighted. **User addition mid-task: "drag the item by dragging the cog"**: pointer drag on a cog moves the item live
  (node, cog, desk strip), saves on release, and does not open the inspector; re-renders pause during the drag.
  New `cameraPanel()` inspector (both modes; replaces the old camera edit panel): status / last error, program/preview
  tally, Cut to camera, recall a preset, type/address/switcher input, overview role, seat shots using it, position;
  rotate/remove in edit mode. Operate-mode side panel now shows seat / desk / camera inspectors.
- ui:check room scenario (12 labelled steps): cogs present; seat and camera cogs open the right inspector; seat 4 cog
  dragged → saved position moved, cog still at its corner, no inspector opened; desk cog dragged → desk moved, strip
  still below; no cogs on seats/cameras in edit mode. First run failed at the camera step (operate mode's side panel had
  no camera branch) → fixed. Screenshot reviewed (first version: 22 px cogs buried the names at 50 % → zoom-scaled).
- `npm test` 136/136, `npm run ui:check` OK.

## Handoff
Done.
