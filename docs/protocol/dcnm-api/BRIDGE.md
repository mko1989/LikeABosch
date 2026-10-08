# dicentis-bridge protocol (version 1)

Between the LikeABosch backend (`backend/src/dcnm/client.js`) and the Windows **dicentis-bridge** (`bridge/dicentis/`,
WO-078) or the mock (`mock/dcnm/server.js`). Decided in [DEC-021](../../decisions/DEC-021-dicentis-dcnm-api-bridge.md).
The bridge is a generic reflection layer over the DICENTIS DCNM API (`api.json`, `types.json`); DICENTIS semantics live
in the Node adapter.

```
LikeABosch backend ──TCP :9481, NDJSON──▶ dicentis-bridge (Windows, .NET 4.8, DICENTIS software installed)
                                            └─ Bosch.Dcnm.Interfaces.Api ──DICENTIS network──▶ DICENTIS server
```

Transport, handshake, envelope, error codes and value encoding are those of the dcn-bridge
([../dcn-swapi/BRIDGE.md](../dcn-swapi/BRIDGE.md)): TCP, one JSON object per line, one client at a time (a new client
replaces the old one with `closed/replaced`), `hello` first within 5 s, optional token (DEC-019), requests with an
integer `id`, responses `{type:"response", id, ok, result | error:{code, message}}`. This file lists what differs.

## Handshake
```json
→ {"type":"hello","protocol":1,"token":"<optional>","client":"likeabosch/0.1.0"}
← {"type":"hello","ok":true,"protocol":1,
   "bridge":{"name":"dicentis-bridge","version":"0.1.0","apiVersion":"7.0.43431.0","fake":false,"dllPath":"C:\\…","runtime":"…","is64Bit":true},
   "interfaces":{"ControlSpeaker":{"interface":"IControlSpeaker","source":"property"},"RoomAudioControl":{"interface":"IRoomAudioControl","source":"implemented by SystemAudioControlApi"},…},
   "status":{ …status object… }}
```
`interfaces` = what reflection found: `source` is `property` (a `WindowsApiInstance` property) or `implemented by <key>`
(a documented interface without its own property that an object of another key implements).

## Requests
Requests run **concurrently** (the API is asynchronous); responses may come in any order. Calls of the same
`api.method` are serialised, because the API throws `ApiOperationFailedException` when a function is entered again
before the previous call released it.

| Request | Fields | `result` |
|---|---|---|
| `connect` | `user`, `password`, optional `server` (host for `OpenAsync(hostNameOrAddress)`; default: the API's own discovery), optional `device` (unique device name; omitted/empty = don't connect as a device), optional `timeoutMs` per step (default 30000) | `{ "open": bool, "authenticated": bool, "device": "<DcnmDeviceConnectionState>" \| null, "enabled": bool \| null, "apiState": "<DcnmApiState>" }` |
| `disconnect` | — | `{}`: `DisconnectAsDeviceAsync` (if connected), `RevokeUserAsync`, `CloseAsync` |
| `call` | `api` (key, e.g. `ControlSpeaker`, or a handle `#3`), `method` (e.g. `GrantSpeechAsync`), `args` (object, parameters by name), optional `timeoutMs` (default 30000) | `{ "result": <value> }`: the awaited `Task<T>.Result` (`null` for `Task`/`void`) |
| `get` | `api`, `property` | `{ "value": <value> }` |
| `set` | `api`, `property`, `value` | `{}` |
| `release` | `handle` | `{}`: forget an object handle |
| `callbackResult` | `callback` (id from a pushed `callback`), `result` | `{}`: answer of a value-returning delegate |
| `status` | — | status object |
| `ping` | — | `{ "time": "<ISO 8601>" }` |

`connect` runs, each step waiting for its state with `timeoutMs`:
1. `Base.OpenAsync([server])` unless `Base.IsOpen`; then wait for `IsOpen`.
2. wait for `Base.CanAuthenticate`, `Base.AuthenticateUserAsync(user, password)` unless `IsUserLoggedOn` (a `false`
   result is `authenticated: false`, not an error).
3. with `device`: wait for `Device.CanConnectAsDevice`, `Device.ConnectAsDeviceAsync(device)` unless
   `CurrentDeviceConnectionState` is `Connected`; wait for `Connected`; report `IsEnabledAsDevice` (false until an
   administrator assigned the device to a seat with manage rights in DICENTIS).
A step that times out ends `connect` with error `TIMEOUT` and the step name in the message.

### Calls
- **Overloads** are chosen by the argument names: the overload whose parameters (without `onFinish` and
  `CancellationToken`) include every given name and whose required parameters are all given; with several, the one
  using the most arguments. None → `BAD_ARGS` listing the overloads.
- The `onFinish` callback is always `null`. A `CancellationToken` parameter gets a token cancelled after `timeoutMs`.
  Optional parameters that are not given take their default.
- A `Task` result is awaited up to `timeoutMs` (→ `TIMEOUT`); a faulted task → `EXCEPTION` with the inner exception.
- **Handles:** a result whose declared type is an interface (e.g. `IPluginInstance` from `RegisterPluginAsync`) is
  returned as `{ "$handle": "#3", "interface": "IPluginInstance" }`; use `"api": "#3"` to call it, `release` to drop it.
- An interface parameter (e.g. `UnregisterPluginAsync(pluginInstance)`) takes a handle reference `{ "$handle": "#3" }`.
- **Delegate parameters** (`PluginEventDelegate`, `PluginCommandDelegate`) are not passed by the client: the bridge
  supplies a delegate. When the API invokes it, the bridge pushes
  `{"type":"callback","callback":7,"api":"Plugins","method":"RegisterPluginAsync","parameter":"handler","args":{"msg":{…}},"expectsResult":true}`.
  For a delegate that returns a value (`PluginCommandDelegate` → `Task<string>`) the client answers with the request
  `{"type":"callbackResult","id":…,"callback":7,"result":"…"}`; without an answer within the call's `timeoutMs` the
  delegate returns the default (`null`).
- `SetCallbackContext` / `SetTaskCompletionContext` (`SynchronizationContext`) cannot be called: `BAD_ARGS`.

## Pushed messages
```json
← {"type":"event","api":"ControlSpeaker","event":"SpeakersListChanged","args":{"Parameter":[{"SpeakerId":"…","MicrophoneState":"On",…}]},"time":"…"}
← {"type":"status","status":{…}}
← {"type":"closed","reason":"replaced" | "shutdown"}
```
- `event`: every event of every interface, subscribed when the bridge starts (before any `Request…Async`, as the API
  requires). `args` = the EventArgs serialised (for `ApiEventArgs<T>`: `{ "Parameter": … }`; for `EventArgs`: `{}`).
- `status` (also the `status` request and in `hello`):
```json
{ "seq": 42,
  "connection": { "open": true, "authenticated": true, "device": "Connected", "enabled": true, "apiState": "Online" },
  "interfaces": { "ControlSpeaker": { "CanControlSpeaker": true }, "Base": { "IsOpen": true, "CanAuthenticate": true, … }, … } }
```
  `interfaces` holds every readable property of a scalar type (bool, number, string, enum, Guid, DateTime, Version) of
  every interface. It is re-read **only** after a `CapabilitiesChanged` event, an event whose name ends in
  `StateChanged`, and after `connect`/`disconnect` steps (debounced 250 ms), and pushed when it changed. No timer polling
  (the vendor docs say polling properties can block their updates).
  `seq` grows with every status the bridge computes. Because requests run concurrently, a status computed earlier can
  reach the client after a newer one (e.g. a push from mid-connect after the `status` reply): clients ignore a status
  whose `seq` is lower than the last one they took.

## Values
As in the dcn-bridge, plus:
| .NET | JSON |
|---|---|
| `Guid` | string (`"0f8fad5b-d9cb-469f-a165-70867728950e"`); input: string |
| `Version` | string (`"7.0.43431.0"`) |
| `IList<T>`, `List<T>`, `Collection<T>`, `ReadOnlyCollection<T>`, `IEnumerable<T>` | array (input: array, converted to the parameter's collection type) |
| `byte[]` | base64 string (input: base64 string or array of numbers) |
| class without a parameterless constructor | input: the public constructor whose parameter names all appear in the object (case-insensitive, most matches wins), remaining members set through writable properties |

## Additional error codes
| `error.code` | Meaning |
|---|---|
| `TIMEOUT` | a `Task` or a `connect` step did not finish within `timeoutMs` |
| `UNKNOWN_PROPERTY` | `get`/`set` of a property that does not exist / is not readable / writable |
| `UNKNOWN_HANDLE` | `api` or `release` names a handle that does not exist |

## Bridge command line (WO-078)
`dicentis-bridge.exe [--listen 127.0.0.1] [--port 9481] [--token <t>] [--dll-dir <DICENTIS folder>] [--fake] [--selftest] [--verbose]`
(env `DICENTIS_BRIDGE_LISTEN`, `…_PORT`, `…_TOKEN`, `…_DLL_DIR`; config file `dicentis-bridge.config.json` next to
the exe). Prints `READY port=<n>` when listening. `--selftest` loads the DLLs, lists interfaces, methods, events and
properties found and compares them with `api.json`, then exits (0 = match).
