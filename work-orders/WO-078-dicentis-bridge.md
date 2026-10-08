# WO-078: dicentis-bridge: Windows .NET bridge for the DCNM API (+ shared bridge core)

| | |
|---|---|
| **Status** | review |
| **Phase** | 6 Windows API |
| **Depends on** | WO-077, WO-061 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
A .NET Framework 4.8 console app that hosts the DICENTIS DCNM API DLLs and serves every interface over the bridge
protocol (DEC-021), testable without Windows through a generated fake. The dcn-bridge moves onto a shared core.

## Context
DEC-021, DEC-017, DEC-019, WO-061/WO-068 (dcn-bridge), `docs/protocol/dcnm-api/{api,types}.json` (WO-077).

## Scope
- In: `bridge/common/` (Server transport, Json, ClrConvert, Log, options) used by `bridge/dcn` and `bridge/dicentis`
  (dcn-bridge behaviour unchanged, `npm run bridge:test` stays green); `bridge/dicentis/` (`DicentisBridge.csproj`,
  AnyCPU net48 + optional dev TFM): DLL folder discovery, reflection over `WindowsApiInstance`, connect sequence
  (Open → Authenticate → ConnectAsDevice with waits), `call` with overload choice by argument names, Task awaiting with
  timeout, `onFinish` hidden, `get`/`set` properties, events with `ApiEventArgs.Parameter`, status of all scalar
  properties re-read on `CapabilitiesChanged`/`…StateChanged`, `--selftest` (compare with api.json), `--fake` generated
  from api.json (`tools/gen-fake.mjs`); `docs/protocol/dcnm-api/BRIDGE.md`; README (install on the DICENTIS PC, seat
  assignment of the device, licences, firewall); conformance test `bridge/dicentis/test/conformance.test.mjs`.
- Out: running against a real DICENTIS (WO-082), the Node adapter (WO-079), launcher (WO-080), packaging (WO-029).

## Acceptance criteria
- [x] `dotnet build bridge/dicentis -c Release -p:DevTfm=net10.0` and the same for `bridge/dcn` succeed for net48 and
  net10.0 (0 errors).
- [x] dcn-bridge conformance still passes after moving onto `bridge/common`: 8/8.
- [x] dicentis-bridge `--fake` conformance on .NET 10: 8/8 (hello incl. both discovery paths and constants, token,
  connect sequence, wrong password, status after CapabilitiesChanged, Task results, Guid lists, events from pool
  threads, overloads, `Collection<string>`, constructor-built data classes in lists, all error codes incl. TIMEOUT and
  EXCEPTION, properties, handles, callbacks with/without result, **every documented method (≥250 calls) with
  spec-generated arguments**, client replacement, the backend against the real bridge). `--fake --selftest`: OK.
- [x] README + BRIDGE.md complete. The net48 exe has **not run** (no Windows here), like WO-061 → status review.

## Work log
- 2026-10-07 (Claude Opus): created (ready). Baseline `npm run bridge:test`: 8/8.
- 2026-10-07 (Claude Opus): in-progress. `docs/protocol/dcnm-api/BRIDGE.md` first (contract), then:
  - **Shared core** `bridge/common/`: `BridgeServer` (transport, hello, envelope; requests handed to an `IBridgeHost`,
    responses when their task completes), `SerialWorker`, `Json`, `ClrConvert` (+ Guid, Version, TimeSpan, base64
    byte[], collection interfaces, string-keyed dictionaries, construction through the constructor whose parameter names
    match the members), `Log`, `Options`. dcn-bridge: `Server.cs` → `DcnHost.cs` (same serial worker, 2 s status poll,
    same hello fields); Program uses the shared options. dcn conformance 8/8 again.
  - **dicentis-bridge** `bridge/dicentis/`: `DcnmHost` (WindowsApiInstance is an instance class → created once;
    interface properties; documented interfaces without a property found on objects implementing them; all events
    subscribed at start; overloads by argument names; `onFinish`/`CancellationToken`/delegates supplied by the bridge;
    Task awaited with timeout; calls serialised per method because of `ApiOperationFailedException`; interface results
    → handles, handle arguments; delegate parameters → pushed `callback` + `callbackResult`; status of scalar properties
    re-read only after CapabilitiesChanged/…StateChanged (debounced 250 ms); connect = open → authenticate → device;
    constants), `Program` (+ `--selftest` vs api.json incl. inherited members), csproj (AnyCPU net48 + DevTfm).
  - **Fake**: `tools/gen-fake.mjs` → `src/Fake/Fake.generated.cs` (2963 lines: 65 enums, 104 classes with only their
    documented constructors, 39 interfaces, explicit implementations, WindowsApiInstance with 3 extra properties and two
    "implemented by" cases) + `FakeBehavior.cs`.
  - Build problems: `--` in a csproj XML comment (again, as in WO-061); the CHM's `0,4f` constant (decimal comma) →
    fixed in the extractor (WO-077 data); constructor parameters whose type differs from the property of the same name
    (IEnumerable → IList, enum → bool) → the fake assigns only matching types; plugin message classes only have a
    parameterless constructor → object initialisers.
  - Conformance: `bridge/dicentis/test/conformance.test.mjs` 8/8 on the first run after the Node client existed;
    `npm run bridge:test` now runs both bridges (16/16). `npm test` 219/219.

- 2026-10-07 (Claude Opus): final run showed `bridge:test` 15/16, flaky: 3 of 6 repeated runs failed. Two causes:
  (1) **real race**: a status push computed mid-connect (not yet authenticated) could reach the client after the newer
  `status` reply → client left loggedIn, re-opened, and the mirror's sweep stopped early while reporting itself
  complete. Fix: `seq` in every status (bridge + mock), client ignores older ones; sweep reports `requested`/`total`/
  `complete`; regression test in `backend/test/dcnm.test.js`. (2) test design: the "every method" loop called
  `Base.CloseAsync`/`RevokeUserAsync`/`Device.DisconnectAsDeviceAsync` mid-way (which correctly ends the session) →
  called last now. After the fix: 8/8 in 8 repeated runs.
- 2026-10-07 (Claude Opus): with both bridge suites in parallel (`npm run bridge:test`) the backend test still failed
  sometimes: events arrived late. Cause in the **fake**: its plugin client blocked a .NET pool thread on the callback
  answer (`GetAwaiter().GetResult()`, up to the 30 s callback timeout), starving the pool that raises events → now
  awaited. The test also waits for the topic it checks. `npm run bridge:test` 16/16 in 4 of 4 runs; `npm test` 227/227.
  Note for real use: a delegate that returns a plain (non-Task) value blocks the API's thread the same way until the
  client answers (BRIDGE.md: answer callbacks promptly).

## Decisions
- Calls run concurrently (the API is asynchronous) but one at a time per `api.method` (ApiOperationFailedException).
- No status polling (vendor docs: polling properties can block their updates); re-read after state/capability events.
- Delegates become bridge callbacks (push + optional answer) instead of being unsupported: makes plugins usable.
- AnyCPU (64-bit) for the dicentis-bridge, x86 stays for the dcn-bridge (DEC-021 alternatives).

## Handoff
- Delivered: `bridge/common/`, `bridge/dicentis/` (exe, fake, generator, selftest, README, conformance test),
  `docs/protocol/dcnm-api/BRIDGE.md`; dcn-bridge on the shared core.
- Not verified: the net48 exe on Windows with the real DICENTIS DLLs (assembly loading, AppDomain/config needs of the
  Bosch libraries, discovery of IRoomAudioControl/IControlCamera, threading of events) → WO-082.
- Known limits: `SetCallbackContext`/`SetTaskCompletionContext` not exposable; a delegate that returns a non-Task value
  blocks the API's thread until the client answers or the timeout passes.
