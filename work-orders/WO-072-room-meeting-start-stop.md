# WO-072: Start / stop the meeting from the Room top bar

| | |
|---|---|
| **Status** | done |
| **Phase** | 3 Web UI |
| **Depends on** | WO-020, WO-035, WO-063 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-07 |

## Goal
User: "i also need the ability to start and stop meetings right from the top bar of the room view." The Room toolbar
shows the current meeting with Start/Stop (and a meeting picker when none runs), for DCN and wired DICENTIS.

## Context
DEC-010 (domain layer), DEC-017. Wired: `web/js/views/meetings.js` (ActivateMeeting / OpenMeeting / CloseMeeting /
DeactivateMeeting, topics `meetings`, `meetingInfo`). DCN: `web/js/views/dcn.js` (StartMeetingById / StopMeetingById,
StartSessionById / StopSessionById; topics `dcnMeetings`, `dcnActiveMeeting`, `dcnSessions`, `dcnActiveSession`).
User choices (2026-10-05): DCN Start = meeting **and its first session**, Stop ends both; wired Start = activate the
chosen meeting + open it, Stop = close (stays activated; Deactivate remains in Meeting → Meeting).

## Scope
- In: domain topic `domain.meeting` { supported, current: { id, title, state, running } | null, meetings: [{ id, title }],
  canControl } for wired + DCN (wireless / dcn-smd: not supported); domain actions `POST /api/domain/meeting/start
  { meetingId }` and `POST /api/domain/meeting/stop`; capability feature `meetingControl`; Room toolbar control
  (picker + Start, or title + Stop, confirm on Stop); mock support where missing; tests; ui:check.
- Out: agenda / session switching in the top bar.

## Acceptance criteria
- [x] Backend tests: start/stop against the wired mock and the DCN mock (DCN start also starts the first session):
  `domain.test.js` + `dcn-domain.test.js` "meeting start / stop" tests pass.
- [x] Room toolbar shows the control for wired and DCN, not for wireless / dcn-smd; full `npm run ui:check` UI CHECK OK;
  toolbar crops looked at (wired "City Council · Stop meeting", DCN dark "Council meeting · Morning session · Stop
  meeting", dcn-smd none, DCN without a meeting "No meeting · [picker] · Start meeting").
- [x] `npm test` 207/207, `e2e:mock` 31/31.

## Work log
- 2026-10-05 (Claude Opus): created (ready) from the user's request + answers.
- 2026-10-05 (Claude Opus): in-progress. Backend: feature `meetingControl` (wired, dcn), action `controlMeeting`
  (wired `canManageMeeting`, dcn `MeetingApi.IsMeetingControlAllowed`), topic `domain.meeting` (mappers wired/dcn;
  wireless/dcn-smd undefined), `POST /api/domain/meeting/start|stop` (routes.js). Web: `meetingBox` in the Room toolbar,
  re-rendered on `domain.meeting`/`domain.capabilities` only when its key changes (an open picker stays open); Stop
  asks for confirmation. Docs: `docs/api/domain.md`.
- 2026-10-07 (Claude Opus): first screenshot of the "no meeting" state: label clipped ("No meetir"), select too wide,
  button text wrapped → CSS (flex: none on label/button, select max 180px), toolbar may wrap on narrow windows.
  Re-checked: OK. All suites green (criteria).

## Decisions
- Wired Stop = `CloseMeeting`. The user chose "close, stays activated", but the real 6.50 server deactivates the
  meeting on close (WO-032, mirrored by the mock), so after Stop the top bar shows the picker again. Deactivate stays
  in Meeting → Meeting.
- Starting another meeting while one runs is refused (400 "… stop it first") instead of stopping it implicitly.
- DCN "first session" = first id of `config.MeetingApi.RetrieveMeetingSessions` (the DCN-SW order). If the meeting has
  no sessions, only the meeting starts.

## Handoff
Done. Real-system check on DCN: StartSessionById right after StartMeetingById (the mock accepts it immediately; a
real DCN-SW might need the MeetingStart event first; then a short retry would be the fix). Wired real-server check
of Start/Stop can go with the next e2e:wired run (WO-028).
