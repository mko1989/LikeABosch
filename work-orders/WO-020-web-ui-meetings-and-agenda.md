# WO-020: Meetings and agenda

| | |
|---|---|
| **Status** | done |
| **Phase** | 3 Web UI |
| **Depends on** | WO-018 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
List meetings, activate/deactivate/open/close meeting, meeting info, agenda topics with open/close agenda.

## Scope (draft: refine into concrete tasks + acceptance criteria before starting)
- Read DEC-002 (plain HTML/JS, no framework) and the UI conventions decided in WO-018.
- Use only `web/js/api.js` + the SSE store for data; never call DICENTIS directly.
- Hide or disable controls the current permissions don't allow (`GET /api/connection` → permissions).
- Test manually against the mock and note the steps in the work log; real-server check goes into WO-028.

## Acceptance criteria
- [x] ui:check scenario (deactivate/activate/open/agenda) passes in light + dark; screenshot reviewed.
- [x] Controls only with `canManageMeeting` (inferred, see Decisions).
- [x] Works when no meeting is active (meetingInfo unavailable).

## Work log
- 2026-10-02 (Claude Opus): Refined (scope below in this log) and implemented together with WO-020/021/024. Shared `actionButton()` helper added to `web/js/dom.js` (busy state, optional confirm dialog, error toast; no optimistic updates). `npm run ui:check` now runs scripted scenarios for all three views (light + dark) plus earlier checks: all OK; screenshots reviewed. `npm test` 61/61.
- Bugs found by the scenarios and fixed in the backend event bridge (`backend/src/wired/events.js`, logged in WO-012 too): (1) a failed refresh (e.g. GetMeetingInfo with no active meeting) doesn't re-arm its event, so meetingInfo never came back after deactivate → activate; the bridge now re-registers that event explicitly. (2) `detach()` left a stale refresh-timer handle, so after Disconnect→Connect within 50 ms of a change, no further events were processed. Both have regression tests (the second verified to fail without the fix).
- View `web/js/views/meetings.js`: meeting list (state dot, default tag, date), Activate (when no meeting is active), active-meeting detail (state, schedule, identification), Open/Close meeting, Deactivate (confirm), agenda list with Open/Switch to/Close. Scenario: Deactivate → Activate City Council → Open → open agenda item 2 → Close agenda.

## Decisions
- The PDF lists **no permissions** for ActivateMeeting/Deactivate/Open/Close and Open/CloseAgenda (verified pp.77, 89–90, 97, 196–197). Controls are gated on `canManageMeeting` (inferred from the Permissions page: "manage meeting" rights). Added to WO-028 checklist.
- Deactivate and Close meeting ask for confirmation; agenda switches don't.
- When `meetingInfo` is unavailable (no active meeting), the view falls back to the meetings list.

## Handoff
Done against the mock. Real-server checks in WO-028: permission really needed; meeting state names/transitions (`activated`→`opened`→`closed`?); whether CloseMeeting deactivates.
