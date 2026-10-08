# WO-019: Synoptic seats and discussion control

| | |
|---|---|
| **Status** | done |
| **Phase** | 3 Web UI |
| **Depends on** | WO-018 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Seat grid/list with status, seated participant, mic state; discussion list (speakers, requests, responders, priority) with speech timers (algorithm in conference README); actions: add to speakers, remove, activate/deactivate mic.

## Scope (refined 2026-10-02)
- View `#/discussion` (`web/js/views/discussion.js`), topics `discussionList`, `seats`; requires `canViewSynoptic`.
- **Speakers** panel: priority/speakers/responders with mic state, speech timer (algorithm PDF p.68 → pure `web/js/speech-timer.js`),
  actions Mute/Unmute (`DeactivateMicrophone`/`ActivateMicrophone`, only with `canDeactivateMicrophone`) and Remove (`RemoveSeatFromDiscussionList`).
- **Requests** panel: waiting list in order, actions "Give floor" (`AddSeatToSpeakers`) and Remove.
- **Seats** grid: every seat with name/screen line, connection status, discussion state colour; filter box;
  per-seat action (Add / Give floor / Remove) when `canManageMeeting`.
- Errors from DICENTIS shown as toasts; no optimistic updates (DEC-009).
- Timers update every second without re-rendering the lists.

## Original draft notes
- Read DEC-002 (plain HTML/JS, no framework) and the UI conventions decided in WO-018.
- Use only `web/js/api.js` + the SSE store for data; never call DICENTIS directly.
- Hide or disable controls the current permissions don't allow (`GET /api/connection` → permissions).
- Test manually against the mock and note the steps in the work log; real-server check goes into WO-028.

## Acceptance criteria
- [x] Speech timer unit tests (on/mute/overtime/hidden).
- [x] ui:check: discussion view without console errors (light/dark), screenshots reviewed.
- [x] Scripted interaction on the mock: add seat via grid → appears under Speakers; request from mock → appears under Requests; Give floor; Remove.
- [x] Actions hidden without `canManageMeeting`; mute buttons hidden without `canDeactivateMicrophone`.

## Work log
- 2026-10-02 (Claude Opus): Implemented `web/js/views/discussion.js` (speakers/requests/seat grid, actions, filter, 1 s timer updates without re-render), `web/js/speech-timer.js` + `web/test/speech-timer.test.js` (4 tests), CSS in `app.css`, registered in `main.js`. `scripts/ui-check*` extended: (1) discussion scenario: Add seats 3–7 via grid → 5th becomes a request (mock max 4 speakers) → Remove seat 3 → request promoted; screenshots light/dark reviewed (timers counting, tile states, actions); (2) permission scenarios: mock account restricted + `permissionsChanged` → view-only shows no buttons; manage-without-mute shows Remove but no Mute/Unmute. `npm run ui:check` OK; `npm test` 59/59.

## Decisions
- Action buttons are shown only with the permissions the spec lists (`canManageMeeting`; mute/unmute also `canDeactivateMicrophone`, which DICENTIS only grants in Response mode, PDF p.66).
- "Give floor" = `AddSeatToSpeakers` on a request (PDF: shifts requester to active speakers).
- The local reference time for the speech timer is taken when a new `discussionList` object arrives (SSE), per PDF p.68.
- No confirmation dialogs for mic actions: they're frequent operator actions and reversible.

## Handoff
Done (against the mock). To check on the real system (WO-028): response-mode mute behaviour, how `isResponder`/`isResponseRequest` look, remote seats (`seatType: remote`), large rooms (grid performance with hundreds of seats: consider keyed updates then).
