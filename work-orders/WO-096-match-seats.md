# WO-096: Match a project's seats to the connected system (simulated → real)

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-095, WO-093 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
User (2026-10-07): "id like a \"simulate\" version too with different systems. exporting and importing such projects with the ability to match the connected system with the simulated project would be great. i also want to package it for test dist" Part 2: a project made on a simulated system (exported/imported as a file) is matched to the real system's seats.

## Context
DEC-026 §4, DEC-016 §6 (project files), DEC-025.

## Scope
- In: `room.seatNames` (sanitised on import, travels in files), `recordSeatNames` (only while the project belongs to the connected system), `RoomStore.remapSeats` + `POST /api/room/remap`, `web/js/seat-match.js` (proposal), Room banner + "Match seats…" dialog (+ link the project to the connected system).
- Out: interpreter desk remapping (DEC-026 §5).

## Acceptance criteria
- [x] `web/test/seat-match.test.js` (rules incl. chairman and leftovers); remap + names in `simulation.test.js` (incl. two seats → one refused, names in the downloaded file).
- [x] ui-check: simulated WAP project opened on the real (mock wired) system → banner "6 seats" → dialog proposes by name → Apply → seats remapped, project linked, banner gone; screenshot `wired-match-seats-scenario-light.png` looked at. `npm test` 263/263, `npm run e2e:wireless:mock` 23/23, `npm run e2e:mock` 31/31, `node scripts/ui-check.mjs` (all systems) OK twice.

## Work log
- 2026-10-07 (Claude Opus): implemented as in Scope; the header crowding seen in the screenshot (project tag) capped in width.

## Decisions
- Proposal order: same id, same name, same number, chairman, natural order; the operator corrects in the dialog.
- Undo history is cleared after a remap (its entries point at the old ids).

## Handoff
Delivered. Status `review`.
