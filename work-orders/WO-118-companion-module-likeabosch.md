# WO-118: Companion module `likeabosch` (DEC-036)

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-117 |
| **Assignee** | Claude Opus (main), Haiku subagents (boilerplate) |
| **Created** | 2026-10-12 |
| **Updated** | 2026-10-12 |

## Goal
A Bitfocus Companion module that controls LikeABosch: seat microphones / requests / priority / all off / next, with
live feedback (SSE), variables and presets; plus raw calls into LikeABosch's bridge APIs (DCNM, DCN) and the camera
director, so everything LikeABosch reaches (including through the Windows bridges) is available on a button.

## Scope
- In: `companion-module-dev/companion-module-likeabosch/` (main.js, src/, companion/manifest.json, HELP.md, presets,
  tests with node:test against a LikeABosch backend + mocks).
- Out: publishing to the Companion module store.

## Acceptance criteria
- [x] Client + model tested against a running LikeABosch backend (simulated wired system with the full API): actions, SSE state, errors, reconnect.
- [x] Module builds with Companion's tool (`npx companion-module-build` → likeabosch-1.0.0.tgz); main.js syntax checked. Constructing the instance needs Companion's IPC host: not done.
- [x] HELP.md explains setup (LikeABosch address, port, LAN access).

## Work log
- 2026-10-12 (Claude Opus): created as ready.

- 2026-10-12 (Claude Opus): built `companion-module-dev/companion-module-likeabosch`: `src/client.js` (quick state +
  SSE `/api/quick/events` via fetch stream, reconnect with backoff, `request()` for any endpoint), actions (seat mic /
  request / priority, next, all off, clear, camera shot / overview, camera automation, DICENTIS API via the dicentis-bridge,
  DCN-SW API via the dcn-bridge, any API request with variables), feedbacks, variables, presets, main.js (status: warning
  while LikeABosch runs but is not connected to the Bosch system).
- Test `test/client.test.js` (7) starts a real LikeABosch backend with a simulated wired DICENTIS (+ linked dicentis-bridge
  mock): SSE state, toggles by id / name / number, feedbacks, variables, LikeABosch's error message logged, director,
  DICENTIS API passthrough (ok + error), definitions, reconnect. 7/7.
- Haiku subagent (reviewed): companion/manifest.json, companion/HELP.md, README.md. LICENSE added; package builds.

## Handoff
- Delivered: the likeabosch Companion module (works with every system LikeABosch connects to, incl. the bridges).
- Not tested inside a real Companion; DCN-SW passthrough action not covered by a test (DCN mock not started in the test).
