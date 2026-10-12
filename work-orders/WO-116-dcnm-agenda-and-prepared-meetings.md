# WO-116: DCNM: agenda editing and prepared (non-active) meetings on a wired system

| | |
|---|---|
| **Status** | draft |
| **Phase** | 3 Web UI |
| **Depends on** | WO-106 |
| **Assignee** | — |
| **Created** | 2026-10-12 |
| **Updated** | 2026-10-12 |

## Goal
The rest of WO-106's original goal: edit agenda topics, and participants of meetings that are not active, through the
DCNM API (IPrepareAgendaTopic, IPrepareMeeting, PrepareParticipant2 with a meeting id).

## Open questions (to refine before `ready`)
- Meeting picker in the Meeting area? How to show participants of a non-active meeting (the Conference Protocol only
  shows the active one: read them through RetrieveParticipantsForMeetingAsync)?

## Work log
- 2026-10-12 (Claude Opus): created as draft (split from WO-106).
