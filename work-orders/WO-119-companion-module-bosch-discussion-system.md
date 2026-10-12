# WO-119: Companion module `bosch-discussion-system`: all Bosch systems, network APIs only (DEC-036)

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-111, WO-075, WO-032, WO-066 |
| **Assignee** | Claude Opus (main), Haiku subagents (boilerplate) |
| **Created** | 2026-10-12 |
| **Updated** | 2026-10-12 |

## Goal
One Companion module for DICENTIS (Conference Protocol), DICENTIS Wireless, CCS 1000 D (REST) and DCN NG meeting data
(read-only stream), talking to the system directly. The actions follow the system chosen in the module configuration.
Built on what LikeABosch learned (events instead of polling, WAP session rules, long-poll).

## Context
User request 2026-10-12 (next.md). The user's modules in `companion-module-dev/` (bosch-dicentis, bosch-ccs-1000,
bosch-dcn) are the starting point; DEC-036.

## Scope
- In: `companion-module-dev/companion-module-bosch-discussion-system/`: transports (src/systems/*), common model,
  actions / feedbacks / variables / presets per system, manifest, HELP.md, tests against LikeABosch's mocks.
- Out: DCN control through the bridge (that is the likeabosch module); publishing.

## Acceptance criteria
- [x] Each transport tested against its LikeABosch mock: connect, seats, live speakers / requests, actions, re-login.
- [x] Action list per system (unit test of the capability table).
- [x] HELP.md per system (what is needed on the system: user rights, ports).

## Work log
- 2026-10-12 (Claude Opus): created as ready.
- 2026-10-12 (Claude Opus): built. Read the user's three modules (bosch-dicentis: WebSocket + REST mode, polls
  GetDiscussionList every 100 ms; bosch-ccs-1000: got, polling; bosch-dcn: C# bridge). New module (ESM, as Companion's
  JS template): `src/systems/{base,dicentis,rest,dcn-smd}.js` (no Companion dependency), `src/systems/smd/*` copied
  from LikeABosch, `src/capabilities.js` (actions per system), `src/{model,config,actions,feedbacks,variables}.js`, main.js.
- Tests (`npm test`): `test/systems.test.js` against LikeABosch's mocks (wired, wireless, ccs1000 variant, dcn-smd) and
  `test/companion.test.js` (definitions per system, action logic with a fake system). Found while testing: the server
  sends event names in PascalCase ("DiscussionListChanged", as real 6.50 does) → matched case-insensitively; SmdState.apply
  returns a Set (my `.length` check never published) → fixed; an empty mode list crashed the action builder → fixed;
  two test expectations of mine were wrong (the server promotes a waiting seat when speakers leave).
- Haiku subagent (reviewed): src/presets.js, companion/manifest.json, companion/HELP.md, README.md. Review: presets
  only use offered actions (validator per system); HELP.md said "one long-poll" → corrected (one per live resource).
- Packaging: `npx companion-module-build` → bosch-discussion-system-1.0.0.tgz (LICENSE added after its warning).
- Evidence: `npm test` 28/28, three runs in a row.

## Handoff
- Delivered: `companion-module-dev/companion-module-bosch-discussion-system` for DICENTIS, DICENTIS Wireless, CCS 1000 D
  and DCN NG meeting data, actions per configured system, feedbacks, variables, presets, help.
- Not tested inside a real Companion (no install here) nor on real hardware; the transports are tested against the mocks.
- The user's old modules are unchanged and not tracked (vendor PDFs inside).
