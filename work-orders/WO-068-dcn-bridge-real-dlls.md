# WO-068: dcn-bridge against the real DCN-SW DLLs (offline verification, remoting, real types)

| | |
|---|---|
| **Status** | done |
| **Phase** | 6 Windows API |
| **Depends on** | WO-061 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
The user wants seat microphones switched on/off from LikeABosch, which needs the DCN-SW API (the meeting data stream
is read-only, DEC-018). The user supplied the DLLs of the DCN-SW server installation (`dcn/`, gitignored, never
committed). Verify the bridge and the spec against the real assemblies as far as possible without a DCN system, and
fix what differs, so the first on-site run (WO-065) has the best chance.

## Context
DEC-017, WO-059 (api.json/types.json from the 4.70 CHM), WO-061 (bridge, verified only with the generated fake).
`dcn/Bosch.Dcn.Ecpc.Client.Logic.dll.config` shows Bosch's own client configuring .NET Remoting (tcp channel port 0,
binary formatter, `typeFilterLevel="Full"` for callbacks).

## Scope
- In: inspection tool (metadata only, no Bosch code executed): versions, target framework, bitness, references,
  full API surface, constants, undocumented types, remoting-related references and strings; compare with api.json;
  update types.json with the real undocumented types (as `source: "dll"`); bridge remoting configuration if the API
  needs it; try `--selftest` with the real DLLs; regenerate the fake; align mock + domain mapping with the real
  event args (vote results); docs.
- Out: running against a DCN-SW server (WO-065).

## Acceptance criteria
- [x] Report of real DLLs vs api.json recorded (log below; `npm run bridge:inspect` → `data/dcn-dll-report.json`); spec extended with what the DLLs add (`dll-additions.json`, `source: "dll"`); after merging: `0 difference(s) to api.json`.
- [x] Undocumented types and constant values known from the DLLs; mock (constants, VoteResults/VoteControl args), fake, domain mapping and tests use them.
- [x] Remoting/callback requirements identified (Client.Logic loads `Bosch.Dcn.Ecpc.Client.Logic.dll.config` from the working directory); the bridge switches the working directory, warns if the file is missing, enforces 32-bit; README says to run on the DCN-SW PC.
- [x] `npm test` 199/199, `npm run bridge:test` 7/7, `spec:check` OK, `e2e:mock` 31/31, `ui:check --system dcn` OK.

## Work log
- 2026-10-05 (Claude Opus): created. Read the config files in `dcn/` (passwords would have been redacted; none
  present): Server.exe.config has SWSMD listeners on 20000 (no AllowedClients), 20001 (HDCC filter), 20002 (webcast
  filter); runtime v4.0; DB `.\SQLEXPRESS`. Added `dcn/` to `.gitignore`.
- 2026-10-05 (Claude Opus): `bridge/dcn/tools/inspect` (net10, `System.Reflection.MetadataLoadContext` + net48 reference
  assemblies: metadata only, no Bosch code executed). Results (DCN-SW 4.70.6, API assemblies 1.0.0.0):
  all API DLLs **x86-only (32BITREQUIRED)**, .NET 4.0; every documented method/parameter/event matches; extra
  5 methods, 6 events, 5 flags (CancelSpeaking, access control, attendance); the CHM's gaps answered
  (ControlEventArgs {ConfigId, ServiceId}, VoteResultEventArgs.TotalResults, VOTING_PRESENCE, constants:
  DEFAULT_AREA 1, DEFAULT_PINCODE 11111, DEFAULT_MEETINGGROUP_ID 1, MAX_VOTE_WEIGHT 99999999, …).
  Remoting: the API DLL itself references only sockets/XmlSerializer and formats `{0}/IServerObjectFactory.rem`;
  in its dependency closure `Bosch.Dcn.Ecpc.Client.Logic.DLL` calls `RemotingConfiguration.Configure(
  "Bosch.Dcn.Ecpc.Client.Logic.dll.config")` (bare file name → working directory) and `Activator.GetObject`; that
  config registers a tcp channel port 0 with `typeFilterLevel="Full"` = server→client callbacks (events). All 13
  DLLs of the closure are in the folder (nunit.framework referenced but not needed at run time).
  First inspector run under-reported root events: MetadataLoadContext flattens interface inheritance one level only
  (IControlApi → IApi but not IApiEvents) → recursive walk, in the inspector and (defensively) in the bridge.
- 2026-10-05 (Claude Opus): spec: `scripts/chm/dcn-dll-additions.py` → `docs/protocol/dcn-swapi/dll-additions.json`,
  merged by `dcnswapi.py`; validator 109 methods / 68 events. Bridge: recursive interface walk, 64-bit process
  refused with a clear message, working directory = DLL folder, warnings for a missing remoting config or missing
  referenced DLLs (also in `--selftest`), status polling every 2 s. Fake regenerated with the real types/constants;
  mock constants read from types.json; VoteResults/VoteControl args in the real shape; `dcn/events.js` takes the
  voting id from `ConfigId`; `dcn.voting` mapper reads `TotalResults.Answers`. Build broke once: the bridge project
  globbed `tools/inspect/**` (duplicate assembly attributes) → `Compile Remove`. Conformance test expectation updated:
  real `CountEventArgs` inherits `ConfigId/ServiceId`. All suites green (see criteria).

## Decisions
- Dev-only dependency `System.Reflection.MetadataLoadContext` in `bridge/dcn/tools/inspect` (not shipped, not in the app).
- Not pursued: talking to DCN-SW without Bosch's DLLs (would mean reverse engineering the obfuscated client protocol).
- Assumed until seen on site: `ConfigId` of voting events = voting id; `AnswerId` = 1-based position in the answer set.
- The bridge must run on the DCN-SW PC (callbacks); recorded in the bridge README and WO-065.

## Handoff
Done. Everything checkable without a running DCN-SW server is verified. The net48 bridge can't be executed here
(x86-only DLLs, no Windows). Next: WO-065 on the DCN-SW PC: build, copy `bin/Release/net48`, run
`dcn-bridge.exe --dll-dir "<DCN-SW folder>" --selftest`, then with `--token`, and check that MicOn/MicOff events arrive.
