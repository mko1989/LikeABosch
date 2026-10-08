# DCN mock (dcn-bridge + simulated DCN-SW server)

```
npm run mock:dcn               # 127.0.0.1:9480, no token (DEC-019), DCN-SW user admin / password admin
MOCK_DCN_PORT=9490 MOCK_DCN_TOKEN=secret npm run mock:dcn
MOCK_DCN_IDLE=1 npm run mock:dcn   # no random requests / mic presses
```
Point the backend at it with `DICENTIS_SYSTEM=dcn`, `DICENTIS_HOST=127.0.0.1`, `DICENTIS_PORT=9480`,
`DICENTIS_USER=admin`, `DICENTIS_PASSWORD=admin` (plus `DICENTIS_BRIDGE_TOKEN=secret` if started with `MOCK_DCN_TOKEN=secret`).

`server.js` speaks the bridge protocol (`docs/protocol/dcn-swapi/BRIDGE.md`): token handshake (only when a token is set), one client (a new one
replaces the old one), `connect` with the DCN-SW credentials (wrong ones → `NO_AUTHORIZATION` after `authDelayMs`),
calls executed in order, argument validation (`BAD_ARGS`), `status` and `event` pushes. The API stays initialized when
the client drops, like the real bridge.

`dcnsw.js` simulates the DCN-SW server (WO-060): 20 seats (seat 1 "Chairman"), 10 delegates registered for meeting 1 on
seats 1–10, meetings 1–2 with sessions 11/12/21, meeting 1 + session 11 running at start, voting script for session 11
(votes 1001 yes/no/abstain, 1002 with DNPV), one vote template, two interpretation languages.
Implemented with real semantics: discussion (speak now / stop, request list append/insert/replace/remove/shift,
cancel all, chairman priority, settings, mic status), meeting/session start/stop, voting (select, start, ad-hoc, hold,
continue, stop → `VoteResults` + `VotingAccepted/Rejected`), master volume/mute, delegates CRUD, registrations, seat
assignment, ID cards (no card device), meetings/sessions/voting script editing, and the matching events.
Every other method returns `NONE` with default `out` values derived from the spec.

**ASSUMPTIONS** (CHM is silent; verify on a real system, WO-065):
- Constants: the real values from the DLLs (WO-068), read from `types.json` (`DEFAULT_AREA` = 1, `DEFAULT_PINCODE` = 11111, …).
- Master volume range 0–30.
- Full speakers list → the oldest speaker is switched off (FIFO).
- Event args follow the real types (WO-068): `VoteResults`/`VotingQuorumUpdated` → `{ ConfigId, ServiceId, TotalResults:
  { PresentCount, NotVotedCount, Answers: [{ AnswerId, CastCount }] } }`, voting control events → `{ ConfigId, ServiceId }`.
  ASSUMPTIONS: `ConfigId` = voting id, `AnswerId` = 1-based position in the answer set.
- Voting accepted = more Yes than No.
- Permissions: switching off any `Is*Allowed` flag of an interface makes all its methods return `NO_AUTHORIZATION`.

Test helpers: `sim.requestToSpeak(seatId)`, `sim.pressMic(seatId)`, `sim.castVote(seatId, answer)`, `sim.calls`,
`setAvailable(bool)` (DCN-SW link down/up), `setAllowed(root, flag, bool)`, `dropClient()`, `reset()`, `stats`, `close()`.
