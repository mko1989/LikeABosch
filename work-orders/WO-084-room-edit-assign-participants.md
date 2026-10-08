# WO-084: Room edit: assign seats to participants and create participants from the seat inspector

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-047, WO-027, WO-022 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
User (2026-10-07): "i also need ability to assign and create and assign participants from the room view edit."
In Room → Edit, the seat inspector lets the operator pick the participant for the seat, clear it, or type a new name
to create a participant and seat them there, without leaving the plan.

## Context
DEC-010 (domain layer), DEC-014 / DEC-021 (participant editing: wired needs the dicentis-bridge, WO-081), DEC-023
(participant domain actions). Only DICENTIS Wireless can edit participants today (WAP database: `POST/PUT/DELETE
/participants`, WO-027); the WAP rejects a seat that another participant holds (400 `Seat already assigned`, WO-075),
so a reassignment must first free the seat.

## Scope
- In:
  - Domain actions (DEC-023): `POST /api/domain/participants` (create), `PUT /api/domain/participants/:id`,
    `DELETE /api/domain/participants/:id`, `PUT /api/domain/seats/:seatId/participant { participantId | null }`
    (moves the participant, frees the seat from its current holder first). Wireless implementation; other systems
    → `NOT_SUPPORTED` (wired with a hint to WO-081).
  - Seat inspector in Edit mode: "Participant" select (none / everyone, with their current seat), "New participant"
    name field + "Create & assign". Shown when `actions.editParticipants`; else the read-only rows as today plus a
    one-line hint.
  - Tests against the wireless mock; ui-check step + screenshot (wireless).
- Out: editing NFC / other fields here (Participants view does that); wired / DCN editing (WO-081).

## Acceptance criteria
- [x] Domain actions tested against the wireless mock: create with seat, assign to a taken seat (holder freed),
      unassign, NOT_SUPPORTED on wired.
- [x] Room → Edit → seat: assign an existing participant, clear, create + assign (ui-check, wireless mock).
- [x] `npm test`, `npm run ui:check` green; screenshots looked at.

## Work log
- 2026-10-07 (Claude Opus): WO created from the user request; scope set (ready → in-progress).

- 2026-10-07 (Claude Opus): DEC-023 written. Domain actions in `backend/src/domain/routes.js`: create / update /
  delete participant, `PUT /seats/:seatId/participant`. Wireless: the seat's current holder is freed first
  (`PUT seatId -1`), also on create and on update with a seat; ids validated (integers, participant must exist →
  404); wired → NOT_SUPPORTED with a pointer to WO-081 (dcn too, generic message). Tests in `domain.test.js`:
  wireless create on a taken seat, move, unassign, rename + seat, delete, validation, restore; wired NOT_SUPPORTED.
- 2026-10-07 (Claude Opus): Room → Edit → seat inspector: "Participant" picker (— nobody — / everyone, "(now Seat n)"
  for people seated elsewhere) and "New name" + "Create & assign"; toasts say who moved from where. Gated by
  `capabilities.actions.editParticipants`, otherwise a one-line hint. The inspector key includes the participant list
  in Edit mode. The wireless Participants view now uses the domain actions too (DEC-023): editing someone onto a taken
  seat now moves the seat instead of the WAP's "Seat already assigned" error.
- 2026-10-07 (Claude Opus): ui-check: the wireless pass never ran its `room` scenario ('room' was missing from
  WIRELESS_ROUTES) and that scenario was a stale copy of the wired one (wired seat ids). Replaced it with the WO-084
  scenario (place seats, assign Anna to seat 3 → holder freed, create "Zoe Room" → Anna freed, clear, restore) and
  added 'room' to WIRELESS_ROUTES. Screenshot `wireless-room-participant-scenario-light.png` looked at (picker, create
  form, toasts; placeholder shortened to "New name" because it was cut). `npm test` 249/249, ui-check (all) OK.

## Decisions
- DEC-023 (domain actions; freeing the seat's holder first).
- Edit mode only (operate mode stays read-only, as asked).

## Handoff
Delivered: create / assign / clear participants from the room's seat inspector (Edit mode) on DICENTIS Wireless; domain
participant actions (DEC-023). Status `review`: user to try it on the real WAP. Wired / DCN: hint only until WO-081.
