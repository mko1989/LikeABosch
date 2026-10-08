# WO-101: Simulated wired system includes the full DICENTIS API (linked mock dicentis-bridge)

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-079, WO-095 |
| **Assignee** | Claude Opus (main) + Haiku subagent (mock behaviours) |
| **Created** | 2026-10-08 |
| **Updated** | 2026-10-08 |

## Goal
User (2026-10-08): "im trying a simulated wired dicentis with the additional api ticked" — and nothing from the full API
showed up, because `startSimulator` forces `dcnmBridge: false`. A simulated wired system now also runs the mock
dicentis-bridge, linked to the Conference Protocol mock, with enough state for audio/Dante (WO-081) and languages (WO-102).

## Context
DEC-029 §4, DEC-026, DEC-021. `backend/src/simulation/simulator.js`, `mock/dcnm/server.js`, `mock/wired/server.js`
(returns `state` + `fire`), `mock/wired/behaviours/interpretation.js`, `docs/protocol/dcnm-api/{api,types}.json`.

## Scope
- In:
  - Simulator: wired profile starts `createMockDcnmBridge` too (unless `profile.fullApi === false`), settings
    `dcnmBridge: true, dcnmHost: 127.0.0.1, dcnmPort, dcnmDevice: 'LikeABosch'`; close both. Profile field `fullApi`
    (bool, optional) validated; Settings → Connection → Simulation: checkbox "Full DICENTIS API (simulated
    dicentis-bridge)" for wired profiles; connection status line shows the dicentis-bridge state.
  - Mock dcnm stateful behaviours (`mock/dcnm/behaviours.js`, pure state + handlers): room audio (gains with ranges,
    mute, test tone; equaliser 2 × 5 bands; audio selection settings; `RequestAudioSettingsAsync` →
    `AudioSettingsChanged`; `Adjust…Async` update + event; VU meters while requested, ~5 Hz random walk, stop on cancel),
    `SystemAudioControlApi` gains, ConfigSite areas, ConfigArea seats (DanteOut, Headroom; Get/Update + `SeatsUpdated`),
    ConfigLanguage (default ~12 languages, CRUD + events), ConfigInterpretation (meeting languages CRUD/order + events,
    desks Retrieve/Update + `MeetingDeskInfoChanged`, interpretation settings, Dante licences), ControlMeeting
    active meeting status, ControlPresentationApi (state + event), capabilities `Can…` true after login.
  - `mock/dcnm/wired-link.js`: built from the wired mock's state: seat ids/names → DCNM seats; the wired active meeting
    id; DCNM meeting languages ↔ wired `interpretation.languages` (create/delete/order changes rewrite the wired list and
    fire `interpretationLanguagesChanged`); DCNM desk outputs ↔ wired interpreter seats' a/b/c languages and lists
    (fire the desk event); presentation ↔ wired `presentationState` both ways.
- Out: UI for the features (WO-081, WO-102); real-system verification (WO-082).

## Acceptance criteria
- [x] `backend/test/simulation.test.js`: a wired simulation reports `status().dcnm.state === 'loggedIn'`; with
  `fullApi: false` there is no dcnm client.
- [x] `mock/dcnm` behaviour tests (`backend/test/dcnm-sim.test.js`): audio settings round trip, VU readings start/stop,
  language create → wired `GetInterpretationLanguages` lists it, desk output change → wired interpreter seat changes,
  presentation toggled via DCNM is seen by the wired mock.
- [x] `npm test` passes; `npm run e2e:mock` passes (see log).

## Work log
- 2026-10-08 (Claude Opus): created (ready) from the user's request; see DEC-029.
- 2026-10-08 (Haiku subagent, reviewed by Claude Opus): `mock/dcnm/behaviours.js` (pure world + handlers for room audio,
  VU, system gains, areas, seats, languages, meeting languages, desks, interpretation settings, active meeting,
  presentation; BAD_ARGS validation; onChange listeners) + `backend/test/dcnm-behaviours.test.js` 17/17. Reviewed the
  handlers and parameter names against api.json; accepted as is. Its notes: single-meeting world, desk B/C sets fixed
  at creation (writable through UpdateMeetingDeskInfo), interpretation-settings changes notify kind `desks`.
- 2026-10-08 (Claude Opus): `mock/dcnm/server.js` takes `world` (handled calls win once authenticated; VU timer while
  requested; `IsPresentationActive` follows); `npm run mock:dcnm` starts with a world. `mock/dcnm/wired-link.js`
  (`createLinkedDcnmBridge(wiredMock)`): seats, interpreter desks, active meeting, wired language ids, desk outputs from
  the wired mock; DCNM meeting-language / desk changes rewrite the wired interpretation state + fire its events;
  presentation both ways (setter on the wired state). Needed `ensure()` exported from
  `mock/wired/behaviours/interpretation.js` (the wired mock creates that state lazily) — first test run failed on it.
  Simulator: wired starts the linked bridge unless `fullApi === false` (validated), settings `dcnmBridge` + port;
  launcher simulation keeps `fullApi: false` if set. Settings → Connection: "Full DICENTIS API" checkbox, "+ full API"
  in the list, dicentis-bridge line in the status card. Tests: `backend/test/dcnm-sim.test.js` 4/4 (two test-side fixes:
  error text regex; a late event from the previous step), `simulation.test.js` 3/3 (new: dcnm logged in; no bridge with
  `fullApi: false`). `scripts/ui-check.mjs` now runs the linked bridge next to the wired mock (all wired UI checks have
  the full API). A first combined run hung because the failing before-hook left servers open; killed, fixed by the
  `ensure()` change.
- 2026-10-08 (Claude Opus): `npm run e2e:mock` and `npm run e2e:wireless:mock` both exit 0 after the mock changes.
- 2026-10-08 (Claude Opus): with the bridge in the ui-check backend, a full run once hit a race in the room scenario
  (seat-3 drag queried the node in a second script after waiting for it: `getBoundingClientRect` of null after a plan
  re-render). Made it one retried step like the other drag helpers. Full `node scripts/ui-check.mjs` then OK (54
  scenarios, all systems).

## Decisions
- `fullApi` absent = on: existing simulated wired profiles get the full API without editing them.

## Handoff
- Simulated wired systems include the full API by default. Real bridge payload casing/enum serialisation is assumed
  to match the docs (types.json); WO-082 verifies it on a real system.
