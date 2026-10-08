# DICENTIS DCNM API passthrough (`/api/dcnm`, WO-079)

The full DICENTIS .NET API (DCNM API 7.0, 39 interfaces, 264 methods, 169 events) through the Windows
**dicentis-bridge** (DEC-021), as a **second connection next to the Conference Protocol**: system `wired` with the
DICENTIS bridge switched on. Reference: [`docs/protocol/dcnm-api/`](../protocol/dcnm-api/README.md); bridge protocol:
[BRIDGE.md](../protocol/dcnm-api/BRIDGE.md).

## Connection settings
`PUT /api/connection/settings { "system": "wired", "dcnmBridge": true, "dcnmHost": "127.0.0.1", "dcnmPort": 9481,
"dcnmDevice": "LikeABosch", "dcnmServer": "" }`, then `POST /api/connection/connect`. The bridge logs on with the wired
`user`/`password`; the optional `bridgeToken` is sent to it too. `dcnmDevice` = the device name the bridge connects as
(an administrator assigns it to a seat with manage rights in DICENTIS once; `""` = don't connect as a device).
`dcnmServer` = DICENTIS server for the API's `OpenAsync(host)` (`""` = the API finds it). Environment:
`DICENTIS_DCNM_BRIDGE`, `DICENTIS_DCNM_HOST`, `DICENTIS_DCNM_PORT`, `DICENTIS_DCNM_DEVICE`, `DICENTIS_DCNM_SERVER`.
`GET /api/connection` → `dcnm: { host, port, state, device, enabled, bridge: { version, apiVersion, fake }, lastError }`.
A bridge failure never disconnects the Conference Protocol.

## Endpoints
| Endpoint | Result |
|---|---|
| `GET /api/dcnm` | `{ state, bridge, interfaces: { <key>: { interface, source } }, connection, constants, lastError }` or `null` (bridge off) |
| `GET /api/dcnm/ops` | `[{ api, interface, summary, inherits, methods: [{ name, params, returns, obsolete? }], events: [{ name, payload }], properties: [{ name, type, access }], found }]` |
| `POST /api/dcnm/ops/:api/:method` | body = arguments by name (without `onFinish`, `CancellationToken`, delegates). `data` = the awaited `Task` result. `?timeoutMs=` (default 30000) |
| `GET /api/dcnm/props/:api` | last reported scalar properties (`Can…`, `Is…`, states) of an interface, no API call |
| `GET /api/dcnm/props/:api/:property` | read a property now |
| `PUT /api/dcnm/props/:api/:property` | `{ "value": … }` |
| `POST /api/dcnm/callbacks/:id` | `{ "result": … }`: answer a value-returning delegate callback (topic `dcnmCallback`) |
| `DELETE /api/dcnm/handles/:handle` | release an object handle (`%23` + number, e.g. `/handles/%231` for `#1`) |

`:api` = the `WindowsApiInstance` property (`ControlSpeaker`, `PrepareParticipant2`, …), a documented interface without
a property under its name without the `I` (`RoomAudioControl`), or a handle (`%231`). Values: Guid/Version/DateTime
as strings, enums by name, data classes as objects of their members (built through the constructor whose parameter
names match, case-insensitive), lists as arrays (BRIDGE.md "Values").

```
POST /api/dcnm/ops/ControlSpeaker/GrantSpeechAsync   {"participantId": "0f8fad5b-…"}           → { ok: true, data: true }
POST /api/dcnm/ops/PrepareParticipant2/AssignParticipantsToSeatsAsync {"participantInfos": [{ "participantId": "…", "seatId": "…" }]}
POST /api/dcnm/ops/ControlSpeaker/SetSpeechTimeAsync  {"participantId": "…", "speechDuration": 120, "discussionType": "Speaker", "resetSpeechTime": true}
GET  /api/dcnm/props/Base/DicentisVersion                                                      → { ok: true, data: "7.0.43431.0" }
```

## Errors
Client-side validation (unknown method, argument names no overload has) and bridge `BAD_ARGS`/`UNKNOWN_*` → 400
`VALIDATION`; unknown interface → 404; bridge off / not logged in → 503 `NOT_CONNECTED`; `TIMEOUT` → 504
`UPSTREAM_TIMEOUT`; the API threw → 502 `UPSTREAM_ERROR` with the exception message.

## Live state (topics via `/api/events`)
Generic mirror (`backend/src/dcnm/mirror.js`): no per-event code, so every event of the API is available.
| Topic | Content |
|---|---|
| `dcnm.<Api>.<Event>` | last payload of that event (`ApiEventArgs.Parameter`), e.g. `dcnm.ControlSpeaker.SpeakersListChanged` (DcnmSpeakerInfo[]), `dcnm.ControlMeeting.MeetingsListChanged`. Updates faster than 10/s are coalesced |
| `dcnmStatus` | `{ connection: { open, authenticated, device, enabled, apiState }, interfaces: { <api>: { <scalar property>: value } } }` |
| `dcnmSweep` | `{ at, requested, failed[] }`: after each login every parameterless `Request…Async` (34, not the VU meter stream) is called once, so the API raises its events with the current state |
| `dcnmCallback` | last delegate callback pushed by the bridge (`{ callback, api, method, parameter, args, expectsResult }`) |
The topics are removed when the bridge connection ends (reason in `/api/state`).
