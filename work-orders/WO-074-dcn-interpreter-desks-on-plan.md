# WO-074: DCN interpreter desks on the room plan (live from the stream)

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-048, WO-051, WO-073 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
User: "it is not seeing interpreter desks" (DCN). Interpreter desks of a DCN system can be placed on the room plan and
show live state (translating, output channel + language, source) from the meeting data stream.

## Context
DEC-020, WO-048/051/052 (wired desks in `web/js/views/room.js`, read from wired topics `interpreterSeats` /
`interpreterBooths`), `smdInterpretation` topic (`{ desks: [{ number, id, boothNumber, seatId, source, destination,
translating }], booths }`), `backend/src/domain/mappers.js` (`deskSeats` excluded from seats for dcn-smd).

## Scope
- In: domain topic `domain.interpreterDesks` for `dcn` and `dcn-smd` (from `smdInterpretation`); desk seats excluded
  from `domain.seats` for `dcn` too; Room view: DCN desks in the unplaced tray, placeable, read-only node with live
  state and an inspector; wired desks unchanged; tests; ui:check dcn with screenshots.
- Out: controlling DCN desks (no API for it); desks for wireless.

## Acceptance criteria
- [x] Mapper unit test; backend test through the mocks (dcn + stream) yields desks (`dcn-stream.test.js` 4/4).
- [x] Room view with the DCN mock + SMD mock: desk placed, shows live state ("B1 · D1", "● A NLD", "hears FLR", red);
  inspector with seat / output / source; screenshot looked at (scratch script, `room?desk=desk-1-1`).
- [x] Wired room ui:check unchanged (full ui:check UI CHECK OK); `npm test` 207/207.

## Work log
- 2026-10-05 (Claude Opus): created (ready).
- 2026-10-05 (Claude Opus): in-progress → done. Mappers: `smdInterpreterDesks` (shared by dcn and dcn-smd),
  `domain.interpreterDesks` in DOMAIN_TOPICS, dcn `seats` drops stream desk seats. Room view: `desks()` returns domain
  desks for DCN in the wired shape (`seatId` = placement id `desk-<booth>-<desk>`, `generic: true`); `dcnDeskNode`,
  `dcnDeskPanel` (read-only), cogs for DCN desks (wired desks keep theirs in the strip), no quick-control strips for
  DCN. Tray/route selection/inspector reuse the wired code paths. ui-check DCN pass now runs an SMD mock with a live desk.

## Decisions
- ASSUMPTION (check on site): seat ids in the stream are the DCN-SW API seat ids (used to keep desk seats out of the
  delegate seats in `dcn` mode).
- Desk id includes the booth number: `SmdState` keys desks by `Number`; if real desk numbers restart per booth, two
  desks would collide there (WO-066 code). Not seen yet; check on site with more than one booth.

## Handoff
Done. Desks appear in Edit layout → Not placed once the stream reports them (an InterpretationActivity or the meeting's
booth list); without the stream (AllowedClients / licence) DCN shows no desks, as before.
