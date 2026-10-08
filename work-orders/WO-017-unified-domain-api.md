# WO-017: Unified domain API design and implementation

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-011, WO-012, WO-015 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
A system-independent API (`/api/seats`, `/api/discussion`, `/api/voting`, `/api/power`, …, plus `GET /api/capabilities`) that the web UI uses, backed by either adapter (DEC-004).

## Scope (refined 2026-10-02)
- DEC-010 written (design).
- `backend/src/domain/mappers.js`: pure wired→domain and wireless→domain mappers for capabilities, seats, discussion, voting, power, participants.
- `backend/src/domain/service.js`: recomputes `domain.*` topics on cache changes of their sources (+ connection status for capabilities).
- `backend/src/domain/routes.js`: `/api/domain/...` actions (speakers add/remove, requests add/remove, mute/unmute, clear, priority on/off, power, voting open/hold/resume/close/abort/accept/reject, voting parameters (wireless)); `NOT_SUPPORTED` error code.
- Tests: mapper unit tests; action tests against **both** mocks.
- Out: UI migration (WO-027).

## Original draft notes
- Write a DEC describing domain models (Seat, DiscussionEntry, VotingState, …), mapping tables wired↔wireless (start from `docs/protocol/wireless-rest/README.md`), and capability flags.
- Implement for wired first; wireless where supported.
- UI WOs (Phase 3) depend on this; until it exists, UI views may call wired passthrough + SSE topics directly, but must go through one `web/js/api.js` module so they can be switched.

## Acceptance criteria
- [x] Domain topics present and correct on both mocks (tests).
- [x] Every domain action works on both systems or returns NOT_SUPPORTED per capabilities (tests).
- [x] `docs/api/domain.md` documents topics, actions, capabilities.
