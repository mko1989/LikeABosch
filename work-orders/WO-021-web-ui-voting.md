# WO-021: Voting control and results

| | |
|---|---|
| **Status** | done |
| **Phase** | 3 Web UI |
| **Depends on** | WO-018 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Prepared votings list, ad-hoc voting, open/close/hold/resume/abort/accept/reject, live results, majority/quorum, individual and per-seat results.

## Scope (draft: refine into concrete tasks + acceptance criteria before starting)
- Read DEC-002 (plain HTML/JS, no framework) and the UI conventions decided in WO-018.
- Use only `web/js/api.js` + the SSE store for data; never call DICENTIS directly.
- Hide or disable controls the current permissions don't allow (`GET /api/connection` → permissions).
- Test manually against the mock and note the steps in the work log; real-server check goes into WO-028.

## Acceptance criteria
- [x] ui:check scenario (activate → open → live results → close → accept) passes; screenshot reviewed.
- [x] Controls only with `canControlVoting`.
- [x] Results update live from mock votes (no reload).

## Work log
- 2026-10-02 (Claude Opus): Refined (scope below in this log) and implemented together with WO-020/021/024. Shared `actionButton()` helper added to `web/js/dom.js` (busy state, optional confirm dialog, error toast; no optimistic updates). `npm run ui:check` now runs scripted scenarios for all three views (light + dark) plus earlier checks: all OK; screenshots reviewed. `npm test` 61/61.
- Bugs found by the scenarios and fixed in the backend event bridge (`backend/src/wired/events.js`, logged in WO-012 too): (1) a failed refresh (e.g. GetMeetingInfo with no active meeting) doesn't re-arm its event, so meetingInfo never came back after deactivate → activate; the bridge now re-registers that event explicitly. (2) `detach()` left a stale refresh-timer handle, so after Disconnect→Connect within 50 ms of a change, no further events were processed. Both have regression tests (the second verified to fail without the fix).
- View `web/js/views/voting.js`: current voting (subject, reference, state, answers, timer) with state-dependent controls (ready: Open; opened: Hold/Close/Abort; onHold: Resume/Close/Abort; done: Accept/Reject; Abort/Reject confirm), results as a single-hue bar list with count + % text per row (dataviz skill: one series → one hue, labels in text tokens, 4px rounded data end, per-row hover title, rows double as table), turnout vs. voting seats, majority/quorum lines when enabled, prepared votings with Activate (locked while a voting is open/on hold), ad-hoc form (subject/number 50, description 255 chars per PDF remarks). Scenario: activate prepared voting → open → (orchestrator casts 5 votes on the mock) → results show "5 votes cast" → close → accept.

## Decisions
- Controls require `canControlVoting`; the view requires `canViewVoting` (spec).
- Status colours are not used for yes/no bars (reserved for state); identity is the text label.
- A new voting can't be activated while one is `opened`/`onHold` (mock rule; real server to confirm).

## Handoff
Done against the mock. Real-server checks in WO-028: answer sets other than yes/no/abstain (for/against/present…), voting timer behaviour, majority/quorum payloads, whether `done` must be accepted/rejected before the next voting.
