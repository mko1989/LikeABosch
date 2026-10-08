# Wired passthrough API

Every in-scope Conference Protocol operation (92; see [REFERENCE.md](../protocol/conference/REFERENCE.md))
is exposed by the backend (WO-011, DEC-004). Parameters and results are exactly the protocol's
`parameters` objects. Responses use the standard envelope.

| Endpoint | Purpose |
|---|---|
| `GET /api/wired/ops` | List operations: `operation, category, summary, permissions, licenses, methods, managed, request, response` |
| `POST /api/wired/ops/<Operation>` | Call any operation; JSON body = request parameters (`{}` if none) |
| `GET /api/wired/ops/<Operation>?a=1&b=x` | `Get*`/`List*` only; flat query parameters typed from the spec (`int`, `bool` = `true/false`, arrays repeated or comma-separated). Object parameters need POST. |

Operation names are case-insensitive.

## Examples
```bash
curl localhost:3000/api/wired/ops/GetSeats
curl localhost:3000/api/wired/ops/GetAgendaTopics?meetingId=meeting-2
curl -X POST localhost:3000/api/wired/ops/AddSeatToSpeakers -H 'content-type: application/json' -d '{"seatId":"seat-3"}'
curl -X POST localhost:3000/api/wired/ops/SetMasterVolume -H 'content-type: application/json' -d '{"volume":12}'
```
```json
{ "ok": true, "data": { "seats": [ … ] } }
```

## Errors
| HTTP | code | when |
|---|---|---|
| 400 | `VALIDATION` | unknown parameter, wrong type/enum (`error.details` lists each problem), non-object body, GET on a state-changing operation |
| 403 | `MANAGED_BY_BACKEND` | `Login`, `Logout`, `RegisterEvents`, `UnregisterEvents`: the backend owns the session and event registration |
| 404 | `NOT_FOUND` | unknown operation, or excluded by DEC-007 (`CheckforLicense`, `GenerateJwtToken`, `ValidateJwtToken`, `CreatePluginDescription`) |
| 502 | `UPSTREAM_ERROR` | the DICENTIS server answered `error`; `error.upstream` has its message (developer text, don't parse) |
| 503 | `NOT_CONNECTED` | backend not logged in to a DICENTIS server |
| 504 | `UPSTREAM_TIMEOUT` | no response within the request timeout (10 s) |

Permissions are enforced by the DICENTIS server; a missing permission shows up as `UPSTREAM_ERROR`.
For live data, prefer the state cache + SSE (`/api/events`, WO-012) over polling these endpoints.
