# WO-106: DCNM: seat assignment, participant and agenda editing on a wired system

| | |
|---|---|
| **Status** | review |
| **Phase** | 3 Web UI |
| **Depends on** | WO-101, DEC-029 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-08 |
| **Updated** | 2026-10-12 |

## Goal
The part of the original WO-081 that is not audio: with the full DICENTIS API, the Meeting area edits seat ↔ participant
assignment (first), participants and the agenda (DEC-014 kept them read-only), through the DEC-029 feature layer and
the same domain actions as wireless (DEC-023: `editParticipants`).

## Context
WO-081 (split 2026-10-08), DEC-014, DEC-021, DEC-023, DEC-029. Interfaces: IPrepareParticipant2, IPrepareAgendaTopic,
IPrepareMeeting.

## Scope (refined 2026-10-12)
- In: participants of the **active meeting** on a wired system through the DCNM API: add (person + registration +
  seat), rename / group, seat assignment (incl. from the room inspector), remove from the meeting; Excel import applies
  on wired (with an optional Group / Affiliation column); the wired Participants view gets Add / Edit / Remove; clear
  messages when the dicentis-bridge is missing; mock dicentis-bridge: persons + participants linked to the wired mock.
- Out: agenda editing and prepared (non-active) meetings (follow-up WO-116, draft); NFC tags on wired; person pictures.

## Acceptance criteria
- [x] Domain participant actions work on a simulated wired system with the full API; results visible through the
      Conference Protocol topics (`backend/test/wired-participants.test.js`).
- [x] The 45-person test workbook imports on wired, groups set from "Affiliation".
- [x] Without the dicentis-bridge: NOT_SUPPORTED with the reason; UI says what is needed.
- [x] Payloads have the shapes the real bridge accepts (mock strict check; bridge conformance passes).
- [x] `npm test`, `npm run ui:check` (participants scenario: add, edit, remove), `npm run e2e:mock` pass.

## Work log
- 2026-10-08 (Claude Opus): created as draft (split from WO-081).
- 2026-10-12 (Claude Opus): refined to ready on the user's report (wired system: no manual add/edit, only import).
  Answer to the open question: the active meeting only (the Conference Protocol, which feeds the UI, shows only that
  one); DEC-034. Set in-progress.
- 2026-10-12 (Claude Opus): implemented.
  - DCNM API study: `RegisterPerson` (CreatePersonsAsync, UpdatePersonAsync, GetPersonAsync), `PrepareParticipant2`
    (RetrieveParticipantsForMeetingAsync, RegisterParticipantsAsync, Assign/UnassignParticipants…, DeleteParticipantsAsync);
    persons must be in the participant user group (`MeetingConstants.PARTICIPANTGROUPID`).
  - Backend: `backend/src/dicentis/participants.js` (name split, unique user names, payload builders following the
    constructors), `DicentisFeatures` actions + `features().participants`, domain routes' wired branch, capability
    `editParticipants` on wired when available, `group` field, import `groups` option (Group / Affiliation column).
  - Bridge: `DcnmHost.Constants()` also reports Guid constants (`MeetingConstants.PARTICIPANTGROUPID`); conformance
    test asserts it. `npm run bridge:test` 16/16 (fake DLL build, macOS).
  - Mock: DCNM world persons + participants (`behaviours.js`), linked to the wired mock (`wired-link.js`: DCNM changes
    rewrite the wired participants / seat assignments and fire participantsChanged, participantSeatsChanged,
    seatsChanged); participant user group enforced.
  - Found while testing: the real bridge needs a data class's exact constructor members; my first payloads (person
    `User` with only first/last name/group; participant without `Id`) would have been refused on Windows while the mock
    took them. Added `checkShape` to the mock bridge (strict for RegisterPerson / PrepareParticipant2) and fixed the
    payloads. Turned on for all interfaces it also fails existing writes: equaliser (`QFactor` vs constructor
    `qualityFactor`), seat Dante out (DcnmSeatConfigurationInfo members missing), language create (`userDefined`,
    `orderId` missing) → WO-115 (ready), not fixed here (scope).
  - UI: wired Participants view: Add participant, Edit, Remove (confirm), form name / group / seat; read-only hint
    explains the dicentis-bridge; import preview shows groups and the "column ignored" note; room inspector message.
    ui:check participants scenario extended (add → edit group → remove); it found `api` missing in the wired branch
    of the view (fixed).
  - Test data: `backend/test/fixtures/participants-45.xlsx` (Name, Affiliation; 45 people) for the user, also used
    by the import test.
  - Evidence: `npm test` 351/351; `npm run ui:check` UI CHECK OK (all systems); `npm run e2e:mock` 31/31, 123/123 ops;
    `npm run e2e:wireless:mock` 23/23; `npm run bridge:test` 16/16; screenshot `wired-participants-added-scenario-light.png` checked.
  - One existing assertion changed on purpose: domain.test.js expected the old "planned in WO-081" message; it now
    expects the dicentis-bridge explanation (behaviour changed by DEC-034).

## Decisions
- DEC-034.
- Remove = from the meeting only; the person stays.
- The mock bridge's constructor-shape check is per interface for now (`strictApis`), so WO-115 can switch on the rest.

## Handoff
- Delivered: add / edit / seat / remove participants of the active meeting on a wired DICENTIS with the dicentis-bridge,
  in the Participants view, the room seat inspector and the Excel import (with Group / Affiliation).
- **Needs a Windows PC with the DICENTIS software** (dicentis-bridge, DEC-021/022). On macOS against a real wired system
  editing stays read-only (now explained in the UI). Real-system check pending: WO-082.
- Unverified assumptions (check first on hardware): Conference Protocol participant ids = DCNM participant ids;
  UpdatePersonAsync with the Password / PinCode GetPersonAsync returns; generated user names / passwords accepted by
  the server's password policy.
- Follow-ups: WO-115 (DCNM payload shapes for audio / languages), WO-116 (draft: agenda + prepared meetings).
