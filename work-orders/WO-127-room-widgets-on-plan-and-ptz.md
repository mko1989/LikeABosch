# WO-127: Room widgets float on the plan (independent of the inspector) + PTZ widget (DEC-039)

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-104, WO-054 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-16 |
| **Updated** | 2026-10-16 |

## Goal
User (next.md, 2026-10-16): "the widgets i wanted to be able to add them to the room view so they are not tied to any
particular inspector but they are just there. also add a ptz widget with the ptz controls and it camera picker, preset
save and current overwrite buttons." Widgets are added to the Room plan as floating cards that stay put whatever is
selected; a new PTZ widget controls any camera.

## Context
DEC-030 (widgets in the side panel; §1 superseded by DEC-039), DEC-039, WO-104 (`web/js/widgets/`), WO-054
(`cameraPanel` in `web/js/views/room.js`, `web/js/ptz.js`), DEC-009.

## Scope
- In: widget layer over `.room-stage` (operate and edit mode); "Widgets ▾" menu in the Room toolbar to add / remove;
  each card draggable by its header, collapsible, closable, brought to front on click; positions clamped into the stage
  (also on resize); per-browser preferences (new key, pure parser + tests). Side panel no longer holds the dock.
  PTZ widget: camera picker (remembered), connection / tally state, compact jog pad, current preset + "Overwrite preset
  N", preset field with Recall / Save, chips for the presets the room uses with that camera. No body rebuild while a
  PTZ button is held.
- Out: several instances of one widget (e.g. two PTZ widgets); widgets anchored to plan coordinates (they stay in screen
  space and don't zoom).

## Acceptance criteria
- [x] Widgets added from the toolbar menu appear on the plan; selecting a seat / camera does not move them.
- [x] Dragging a widget header moves it; position survives a reload; collapse and close work.
- [x] PTZ widget: pick a camera, jog, recall/save a preset, overwrite the current preset (mock camera).
- [x] Pure tests for the preferences (parse, add/remove, move, clamp); `npm test` passes.
- [x] ui-check (wired + wireless) passes with the widget scenarios adapted; screenshots looked at.

## Work log
- 2026-10-16 (Claude Opus): created (ready → in-progress); DEC-039 written.
- 2026-10-16 (Claude Opus): in-progress → review. `web/js/widgets/dock.js` replaced by `layer.js` (layer over
  `.room-stage`, "Widgets ▾" menu in the Room toolbar, cards with More / collapse / ✕, header drag with pointer capture,
  bring to front, clamp on render and on stage resize, no rebuild while a PTZ button is held); `prefs.js` rewritten (key
  `likeabosch.room.widgets.v2`: placed (front-to-back), collapsed, pos, settings; add / remove / move / clamp / default
  position); new `widgets/ptz.js` (camera picker stored as `settings.ptz.cameraId`, state + tally, `ptzPad`, current
  preset + Overwrite, preset field Recall / Save, preset chips). Room side panel: inspector, director, speakers only.
  CSS: floating cards. `web/test/widgets.test.js` 6/6.
  ui-check: scenarios now add widgets through the menu (`setWidgets` helper) and take them off again at the end; wired
  `voting` also checks that opening a seat inspector leaves the voting card where it was and that no widget is in the
  side panel; wired `room` adds the PTZ widget, picks cam-1, closes the camera inspector (widget stays), saves preset 5,
  jogs (tilt up, release on the window → stopped, "adjusted"), overwrites preset 5, drags the header 120 px left (position
  + camera saved in localStorage), removes it with ✕. First run failed on my helper (an escaped `${}` in the injected
  script) → fixed. Screenshots looked at: first look showed added cards cascading only 28 px (almost fully covering each
  other) and a tiny collapse glyph → new cards go side by side from the top right (cascade once the row is full),
  bigger header icons; second look OK (wired light PTZ widget, wired dark three widgets, wireless light voting).
  Full `node scripts/ui-check.mjs` (all 5 systems, light + dark): UI CHECK OK. `npm test` 376/376.

## Decisions
- DEC-039.
- Old WO-104 preferences (`likeabosch.room.widgets`) are not migrated: it only held hidden / collapsed flags of the side
  dock; widgets now start off the plan and are added from the menu.
- PTZ widget topics include `room` and `domain.seats` (preset chip labels); its body rebuilds on layout changes too.

## Handoff
- Delivered as in Scope. Widgets show in operate and edit mode, in screen space (they don't zoom / pan with the plan).
- Not done: several PTZ widgets at once (one per camera), cut / preview buttons in the PTZ widget: say if wanted.
