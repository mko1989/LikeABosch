# WO-060: DCN Node adapter, bridge protocol, mock bridge

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-059 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
LikeABosch can connect to a DCN system through the dcn-bridge (DEC-017): connection settings, passthrough for all 104
methods, events into the state cache, all testable against a mock bridge without Windows.

## Context
DEC-017, DEC-004 (envelope), DEC-005 (cache/SSE), `docs/protocol/dcn-swapi/`. Patterns: `backend/src/wired/*`
(events), `backend/src/wireless/*` (second adapter), `backend/src/connection/manager.js`.

## Scope
- In:
  - `docs/protocol/dcn-swapi/BRIDGE.md`: protocol spec (hello/token, connect, call, disconnect, ping; pushed status/event; value encoding; errors).
  - `backend/src/dcn/spec.js` (load + validate args), `client.js` (`DcnClient`, same state model, reconnect, status),
    `topics.js` (topic → Retrieve call, event → topics), `events.js` (`DcnEventBridge`: initial sync, event → refetch, last-event topics, permissions), `routes.js` (passthrough + ops listing).
  - Config/settings: `system: 'dcn'`, default port 9480, `dcnServer`, secret `bridgeToken` (env `DICENTIS_DCN_SERVER`, `DICENTIS_BRIDGE_TOKEN`).
  - `mock/dcn/server.js` (+ README, `npm run mock:dcn`): bridge protocol + DCN-SW semantics (meeting/session start/stop, speakers/requests/respond lists, mic status, chairman priority, discussion settings, master volume/mute, delegates, meetings/sessions, voting script, ad-hoc voting, hold/continue/stop, vote results event, seat assignment).
  - Tests: client (token, connect errors, call, timeouts, reconnect), passthrough (validation, API_ERROR mapping), events → cache.
- Out: domain mapping (WO-062), UI (WO-063), the real C# bridge (WO-061).

## Acceptance criteria
- [x] `PUT /api/connection/settings {system:'dcn'}` + connect reaches `loggedIn` against the mock; wrong token / wrong DCN-SW credentials → `UPSTREAM_AUTH` (tests "settings…", "wrong token and wrong DCN-SW credentials…").
- [x] Every method in api.json is reachable through `/api/dcn/ops/...` (104 calls, all 200 or 502); unknown args → 400; `API_ERROR` ≠ NONE → 502 with `apiError`. NO_AUTHORIZATION → **401** `UPSTREAM_AUTH` (the envelope maps UPSTREAM_AUTH to 401, see Decisions; criterion said 403).
- [x] Mic on/off and list events update `dcn*` topics without polling (test "events from the system update topics without polling").
- [x] `npm test` green (175/175); `npm run e2e:mock` still green (31/31 checks, 123/123 operations).

## Work log
- 2026-10-05 (Claude Opus): created (ready).
- 2026-10-05 (Claude Opus): in-progress. `docs/protocol/dcn-swapi/BRIDGE.md` (protocol v1). `backend/src/dcn/`:
  `spec.js` (method lookup, arg validation incl. structs/enums; extractor now marks `const` struct fields so they are
  not treated as data), `client.js` (`DcnClient`), `topics.js` (25 fetched topics, event → topic table, voting state
  from events, event-data topics), `events.js` (`DcnEventBridge`), `routes.js`. Config/manager: `system: dcn`,
  default port 9480, `dcnServer`, secret `bridgeToken` (never saved/returned), `permissions` = true `Is*Allowed` flags.
  `mock/dcn/{server,dcnsw}.js` + README, `npm run mock:dcn`. Docs: `docs/api/dcn-passthrough.md`, API README,
  architecture, `.env.example`, CLAUDE.md layout.
- 2026-10-05 (Claude Opus): first smoke run against the mock filled all topics. Tests `backend/test/dcn.test.js` (17).
  Failures on the first run, all in the test/mock: the "every method reachable" test's sample args also stopped
  meeting 1 (→ added `mock.reset()` + resync after it); the mock's permission check looked at the wrong `*View*`
  flag (→ any false flag of an interface denies it); a handler exception was answered without the request id
  (→ `EXCEPTION` reply with the id). Client fix during review: after `closed: replaced` the state now goes to
  `disconnected` (it stayed `connected`). `npm test` 175/175, `npm run e2e:mock` 31/31.

- 2026-10-05 (Claude Opus, during WO-061): correction: `DcnClient.connect()` had a race with the real bridge
  (decided "logged in" from the stale hello status). Fixed in WO-061 (client requests `status` after `connect`; the
  mock now pushes status on a later tick). See WO-061 log.

## Decisions
- `NO_AUTHORIZATION` maps to the existing `UPSTREAM_AUTH` code (HTTP 401), not a new 403, to keep DEC-004's code table.
- Events are not forwarded to SSE as notifications (`ParticipantTimeLeftUpdated` may be frequent); they update topics.
- After our own successful writes the bridge refreshes the topics of that interface and applies the voting state
  (`operationSucceeded`), in case DCN-SW does not echo events to the client that caused them (unknown, WO-065).
- Voting state is seeded at login from `RetrieveActiveVotingId` (`opened` if set): a voting on hold at login shows as
  `opened` until the next voting event.
- Topics that need the active meeting/session (`dcnSessions`, `dcnRegisteredDelegates`, `dcnSeatAssignments`,
  `dcnVotingScript`) are stage 1 and fetched after the ids; with no meeting they are `[]`.

## Handoff
Done. Backend can connect to DCN through a bridge; verified only against the mock. Next: WO-061 (real C# bridge),
WO-062 (domain mapping, so the shared UI views work), then WO-063 (UI). Mock assumptions are listed in
`mock/dcn/README.md`; they must be checked on a real system (WO-065).
