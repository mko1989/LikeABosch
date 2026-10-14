# WO-124: Seating view: assign, move and clear seats in the overview

| | |
|---|---|
| **Status** | review |
| **Phase** | 3 Web UI |
| **Depends on** | WO-046, WO-084, WO-106 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-14 |
| **Updated** | 2026-10-14 |

## Goal
Meeting → Seating lets the user change who sits where, directly in the seat table, whenever the connected system allows
participant editing (wireless; wired with the full DICENTIS API). It no longer shows the outdated "planned, WO-081"
read-only note.

## Context
User report 2026-10-14: the Seating view shows "Seat assignments are prepared in the DICENTIS Meeting Application …
editing here needs the dicentis-bridge (planned, WO-081)" instead of letting the user change seating. WO-106 (DEC-034)
already delivered wired seat assignment through the DCNM API, used by the Participants view and the room seat
inspector; the Seating view (WO-046) was never updated. Backend: `PUT /api/domain/seats/:seatId/participant
{ participantId | null }` (wired via dicentis-bridge, wireless via the WAP; frees the seat's previous holder), gated
by `domain.capabilities.actions.editParticipants`. DEC-009 (no innerHTML, writes via `web/js/api.js`), DEC-023, DEC-034.

## Scope
- In: `web/js/views/seating.js`: per-seat participant picker in the "Assigned participant" column when
  `editParticipants` is on (assign, move from another seat, clear); table not rebuilt under an open picker; the
  "Changing assignments" card text per system (wired with / without the dicentis-bridge, wireless); ui:check seating
  scenario (wired with the linked mock dicentis-bridge, and wireless) exercises the picker.
- Out: backend changes (none needed); DCN seat editing (DCN-SW API, not offered by the domain layer); drag & drop
  between seats.

## Acceptance criteria
- [x] Wired simulated system with the full API: picking a participant for a seat assigns it, the seat they left
      shows "— nobody —", clearing works (ui:check wired seating scenario, light + dark: ok).
- [x] Wireless: same picker works (ui:check wireless seating scenario, light + dark: ok; checked through the WAP mock's
      participant list).
- [x] Without `editParticipants` the table stays read-only and the card says what is needed (no "planned, WO-081"):
      DCN / DCN-SMD screenshots unchanged (read-only); wired-without-bridge text checked in code only (no ui:check pass
      runs wired without the linked mock bridge).
- [x] `npm test` 373/373 and `npm run ui:check` UI CHECK OK; screenshots looked at.

## Work log
- 2026-10-14 (Claude Opus): created on the user's report; scope clear (UI only), set in-progress.
- 2026-10-14 (Claude Opus): implemented.
  - `web/js/views/seating.js`: with `editParticipants` the "Assigned participant" cell is a picker (`select.seat-picker`,
    "— nobody —" + participants by surname; someone seated elsewhere shows "(now Seat N)"). A change calls
    `PUT /api/domain/seats/:id/participant` (frees the previous holder; wired via DCNM, wireless via the WAP), toast
    "X → Seat N (moved from …)". The "Changing assignments" card is rendered from the capabilities (re-rendered on
    `topic:domain.capabilities`): editable text, or per system why not (wired: dicentis-bridge in Settings →
    Connection, link; the "planned, WO-081" text is gone).
  - Live updates vs. an open list: first version skipped table rebuilds while a picker had focus and re-focused the
    picker after a change. ui:check showed the table stuck at the old state: the move arrives through Conference
    Protocol events *after* the PUT returns, and focus never left. Fixed: rebuilds wait only while the list is open
    (pointerdown / keydown until change, blur, Escape or Tab); after each rebuild the same seat's picker gets focus back
    (`preventScroll`).
  - `web/css/app.css`: picker 11.5rem wide. A 13rem minimum pushed "Show on plan" out of the card at 1280 px (screenshot).
  - `scripts/ui-check-electron.cjs`: wired seating scenario: seat-1 shows Anna (selected option, not textContent:
    option texts would match anyway), help text without "WO-081", move Anna → seat-19, seat-1 empty, clear seat-19,
    Anna back to seat-1 (state restored for the dark pass). Hit two bugs in my own check: the mock chair is
    "Chair Anna de Vries" (match by substring), and `?? ''` mixed with `&&` without parentheses is a SyntaxError.
    Wireless seating scenario: move Anna to seat 20 and back with the picker, checked through `/api/wireless/participants`.
  - Evidence: `npm test` 373/373; `npm run ui:check` UI CHECK OK (wired, wireless, dcn, dcn-smd; seating scenarios
    ok); screenshots wired-seating-scenario-{light,dark}, wired-seating-moved-scenario-light, wireless-seating-light,
    dcn-seating-light checked.

## Decisions
- Seat-centric endpoint (`PUT /seats/:id/participant`) rather than the participant PUT: same call as the room
  inspector, and it frees the seat's previous holder on both systems.
- No backend change, no new DEC (follows DEC-009, DEC-023, DEC-034).

## Handoff
- Delivered: Meeting → Seating assigns, moves and clears seats in the table on wireless and on wired with the full
  DICENTIS API; read-only systems explain what is needed.
- Real wired system: as WO-106, needs the dicentis-bridge on a Windows PC (real-system check is WO-082).
- Not done (out of scope): drag & drop between seats; making the "Participants without a seat" chips assignable.
