# WO-111: CCS 1000 D support (fourth system type, DEC-032)

| | |
|---|---|
| **Status** | review |
| **Phase** | 2 Backend |
| **Depends on** | WO-014, WO-015, WO-017, WO-027, WO-095 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-12 |
| **Updated** | 2026-10-12 |

## Goal
LikeABosch connects to a Bosch CCS 1000 D Digital Discussion System (CCSD-CU) over its RESTful API: seats, discussion
(speakers, request list, priority), power on/standby and microphone sensitivity, live on the room plan and in a
simulated CCS 1000 D, like the DICENTIS Wireless support.

## Context
- User request 2026-10-12 ("ive added docs on ccs-1000 discussion system. id like you to add support for it").
- Vendor material: `docs/research/ccs-1000/` (software/REST_API.html = Swagger 2.0, API v1.8, embedded like the WAP's;
  SynopticControl example; firmware image `CCSD-CU-upgrade` = zip with a UBI root file system).
- DEC-032 (this WO), DEC-024 (WAP undocumented endpoints), DEC-026 (simulation), WO-075 (real WAP behaviour).
- Diff of the two swaggers: see DEC-032 Context.

## Scope
- In:
  - `docs/protocol/ccs1000-rest/` swagger.yaml (verbatim) + swagger.json + README (our notes); gitignore rules;
    dist stripping (WO-107).
  - `ccs1000` system type: config, connection manager (WirelessClient with product name), poller topic list,
    passthrough `/api/ccs1000`, domain mappers + capabilities (`micSensitivity`), domain action dispatch.
  - Mock: `createMockWirelessServer({ variant: 'ccs1000' })` + `npm run mock:ccs1000`; simulator + launcher type.
  - UI: connection/system choice, simulation type, overview/system cards, Settings → Microphones (sensitivity per
    seat, reset all), hide WAP-only views via capabilities.
  - Tests against the mock (client, poller, passthrough, domain, simulation).
- Out: the CCSD-CU web UI's undocumented endpoints (firmware image research, follow-up WO); real-hardware check
  (follow-up WO, needs a CCSD-CU).

## Deliverables
docs/protocol/ccs1000-rest/*, backend/src/{config,connection,wireless,domain,simulation,projects}, mock/wireless/server.js,
web/js (connection, overview, system, router, views/ccs-microphones.js), launcher (settings), tests, architecture.md.

## Acceptance criteria
- [x] `npm test` passes, incl. new CCS tests (login, topics, discussion actions, mic sensitivity, 404 for participants).
- [x] Simulated CCS 1000 D connects; discussion live; Settings → Microphones changes a seat (ui:check scenarios).
- [x] `npm run ui:check` clean; screenshots looked at.
- [x] Wireless behaviour unchanged (`npm run e2e:wireless:mock` passes).
- [x] Bosch-derived files gitignored; `npm run dist` stripping includes the CCS spec (strip test).

## Work log
- 2026-10-12 (Claude Opus): created. Extracted both embedded swaggers and diffed them (see DEC-032). Synoptic example
  uses only documented paths (`login`, `seats`, `speakers`, `waiting-list`, `voting*`, `system-info`, `logout`).

- 2026-10-12 (Claude Opus): implemented.
  - Spec: `docs/protocol/ccs1000-rest/swagger.yaml` (verbatim) + `swagger.json` (PyYAML safe_load + json.dump: the same
    converter reproduces `wireless-rest/swagger.json` byte-for-value, checked), 16 paths / 22 operations / 7 definitions.
    Both gitignored, as is `docs/research/ccs-1000/` (Bosch material). README (our notes, tracked).
  - Backend: `SYSTEMS`/`DEFAULT_PORTS` + `ccs1000`; `WirelessClient` option `product`; poller `attach(client, topics)`;
    `CCS_TOPICS`; manager `ccs1000Client` (client tagged `system: 'ccs1000'`; `wirelessClient` now excludes it);
    `/api/ccs1000` = `createWirelessRouter({ spec: ccsSpec, product, uploads: false })`; domain `ccs1000` mappers
    (seats: `micMode`, no diagnostics; no voting / participants), FEATURES.ccs1000, new flags `micSensitivity`, `voting`,
    `participants`, new action `powerStandby` (the CCS has standby but no off, so standby can't hang on `powerOff`);
    `run()` dispatch with `ccs1000` override (`null` on voting, participants, import, power off).
  - Mock: `createMockWirelessServer({ variant: 'ccs1000' })`, `npm run mock:ccs1000` (port 8081). Simulator, launcher
    (system + simulation option), connection view (system + simulation types), system/overview cards ("Control unit").
  - UI: `views/ccs-microphones.js` (slider per seat, −6…+9 dB, values read 3 at a time on open, reset all);
    voting / participants / seating views gated by the new flags, so the Meeting tab disappears on a CCS.
  - ui:check: new `ccs1000` pass (routes overview, discussion, system, ccs-microphones, room, connection) with scenarios
    discussion (nav has no WAP-only views; add speaker / request) and ccs-microphones (slider → device value).
    First run showed no Standby button on System (bound to `powerOff`) → `powerStandby` action added; rerun OK,
    screenshots checked (light + dark).
  - Evidence: `npm test` 331/331; `node scripts/ui-check.mjs --system ccs1000` UI CHECK OK; `npm run e2e:wireless:mock`
    23/23, 32/32 operations; stripSpecs writes `ccs1000-rest/swagger.json` titled "CCS 1000 D REST API (interface only)".

## Decisions
- DEC-032 (system type on the wireless adapter).
- `powerStandby` as its own capability action (standby without off on a CCS 1000 D).
- Microphone sensitivity is not a polled topic: 22 per-seat GETs on every poll would load the device; the view reads
  them when opened and after a change.

## Handoff
- Delivered: CCS 1000 D as system `ccs1000` (connect, seats, discussion, priority, power on/standby, microphone
  sensitivity), simulation, launcher, UI, tests, ui:check pass.
- Not verified on a real CCSD-CU (no hardware). Assumed from the WAP (WO-075): login answer, long-poll hold, 409 on a
  second session. Follow-up: WO-113 (draft) real-hardware check; mining the firmware image's web UI endpoints is part
  of it if needed.
- `ui:check` positional arguments: the first one is the output directory (`node scripts/ui-check.mjs data/ui-check
  --system ccs1000 system`).
