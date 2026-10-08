# WO-106: DCNM: seat assignment, participant and agenda editing on a wired system

| | |
|---|---|
| **Status** | draft |
| **Phase** | 3 Web UI |
| **Depends on** | WO-101, DEC-029 |
| **Assignee** | — |
| **Created** | 2026-10-08 |
| **Updated** | 2026-10-08 |

## Goal
The part of the original WO-081 that is not audio: with the full DICENTIS API, the Meeting area edits seat ↔ participant
assignment (first), participants and the agenda (DEC-014 kept them read-only), through the DEC-029 feature layer and
the same domain actions as wireless (DEC-023: `editParticipants`).

## Context
WO-081 (split 2026-10-08), DEC-014, DEC-021, DEC-023, DEC-029. Interfaces: IPrepareParticipant2, IPrepareAgendaTopic,
IPrepareMeeting.

## Open questions (to refine before `ready`)
- Which meeting is edited: the active one only, or prepared meetings too?

## Work log
- 2026-10-08 (Claude Opus): created as draft (split from WO-081).
