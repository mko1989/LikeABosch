# WO-059: DCN-SW API reference (CHM → JSON)

| | |
|---|---|
| **Status** | done |
| **Phase** | 1 Protocol extraction |
| **Depends on** | — |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
A machine-readable reference of the DCN-SW API (Bosch DCN NG conference software, .NET) that the Windows bridge, the
Node adapter, the mock and the tests all use as their single source of truth (DEC-003 style, DEC-017).

## Context
User request 2026-10-05: "add support for dcn system (network for now, rs maybe later), api is here DCN-SWAPI.chm".
DEC-017 explains why a Windows bridge is needed. CHM tools: `scripts/chm/README.md`.

## Scope
- In: move `DCN-SWAPI.chm` to `docs/source/`, unpack to `docs/source/chm/DCN-SWAPI` (7zz); extractor
  `scripts/chm/dcnswapi.py` → `docs/protocol/dcn-swapi/api.json` (roots, interfaces, methods with in/out parameters,
  errors, remarks, examples, properties, events) + `types.json` (structs, classes, enums with values);
  `docs/protocol/dcn-swapi/README.md` (fundamentals, gaps); validator `scripts/validate-dcn-spec.mjs`.
- Out: the bridge protocol (WO-060 `BRIDGE.md`), any code.

## Deliverables
`docs/source/DCN-SWAPI.chm`, `docs/source/chm/DCN-SWAPI/`, `scripts/chm/dcnswapi.py`, `docs/protocol/dcn-swapi/{api,types}.json`,
`docs/protocol/dcn-swapi/README.md`, `scripts/validate-dcn-spec.mjs`, `npm run spec:check` extended.

## Acceptance criteria
- [x] 11 interfaces, 104 methods, 62 events extracted; counts cross-checked against the CHM topic files (62 `E_*` event pages; 104 = 106 interface method pages minus the 2 inherited `IApi` ones).
- [x] Every parameter/field type resolves to a primitive, an array of one, or an entry in `types.json` (validator), with the undocumented types listed in the README.
- [x] README lists roots, the connection model, error codes, licences/permissions and the known documentation gaps.

## Work log
- 2026-10-05 (Claude Opus): read the CHM. It is a Sandcastle .NET reference for `Bosch.Dcn.Ecpc.Client.Api.*`
  4.70.0006; `IApi.Initialize("tcp://host:9461", user, pw)` = .NET Remoting → DEC-017 (Windows bridge). Moved the CHM to
  `docs/source/`, unpacked with 7zz (820 topic pages). Wrote `scripts/chm/dcnswapi.py` (parses `Microsoft.Help.Id`, the
  C# syntax block, parameter lists, return value, remarks, examples). First run: 11 interfaces, 104 methods, 62 events,
  61 types (7 enums). Fixed: enum tables included the running-header row. No overloaded method names, so methods are
  addressed by name. All methods return `API_ERROR`.
- 2026-10-05 (Claude Opus): bug found while writing the README: the enum parser dropped the **first member** of every
  enum (`API_ERROR.NONE`, `MicrophoneStatus.OFF`, …). Rows are now matched on their `target="F:…"` cell; all 7 enums
  complete (API_ERROR 51 values). Added `scripts/validate-dcn-spec.mjs` (counts, no overloads, all return `API_ERROR`,
  type references, enum members) to `npm run spec:check`: `OK`, known gaps VoteResultEventArgs,
  VoteControlEventArgs, VOTING_PRESENCE, KeyValuePair<string, string>. `docs/protocol/dcn-swapi/README.md` written.

## Decisions
- One `api.json` + one `types.json` instead of a file per method (unlike the Conference Protocol): the API is addressed
  as `<root>.<Api>.<Method>`, and the bridge/mock load it whole.
- Methods are keyed `control.DiscussionApi` etc. (root property path), not by interface name, because `MeetingApi` and
  `VoteApi` exist under both roots with different interfaces.

## Handoff
Done. `api.json`/`types.json` are the source of truth for the bridge (WO-061), the Node adapter and the mock (WO-060).
Known gaps (README "Gaps") are to be filled from the bridge's run-time reflection on a real system (WO-065).
