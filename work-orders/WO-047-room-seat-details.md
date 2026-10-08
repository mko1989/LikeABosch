# WO-047: Room: full details of the selected seat

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-035, WO-044 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
User (2026-10-03): "for editing the room view i need all the info about the seat that is selected".

## Scope
- In: domain seats gain a `details` object (wired: seatType, visType, supportsSpeaking, hasVotingLicense, attributes,
  devices[] (name, type, serial, version, state, capabilities, found at seat), assigned/seated participant ids;
  wireless: diagnostics as today).
- In: room side panel for the selected seat (edit and operate mode): identity (name, id, status, local/remote, hidden),
  rights (vote, prio, voting licence, VIS type), participant (assigned / seated, name, group, present), live state (mic
  state, discussion role, speech timer), microphone sensitivity (value + quick adjust when permitted), devices list,
  camera shot, position/rotation; existing rotate/remove/shot editor stays.
- Out: editing seat configuration (not in the Conference Protocol).

## Acceptance criteria
- [x] Selecting a seat shows all of the above (mock + wired real snapshot); sensitivity change works on the mock.
- [x] Unit test for the details mapper; `npm test`, `npm run ui:check` pass; screenshot reviewed.

## Work log
- 2026-10-03 (Claude Opus): domain seats gained `details` (wired: status, seatType, visType, supportsSpeaking,
  hasVotingLicense, attributes, assigned/seated participant ids, devices with type/serial/version/state/capabilities;
  6.50 PascalCase normalised; wireless: minimal) + unit test. Room side panel `seatPanel()` in both modes: status/remote/
  hidden/attribute badges, participant (assigned, seated, user name), live (discussion role / queue position, speech time),
  **mic sensitivity** (− / value / + / reset, step and range from the description, permission-gated; "seat rejected"
  toast when the server answers status:false), seat rights, devices, seat id, position, camera shot (editor in edit mode).
  Edit mode: rotate/remove, or "Place on plan" for an unplaced seat. Operate mode: click still switches the mic, details
  open via right-click or the I key; `#/room?seat=<id>` selects and centres the seat (Meeting → Seating link).
  Edit-mode panel refreshes only when the selected seat's data changes (keeps half-typed shot inputs).
- ui:check (seating scenario): seat 3 panel shows its device and participant; "+" changes sensitivity to +0.5 dB live
  (mock event → topic → panel); screenshot reviewed (light/dark). Reset as an icon button after "Reset" wrapped.
- 2026-10-03 (Claude Opus): real 6.50 read-only snapshot (`scripts/ui-snapshot.mjs … "room?seat=<id>"`): panel shows
  status, type, rights, supports speaking: No, sensitivity 0 dB with controls, no devices (6.50 returns none). `npm test`
  136/136, `npm run ui:check` OK (3 consecutive full runs).

## Handoff
Done. Seat configuration (rights, devices) is not editable through the Conference Protocol (WO-050).
