# WO-061: dcn-bridge: Windows .NET bridge for the DCN-SW API

| | |
|---|---|
| **Status** | review |
| **Phase** | 6 Windows API |
| **Depends on** | WO-059, WO-060 (BRIDGE.md) |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
A .NET Framework 4.8 console app that hosts the Bosch DCN-SW API DLLs and speaks the bridge protocol (BRIDGE.md), so
the Node adapter can drive a real DCN system (DEC-017).

## Context
DEC-017, `docs/protocol/dcn-swapi/{api,types}.json`, `BRIDGE.md`, the mock bridge `mock/dcn/server.js` (reference behaviour).

## Scope
- In: `bridge/dcn/` C# project (SDK-style, `net48`, no NuGet runtime deps): config (listen address/port, token, DLL folder) from args/env/`dcn-bridge.config.json`;
  run-time loading of `Bosch.Dcn.Ecpc.Client.Api.Logic.dll` (+ AssemblyResolve from the DLL folder);
  reflection dispatch of `call` (args by name, `out` params, enums by name, structs/arrays from JSON); event subscription
  for every event of every interface via expression-built delegates; status push on Availability/Authorization change;
  JSON with `JavaScriptSerializer`; README (build, install, run as a service, firewall).
  A `--selftest` mode that loads the DLLs and lists what reflection found, for the first run on site.
- Out: running against a real system (WO-065), Windows service installer/packaging (WO-029).

## Acceptance criteria
- [x] `dotnet build bridge/dcn -c Release` succeeds on macOS (net48 via the reference assemblies package; 0 warnings, 0 errors).
- [x] Protocol conformance test passes against the bridge in `--fake` mode: ran on .NET 10 (macOS) instead of Windows/Mono, same source (`npm run bridge:test`, 7/7, incl. the backend syncing through the bridge). The net48 binary itself was **not run** (no Windows here).
- [x] README explains install on the DCN-SW PC, DLL folder, token, firewall, and how to read `--selftest` output.

## Work log
- 2026-10-05 (Claude Opus): created (ready).
- 2026-10-05 (Claude Opus): in-progress. Checked: `dotnet` 10 SDK can build `net48` on macOS with
  `Microsoft.NETFramework.ReferenceAssemblies` (build-time only). No Mono, so net48 can't run here. Changed approach so it
  is still testable: own `Json.cs` (no `JavaScriptSerializer`, which modern .NET lacks), optional second target
  (`-p:DevTfm=net10.0`), and a generated `--fake` API (`tools/gen-fake.mjs` → `src/Fake/Fake.generated.cs`, 1603 lines,
  explicit interface implementations) driven by the same `ApiHost` reflection as the Bosch DLLs.
  Files: `DcnBridge.csproj`, `src/{Program,Server,ApiHost,ClrConvert,Json}.cs`, `src/Fake/FakeBehavior.cs`, README,
  example config, `test/conformance.test.mjs`, `npm run bridge:test` / `bridge:gen`, `.gitignore` for bin/obj.
- 2026-10-05 (Claude Opus): build problems: `--` inside an XML comment in the csproj; the Write tool turned `'\u2028'`
  escapes in Json.cs into raw line separators (C# newline) → numeric comparisons. Found while reviewing: `ReadLine`
  left the MemoryStream position past the end after `SetLength` (next write would have left stale bytes) → fixed.
  `--fake --selftest`: 11 interfaces / 104 methods / 62 events / 17 constants, `SELFTEST OK`.
- 2026-10-05 (Claude Opus): conformance run 1: 5/7. **Real bug in the Node client** (WO-060 code) that the mock hid:
  `DcnClient.connect()` judged "logged in" from the stale hello status, because the bridge pushes the new status in a
  separate packet after the connect reply (the mock wrote both in one chunk). Fix: the client requests `status` after
  `connect`; the mock now pushes status on a later tick, like the bridge. Run 2: 7/7. `backend/test/dcn.test.js` 17/17.

- 2026-10-05 (Claude Opus, WO-068): checked against the user's real DCN-SW 4.70.6 DLLs (metadata): API surface
  matches; bridge got a recursive interface walk, 32-bit enforcement, working directory = DLL folder (remoting config),
  missing-DLL warnings, status polling. See WO-068.

## Decisions
- Reflection goes through the **interfaces** (root property types and their sub-interface properties), not
  `GetType()` of the instances: obfuscated classes may implement members explicitly. Methods addressed by name.
- `Initialize` runs on a watched thread: done when it returns, or when `IsAvailable` turns true while it still blocks
  (the CHM contradicts itself), or `SETUP_LINK_FAILED` after `--init-timeout` (60 s).
- x86 process by default (older Bosch DLLs may be 32-bit); `-p:PlatformTarget=x64` to change.
- Events are subscribed once per process after the first successful Initialize and survive client reconnects.
- Constants (`const`/`static readonly` fields of the API's structs) go into `hello.constants`, because the CHM doesn't
  document their values.

## Handoff
Review: everything that can be verified without Windows is verified. Not verified: running the `net48` exe, loading
the real Bosch DLLs, .NET Remoting to a DCN-SW server, the real event args. All of that is WO-065: first step on site is
`dcn-bridge.exe --dll-dir … --selftest`, and its output tells us whether the DLLs match the 4.70 docs.
Packaging as a Windows service/installer: WO-029.
