# WO-053: Switcher preview: inspector button + "camera cog sends to preview" option

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-037, WO-038, WO-052 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
User (2026-10-03): "there should be a preview button in there [camera inspector] that sends to preview as well as a
global option setting to send to prv when the cog of a camera is clicked."

## Scope
- In: switcher drivers `previewInput(input)` (ATEM `changePreviewInput` on the configured M/E; mock), DeviceManager
  `preview()`, `POST /api/devices/switcher/preview { input }`; tests.
- In: camera inspector "Preview" button next to "Cut to camera".
- In: global option `room.operate.cogSendsPreview` (room.json, `PUT /api/room/operate`), toggle in Settings → Cameras &
  switcher; when on, clicking a camera's ⚙ (not dragging it) also sends that camera to preview.
- Out: transitions (auto/mix) — program stays a hard cut (DEC-012).

## Acceptance criteria
- [x] Preview works on the mock switcher (API + inspector button); ATEM driver calls changePreviewInput (stub test).
- [x] Option persisted; cog click sends preview only when enabled; `npm test`, `npm run ui:check` pass; screenshot reviewed.

## Work log
- 2026-10-03 (Claude Opus): switcher drivers gained `previewInput(input)` (ATEM: `changePreviewInput(n, me)` on the
  configured M/E, validated; mock: sets preview), `DeviceManager.preview()`, `POST /api/devices/switcher/preview`
  (tests: stub ATEM call + real atem-connection has `changePreviewInput`; API publishes the new preview). Global option
  `room.operate.cogSendsPreview` (room.json, `PUT /api/room/operate`, validated, test) with a toggle in Settings →
  Cameras & switcher ("Room view" card). Camera inspector: **Preview** button next to Cut to camera; Settings → Cameras
  control card: Preview next to Cut to input. A camera's ⚙ click (not a drag) also previews when the option is on.
- ui:check room scenario: inspector Preview → switcher preview 1; with the option off a cam-2 ⚙ click leaves preview
  alone; option on → cam-2 ⚙ click → preview 2; option reset. Screenshots reviewed. `npm test` 137/137, ui:check OK.

## Handoff
Done. ATEM preview verified against the stub only; real ATEM: WO-041.
