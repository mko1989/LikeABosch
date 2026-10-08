# DEC-021: The full DICENTIS (DCNM .NET) API through a Windows bridge ("dicentis-bridge")

- **Status:** accepted (requested by the user 2026-10-07: "make the dicentis wired bridge app so the full api will be
  available"; design by Claude, revisable)
- **WO:** WO-077 (reference), WO-078 (bridge), WO-079 (Node adapter + mock), WO-080 (launcher, see DEC-022)
- **Supersedes:** DEC-013 §3 ("DCNM .NET API is out of scope") and the deferral in DEC-014 §2–3 (Windows sidecar
  "later"). The rest of DEC-013 and DEC-014 stays. **Extends:** DEC-017 (bridge pattern), DEC-019 (token optional).

## Context
The Conference Protocol (wired, WSS) cannot edit participants, the agenda or seat assignments, and has almost no audio
settings (DEC-014). All of that, and much more, is in Bosch's **DCNM API** (`docs/source/DcnmApiDocumentation.chm`,
DICENTIS 7.0, assembly version 7.00.43431): a .NET Framework library, `Bosch.Dcnm.Interfaces.Api.dll` +
`…Api.Interfaces.dll`, installed with the DICENTIS software (`C:\Program Files\Bosch\DICENTIS`).
- Entry: static `WindowsApiInstance` with one property per interface (`Base` = `IApi`, `Device` = `IDeviceApi`,
  `ControlSpeaker`, `PrepareParticipant`, `RoomAudioControl`, …): 39 interfaces, 266 methods, 169 events.
- Connection: `Base.OpenAsync()` → `IsOpen`; `Base.AuthenticateUserAsync(user, password)`; for most control functions
  `Device.ConnectAsDeviceAsync(uniqueName)`: the API client "is discovered as a device by the server. It needs to be
  assigned to a seat and given manage rights" (configured once in DICENTIS).
- Methods are asynchronous: `Task<T> XxxAsync(…, Action<Task<T>> onFinish = null)`. Data mostly arrives as events
  (`EventHandler<ApiEventArgs<T>>`, value in `.Parameter`): register, then call `Request…Async()`, which makes the event
  fire with the current state. `Can…` properties tell what is allowed; changes come with `CapabilitiesChanged`; the docs
  ask not to poll properties.

Node cannot load .NET assemblies, so the same constraint as for DCN (DEC-017) applies.

## Decision
1. **dicentis-bridge**: a .NET Framework 4.8 console app in `bridge/dicentis/`, generic like the dcn-bridge. It loads
   the DICENTIS DLLs **at run time** from the DICENTIS installation folder (`--dll-dir`, default
   `C:\Program Files\Bosch\DICENTIS`, also searched below `Program Files\Bosch`), discovers the interfaces from
   `WindowsApiInstance`'s properties by reflection, and serves them over the bridge protocol. No Bosch code in the repo,
   no per-method code. AnyCPU (64-bit on 64-bit Windows; `--selftest` reports the bitness).
2. **Shared bridge core**: transport (TCP, NDJSON, one client, hello/token per DEC-019), JSON and value conversion move
   to `bridge/common/` and are compiled into both bridges. The dcn-bridge keeps its protocol and behaviour.
3. **Protocol** (`docs/protocol/dcnm-api/BRIDGE.md`, default port **9481**): same framing, envelope and error codes as
   the dcn-bridge, plus:
   - `connect {user, password, device?}` runs Open → Authenticate → (if `device` given) ConnectAsDevice and waits for
     each state (timeouts); answers `{ open, authenticated, device }`.
   - `call {api, method, args, timeoutMs?}`: `api` = the `WindowsApiInstance` property name (`ControlSpeaker`); the
     `onFinish` callback parameter is never exposed; overloads are chosen by the argument names given; the returned
     `Task` is awaited (default 30 s) and its `Result` returned as `result`. Calls run concurrently (the API is
     asynchronous by design); responses are matched by `id`.
   - `get {api, property}` / `set {api, property, value}` for properties.
   - Pushed `event {api, event, args}` for every event of every interface (`ApiEventArgs.Parameter` as `args.Parameter`),
     subscribed once at start, before any `Request…` call. Pushed `status`: every scalar property (`Can…`, `Is…`, states)
     of every interface, re-read **only** after `CapabilitiesChanged`/`…StateChanged` events and connect steps (no
     polling, as the docs ask), sent when it changed.
4. **Node adapter `backend/src/dcnm/`**: bridge client (shares code with `backend/src/dcn/client.js`), spec from
   `docs/protocol/dcnm-api/{api,types}.json`, passthrough `POST /api/dcnm/ops/<Api>/<Method>` and
   `GET /api/dcnm/props/<Api>`, and a **generic state mirror**: the last payload of every event is cached as topic
   `dcnm.<Api>.<Event>`; after connecting, every parameterless `Request…Async` is called once so the mirror fills.
   DICENTIS semantics on top (seat assignment editing, audio …) are separate WOs.
5. **Secondary connection next to the Conference Protocol** (like DEC-020): with `system: "wired"` and `dcnmBridge`
   on, the connection manager also connects to the dicentis-bridge. Settings: `dcnmBridge` (bool, default false),
   `dcnmHost` (default `127.0.0.1`, the launcher starts the bridge locally, DEC-022), `dcnmPort` (9481), `dcnmDevice`
   (device name, default `LikeABosch`; empty = don't connect as a device). Credentials: the wired user/password. Its
   state is reported in `/api/connection` as `dcnm`; its failure never disconnects the Conference Protocol.
   Environment: `DICENTIS_DCNM_BRIDGE`, `DICENTIS_DCNM_HOST`, `DICENTIS_DCNM_PORT`, `DICENTIS_DCNM_DEVICE`.
6. **Testing**: `--fake` mode with a generated stub of all 39 interfaces (from `api.json`, like the dcn-bridge), a
   protocol conformance test on .NET 10 (`npm run bridge:test`), and `mock/dcnm/` (bridge protocol in Node) for
   backend tests. A live DICENTIS system with the DLLs is needed for real verification (draft WO).

## Consequences
- The PC running dicentis-bridge needs the DICENTIS software (same version as the system: the API checks it,
  `VersionMismatchErrorDetected`) and must be on the DICENTIS network. The DICENTIS admin assigns the "LikeABosch"
  device to a seat with manage rights once. Licences decide which interfaces work (`Can…`).
- Naming: the Windows program is **dicentis-bridge**; in code, settings and topics the API is called **dcnm** (its
  Bosch name), to keep it apart from the Conference Protocol (`wired`).
- The bridge port is plain TCP (token optional, DEC-019). The launcher binds it to 127.0.0.1 when it starts it.
- WO-050 (draft sidecar) is replaced by WO-077…WO-080 and follow-ups.

## Alternatives considered
- **One bridge exe for DCN and DICENTIS:** fewer files, but the two need different bitness (DCN-SW DLLs are x86 only,
  DICENTIS is AnyCPU/x64) and different DLL folders. Rejected; shared source instead.
- **Hand-written endpoints per operation (HTTP sidecar):** 266 methods to maintain. Rejected (same reasoning as DEC-017).
- **Wrap the API in the DICENTIS Python/IronPython way:** no events (the docs say so). Rejected.
- **Polling properties for status:** the vendor docs say polling can block property updates. Rejected.
