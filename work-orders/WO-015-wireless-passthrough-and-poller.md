# WO-015: Wireless passthrough endpoints + poller

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-014, WO-012 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
`/api/wireless/...` mirrors every Swagger path (DEC-004), and a poller feeds the shared state cache / SSE (DEC-005).

## Scope (to refine before start)
- Routes generated from `swagger.yaml` (method + path), body validation from schemas.
- Poller: long-poll (`isPolling=true`) if WO-014 confirms the semantics, else interval polling; broadcast on change only.
- Topic naming aligned with wired topics where concepts match (seats, speakers, waitingList, voting, power).

## Acceptance criteria
- [x] Passthrough for all 32 swagger operations (except managed login/logout), body/path/query validation, error mapping.
- [x] Poller keeps all wireless topics in the cache and pushes via SSE; writes refresh immediately.
- [x] Connection manager connects to wireless systems, incl. session takeover (override).
- [x] Tests against the wireless mock (`backend/test/wireless-backend.test.js`, 7).

## Work log
- 2026-10-02 (Claude Opus): Implemented `backend/src/wireless/{topics,poller,routes}.js`; `ConnectionManager` creates a `WirelessClient` + attaches the `WirelessPoller` when `system: wireless` (`connect({override})`, `POST /api/connection/connect {override:true}`), `wiredClient`/`wirelessClient` getters so each passthrough only talks to its own system (other → 503). `app.js` mounts `/api/wireless`. Tests: 7 new; `npm test` 80/80.

## Decisions
- Wireless topics are raw (`wirelessSeats`, `wirelessSpeakers`, `wirelessWaitingList`, `wirelessParticipants`, `wirelessIdentification`, `wirelessSystemStatus`, `wirelessVoting`, `wirelessVotingState`, `wirelessVotingResults`, `wirelessSystemInfo`); payload = response body. System-independent topics come from the domain layer (WO-017).
- **Adaptive polling:** each topic loops on `?isPolling=true`; a request answered faster than `minIntervalMs` (2 s) is followed by a pause, so both a true long-poll WAP (instant updates) and a non-holding one (≈2 s polling) are handled without hammering it.
- `isPolling` is rejected on the passthrough (reserved for the poller; clients read `/api/state`).
- After any successful wireless write, all topics are refreshed immediately (cheap: ~9 GETs) so the UI doesn't wait for the poll.

## Handoff
Done. WO-017 builds unified domain topics/actions on top of `wireless*` and wired topics.
