# WO-077: DCNM (DICENTIS .NET) API reference (CHM → JSON)

| | |
|---|---|
| **Status** | done |
| **Phase** | 1 Protocol extraction |
| **Depends on** | — |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
A machine-readable reference of the DICENTIS DCNM API 7.0 (`Bosch.Dcnm.Interfaces.Api`) that the dicentis-bridge, its
fake, the Node adapter, the mock and the tests use as the single source of truth (DEC-003 style, DEC-021).

## Context
DEC-021. Source: `docs/source/DcnmApiDocumentation.chm`, unpacked in `docs/source/chm/DcnmApiDocumentation` (Sandcastle,
2171 topics). Same approach as WO-059 (`scripts/chm/dcnswapi.py` for DCN).

## Scope
- In: `scripts/chm/dcnmapi.py` → `docs/protocol/dcnm-api/api.json` (entry `WindowsApiInstance`, 39 interfaces with
  methods incl. overloads, parameters, return types, events with their payload type, properties) and `types.json`
  (classes, structs, enums with values, EventArgs); `docs/protocol/dcnm-api/README.md` (connection model, licences and
  rights, how-tos summary, gaps); `scripts/validate-dcnm-spec.mjs` in `npm run spec:check`.
- Out: the bridge protocol (WO-078), code.

## Acceptance criteria
- [x] Counts cross-checked against the CHM topic ids: 39 interfaces (39 interface T: pages), 264 methods (264 interface
  M: pages, no Dispose pages), 169 events (169 E: pages), 106 interface properties, 104 classes / 591 properties /
  224 constructors, 65 enums, 2 delegates; 211 T: pages = 39 + 104 + 65 + 2 + WindowsApiInstance.
- [x] Every type resolves (`node scripts/validate-dcnm-spec.mjs`: "dcnm-api spec OK"; framework types whitelisted).
- [x] README describes the connection sequence, the async/event model, rights/licences and the gaps.

## Work log
- 2026-10-07 (Claude Opus): created (in-progress).
- 2026-10-07 (Claude Opus): `scripts/chm/dcnmapi.py` (Sandcastle pages: `Microsoft.Help.Id` + C# declaration of the
  `_code_Div1` block, parameter lists, return value, remarks, exceptions, enum member tables). Problems: attributes before
  declarations (`[ObsoleteAttribute("…")]`, 10+ events) broke the event parser → attributes stripped, the obsolete
  message kept as `obsolete`; enum rows with an empty description cell (`<td />`) were skipped (3 enums empty) → fixed.
  Validator `scripts/validate-dcnm-spec.mjs` (+ `npm run spec:check`). Findings for the bridge: 5 interfaces have no
  documented `WindowsApiInstance` property (IRoomAudioControl, IControlCamera, IPrepareCamera, ISystemVideoControl,
  IPrepareParticipant); data classes have only parameterised constructors; `Base.OpenAsync(hostNameOrAddress)` exists;
  `RegisterPluginAsync` returns an interface object; 8 methods take a CancellationToken; 13 methods have no callback.

## Decisions
- Interfaces keyed by their `WindowsApiInstance` property name (what the bridge's `api` field uses); the 7 others under
  `otherInterfaces` by interface name. Inherited members stay on the declaring interface (`inherits`).
- The `onFinish` callback parameter is dropped from `params` (flag `callback`): it cannot cross the bridge.

## Handoff
- Delivered `docs/protocol/dcnm-api/{api,types}.json`, README, extractor and validator. Gaps listed in the README.
- Next: WO-078 (bridge) uses api.json for `--selftest` and the generated fake.
