# WO-095: Simulated systems (no hardware): wired, wireless, DCN with any number of seats

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-093, WO-010, WO-014 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
User (2026-10-07): "id like a \"simulate\" version too with different systems. exporting and importing such projects with the ability to match the connected system with the simulated project would be great. i also want to package it for test dist" Part 1: simulate different systems inside LikeABosch.

## Context
DEC-026, DEC-025. Mocks: mock/wired, mock/wireless, mock/dcn, mock/dcn-smd.

## Scope
- In: `backend/src/simulation/simulator.js`; settings `simulators` / `simulate`; `ConnectionManager.system` (effective type) and status `simulated`; mocks take seat count + name; Settings → Connection → Simulation (add/edit/delete, Simulate, Back to the real system); "SIMULATED" in the header; project key `sim:<id>`.
- Out: scripted activity (speakers, votes) in simulations.

## Acceptance criteria
- [x] `backend/test/simulation.test.js`: wired 40 seats + wireless 8 seats, capabilities, own projects, back and forth, domain action on the simulated WAP.
- [x] ui-check `connection`: add + simulate + header tag + own project; screenshots looked at. `npm test` 263/263, `npm run e2e:wireless:mock` 23/23, `npm run e2e:mock` 31/31, `node scripts/ui-check.mjs` (all systems) OK twice.

## Work log
- 2026-10-07 (Claude Opus): implemented as in Scope. The 5 places that read `manager.settings.system` now use
  `manager.system`. Simulation test passed first time. While wiring the ui-check I found that going back to the real
  system opened its *most recently changed* project instead of the one used last: projects now record `openedAt` and
  DEC-025's rule says "last used" (DEC-025 text adjusted the same day, before any review; logged here and in WO-093).
  The connection scenario runs last (it adds projects other scenarios count).

## Decisions
- Profiles are machine settings (like the connection), not part of projects.

## Handoff
Delivered. Status `review`. Simulations are static (no speaker activity); say if scripted activity is wanted.
