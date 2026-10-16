# Decision log

Architecture Decision Records. Read all **accepted** ones before starting work.
Rules: see "Decisions (ADRs)" in [/CLAUDE.md](../../CLAUDE.md).

| ID | Title | Status |
|---|---|---|
| [DEC-001](DEC-001-target-systems.md) | Support both DICENTIS systems, wired first | accepted (user) |
| [DEC-002](DEC-002-tech-stack.md) | Node.js + plain JS, Express 5, ws, SSE, node:test, no UI framework | accepted (user + Claude) |
| [DEC-003](DEC-003-protocol-spec-as-json.md) | Protocol spec extracted once into machine-readable JSON | accepted |
| [DEC-004](DEC-004-backend-api-shape.md) | Backend API: per-operation passthrough + domain layer, response envelope | accepted |
| [DEC-005](DEC-005-events-and-state-cache.md) | One upstream session, backend state cache, SSE to browsers | accepted |
| [DEC-006](DEC-006-testing-mock-and-real.md) | Mocks for automated tests, real hardware for manual checks | accepted (user) |
| [DEC-007](DEC-007-excluded-operations.md) | Exclude 4 undocumented wired operations | accepted (user) |
| [DEC-008](DEC-008-electron-launcher.md) | Electron launcher (own package.json, safeStorage creds, spawns backend) | accepted (user + Claude) |
| [DEC-009](DEC-009-web-ui-structure.md) | Web UI structure without a framework (views, store, h(), no innerHTML) | accepted |
| [DEC-010](DEC-010-domain-layer.md) | Unified domain layer: `domain.*` topics, `/api/domain` actions, capabilities | accepted |
| [DEC-011](DEC-011-room-workspace-and-settings.md) | Room top view as main workspace; existing views under Settings; Launch GUI → system browser | accepted (user); navigation partly superseded by DEC-014 |
| [DEC-012](DEC-012-camera-control-architecture.md) | PTZ camera + ATEM control, camera director rules, atem-connection dependency | accepted (user + Claude) |
| [DEC-013](DEC-013-name-and-newer-vendor-docs.md) | Product name LikeABosch; 7.0 CHM docs rank below real-server behaviour, above the PDF; .NET DCNM API out of scope | accepted (user + Claude); §3 superseded by DEC-021 |
| [DEC-014](DEC-014-meeting-area-and-windows-api-deferral.md) | Meeting area tab; meeting prep read-only; DICENTIS audio/Dante settings deferred to a Windows sidecar | accepted (user); deferral (§2–3) superseded by DEC-021 |
| [DEC-015](DEC-015-per-device-automation.md) | Per-device automation switches for cameras and the video switcher (extends DEC-012 §4) | accepted (user + Claude) |
| [DEC-016](DEC-016-projects-and-data-folder.md) | Projects (room + cameras, auto-save, file format) and one shared per-user data folder | accepted (user + Claude) |
| [DEC-017](DEC-017-dcn-support-via-windows-bridge.md) | DCN NG via the DCN-SW API: Windows reflection bridge (NDJSON/TCP), `dcn` adapter + mock; RS-232 later | accepted (user scope + Claude); primary path superseded by DEC-018; token requirement superseded by DEC-019 |
| [DEC-018](DEC-018-dcn-streaming-meeting-data.md) | DCN via Streaming Meeting Data (DCN-SWSMD): `dcn-smd`, read-only TCP stream from the DCN-SW server, no Windows component | accepted (user) |
| [DEC-019](DEC-019-dcn-bridge-token-optional.md) | dcn-bridge token optional, off by default (internal use) | accepted (user) |
| [DEC-020](DEC-020-dcn-bridge-plus-stream.md) | DCN: bridge (control) + meeting data stream (live data) at the same time | accepted (user + Claude) |
| [DEC-021](DEC-021-dicentis-dcnm-api-bridge.md) | Full DICENTIS (DCNM .NET) API through a Windows dicentis-bridge, shared bridge core, second connection next to the Conference Protocol | accepted (user request + Claude) |
| [DEC-022](DEC-022-launcher-runs-bridges.md) | The launcher runs the Windows bridges as child processes when needed (Windows only) | accepted (user request + Claude) |
| [DEC-023](DEC-023-participant-editing-and-xlsx.md) | Participant editing as domain actions (create, edit, assign seat); XLSX import/export with our own reader/writer | accepted (user request + Claude) |
| [DEC-024](DEC-024-wap-undocumented-endpoints.md) | WAP undocumented endpoints (discussion, audio/EQ, seat config, display image upload) as a curated second spec file; secrets never exposed | accepted (user request + Claude) |
| [DEC-025](DEC-025-projects-follow-connected-system.md) | A project belongs to a DICENTIS system; connecting to another system opens (or creates) its project | accepted (user request + Claude) |
| [DEC-026](DEC-026-simulated-systems.md) | Simulated systems (the mocks) inside LikeABosch; projects carry seat names; "Match seats" maps a project to the connected system | accepted (user request + Claude) |
| [DEC-027](DEC-027-companion-triggers.md) | Bitfocus Companion buttons pressed when seats / interpreter desks are activated or deactivated; picker frames Companion's web buttons | accepted (user request + Claude) |
| [DEC-028](DEC-028-dcn-rs232-via-dcn-sw.md) | DCN with an RS-232 CCU = DCN-SW 3.x through the existing bridge path, version choice sets the port (supersedes DEC-017 §1 when accepted) | proposed |
| [DEC-029](DEC-029-dicentis-features-over-dcnm.md) | DICENTIS-only features (audio/Dante, languages) as a backend feature layer over the DCNM API (`dicentis.*` topics, `/api/dicentis/*` actions); simulated wired systems include the full API (linked mocks) | accepted (user request + Claude) |
| [DEC-030](DEC-030-room-widgets.md) | Room widgets (voting, audio, presentation) in the operate-mode side panel | accepted (user request + Claude); §1 superseded by DEC-039 |
| [DEC-031](DEC-031-director-fast-overview-and-preposition.md) | Director timing: immediate overview, pre-positioning off-air cameras, travel wait capped by `settleMs`, default delay 250 ms (extends DEC-012 §4) | accepted (user report + Claude) |
| [DEC-032](DEC-032-ccs1000-on-the-wireless-adapter.md) | CCS 1000 D as a fourth system type (`ccs1000`) on the wireless REST adapter: own spec, topic list, mappers; mic sensitivity | accepted (user request + Claude) |
| [DEC-033](DEC-033-kramer-and-tvone-switchers.md) | Kramer MV-6 (Protocol 3000) and tvONE CORIO (CORIOmaster API) switcher drivers, no new dependency (extends DEC-012) | accepted (user request + Claude) |
| [DEC-034](DEC-034-wired-participant-editing-over-dcnm.md) | Wired participant editing (active meeting) through the DCNM API: person + registration + seat; Group / Affiliation import column; constructor-exact payloads | accepted (user report + Claude) |
| [DEC-035](DEC-035-quick-actions-api.md) | Quick-actions API for Bitfocus Companion (`/api/quick`): seat mic / request / priority on-off-toggle, compact state + SSE | accepted (user request + Claude) |
| [DEC-036](DEC-036-companion-modules.md) | Two Companion modules: `bosch-discussion-system` (direct, network APIs only, actions per system) and `likeabosch` (quick API + bridges via LikeABosch) | accepted (user request + Claude); points 1 and 4 superseded by DEC-038 |
| [DEC-037](DEC-037-auto-start-bridges.md) | The launcher starts a bridge by itself on Windows when the Bosch DLLs are installed (`autoBridges`) | accepted (user request + Claude) |
| [DEC-038](DEC-038-bosch-dicentis-module-v2.md) | The all-systems Companion module ships as v2 of the published `bosch-dicentis` (id kept, upgrade script, 1.x keys and variables kept); supersedes DEC-036 points 1 and 4 | accepted (decided by user + Claude) |
| [DEC-039](DEC-039-room-widgets-float-on-plan.md) | Room widgets float on the plan, added by the operator (per-browser placement); PTZ widget; supersedes DEC-030 §1 | accepted (user request + Claude) |
