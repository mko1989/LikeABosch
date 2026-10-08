# dcn-bridge protocol (version 1)

Between the LikeABosch backend (`backend/src/dcn/client.js`) and the Windows **dcn-bridge** (`bridge/dcn/`, WO-061)
or the mock (`mock/dcn/server.js`). Decided in DEC-017. The bridge is a thin, generic reflection layer over the DCN-SW
API (`api.json`, `types.json`); all DCN semantics live in the Node adapter.

```
LikeABosch backend ──TCP :9480, NDJSON──▶ dcn-bridge (Windows, .NET 4.8) ──.NET Remoting tcp://localhost:9461──▶ DCN-SW server ──▶ DCN NG CCU
```

## Transport
- TCP, UTF-8, **one JSON object per line** (`\n`-terminated; no newlines inside a message). Max line 16 MiB.
- Default port **9480**. One client at a time: when a second client completes `hello`, the first one receives
  `{"type":"closed","reason":"replaced"}` and is disconnected (so a restarted backend never locks itself out).
- No TLS. Optionally the bridge authenticates the client with a shared **token** (`--token`); without one it accepts
  every client (DEC-019). Bind the bridge to the control network.

## Handshake
The first message must be `hello`, within 5 s, otherwise the bridge closes the socket.
```json
→ {"type":"hello","protocol":1,"token":"<shared secret>","client":"likeabosch/0.1.0"}
← {"type":"hello","ok":true,"protocol":1,"bridge":{"name":"dcn-bridge","version":"0.1.0","apiVersion":"4.70.0006.0","fake":false,"dllPath":"C:\\…"},
   "constants":{"SEAT_ASSIGNMENT.DEFAULT_AREA":0,"SEAT_ASSIGNMENT.NO_DELEGATE":0,"PARTICIPATION_INFO.NO_SEAT":0,"…":0},
   "status":{ …status object… }}
← {"type":"hello","ok":false,"error":{"code":"BAD_TOKEN","message":"…"}}          (then the bridge closes)
```
`constants` are the `const`/`static readonly` fields of the API's structs, read by reflection (their values are not
documented in the CHM). `apiVersion` is the version of the loaded `Bosch.Dcn.Ecpc.Client.Api.Logic.dll`.

## Requests and responses
Every request has a client-chosen integer `id`. The response carries the same `id`. Requests are executed **one at a
time in arrival order** (the DCN-SW API's thread safety is undocumented).
```json
← {"type":"response","id":7,"ok":true,"result":{…}}
← {"type":"response","id":7,"ok":false,"error":{"code":"UNKNOWN_METHOD","message":"…"}}
```

| Request | Fields | `result` |
|---|---|---|
| `connect` | `server` (e.g. `tcp://localhost:9461`), `user`, `password`, `roots` (`["control","config"]`) | `{ "control": "<API_ERROR>", "config": "<API_ERROR>" }`: the `Initialize` result per root |
| `call` | `api` (`control.DiscussionApi` …), `method`, `args` (object, `in`/`ref` parameters by name) | `{ "returns": "<API_ERROR>", "out": { <out/ref parameter>: value, … } }` |
| `status` | — | status object (below) |
| `disconnect` | — | `{}`; calls `Terminate` on every initialized root |
| `ping` | — | `{ "time": "<ISO 8601>" }` |

- `connect` with the same `server`/`user`/`password` as the current initialization returns `NONE` per root without
  re-initializing. Different values: `Terminate`, then `Initialize`. `Initialize` can take a while (≥ 5 s on wrong
  credentials); clients should allow 30 s.
- A client disconnect does **not** terminate the DCN-SW API (a backend restart then reconnects instantly). Only
  `disconnect` does.
- `API_ERROR` values are sent **by name** (`"NONE"`, `"NOT_ACTIVE"`, …). A non-`NONE` `returns` is still `ok: true`:
  the call reached the DCN-SW API. `ok: false` means the bridge could not make the call:

| `error.code` | Meaning |
|---|---|
| `BAD_REQUEST` | not JSON / unknown `type` / missing fields |
| `BAD_TOKEN` | wrong token (hello only; only when the bridge has a token) |
| `NOT_HELLO` | a request before a successful `hello` |
| `UNKNOWN_API`, `UNKNOWN_METHOD` | no such interface/method (in the spec or by reflection) |
| `BAD_ARGS` | missing `in` parameter, unknown argument, or a value that does not convert to the parameter type |
| `NOT_INITIALIZED` | `call` on a root that was never successfully initialized |
| `DLL_NOT_LOADED` | the Bosch DLLs could not be loaded (see `--selftest`) |
| `EXCEPTION` | the API threw; `message` = exception type + message |

## Pushed messages (no `id`)
```json
← {"type":"status","status":{…}}
← {"type":"event","api":"control.DiscussionApi","event":"MicOn","args":{"ParticiantInfo":[{"SeatId":12,"ParticipantId":0,…}]},"time":"2026-10-05T12:00:00.000Z"}
← {"type":"closed","reason":"replaced" | "shutdown"}
```
- `status` is pushed after `AvailabilityChange` / `AuthorizationChange` of either root and after `connect`/`disconnect`:
```json
{ "control": { "initialized": true, "available": true, "allowed": { "IsControlAllowed": true,
                 "DiscussionApi.IsDiscussStandardViewAllowed": true, "DiscussionApi.IsDiscussStandardControllAllowed": true, … } },
  "config":  { "initialized": true, "available": true, "allowed": { "IsConfigAllowed": true, "DelegateApi.IsDelegateRegistrationAllowed": false, … } } }
```
  `allowed` holds every `bool` property whose name starts with `Is` on the root and on its sub-interfaces (except `IsAvailable`).
- `event`: every .NET event of every sub-interface, subscribed after a successful `Initialize`. `args` = the EventArgs
  serialised as below. `AvailabilityChange`/`AuthorizationChange` are reported as `status`, not as `event`.

## Value encoding
| .NET | JSON |
|---|---|
| `int`, `long`, `short`, `byte`, `double` | number |
| `bool`, `string` | boolean, string (`null` for a null string) |
| enum | member **name** (input: name or number) |
| array | array (`null` for a null array) |
| struct / class | object of its public **instance** fields and readable properties, .NET names (PascalCase). No `const`/`static`. |
| `KeyValuePair<K,V>` | `{ "Key": …, "Value": … }` |
| `DateTime` | ISO 8601 string |

Input conversion (`args`): parameter names as in `api.json` (camelCase). Structs/classes are built from objects: a
missing member keeps its default. Unknown members → `BAD_ARGS`. A class with a parameterless constructor is created
with it; a struct starts from `default`.

## Bridge command line (WO-061)
`dcn-bridge.exe [--listen 0.0.0.0] [--port 9480] [--token <t> | env DCN_BRIDGE_TOKEN (optional)] [--dll-dir <DCN-SW folder>] [--fake] [--selftest]`.
`--fake` serves an in-process stub of the documented interfaces (no Bosch DLLs needed), for protocol tests.
`--selftest` loads the DLLs, prints the roots, interfaces, methods, events and constants found by reflection and
compares them with `api.json`, then exits.
