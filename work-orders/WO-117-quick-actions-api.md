# WO-117: Quick-actions API for Bitfocus Companion (DEC-035)

| | |
|---|---|
| **Status** | review |
| **Phase** | 2 Backend |
| **Depends on** | WO-017, WO-099 |
| **Assignee** | Claude Opus (main), Haiku subagent (tests) |
| **Created** | 2026-10-12 |
| **Updated** | 2026-10-12 |

## Goal
A small, stable HTTP API made for Companion buttons: seat microphone on / off / toggle, requests, priority, all off,
next speaker, plus a compact state and a compact live stream for button feedback.

## Context
User request 2026-10-12 (next.md). DEC-035, DEC-010 (domain layer), DEC-027 (Companion triggers, the other direction).

## Scope
- In: `backend/src/quick/routes.js` (`/api/quick…`), shared `backend/src/domain/actions.js` (domain discussion actions
  extracted from the domain routes), tests, docs (backend API docs).
- Out: the Companion module (WO-118); authentication (WO-029).

## Acceptance criteria
- [x] Every endpoint of DEC-035 works on the wired and wireless mocks (tests).
- [x] Domain routes unchanged in behaviour after the extraction (existing tests pass).
- [x] Documented for users (backend API docs).

## Work log
- 2026-10-12 (Claude Opus): created; implemented `createDomainActions` (run + discussion actions moved out of
  domain/routes.js; domain, DCN, CCS, wireless, wired-participant tests 51/51 after the move) and `createQuickRouter`.
- 2026-10-12 (Haiku subagent, reviewed by Claude Opus): `backend/test/quick.test.js`, 13 tests (wired + wireless mock:
  state, seat references by id / name / position, toggles, 404s, wired request 400, clear, next, priority, mics off,
  requests clear, SSE). Re-run by the main agent: 13/13.
- 2026-10-12 (Haiku subagent, reviewed by Claude Opus): `docs/api/quick.md` + a line in docs/api/README.md. Its review
  notes: `mic/on` did not unmute a muted speaker → fixed (`discussion.mute(seat, false)`), docs updated.
- 2026-10-12 (Claude Opus): mounted in app.js; evidence: `npm test` (quick 13/13), used by the likeabosch Companion module
  tests against a real backend (WO-118).

## Decisions
- DEC-035.

## Handoff
- Delivered: `/api/quick` (state, SSE, seat mic / request / priority on-off-toggle, mics off, requests clear, discussion
  clear, next) on every system; shared `domain/actions.js`; docs/api/quick.md.
- Gaps: no authentication (WO-029); bulk actions use the state at the time of the call (a seat that starts speaking
  during "all off" stays on); unmute path not covered by a test (the wired mock has no muted speakers by default).
