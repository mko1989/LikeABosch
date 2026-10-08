# Architecture

Status: initial design (2026-10-02, WO-001); wired backend implemented through WO-013; DCN (third system) from WO-059 (DEC-017);
full DICENTIS DCNM API through the dicentis-bridge from WO-077 (DEC-021). Keep this file current: when a WO changes the
structure, update this file in the same WO and log it.

## Overview

```
 Browser (web/, plain HTML+JS)
    │  HTTP  /api/...         ▲ SSE /api/events
    ▼                         │
 ┌──────────────────────── backend (Node.js, Express) ──────────────────────────┐
 │  routes/                                                                       │
 │   ├─ /api/connection     connect / disconnect / status / settings             │
 │   ├─ /api/wired/ops/:Op  passthrough, 1 endpoint per Conference Protocol op   │
 │   ├─ /api/wireless/...   passthrough mirroring the Swagger paths              │
 │   ├─ /api/dcn/ops/:api/:method  passthrough, 1 endpoint per DCN-SW API method │
 │   ├─ /api/dcnm/ops/:api/:method passthrough to the DICENTIS DCNM API (bridge) │
 │   ├─ /api/<domain>       unified, system-independent API used by the UI       │
 │   └─ /api/events         SSE: { topic, data } state updates                   │
 │                                                                                 │
 │  domain/  ── maps unified calls to the active adapter, owns capability flags  │
 │  state/   ── in-memory cache per topic (seats, discussion, voting, …) + bus   │
 │                                                                                 │
 │  wired/ adapter                         wireless/ adapter                      │
 │   client.js  WSS, messageId matching,    client.js  HTTP + sid session,       │
 │              timeouts, reconnect, login             re-login on expiry          │
 │   events.js  RegisterEvents, event →     poller.js  long-poll / interval       │
 │              refetch Get op → cache                  refresh → cache            │
 │   spec.js    loads operations/*.json, validates params                         │
 └──────────────┬──────────────────────────────────────┬─────────────────────────┘
                │ wss://host:31416/Dicentis/API         │ http://host/api
                ▼  (subprotocol DICENTIS_1_0)           ▼
        DICENTIS server (wired)                 DICENTIS Wireless WAP
        or mock/wired (tests)                   or mock/wireless (tests)
```

Key decisions: [DEC-001](decisions/DEC-001-target-systems.md) (both systems, wired first),
[DEC-002](decisions/DEC-002-tech-stack.md) (stack), [DEC-003](decisions/DEC-003-protocol-spec-as-json.md)
(spec JSON), [DEC-004](decisions/DEC-004-backend-api-shape.md) (API shape & envelope),
[DEC-005](decisions/DEC-005-events-and-state-cache.md) (single session, cache, SSE),
[DEC-006](decisions/DEC-006-testing-mock-and-real.md) (mocks + real hardware).

## Directory map (target)

```
package.json              single root package (scripts: start, dev, test, mock:wired, mock:wireless)
.env.example              DICENTIS_* settings template (real .env is gitignored)
backend/
  src/
    server.js             entry: config, express app, static web/, route mounting, shutdown
    config.js             env + data/settings.json
    lib/                  logger, errors (envelope + codes), sse hub, event bus, bridge-socket (NDJSON bridge transport), xlsx (own XLSX/CSV reader+writer, DEC-023)
    wired/                client.js, spec.js (shared with mock), routes.js, events.js (event bridge)
    wireless/             client.js, routes.js, poller.js; spec.js loads swagger.json + undocumented.json (WAP web UI endpoints, DEC-024)
    dcn-smd/              DCN Streaming Meeting Data (DEC-018): xml.js, frames.js, client.js, state.js (activities → state), sync.js (→ smd* topics, persisted), routes.js
    dcn/                  client.js (dcn-bridge TCP/NDJSON), spec.js, topics.js, events.js (event → refetch → dcn* topics), routes.js (DEC-017)
    dcnm/                 DICENTIS DCNM API via the dicentis-bridge (DEC-021): client.js, spec.js, mirror.js (event → dcnm.<Api>.<Event> topics, sweep), routes.js
    dicentis/             DICENTIS-only features over the DCNM API (DEC-029): service.js (dicentis.* topics), audio.js (WO-081), languages.js (WO-102), routes.js (/api/dicentis/*)
    connection/           manager.js (settings precedence env > file, active client), routes.js
    state/                cache.js (topics + unavailable reasons; LikeABosch's own topics survive a disconnect), routes.js (/api/events SSE, /api/state)
    domain/               unified API (WO-017); participant editing + Excel import/export (participants-io.js, DEC-023)
    devices/              cameras/ (visca, panasonic, onvif, mock), switchers/ (atem, mock), discovery/mdns.js (ATEM autodiscovery, WO-090), manager.js, routes.js (DEC-012)
    simulation/           simulator.js: simulated systems = the mocks started in-process (DEC-026, WO-095); the launcher can start one (LIKEABOSCH_SIMULATE, WO-098)
    companion/            Bitfocus Companion (DEC-027, WO-099): client.js (HTTP remote control), service.js (mic on/off edges → button presses), routes.js
    room/                 room layout store + API (outline, floor plan, seat/camera/interpreter-desk placements, shots, director settings)
    director/             decide.js (pure rules) + director.js (executor) + routes.js: mic → preset → ATEM cut
  test/                   node:test suites (unit + against mocks)
mock/
  wired/                  WSS mock server (self-signed cert), behaviours/ per area
  wireless/               HTTP mock server
  dcn/                    mock dcn-bridge (bridge protocol) + simulated DCN-SW server
  dcn-smd/                mock DCN-SW server Streaming Meeting Data (queue + replay, AllowedClients)
  dcnm/                   mock dicentis-bridge (bridge protocol, spec-driven DCNM API); behaviours.js = stateful audio, seats, languages,
                          desks, presentation (WO-101); wired-link.js = the same DICENTIS "database" as a wired mock (simulation, DEC-029 §4)
  companion/              mock Bitfocus Companion HTTP API (+ /tablet page with the same geometry)
  cameras/                VISCA (UDP/TCP, Sony/raw), Panasonic AW HTTP, ONVIF SOAP protocol mocks
web/
  index.html, css/app.css app shell + design tokens
  js/                     main, api, store(+store-core), router (areas Room / Meeting / Settings, DEC-014), dom (DEC-009),
                          interp.js (interpreter desk semantics), arrange.js (seat shapes, WO-055), labels.js (name layout on the plan, WO-083),
                          participants-io.js (Excel import/export dialog, WO-085), wap.js (wireless config helpers),
                          companion.js (inspector section + button picker, WO-099), camera-aim.js (camera turn + colours, WO-103),
                          voting-controls.js, dicentis-audio.js / dicentis-languages.js (DEC-029 UI), widgets/ (Room widget dock, DEC-030); views/<name>.js
                          (views/wap-*.js: DICENTIS Wireless configuration via the WAP web UI API, WO-086…089)
                          (views/dcn.js: Settings → DCN, WO-063)
  test/                   node:test for pure modules
launcher/                 Electron launcher (DEC-008), own package.json; build/icon.svg + icon.png = app icon for the installers (WO-100)
bridge/common/            transport (TCP/NDJSON server), JSON, value conversion shared by both bridges (DEC-021)
bridge/dcn/               dcn-bridge: Windows .NET 4.8 host for the DCN-SW API DLLs, reflection dispatch (DEC-017, WO-061)
bridge/dicentis/          dicentis-bridge: Windows .NET 4.8 host for the DICENTIS DCNM API DLLs (DEC-021, WO-078)
docs/, work-orders/, scripts/   see CLAUDE.md
data/                     dev outputs: reports, ui-check screenshots (gitignored). Runtime data lives in the per-user
                          folder (DEC-016): settings.json, project.json, projects/<id>/{room,devices}.json + floor plan
```

## Request flow (wired passthrough)

1. `POST /api/wired/ops/SetMasterVolume { "volume": 10 }`
2. `spec.js` checks the operation exists and that every body field is declared in the spec request (else 400 `VALIDATION`).
3. `client.js` sends `{ messageId: n, operation, parameters }` and awaits the response with matching `messageId` (timeout → 504).
4. `operation === "error"` → 502 `UPSTREAM_ERROR` with the server message; otherwise `200 { ok: true, data: parameters }`.

## Event flow (wired)

`event { events: ["votingStateChanged"] }` → `events.js` looks up the topic for that event
→ calls `GetVotingState` (re-arms the event) → `state/cache` updates `votingState` → SSE
broadcasts `{ topic: "votingState", data }`. The event → Get-operation table is produced in WO-006.

## Camera automation flow (DEC-012)
`domain.discussion` (mic on/off) → `director` (last activated / priority → seat shot or overview; strategy safe/live;
delay, minimum shot, travel time) → `devices` (camera driver `recallPreset`, then switcher `programCut`) → topics
`devices.*` / `director` → Room view (tally, current shot). Configuration: `data/devices.json`, `data/room.json`.

## Companion triggers (DEC-027)
`domain.discussion` (seat mic on/off) + `interpretationRoutings` / `domain.interpreterDesks` (desks) → `CompanionService`
(edges only; the first state after a (re)connect is the baseline) → `room.triggers.{seats,desks}[id].{on,off}` →
`POST http://<companion>/api/location/<page>/<row>/<column>/<press|down|up>` in order. Target in the project's
`devices.json` (`companion`), status + log as topic `devices.companion`. The picker frames Companion's `/tablet` page
(CSP `frame-src http: https:`) under a click grid.

## DCN (DEC-017)
```
LikeABosch backend ──TCP :9480 NDJSON (BRIDGE.md)──▶ dcn-bridge.exe (Windows, next to DCN-SW) ──.NET Remoting :9461──▶ DCN-SW server ──▶ DCN NG CCU
```
`DcnClient` (state `loggedIn` = bridge up + ControlApi initialized + DCN-SW available) → `DcnEventBridge` (initial sync in
two stages; events → refetch; voting state and vote results from events) → `dcn*` topics. The bridge is generic
(reflection over the Bosch DLLs, driven by `docs/protocol/dcn-swapi/api.json`); DCN semantics live in Node.

## DCN Streaming Meeting Data (DEC-018, main DCN connection)
```
LikeABosch backend ──TCP :20000 (frames: Int32 topic, Int32 length, XML)──  DCN-SW server (Windows, at the CCU)
```
One-way and unauthenticated. `DcnSmdClient` → `FrameDecoder` → `parseXml` → `SmdState.apply` (meeting, discussion
lists, seats, voting, …) → `DcnSmdSync` → `smd*` topics (+ `<dataDir>/dcn-smd-state.json`) → `dcn-smd` domain mappers
(read-only). The DCN-SW API bridge (`dcn`) remains as optional control mode.

With `system: "dcn"` both run together (DEC-020): the bridge is the main connection (control, `dcn*` topics) and the
manager also opens a `DcnSmdClient` (`streamClient`, settings `smdStream`/`smdHost`/`smdPort`) into the same
`DcnSmdSync`, so `smd*` topics (live interpreter desks, WO-074) are there too. Stream failures only show in
`/api/connection` `stream`; they never affect the bridge.

## Full DICENTIS API: dicentis-bridge next to the Conference Protocol (DEC-021, DEC-022)
```
LikeABosch backend ──wss :31416 (Conference Protocol)──────────────────────────────▶ DICENTIS server
        └──────────TCP 127.0.0.1:9481 NDJSON (dcnm-api/BRIDGE.md)──▶ dicentis-bridge.exe ──DCNM .NET API──┘
                                                                      (Windows, DICENTIS software installed;
                                                                       started by the launcher, DEC-022)
```
With `system: "wired"` and `dcnmBridge` on, the connection manager opens a `DcnmClient` next to the `WiredClient`
(like the DCN stream, DEC-020: secondary, its failure never touches the main connection). The bridge discovers the API
by reflection (39 interfaces), runs open → authenticate → connect-as-device, awaits each call's `Task`, and pushes every
event. `DcnmMirror` keeps the last payload of every event as topic `dcnm.<Api>.<Event>` and, after each login, calls all
parameterless `Request…Async` once so those topics fill. `/api/dcnm/*` is the passthrough.

On top, the **DICENTIS feature layer** (`backend/src/dicentis/`, DEC-029) follows the manager's `dcnmClient`, fetches what
the features need (areas, active meeting, room audio, seats, languages, meeting languages, desks), keeps normalised
`dicentis.*` topics current from the API's events and runs validated actions (`POST /api/dicentis/<area>/<action>`,
building the DCNM data classes read-modify-write). `domain.capabilities.dicentis = { audio, languages }` tells the UI
what to show (Settings → Audio, Settings → Interpretation → Languages setup, Room audio widget). A simulated wired
system starts the linked mock bridge (WO-101), so all of this works without Windows.
