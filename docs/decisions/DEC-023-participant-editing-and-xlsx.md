# DEC-023: Participant editing as domain actions; XLSX import/export without a dependency

- **Status:** accepted (requested by the user 2026-10-07: import/export of participants and seating, create/assign
  from the room; design by Claude, revisable)
- **WO:** WO-084 (domain actions, room inspector), WO-085 (import/export)
- **Extends:** DEC-010 (domain layer). **Respects:** DEC-014 / DEC-021 (the Conference Protocol cannot edit
  participants; wired editing comes through the dicentis-bridge, WO-081).

## Context
Participants could only be edited on Wireless, in a wireless-specific view calling the passthrough (WO-027). The user
wants to create and seat participants from the room plan and to exchange the list with Excel. Both need the same
writes, and wired editing will come later (WO-081), so the writes belong in the domain layer.
The WAP refuses a seat that another participant holds (`Seat already assigned`) and a duplicate NFC tag (WO-075).

## Decision
1. **Domain actions** (`/api/domain`, DEC-010): `POST /participants {name, seatId?, nfc?}` → `{ id }`,
   `PUT /participants/:id {name?, seatId?, nfc?}`, `DELETE /participants/:id`,
   `PUT /seats/:seatId/participant {participantId | null}` (frees the seat from its holder, then moves the
   participant). `seatId: null` = no seat. Implemented for wireless; other systems answer `NOT_SUPPORTED` until they
   can (wired: WO-081). Gated in the UI by `capabilities.actions.editParticipants`.
2. **File format: XLSX**, written and read by our own small module (`backend/src/lib/xlsx.js`, ZIP through
   `node:zlib`), no new dependency (DEC-002). The reader handles what Excel, LibreOffice and Numbers write (shared
   strings, inline strings, numbers, booleans); CSV is also accepted on import. Export:
   - sheet **Participants**: `Name`, `Seat`, `NFC tag` (importable) + read-only columns the system has (`ID`, group,
     present, …);
   - sheet **Seats**: every seat, its participant and plan position (reference; not imported).
3. **Import rules:** the sheet named "Participants" (else the first sheet); columns found by header (`Name` /
   `Participant`, `Seat`, `NFC`/`NFC tag`, optional `ID`). Rows match existing participants by `ID`, else by name
   (case-insensitive). Seat = seat name or seat id; empty = no seat. Errors (nothing is applied): unknown seat, a seat
   or NFC tag used twice, duplicate names, empty name, name > 32 characters (wireless). Participants not in the file
   are kept, unless "remove participants not in the file" is chosen; a kept participant whose seat the file gives to
   someone else loses that seat (warning). Always a preview first; apply runs deletes → frees seats/NFC tags that move
   → creates/updates, and stops at the first refused write, reporting what was done.

## Consequences
- The wireless Participants view uses the domain actions (one code path for room, view and import).
- Wired / DCN: export works (read), import and room editing show "not supported" until WO-081.
- Our XLSX module must be kept small; if a feature beyond plain cell values is ever needed (styles, formulas),
  revisit the dependency choice.

## Alternatives considered
- **SheetJS / ExcelJS:** complete, but a large runtime dependency (SheetJS's npm package is outdated; ExcelJS pulls
  many packages) for plain tables. Rejected.
- **CSV only:** simplest, but the user asked for Excel; CSV encoding/separator issues with Excel locales. Kept as an
  extra import format only.
- **Wireless-only endpoints:** would need to be redone for wired. Rejected.
