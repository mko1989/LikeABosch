# WO-062: DCN in the domain layer (seats, discussion, voting, participants, capabilities)

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-060 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
With a DCN system connected, the `domain.*` topics and `/api/domain` actions work, so the shared UI views (discussion,
seats/room, voting core, participants) and the camera director work unchanged (DEC-010, DEC-017 §7).

## Context
DEC-010, `backend/src/domain/{mappers,service,routes}.js`, WO-060 topics.

## Scope
- In: `dcn` feature flags + actions in `capabilities()`; mappers `dcn.seats|discussion|voting|power|participants`;
  `DOMAIN_TOPICS[*].dcn` sources; domain actions for DCN (speakers add/remove, requests add/remove, clear, priority,
  voting open/hold/resume/close where DCN has them); mapper unit tests with mock fixtures; director works with DCN mic events.
- Out: UI changes (WO-063).

## Acceptance criteria
- [x] Domain tests: DCN mock connected → `domain.seats`, `domain.discussion`, `domain.voting`, `domain.participants`, `domain.capabilities` populated; actions change mock state and the change arrives in the topics (`backend/test/dcn-domain.test.js`, 10 tests).
- [x] `npm test` green (185/185); `npm run e2e:mock` 31/31; `npm run bridge:test` 7/7.

## Work log
- 2026-10-05 (Claude Opus): created (ready).
- 2026-10-05 (Claude Opus): in-progress. `mappers.js`: `FEATURES.dcn`, DCN branch in `capabilities()` (actions from
  the bridge's `Is*Allowed` flags), `dcn.{seats,discussion,voting,power,participants}`, `DOMAIN_TOPICS[*].dcn`.
  `service.js`: mapper/source lookup by system, capabilities recomputed on `dcnBridge`. `routes.js`: DCN branch for
  every action (see docs/api/domain.md table), each followed by `dcnEvents.operationSucceeded`.
- 2026-10-05 (Claude Opus): test run 1: voting failed: after `SelectVotingById` `dcnVoting.votingId` stayed null (it
  was copied from `dcnActiveVoting` before that topic refreshed). Fix in `dcn/events.js`: the call's `votingId` (or an
  event's `VotingId` when present) is applied directly, and `dcnVoting` follows `dcnActiveVoting` on every refresh.
  Full suite then showed a **regression on wired** (3 tests, e2e 30/31): the DCN branch's seat-id validation ran
  eagerly while building `{ wired, wireless, dcn }`, rejecting wired ids like `s1`. Fix: DCN args are thunks. After:
  `npm test` 185/185, `e2e:mock` 31/31, `bridge:test` 7/7, `spec:check` OK.

## Decisions
- DCN features stay off for the wired-only views (meetings, agenda, interpretation, masterVolume, …): those views call
  wired operations. DCN versions are WO-063.
- `domain.power` is never provided for DCN (no API); `PUT /power` → NOT_SUPPORTED.
- Domain voting `open` needs a selected/active voting id (the DCN-SW API starts votings by id); ad-hoc votings go
  through the passthrough (`StartAdhocVoting`) until WO-063.
- Participants: with a running meeting, its registered delegates (like wired); otherwise all delegates.
- `present` is null: `RetrieveDelegatesForActiveMeeting` lists the meeting's delegates, not who is seated (unclear, WO-065).

## Handoff
Done. With DCN connected the discussion view, room plan (seat list, live mics), voting core, participants and the
camera director work through the domain layer (verified against the mock). Open: WO-063 (UI: connection form,
launcher, DCN-specific panels), WO-065 (real system).
