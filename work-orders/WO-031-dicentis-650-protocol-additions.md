# WO-031: DICENTIS 6.50 protocol additions

| | |
|---|---|
| **Status** | done |
| **Phase** | 4 Hardening |
| **Depends on** | WO-016 (authenticated real-server run) |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
The real server runs DICENTIS 6.50 and offers 18 operations not in our 4.3-era PDF (see WO-016 work log, 2026-10-03). Add them to the spec (with `source: "real server 6.50"` notes instead of PDF pages), the mock, the passthrough (automatic once in the spec), and the UI where valuable.

## Scope (draft)
- Extend SPEC-FORMAT/validator for operations without PDF pages (e.g. `sourcePages: null`, `source: "server 6.50 + vendor demonstrator"`).
- Capture real request/response shapes with read-only calls (Get*) during the authenticated smoke run; write operations only with the user's go-ahead.
- Candidates for UI: speech time +/- / reset in the discussion view; microphone sensitivity (installer function); getDiscussionOptions/getSpeechTimerOptions to show the configured discussion mode.

## Acceptance criteria
- [x] All 18 operations in the spec (`source` instead of PDF pages; validator, cross-check, reference generator support it); passthrough exposes them automatically (110 operations).
- [x] Request/response shapes verified on the real server (WO-032 run 3: 0 spec deviations).
- [x] Mock behaviours for all 18 (`mock/wired/behaviours/v650.js`).
- [x] UI: speech time −1′/+1′/reset on speakers (domain action), discussion options shown on the speaker count.

## Work log
- 2026-10-03 (Claude Opus): Added operations/*.json for GetApiState, GetDiscussionOptions, GetSpeechTimerOptions, GetRemainingVoteTime, GetSupportedHeadphones, Get/Update/Reset MicrophoneSensitivity(+Description), Request/Grant/Remove Speech and Response, Increase/Decrease/Reset SpeechTime (category `system` added). SPEC-FORMAT: `sourcePages: null` + `source`. Shapes from the vendor demonstrator client, then corrected by the real-server e2e runs (speech time → `{success}`, sensitivity → `{status}`). New topics without events: discussionOptions, speechTimerOptions, microphoneSensitivityDescription. Domain: `POST /api/domain/discussion/speakers/:seatId/time/:action` + feature `speechTimeAdjust` (wired). Mock: v650.js (seat add/remove helpers shared with seats.js).

## Decisions
- Operations not in the PDF are first-class spec entries with `source`; PDF cross-checks skip them, response validation (smoke/e2e) covers them.
- Microphone sensitivity has no UI yet: on the test installation every device rejects changes (status:false), so it could not be verified visually. Available through the passthrough.

## Handoff
Done. Open: GetRemainingVoteTime response shape (needs an account with canViewVoting), response-mode behaviour of Request/Grant/RemoveResponse (needs discussion mode with responses).
