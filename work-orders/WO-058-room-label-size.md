# WO-058: Room plan: adjustable label size (− / +)

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-035, WO-042 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
User (2026-10-05): "I have quite a big room with a lot of seats and their numbers/labels are barely readable when I
have the whole room fit the screen. It'd be best to add a +/- display font size so it's easily adjustable."

## Scope
- In: toolbar control "Labels − 100% +" in both modes; scales seat numbers, participant names and camera labels
  (50 %–600 %, steps); labels stay anchored (centred in the seat / just below the disc) at any size; remembered per
  browser (localStorage, wrapped in try/catch; display preference, the right size depends on the screen).
- Out: auto-sizing to a minimum screen size. (Interpreter desks were out at first, added after user feedback, see log.)

## Acceptance criteria
- [x] − / + change the label size on the plan; value shown; limits respected; survives a reload.
- [x] ui-check step + screenshot looked at; `npm test` + `npm run ui:check` green.

## Work log
- 2026-10-05 (Claude Opus): WO created.
- 2026-10-05 (Claude Opus): room.js: LABEL_STEPS 50–600 %, `--label-scale` on the SVG, "Labels − n% +" group in the
  toolbar (both modes, buttons disabled at the limits), localStorage `likeabosch.room.labelScale` (try/catch).
  CSS: seat number / name / camera label / MANUAL font sizes use calc(… × var(--label-scale)); seat numbers use
  dominant-baseline central (y 0), names and camera labels dominant-baseline hanging just below the shape, MANUAL
  dy 1.3em, so positions don't depend on the size. ui-check: reset to 100 % (the setting persists in the Electron
  profile: my first check assumed 14 px and failed at 17.5 px; one run also broke on a quoting mistake in the check),
  3 × "Larger labels" → seat 3 label 28 px, "200%", stored "2"; back to 14 px. `npm test` 158/158,
  `node scripts/ui-check.mjs` OK. Screenshot `wired-room-labels-scenario-light.png` looked at: numbers clearly bigger;
  participant names overlap at 200 % in the dense mock layout.
- 2026-10-05 (Claude Opus): User: "they are not adjusting the labels of the interpreter desks." Scaling only the
  desk texts would overflow the fixed box, so the whole desk symbol (box + texts) scales: wrapped in `g.desk-art`
  with CSS `transform: scale(var(--label-scale))`; the HTML quick-control strip offset (`positionStrips`) and the
  fit bounds use the scale; `stepLabels` repositions the strips. ui-check: desk body width ×2 at 200 % and the strip
  stays directly below the desk. `npm test` 158/158, `node scripts/ui-check.mjs` OK; screenshot
  `wired-room-labels-scenario-light.png` looked at (B1 · D1 readable, strip under it).

## Decisions
- Per-browser setting, not per project: two screens on the same project need different sizes.
- Interpreter desks: the whole symbol scales (not just its text), so the text never overflows its box.
- Implemented as a CSS variable `--label-scale` on the SVG; text anchoring via `dominant-baseline` so no position
  math depends on the size.

## Handoff
Delivered: Labels − / + in the room toolbar (50–600 %, per browser). Status `review`.
Possible follow-up (ask the user): a toggle to hide participant names on the plan, since large labels overlap in
dense layouts.
