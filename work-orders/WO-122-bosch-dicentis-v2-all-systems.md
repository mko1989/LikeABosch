# WO-122: Companion module `bosch-dicentis` v2: all Bosch systems as an upgrade of the published module (DEC-038)

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-119 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-14 |
| **Updated** | 2026-10-14 |

## Goal
The published Companion module `bosch-dicentis` (bitfocus/companion-module-bosch-dicentis) gets the code of the combined
module from WO-119 (DICENTIS, DICENTIS Wireless, CCS 1000 D, DCN NG meeting data) as version 2.0.0, with upgrade scripts
so existing connections, buttons, triggers and variable texts keep working.

## Context
User request 2026-10-14: Bitfocus wants the existing module updated instead of a new one. Read DEC-036, DEC-038,
WO-119. The 1.x code is in the Bitfocus repository (tags v1.0.0 … v.1.1.2; same ids in all of them).

## Scope
- In: `companion-module-dev/companion-module-bosch-dicentis-main`: replace the 1.x code with the WO-119 module (ESM,
  src/), id / shortname / repository kept; upgrade script (config, actions, feedbacks); run-time resolution of 1.x seat /
  desk keys; 1.x variables; `custom_command` / `rest_request` kept; DICENTIS reads interpreter booths; HELP.md
  "Upgrading from 1.x"; tests; yarn.lock; package build.
- Out: publishing (push / tag / Bitfocus developer portal: the user's), a run inside a real Companion (needs an
  install), real hardware.

## Acceptance criteria
- [x] Upgrade script unit tests with configs / actions / feedbacks shaped as saved by 1.0.x and 1.1.x (websocket and
      rest), and idempotence (a v2 config is left alone).
- [x] 1.x seat keys (`Seat_1_John_Doe`, REST `Seat_1_Seat_1`, changed screen line) and desk keys (`1_2`) resolve; tested.
- [x] 1.x variables defined and filled; tested.
- [x] `npm test` (or `yarn test`) green, including the transports against LikeABosch's mocks.
- [x] `companion-module-build` packages the module without errors.

## Work log
- 2026-10-14 (Claude Opus): created as in-progress. Checked the upstream repository: local copy equals upstream main
  (code) apart from bot dependency bumps; only `bosch-dicentis` is published (ccs-1000, dcn, discussion-system,
  likeabosch are not). Wrote DEC-038.

- 2026-10-14 (Claude Opus): built. The module folder is now a git working copy of
  bitfocus/companion-module-bosch-dicentis (its `.git` copied from a fresh clone), branch `v2-all-systems`, nothing
  committed; upstream's newer `.github/`, `package.json` and `yarn.lock` restored first. 1.x root files (actions,
  config, feedbacks, variables, presets, upgrades .js) removed; WO-119's main.js, src/, test/, HELP.md, README copied
  in. Changes on top of WO-119: `src/upgrades.js` (script 0: config, actions, feedbacks), `findSeat` 1.x key fallback +
  `findDesk` (`src/model.js`), DICENTIS reads `GetInterpreterBooths` (+ `interpreterBoothsChanged`) so desks are
  "Booth N desk M" with booth / desk numbers, `custom_command` (DICENTIS) and `rest_request` (REST) with 1.x option ids,
  1.x variables (`legacyValues`, second LatestSpeaker over open microphones), HTTPS default port 443 (was 80, a WO-119
  bug), manifest 2.0.0 (id / shortname / repository kept), package.json on yarn 4 (`object-path` dropped, ws 8),
  `.gitignore` + `.yarnrc.yml` (node-modules linker), mock tests skip without LikeABosch, HELP.md "Upgrading from 1.x".
- Evidence: `npm test` 39/39 three runs in a row (new: test/upgrade.test.js 11 tests with 1.0.x / 1.1.x websocket /
  rest configs and buttons, plus a booth / desk-key test against the wired mock). Copy outside LikeABosch: 19/19, the
  4 mock suites skipped. `yarn package` → bosch-dicentis-2.0.0.tgz, built manifest id `bosch-dicentis`, shortname
  `dicentis`, apiVersion 1.12.1. The user's old `pkg/` and `pkg.tgz` (1.1.0 build outputs) moved to
  `companion-module-dev/_old-builds/` before building.

## Decisions
- DEC-038 (module id kept, upgrade script, run-time 1.x keys, 1.x variables).

## Handoff
- Delivered: `companion-module-dev/companion-module-bosch-dicentis-main` = bosch-dicentis 2.0.0 (uncommitted, branch
  `v2-all-systems` of the Bitfocus repository) and `bosch-dicentis-2.0.0.tgz`.
- Publishing is the user's: commit, push, tag `v2.0.0`, submit in the Bitfocus developer portal.
- Not run inside a real Companion yet: WO-123 (draft). Known behaviour changes are listed in DEC-038 / HELP.md.
- `companion-module-bosch-discussion-system` is the unpublished reference now (README note); change bosch-dicentis.
