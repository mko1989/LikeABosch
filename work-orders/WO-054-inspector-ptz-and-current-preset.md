# WO-054: Camera inspector: small PTZ controller, presets, overwrite the current preset

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-038, WO-040, WO-052 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
User (2026-10-03, while WO-053 was in progress): "and small ptz controller for small adjustments with ability to
save/recall presets. when possible it should be possible to overwrite the 'current' preset."

## Scope
- In: backend tracks each camera's **current preset** (last recalled/stored through LikeABosch, incl. the director) and
  whether it was adjusted since (jog), published as `currentPreset: { preset, modified }` on `devices.cameras`; tests.
- In: shared PTZ pad module (`web/js/ptz.js`) used by Settings → Cameras and the camera inspector: hold to move, tap for
  a nudge, speed (compact default slow), stop on release anywhere (window listener) so a re-render can't leave a camera moving.
- In: camera inspector: pad, "Current preset N (adjusted)", **Overwrite preset N**, recall/save by number, quick recall
  chips for this camera's seat shots and overview preset.
- In: side panel rebuilt per section only when that section's data changes (operate mode too); no rebuild during a PTZ
  hold (prevents lost pointer releases and wiped preset inputs).

## Acceptance criteria
- [x] currentPreset set on recall/store, `modified` after a move (unit test); overwrite stores the same preset number.
- [x] Inspector pad moves/stops the mock camera; overwrite/save/recall work; `npm test`, `npm run ui:check` pass; screenshot reviewed.

## Work log
- 2026-10-03 (Claude Opus): backend: `DeviceManager` keeps `currentPreset` per camera (set by recall incl. the director,
  and by store; `modified: true` after a non-zero move), published on `devices.cameras` (unit test: recall → adjusted
  → overwrite → store other). Mock camera status reports `moving`.
- `web/js/ptz.js`: shared jog pad (hold to move, tap = nudge, speed; compact variant 0.25 default). Stop bound to the
  window (pointerup/cancel/blur), so removing the button mid-hold can't leave a camera moving; `ptzHolding()` /
  `afterPtzHold()` let views postpone re-renders. Used by Settings → Cameras (replaces its own pad; shows the current
  preset; control card re-renders only on changes and never mid-hold) and the camera inspector.
- Camera inspector: compact pad, "Current preset N (adjusted)" + **Overwrite preset N** (primary when adjusted), preset
  input with Recall / Save, quick-recall chips for this camera's seat shots and overview (current one highlighted).
- Room side panel now built from keyed sections (inspector / director / speakers in operate; selection / tray in edit),
  each rebuilt only when its data changes and never during a PTZ hold (before: operate mode rebuilt the whole panel on
  every live update, which would have wiped inputs and could drop a pointer release).
- ui:check room scenario: recall chip "Seat 3 · 3" → current preset 3; hold Pan right → camera moving; release on the
  window (not the button) → stopped and marked adjusted; Overwrite preset 3 → not adjusted; Save as 7 → current 7.
  Settings → Cameras scenario still drives the shared pad. Screenshots reviewed. `npm test` 137/137, ui:check OK.

## Decisions
- "Current preset" is what LikeABosch last recalled/stored; cameras can't report it (moves from a hardware joystick are
  not seen).

## Handoff
Done.
