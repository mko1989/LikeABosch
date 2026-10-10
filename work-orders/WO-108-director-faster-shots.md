# WO-108: Director: faster preset recalls, immediate overview

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-039, WO-056 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-10 |
| **Updated** | 2026-10-10 |

## Goal
Camera shots follow speakers faster and the overview comes back as quickly as possible (user, next.md 2026-10-10:
"camera presets take too long to be recalled, probably due to the misclick setting, should be shorter by default; going
back to overview should always be as quick as possible").

## Context
DEC-012 §4, DEC-015, [DEC-031](../docs/decisions/DEC-031-director-fast-overview-and-preposition.md). Code:
`backend/src/director/director.js` (executor), `decide.js` (pure plan), `backend/src/room/store.js` (defaults),
`web/js/views/automation.js` (settings form). The "misclick setting" is `delayMs` ("Delay after mic on").

## Scope
- In: DEC-031 §1–6 in the director executor and room defaults; settings hints; tests.
- Out: VISCA driver changes (completion handling per camera model) → WO-041 (hardware verification).

## Deliverables
`backend/src/director/director.js`, `backend/src/room/store.js`, `web/js/views/automation.js`,
`backend/test/director.test.js`, DEC-031.

## Acceptance criteria
- [x] Last mic off → overview cut without waiting `delayMs`/`minShotMs` (test with large delay/minShot).
- [x] New speaker on an off-air camera: recall sent at once, cut only after `delayMs` (test).
- [x] Mic on/off within `delayMs` while another speaker is on air → no cut (test).
- [x] Safe cut waits for completion or `settleMs` from the recall, whichever first; never the camera's full completion timeout (test with a slow camera).
- [x] Default `delayMs` 250; `npm test` green; Settings → Automation hints updated (ui:check screenshot looked at).

## Work log
- 2026-10-10 (Claude Opus): Created from next.md. Analysis: delays were sequential (delayMs → recall awaited incl.
  VISCA completion up to 10 s → settleMs → cut); overview waited delayMs + minShot remainder; pending timer not cleared
  when the target returned to the current shot (misclick still cut). DEC-031 written. Status ready → in-progress.
- 2026-10-10 (Claude Opus): Implemented in `director.js`: `#recall` sends without awaiting and keeps
  `arrival[camera]` = race(completion reply, `settleMs` from sending; failed recall → at once); `wait` steps and safe
  cuts await it; live never waits. `#preposition` recalls the pending shot's camera when it is not on program, not the
  current target's camera and no job runs. Nobody speaking → `#go` at once. Timer cleared on every discussion change
  (+ `enabled` re-checked when it fires). First run of the new tests: speaker after the overview still waited ~5 s,
  because `lastCutAt` kept the earlier speaker cut → `lastCutAt` is now the time the speaker shot on air went on air
  (0 while the overview is on air). Default `delayMs` 250 (room store; room.test.js updated), automation hints +
  input step 50. New suite "director timing (DEC-031)" (4 tests): all fail against the old director.js (checked by
  swapping the file back temporarily), all pass now. `npm test`: 322/322. `npm run ui:check`: OK; looked at
  `data/ui-check/wired-automation-light.png` (250 default, new hints, layout fine).
- 2026-10-10 (Claude Opus): Status → review (behaviour with the user's real cameras still to be seen).

## Decisions
- DEC-031.

## Handoff
Delivered: DEC-031 in the director (immediate overview, pre-positioning, travel wait capped by `settleMs`, misclick fix,
default delay 250 ms), hints in Settings → Automation, tests.

Known gaps / for the user:
- **Saved projects keep their `delayMs`** (500 in projects created before): change it in Settings → Camera automation.
- Cameras that report arrival later than "Camera travel time" are now cut to while still moving: raise the value.
- The VISCA driver still waits up to 10 s for a completion reply per command and serialises commands per camera. A
  camera that only ACKs therefore delays the *next* command to the same camera. The director no longer waits for it,
  but quick speaker changes on one such camera can still queue. To check on hardware → WO-041.
