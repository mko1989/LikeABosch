# WO-024: System controls: power, volume, illumination, room, presentation

| | |
|---|---|
| **Status** | done |
| **Phase** | 3 Web UI |
| **Depends on** | WO-018 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Power mode on/off/standby, master volume slider (range from GetMasterVolumeRange), seat illumination, room name/contact, presentation activate/deactivate.

## Scope (draft: refine into concrete tasks + acceptance criteria before starting)
- Read DEC-002 (plain HTML/JS, no framework) and the UI conventions decided in WO-018.
- Use only `web/js/api.js` + the SSE store for data; never call DICENTIS directly.
- Hide or disable controls the current permissions don't allow (`GET /api/connection` → permissions).
- Test manually against the mock and note the steps in the work log; real-server check goes into WO-028.

## Acceptance criteria
- [x] ui:check scenario passes (light + dark); screenshot reviewed.
- [x] Each control gated on its permission from the spec.

## Work log
- 2026-10-02 (Claude Opus): Refined (scope below in this log) and implemented together with WO-020/021/024. Shared `actionButton()` helper added to `web/js/dom.js` (busy state, optional confirm dialog, error toast; no optimistic updates). `npm run ui:check` now runs scripted scenarios for all three views (light + dark) plus earlier checks: all OK; screenshots reviewed. `npm test` 61/61.
- Bugs found by the scenarios and fixed in the backend event bridge (`backend/src/wired/events.js`, logged in WO-012 too): (1) a failed refresh (e.g. GetMeetingInfo with no active meeting) doesn't re-arm its event, so meetingInfo never came back after deactivate → activate; the bridge now re-registers that event explicitly. (2) `detach()` left a stale refresh-timer handle, so after Disconnect→Connect within 50 ms of a change, no further events were processed. Both have regression tests (the second verified to fail without the fix).
- View `web/js/views/system.js`: power (state; Power on / Power off (confirm), separately gated on canSwitchSystemPowerOn/Off, disabled while powering on/off), master volume slider within GetMasterVolumeRange (sends on release, doesn't fight the user while dragging), presentation activate/deactivate, seat illumination (enable/disable with canEditSynoptic; illuminated seat select with canEnableSeatIllumination), room info. Mock got illumination behaviours (EnableSeatIllumination, SetIlluminateSeat, GetIlluminatedSeat). Scenario: volume 5 → power off/on → enable illumination → illuminate seat 3 → disable.

## Decisions
- Presentation Activate/Deactivate have no permissions in the PDF; gated on `canManageMeeting` (inferred, WO-028 checklist).
- Power off asks for confirmation; power on does not.

## Handoff
Done against the mock. Real-server checks in WO-028: presentation permission, intermediate powering states timing, illumination only in installation mode.
