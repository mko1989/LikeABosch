# DEC-034: Wired participant editing through the DCNM API; Group / Affiliation import column

- **Status:** accepted (user report 2026-10-12: "couldn't manually add/edit participants [on wired] … manual should be
  there"; design by Claude, revisable)
- **WO:** WO-106
- **Extends:** DEC-023 (participant domain actions, XLSX import), DEC-029 (DICENTIS feature layer over the DCNM API).
  **Respects:** DEC-014 / DEC-021 (the Conference Protocol only reads participants; writes need the dicentis-bridge).

## Context
On a wired DICENTIS the Participants view was read-only and import showed "not supported": the Conference Protocol has
no participant writes (WO-031/044 checked every operation). The DCNM .NET API has them: a participant is a **person**
(`RegisterPerson`) **registered into a meeting** (`PrepareParticipant2.RegisterParticipantsAsync`) and optionally
**assigned to a seat** (`AssignParticipantsToSeatsAsync`). Persons must be in the participant user group
(`MeetingConstants.PARTICIPANTGROUPID`, a static Guid). The bridge builds DCNM data classes only through a constructor
whose parameters are exactly the JSON members (bridge/common/ClrConvert.cs).

## Decision
1. **Domain actions unchanged** (DEC-023): `POST/PUT/DELETE /api/domain/participants…`, `PUT /seats/:id/participant`,
   import. On wired they run through `DicentisFeatures` (`createParticipant`, `updateParticipant`, `deleteParticipant`,
   `assignSeat`) when `dicentis.status.features.participants` (bridge logged in, `PrepareParticipant2.CanPrepareParticipants`
   and `RegisterPerson.CanRegisterPerson`); then `capabilities.actions.editParticipants` is true on wired. Without it
   the answer is `NOT_SUPPORTED` with what is needed (dicentis-bridge, right).
2. **Scope = the active meeting.** Create = new person (user name from the name, unique: `anna.kowalska`, `…2`; a random
   password, as people identify at the seat) + registration (can discuss, can vote, weight 1) + seat. Delete = remove
   from the meeting; the **person stays** in the DICENTIS database. Rename = the person's first/last name (one word = last
   name; title and middle name cleared on a rename). New field **`group`** (the person's Group) on create/update.
   NFC tags are not set on wired (validation error).
3. **Seat semantics as on wireless:** a seat given to someone is first taken from its holder (Unassign, then Assign).
4. **Participant user group:** the bridge now reports Guid constants too (`MeetingConstants.PARTICIPANTGROUPID`); if a
   bridge does not, the group of the meeting's existing participants is used; none → clear error.
5. **Payloads follow the constructors** (DcnmUserAccountPreparationInfo `(user, userName, password, pinCode)`,
   DcnmUserPreparationInfo with every member on update, DcnmParticipantPreparationInfo2 with `Id` = empty Guid). The mock
   dicentis-bridge checks constructor shapes the same way (`strictApis`, on for `RegisterPerson` and
   `PrepareParticipant2`; audio / languages follow in WO-115, which fixes the payloads that check found).
6. **Import:** optional column **Group / Affiliation** (also Organisation, Party, Delegation, Company); imported where the
   system stores a group (wired), else ignored with a note.

## Consequences
- Wired editing works only with the dicentis-bridge (Windows + DICENTIS software): on a Mac it stays read-only, now
  with an explanation in the view, the import dialog and the room inspector.
- Unverified on a real system: GetPersonAsync's Password/PinCode on update (we send back what it returns), whether the
  Conference Protocol's participant ids equal the DCNM participant ids (the simulation assumes so), events timing.

## Alternatives considered
- **Edit through prepared meetings (not only the active one):** more UI (meeting picker) and the Conference Protocol
  shows only the active meeting, so changes would be invisible. Later if needed.
- **Delete the person too:** destroys data shared with other meetings. Rejected.
- **A separate "DICENTIS participants" view:** duplicates the Participants view. Rejected: same view, same actions.
