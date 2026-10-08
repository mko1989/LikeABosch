# DCN passthrough (`/api/dcn`, WO-060)

DCN NG through the DCN-SW API and the dcn-bridge (DEC-017). One endpoint per method of
`docs/protocol/dcn-swapi/api.json` (104), addressed as `<root>.<Api>/<Method>`.

## Connection settings
`PUT /api/connection/settings { "system": "dcn", "host": "<bridge host>", "port": 9480, "user": "<DCN-SW user>",
"password": "…", "bridgeToken": "…", "dcnServer": "tcp://localhost:9461" }`, then `POST /api/connection/connect`.
`dcnServer` is the DCN-SW server as seen **from the bridge PC**. `password` and `bridgeToken` are kept in memory only
(env `DICENTIS_PASSWORD`, `DICENTIS_BRIDGE_TOKEN`). Connection `state`: `connected` = bridge reachable but the DCN-SW
API is not usable (link down; it reconnects by itself); `loggedIn` = usable. `permissions` = the `Is*Allowed` flags that are true.

Errors on connect: wrong token → 401 `UPSTREAM_AUTH` `reason: badToken`; DCN-SW user rejected → 401 `UPSTREAM_AUTH`
`apiError: NO_AUTHORIZATION` (also returned when DCN-SW has no link to the master CCU); bridge unreachable or
`SETUP_LINK_FAILED` → 503 `NOT_CONNECTED` (the backend keeps retrying).

## Endpoints
| Endpoint | |
|---|---|
| `GET /api/dcn/ops` | `[{ key, api, method, summary, methods, in: [{name,type}], out: [{name,type}], errors }]` |
| `POST /api/dcn/ops/:api/:method` | body = all `in` parameters by name. `data` = the `out` parameters |
| `GET /api/dcn/ops/:api/:method` | `Retrieve*`/`Get*` only; `in` parameters as query, arrays comma-separated |
| `GET /api/dcn/bridge` | `{ state, bridge: { name, version, apiVersion, fake, dllPath }, status, constants }` |

```http
POST /api/dcn/ops/control.DiscussionApi/SpeakNow   {"participantId": 0, "seatId": 12}     → { ok: true, data: {} }
GET  /api/dcn/ops/config.DelegateApi/RetrieveDelegatesById?delegateIds=101,102           → { ok: true, data: { delegates: [...] } }
POST /api/dcn/ops/control.VoteApi/StartAdhocVoting {"votingSettings": {"AnswerSet": "ParliamentaryYesNoAbstain", "Subject": "Break?"}}
```
Values follow BRIDGE.md: structs use the .NET member names (`SeatId`, `FirstName`), enums by name (number accepted).
Discussion calls take `(participantId, seatId)`: pass `0` for the one you don't use (participant wins; needs DCN-SWDB).

Validation (400 `VALIDATION`): missing/unknown parameter, wrong type, unknown struct member, unknown enum member.
`API_ERROR` other than `NONE` → 502 `UPSTREAM_ERROR` with `apiError` (e.g. `NOT_ACTIVE` = no meeting running);
`NO_AUTHORIZATION` → 401 `UPSTREAM_AUTH`.

## Live state (topics via `/api/events`)
Filled at login, refreshed on DCN-SW events (no polling); definitions in `backend/src/dcn/topics.js`.

| Topic | Source |
|---|---|
| `dcnActiveMeeting` `{meetingId}`, `dcnActiveSession` `{sessionId}`, `dcnActiveMeetingDelegates` `[delegateId]` | control.MeetingApi (`null`/`[]` when none is running) |
| `dcnSpeakers`, `dcnRequests`, `dcnRespond`, `dcnRequestsToRespond` | `PARTICIPANT[]` lists |
| `dcnMicStatus` `[{SeatId, MicStatus}]`, `dcnNotebookers`, `dcnDiscussionSettings`, `dcnPrios`, `dcnGroupTimers` | control.DiscussionApi |
| `dcnMasterVolume` `{volume}`, `dcnMasterMute` `{mute}` | control.DcnSystemApi |
| `dcnActiveVoting` `{votingId}`, `dcnSessionVotings` `[id]` | control.VoteApi |
| `dcnVoting` `{state, votingId, outcome, since}` | **from events** (no getter): state `closed\|ready\|opened\|onHold\|done`, outcome `accepted\|rejected\|null` |
| `dcnVoteResults`, `dcnVotingQuorum`, `dcnVotingTimer`, `dcnSpeakerTimeLeft` | last event args (`VoteResults`, …) + `receivedAt` |
| `dcnMeetings`, `dcnDelegates`, `dcnVoteTemplates`, `dcnInterpretationLanguages` | config, `[{ id, ...struct }]` |
| `dcnChannels` | `ChannelType[]` |
| `dcnSessions`, `dcnRegisteredDelegates`, `dcnSeatAssignments`, `dcnVotingScript` | config of the active meeting/session |
| `dcnBridge` | `{ bridge, status, constants }` |
