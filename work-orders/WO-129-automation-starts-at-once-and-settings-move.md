# WO-129: Camera automation works without a nudge; its settings move to Cameras & switcher

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-039, WO-040, WO-056, WO-108 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-17 |
| **Updated** | 2026-10-17 |

## Goal
User (2026-10-17): "the camera automation doesnt start working until i click the auto tick on one camera in room view.
also the options for camera automations and overview should be in cameras and switcher tab. the camera automation should
just have the presets to seats bindings."

## Context
DEC-012 §4, DEC-015, DEC-031; `backend/src/director/director.js`, `backend/src/devices/manager.js`,
`backend/src/room/store.js`, `web/js/views/automation.js`, `web/js/views/cameras.js`, `scripts/ui-check-electron.cjs`.

## Scope
- In:
  - Bug: after a start / project open the director's first automatic shot does nothing until some device status change.
  - The director acts on who is speaking now when the automation is switched on (master switch, a camera or the
    switcher back into the automation), not only on the next microphone change.
  - UI: Behaviour (Auto, safe/live, timings), the overview shot and the recent actions log move from Settings → Camera
    automation to Settings → Cameras & switcher. Camera automation keeps only the seat → preset table (+ delete presets).
- Out: Room view side panel (Auto switch, switcher cuts) stays as it is; no change to director rules.

## Deliverables
`backend/src/director/director.js`, `backend/src/devices/manager.js`, `backend/src/room/store.js`, `backend/src/server.js`,
`backend/test/director.test.js`, `web/js/views/automation.js`, `web/js/views/cameras.js`, `scripts/ui-check-electron.cjs`.

## Acceptance criteria
- [x] Regression test: after a project re-open with the switcher already connected, the first speaker gets a correct
      (safe) shot without touching any device setting.
- [x] Test: switching Auto on while a mic is on puts that seat on air.
- [x] Test: switching a camera back into the automation while its seat speaks puts that seat on air.
- [x] `npm test` passes.
- [x] Settings → Cameras & switcher shows behaviour, overview shot, recent actions; Settings → Camera automation shows
      only the seat presets; `npm run ui:check` passes and the screenshots are looked at.

## Work log
- 2026-10-17 (Claude Opus): Reproduced with a simulated wireless system (the user's current project) + 3 mock cameras +
  mock switcher, restart of the backend, then a mic on: log `automatic: seat 3 → cam-1 preset 3`, steps `[]`, no cut.
  Cause: `projects.#open` → `devices.open` (the mock switcher connects and publishes `changed`, the director learns
  program = cam-1) → `emit('opened')` → `director.reset()` set `onAirCamera = null`. Nothing restored it until the next
  device publish, which is what a camera's automation tick (PUT camera → `#publish`) does. With `onAirCamera` null the
  safe strategy pre-positioned the on-air camera (moved it live) and then, after the recall's publish fixed
  `onAirCamera`, saw nothing left to do. Fix: `reset()` (and the constructor) read the program camera back from the
  switcher. Repro after the fix: steps recall/wait/cut/recall/wait/cut, cuts [3, 1] (safe move via the overview).
- 2026-10-17 (Claude Opus): Re-evaluation: `DeviceManager` emits `automation` when a PUT camera / PATCH switcher carries
  the `automation` field; `RoomStore.onDirectorChanged` hook after `setDirector` (wired in server.js). Both call
  `director.reevaluate()`. Explicit hooks instead of diffing the `room` / `devices` topics, which also change when a
  project opens (devices not connected yet → spurious failed recalls).
- 2026-10-17 (Claude Opus): UI: `cameras.js` got the "Camera automation" card (form `.automation-settings`), the
  "Overview shot" card (left column) and "Recent camera actions" (right column, under the PTZ control); `automation.js`
  keeps only "Seat presets" (table + delete presets) with a link back. `ui-check-electron.cjs` sets overview + behaviour on
  the Cameras page (new screenshot `cameras-automation-settings`) and checks that the Camera automation page has no
  behaviour form / overview selector any more.
- 2026-10-17 (Claude Opus): Tests: new suite "the automation acts without a nudge (WO-129)" in
  `backend/test/director.test.js` (project re-open → `onAirCamera` read back, first speaker gets cuts [2, 1]; Auto on while
  speaking; camera back into the automation while its seat speaks). All 3 fail with the backend fix stashed, pass with it.
  `npm test`: 379/379 pass. `npm run ui:check`: UI CHECK OK; looked at `wired-cameras-automation-settings-scenario-light.png`
  and `wired-automation-scenario-light.png` (cards where expected, nothing clipped).

## Decisions
- Re-evaluate only on explicit operator changes (director settings saved, a device's automation flag set), not on
  project open: the devices of the new project are still connecting then, and the first microphone change starts the
  automation anyway.

## Handoff
- Delivered: director no longer forgets what is on air when a project opens (the cause of "only works after clicking a
  camera's Auto tick"); the director re-evaluates when Auto / a device's automation is switched; behaviour, overview and
  log live in Settings → Cameras & switcher, Settings → Camera automation is only the seat → preset table.
- Not changed: the Room view's side panel (Auto switch, switcher cuts, Overview button).
- Not checked on real hardware (ATEM connects more slowly than the mock, so it hit the bug less often; the fix covers
  both orders).
