# WO-071: Room plan: preset badge visible on seats in any direction

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-035, WO-052 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
User report: "for seats that are facing right the has preset indication is not visible". The blue shot badge must be
visible on every seat with a camera shot, whatever the seat's rotation.

## Context
`web/js/views/room.js` `seatNode()`: the badge is drawn in the seat's rotated frame at the local top-right
(`SEAT_R - 4, -SEAT_R + 4`), so it moves with the rotation; the inspector cog (WO-052) is drawn unrotated at the
bottom-right. At 90° (facing right) the badge lands exactly under the cog.

## Scope
- In: draw the badge counter-rotated so it always sits at the top-right on screen (like the labels); screenshot check
  with seats facing up/right/down/left.
- Out: other plan symbols.

## Acceptance criteria
- [x] Screenshot with seats at 0/90/180/270° and shots: badge visible on every seat with a shot, none on seats without (scratch repro, crop looked at).
- [x] `npm run ui:check -- --system wired room` UI CHECK OK.

## Work log
- 2026-10-05 (Claude Opus): created. Reproduced with a scratch script (wired mock, 16 seats in four directions, 12 with
  shots, `scripts/ui-check-electron.cjs room`): seats facing right show no badge (under the cog); facing down/left the
  badge sits bottom-left / top-left.
- 2026-10-05 (Claude Opus): badge wrapped in a `g` with `rotate(-rotation)` → fixed top-right on screen. Re-rendered:
  seats 1–3, 5–7, 9–11, 13–15 show the badge top-right, the four without shots none. ui:check room OK.
- 2026-10-05 (Claude Opus): correction: that ui:check run was `--system wired room`, which took `room` as the outDir
  and checked every wired route (still OK; stray `./room/` removed, see WO-073). Full `npm run ui:check` later: OK.

## Decisions

## Handoff
Done. One-line change in `seatNode()`.
