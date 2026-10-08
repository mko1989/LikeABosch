# DEC-010: Unified domain layer (topics + actions + capabilities)

- **Status:** accepted (proposed by Claude 2026-10-02 in WO-017; revisable)
- **WO:** WO-017 (backend), WO-027 (UI)
- **Builds on:** DEC-004 (API shape), DEC-005 (cache/SSE)

## Context
Wired and wireless systems overlap (seats, discussion, voting, power, participants) but differ in shape
(wired: string seat ids, rich discussion entries, 8 voting states; wireless: integer ids, speakers + waiting list,
voting state 0/1/2, power 0/1/2). The UI must work on both without duplicating views.

## Decision
1. **Domain topics** in the same state cache, named `domain.*`, derived by pure mapper functions from the raw
   topics of the active system whenever a source topic changes:
   - `domain.capabilities`: `{ system, features: {...}, actions: {...} }`. Features say what the system *has*
     (e.g. `meetings`, `interpretation`: wired only; `requestQueueAdd`, `priorityCalls`, `participantsEdit`,
     `votingParameters`: wireless only). Actions combine features with permissions (wired) for button gating.
     Wireless rights are not queryable, so wireless actions are offered and the WAP enforces them (401/403 → toast).
   - `domain.seats`: `[{ id, name, person, connected, canVote, canPrio }]`.
   - `domain.discussion`: `{ speakers: [{ seatId, seatName, name, micState: on|mute|off, priority, kind }], requests: [{ seatId, seatName, name }], timers? }`.
     Wired speech-timer data is kept per entry (`timer: { remainingSpeechDuration, speechStartTime, show }`) with top-level `referenceTime`.
   - `domain.voting`: `{ state, subject, description, answers, results: [{ answer, count }] }`, with `state` in the **wired
     vocabulary** (`closed|ready|opened|onHold|done|canceled|accepted|rejected`); wireless 0/1/2 → closed/opened/onHold.
   - `domain.power`: `{ state: on|standby|off|poweringOn|poweringOff }`.
   - `domain.participants`: `[{ id, name, group, seat, present, canVote, nfc }]` (fields absent on a system are `null`).
2. **Domain actions** under `/api/domain/...` translate to the active system's operations (via the existing clients),
   returning the standard envelope; unsupported actions → 400 `NOT_SUPPORTED` (new code).
3. Wired-only areas (meetings/agenda, interpretation, files, seat illumination, presentation, master volume, prepared/ad-hoc
   votings) keep using wired topics + the wired passthrough; the UI shows them only when `features.<area>` is true.
4. Mappers live in `backend/src/domain/mappers.js`, pure and unit-tested with fixtures from both mocks.

## Consequences
- Shared UI views (discussion, overview, power, voting core, participants) read only `domain.*` topics (WO-027).
- Adding a third system later = new mappers + action table, no UI change.
- Raw topics stay available for system-specific detail views.
