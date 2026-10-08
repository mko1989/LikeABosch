# WO-094: Room edit: arrange more seats than the shape holds (overflow stays for later)

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-055 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
User (2026-10-07, next.md): "allow to arrange seats when there is too much seats per configured lines of seats … 40 seats … U shape with 10 per side, so there is 10 overflow. right now there is an error preventing applying. i want the overflow to stay where it was and let later arrangement."

## Context
WO-055 (arrange in shapes; `countsError` required the segments to hold exactly the selected count).

## Scope
- In: `countsError` allows fewer places than seats (error only when there are more places than seats or none); `placesFor`; `arrangement()` arranges the first seats in seat order and returns the rest as overflow; status text names the overflow; after Apply the overflow seats become the selection (ready for the next arrangement); undo as before.
- Out: automatic placement of the overflow.

## Acceptance criteria
- [x] Unit tests (`web/test/arrange.test.js`: countsError, placesFor).
- [x] ui-check: 20 seats, U 5/5/5 → 15 ghosts, status "5 seats do not fit", Apply → "5 seats selected", their positions unchanged, undo; screenshot `wired-room-arrange-overflow-scenario-light.png` looked at. `npm test` 259/259, ui-check OK.

## Work log
- 2026-10-07 (Claude Opus): implemented and checked as in the criteria.

## Decisions
- Overflow = the last seats in the chosen seat order (by name or selection order), so "seat 1…30" go into the U and 31…40 are left.
- More places than seats stays an error (the shape would have gaps the user did not ask for).

## Handoff
Delivered. Status `review`.
