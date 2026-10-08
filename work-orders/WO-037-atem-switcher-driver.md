# WO-037: Blackmagic ATEM switcher driver (atem-connection) + mock

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-001 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
`SwitcherDriver` for ATEM (DEC-012): program cut on a configurable M/E, state (program/preview/inputs, connected).

## Scope
- `backend/src/devices/switchers/{atem,mock,index}.js`; `atem-connection` dependency (installed, MIT).
- Mock switcher driver (in-memory, same events) used by tests/demo; real ATEM verified in WO-041.

## Acceptance criteria
- [x] Driver unit tests with the mock; ATEM driver tested for API mapping with a stubbed Atem instance.

## Work log
- 2026-10-03 (Claude Opus): `atem-connection@3.10.3` installed (MIT; native freetype dep loads under Node and Electron-as-Node). `backend/src/devices/switchers/{atem,index}.js`: AtemSwitcher (connect with timeout, program cut on configured M/E, state program/preview/inputs/model, `program` events also for panel cuts), MockSwitcher. Tests `backend/test/switchers.test.js` with an injected stub of the atem-connection API + real module load check (4).

## Decisions

## Handoff
Done against protocol mocks / stub. Real hardware: WO-041.
