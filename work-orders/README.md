# Work orders

Every piece of work in this project is a **work order** (WO): a small, self-contained,
documented task. The rules are in [/CLAUDE.md](../CLAUDE.md) ("Work orders: the rules"); the
template is [_TEMPLATE.md](_TEMPLATE.md).

## How to pick up work (fresh agent)

1. Read `CLAUDE.md`, `docs/decisions/README.md`, `docs/architecture.md`.
2. Find the lowest-numbered WO below with status `ready` whose dependencies are all `done`
   (or continue an `in-progress` one). A `draft` WO must be refined to `ready` first:
   concrete scope + acceptance criteria, and record that refinement in its work log.
3. Set it to `in-progress` here **and** in the WO header, then work, log and hand off.

Statuses: `draft` · `ready` · `in-progress` · `blocked` · `review` · `done` · `cancelled`

## Status board

| WO | Title | Phase | Status | Depends on | Updated |
|---|---|---|---|---|---|
| [WO-001](WO-001-project-setup-and-governance.md) | Project setup and governance | 0 | done | — | 2026-10-02 |
| [WO-002](WO-002-conference-protocol-fundamentals.md) | Conference Protocol fundamentals + PDF text/index | 1 | done | 001 | 2026-10-02 |
| [WO-003](WO-003-extract-conference-operations.md) | Extract 96 Conference Protocol operations to JSON | 1 | done | 002 | 2026-10-02 |
| [WO-004](WO-004-extract-conference-types.md) | Extract Conference Protocol types/enums to JSON | 1 | done | 002 | 2026-10-02 |
| [WO-005](WO-005-wireless-rest-reference.md) | Wireless REST API reference (swagger.yaml) | 1 | done | 001 | 2026-10-02 |
| [WO-006](WO-006-event-catalog.md) | Event catalog + event → refresh-operation map | 1 | done | 003 | 2026-10-02 |
| [WO-007](WO-007-spec-review-and-reference.md) | Spec review, normalization, generated reference | 1 | done | 003, 004 | 2026-10-02 |
| [WO-008](WO-008-backend-scaffold.md) | Backend scaffold | 2 | done | 001 | 2026-10-02 |
| [WO-009](WO-009-wired-protocol-client.md) | Wired protocol client (WebSocket) | 2 | done | 008, 003 | 2026-10-02 |
| [WO-010](WO-010-wired-mock-server.md) | Wired mock DICENTIS server | 2 | done | 003, 006 | 2026-10-02 |
| [WO-011](WO-011-wired-passthrough-endpoints.md) | Wired passthrough endpoints (one per operation) | 2 | done | 009, 010, 007 | 2026-10-02 |
| [WO-012](WO-012-wired-event-bridge-and-sse.md) | Wired event bridge, state cache, SSE | 2 | done | 009, 006, 010 | 2026-10-02 |
| [WO-013](WO-013-connection-management.md) | Connection management and settings | 2 | done | 009, 012 | 2026-10-02 |
| [WO-014](WO-014-wireless-client-and-mock.md) | Wireless REST client + mock server | 2 | done | 008, 005 | 2026-10-02 |
| [WO-015](WO-015-wireless-passthrough-and-poller.md) | Wireless passthrough endpoints + poller | 2 | done | 014, 012 | 2026-10-02 |
| [WO-016](WO-016-backend-api-docs-and-smoke-test.md) | Backend API docs + real-server smoke test | 2 | done | 011, 012, 013 | 2026-10-02 |
| [WO-017](WO-017-unified-domain-api.md) | Unified domain API (design DEC + impl.) | 2 | done | 011, 012, 015 | 2026-10-02 |
| [WO-018](WO-018-web-ui-shell.md) | Web UI shell, API client, live store | 3 | done | 013, 012 | 2026-10-02 |
| [WO-019](WO-019-web-ui-seats-and-discussion.md) | Synoptic seats and discussion control | 3 | done | 018 | 2026-10-02 |
| [WO-020](WO-020-web-ui-meetings-and-agenda.md) | Meetings and agenda | 3 | done | 018 | 2026-10-02 |
| [WO-021](WO-021-web-ui-voting.md) | Voting control and results | 3 | done | 018 | 2026-10-02 |
| [WO-022](WO-022-web-ui-participants.md) | Participants | 3 | done | 018 | 2026-10-02 |
| [WO-023](WO-023-web-ui-interpretation.md) | Interpretation | 3 | done | 018 | 2026-10-02 |
| [WO-024](WO-024-web-ui-system-controls.md) | System controls (power, volume, illumination, room, presentation) | 3 | done | 018 | 2026-10-02 |
| [WO-025](WO-025-web-ui-files-images-notes.md) | Files, images, layouts, notes | 3 | done | 018 | 2026-10-02 |
| [WO-026](WO-026-web-ui-plugins.md) | Plugins | 3 | draft | 018, 007 | 2026-10-02 |
| [WO-027](WO-027-web-ui-wireless-support.md) | Wireless support in the UI | 3 | done | 017, 019 | 2026-10-02 |
| [WO-030](WO-030-electron-launcher.md) | Electron launcher (setup, credentials, start server, launch GUI) | 3 | done | 008, 013 | 2026-10-02 |
| [WO-031](WO-031-dicentis-650-protocol-additions.md) | DICENTIS 6.50 protocol additions (18 undocumented ops) | 4 | done | 016 | 2026-10-03 |
| [WO-032](WO-032-end-to-end-real-server.md) | End-to-end test of the full API on the real server | 4 | done | 016, 031 | 2026-10-03 |
| [WO-028](WO-028-real-server-verification.md) | Real-server verification + spec corrections | 4 | in-progress | 016 | 2026-10-07 |
| [WO-029](WO-029-security-and-packaging.md) | UI auth, security, packaging | 4 | draft | 028 | 2026-10-02 |
| [WO-033](WO-033-ui-room-and-settings-structure.md) | UI structure: Room workspace + Settings area | 5 | done | 018 | 2026-10-03 |
| [WO-034](WO-034-room-layout-model-and-api.md) | Room layout model, persistence, API | 5 | done | 033 | 2026-10-03 |
| [WO-035](WO-035-room-view.md) | Room view: drag & drop top view, live mics, cameras | 5 | done | 034, 038 | 2026-10-03 |
| [WO-036](WO-036-camera-drivers.md) | PTZ drivers: VISCA, Panasonic AW, ONVIF + mocks | 5 | done | 001 | 2026-10-03 |
| [WO-037](WO-037-atem-switcher-driver.md) | Blackmagic ATEM driver + mock | 5 | done | 001 | 2026-10-03 |
| [WO-038](WO-038-device-manager-and-api.md) | Device manager: config, connections, API | 5 | done | 036, 037 | 2026-10-03 |
| [WO-039](WO-039-camera-director.md) | Camera director: seat → preset → switcher | 5 | done | 034, 038 | 2026-10-03 |
| [WO-040](WO-040-camera-settings-ui.md) | Settings UI: cameras, switcher, presets, automation | 5 | done | 038, 039, 033 | 2026-10-03 |
| [WO-041](WO-041-camera-hardware-verification.md) | Hardware verification: Avonic, ATEM, other PTZ | 5 | draft | 036, 037, 039 | 2026-10-03 |
| [WO-042](WO-042-room-workspace-resizable.md) | Room view: unbounded workspace, resizable room outline | 5 | done | 035 | 2026-10-03 |
| [WO-043](WO-043-product-name-likeabosch.md) | Product name "LikeABosch" in UI and launcher | 4 | done | 018, 030 | 2026-10-03 |
| [WO-044](WO-044-conference-protocol-7-0-chm.md) | Update spec from DICENTIS 7.0 Conference Protocol docs (CHM) | 4 | done | 031, 032 | 2026-10-03 |
| [WO-045](WO-045-ui-use-7-0-additions.md) | UI: use the 7.0 protocol additions (notes download, user names, multi-seat mic) | 3 | draft | 044 | 2026-10-03 |
| [WO-046](WO-046-meeting-area.md) | Meeting area: meeting, agenda, participants, seating (read-only) | 3 | done | 020, 022, 044 | 2026-10-03 |
| [WO-047](WO-047-room-seat-details.md) | Room: full details of the selected seat | 5 | done | 035, 044 | 2026-10-03 |
| [WO-048](WO-048-room-interpreter-desks.md) | Room: interpreter desks as special devices with quick controls | 5 | done | 035, 023 | 2026-10-03 |
| [WO-049](WO-049-settings-audio.md) | Settings → Audio (Conference Protocol scope) | 3 | done | 044 | 2026-10-03 |
| [WO-050](WO-050-windows-dcnm-sidecar.md) | Windows sidecar for the DCNM .NET API (meeting prep, DICENTIS audio/Dante) | 6 | cancelled (→ WO-077…082) | — | 2026-10-07 |
| [WO-051](WO-051-desk-quick-controls-on-plan.md) | Interpreter desk quick controls on the room plan | 5 | done | 048 | 2026-10-03 |
| [WO-052](WO-052-operate-mode-inspector-cogs.md) | Operate mode: inspector cog on every plan item | 5 | done | 047, 048, 051 | 2026-10-03 |
| [WO-053](WO-053-switcher-preview.md) | Switcher preview: inspector button + camera-cog-to-preview option | 5 | done | 037, 038, 052 | 2026-10-03 |
| [WO-054](WO-054-inspector-ptz-and-current-preset.md) | Camera inspector: small PTZ controller, presets, overwrite current preset | 5 | done | 038, 040, 052 | 2026-10-03 |
| [WO-055](WO-055-room-multi-select-and-arrange.md) | Room edit: box selection, group move, arrange seats in shapes | 5 | review | 035, 042 | 2026-10-05 |
| [WO-056](WO-056-device-automation-toggles-and-bulk-presets.md) | Automation on/off per camera + switcher; bulk seat presets | 5 | review | 038, 039, 040, 055 | 2026-10-05 |
| [WO-057](WO-057-projects-and-shared-data-folder.md) | Projects in the top bar + one shared data folder | 5 | review | 034, 038, 030, 056 | 2026-10-05 |
| [WO-058](WO-058-room-label-size.md) | Room plan: adjustable label size (− / +) | 5 | review | 035, 042 | 2026-10-05 |
| [WO-059](WO-059-dcn-swapi-reference.md) | DCN-SW API reference (CHM → JSON) | 1 | done | — | 2026-10-05 |
| [WO-060](WO-060-dcn-node-adapter-and-mock.md) | DCN Node adapter, bridge protocol, mock bridge | 2 | done | 059 | 2026-10-05 |
| [WO-061](WO-061-dcn-windows-bridge.md) | dcn-bridge: Windows .NET bridge for the DCN-SW API | 6 | review | 059, 060 | 2026-10-05 |
| [WO-062](WO-062-dcn-domain-mapping.md) | DCN in the domain layer | 2 | done | 060 | 2026-10-05 |
| [WO-063](WO-063-dcn-ui-support.md) | DCN in the UI and the launcher | 3 | done | 062 | 2026-10-05 |
| [WO-064](WO-064-dcn-rs232.md) | DCN with an RS-232 (first-gen) CCU: DCN-SW 3.10 via the bridge (DEC-028 proposed) | 2 | blocked (3.10 port from user) | 062 | 2026-10-08 |
| [WO-065](WO-065-dcn-real-system-verification.md) | DCN on a real system: stream + bridge verification | 4 | draft | 061, 062, 066, 068 | 2026-10-05 |
| [WO-066](WO-066-dcn-smd-backend.md) | DCN Streaming Meeting Data: reference, client, state, mock, domain | 2 | done | 062 | 2026-10-05 |
| [WO-067](WO-067-dcn-smd-ui.md) | DCN Streaming Meeting Data in the UI and the launcher | 3 | done | 066 | 2026-10-05 |
| [WO-068](WO-068-dcn-bridge-real-dlls.md) | dcn-bridge against the real DCN-SW DLLs (offline verification, remoting, real types) | 6 | done | 061 | 2026-10-05 |
| [WO-069](WO-069-dcn-bridge-dll-dir-and-port-on-system-switch.md) | dcn-bridge finds the DCN-SW folder; port follows a system switch in the launcher | 6 | review | 061, 063, 068 | 2026-10-05 |
| [WO-070](WO-070-dcn-bridge-token-optional.md) | dcn-bridge token optional (DEC-019) | 6 | done | 061, 063, 069 | 2026-10-05 |
| [WO-071](WO-071-room-shot-badge-rotation.md) | Room plan: preset badge visible on seats in any direction | 5 | done | 035, 052 | 2026-10-05 |
| [WO-072](WO-072-room-meeting-start-stop.md) | Start / stop the meeting from the Room top bar | 3 | done | 020, 035, 063 | 2026-10-07 |
| [WO-073](WO-073-dcn-bridge-plus-stream.md) | DCN: meeting data stream alongside the bridge (DEC-020) | 2 | done | 060, 066, 067, 069 | 2026-10-05 |
| [WO-074](WO-074-dcn-interpreter-desks-on-plan.md) | DCN interpreter desks on the room plan (live from the stream) | 5 | done | 048, 051, 073 | 2026-10-05 |
| [WO-075](WO-075-wireless-real-wap-e2e.md) | Wireless: full REST API verified on a real WAP (e2e:wireless) | 4 | done | 014, 015, 017, 027 | 2026-10-07 |
| [WO-076](WO-076-wireless-undocumented-endpoints.md) | Wireless: use the WAP's undocumented endpoints (discussion settings, volume, audio, cameras) | 2 | review | 075 | 2026-10-07 |
| [WO-077](WO-077-dcnm-api-reference.md) | DCNM (DICENTIS .NET) API reference (CHM → JSON) | 1 | done | — | 2026-10-07 |
| [WO-078](WO-078-dicentis-bridge.md) | dicentis-bridge: Windows .NET bridge for the DCNM API (+ shared bridge core) | 6 | review | 077, 061 | 2026-10-07 |
| [WO-079](WO-079-dcnm-node-adapter-and-mock.md) | DCNM Node adapter, mock bridge, second connection next to the Conference Protocol | 2 | done | 077, 078 | 2026-10-07 |
| [WO-080](WO-080-launcher-runs-bridges.md) | Launcher starts the Windows bridges as child processes (DEC-022) | 3 | review | 030, 078, 079, 069 | 2026-10-07 |
| [WO-081](WO-081-dcnm-in-domain-and-ui.md) | Use the DCNM API: DICENTIS audio & Dante (editing split to WO-106) | 3 | review | 079, 101 | 2026-10-08 |
| [WO-082](WO-082-dicentis-bridge-real-system.md) | dicentis-bridge on a real DICENTIS system (selftest, connect as device, e2e) | 4 | draft | 078, 079, 080 | 2026-10-07 |
| [WO-083](WO-083-room-seat-name-labels-no-overlap.md) | Room plan: participant names alternate top/bottom, never overlap | 5 | review | 035, 058 | 2026-10-07 |
| [WO-084](WO-084-room-edit-assign-participants.md) | Room edit: assign / create participants from the seat inspector (DEC-023) | 5 | review | 047, 027, 022 | 2026-10-07 |
| [WO-085](WO-085-participants-xlsx-import-export.md) | Participants and seating: Excel (XLSX) export and import (DEC-023) | 3 | review | 084 | 2026-10-07 |
| [WO-086](WO-086-wireless-discussion-settings.md) | Wireless: discussion settings (the WAP's "Prepare → Discussion") | 3 | review | 076 | 2026-10-07 |
| [WO-087](WO-087-wireless-audio-and-eq.md) | Wireless: audio settings, master volume and loudspeaker equaliser | 3 | review | 076 | 2026-10-07 |
| [WO-088](WO-088-wireless-seat-configuration.md) | Wireless: seat configuration (names, rights, selection/subscription mode, de-init, remove, range test) | 3 | review | 076 | 2026-10-07 |
| [WO-089](WO-089-wireless-seat-display-image.md) | Wireless: seat display image (logo upload), what the displays show, firmware upgrade status | 3 | review | 076 | 2026-10-07 |
| [WO-090](WO-090-atem-autodiscovery.md) | Blackmagic ATEM: find switchers on the network (autodiscovery) | 5 | review | 037, 040 | 2026-10-07 |
| [WO-091](WO-091-new-project-and-awareness.md) | Projects: start a new (empty) project, clear the room, clearer "which project is open" | 5 | review | 057 | 2026-10-07 |
| [WO-092](WO-092-clear-camera-presets.md) | Delete / clear saved camera presets (seat shots) | 5 | review | 039, 040, 056 | 2026-10-07 |
| [WO-093](WO-093-projects-follow-connected-system.md) | Projects follow the connected DICENTIS system (DEC-025) | 5 | review | 057, 091 | 2026-10-07 |
| [WO-094](WO-094-arrange-overflow.md) | Room edit: arrange more seats than the shape holds (overflow stays for later) | 5 | review | 055 | 2026-10-07 |
| [WO-095](WO-095-simulated-systems.md) | Simulated systems (no hardware): wired, wireless, DCN with any number of seats (DEC-026) | 5 | review | 093, 010, 014 | 2026-10-07 |
| [WO-096](WO-096-match-seats.md) | Match a project's seats to the connected system (simulated → real) | 5 | review | 095, 093 | 2026-10-07 |
| [WO-097](WO-097-test-distribution-build.md) | Test distribution build (macOS + Windows) | 4 | review | 030, 080, 095 | 2026-10-07 |
| [WO-098](WO-098-simulation-discoverable.md) | Simulation easy to find: launcher option + links in the web UI | 5 | review | 095, 030 | 2026-10-08 |
| [WO-099](WO-099-companion-triggers.md) | Bitfocus Companion: press buttons when a seat / interpreter desk is activated (DEC-027) | 5 | review | 038, 047, 048, 074, 096 | 2026-10-08 |
| [WO-100](WO-100-installers.md) | Installers: Windows setup (NSIS), macOS dmg, app icon | 4 | review | 097 | 2026-10-08 |
| [WO-101](WO-101-simulated-wired-full-api.md) | Simulated wired system includes the full DICENTIS API (linked mock dicentis-bridge, DEC-029) | 5 | review | 079, 095 | 2026-10-08 |
| [WO-102](WO-102-languages-add-and-assign.md) | Languages: add system languages, meeting languages, assign to interpreter desks | 3 | review | 101, 023, 048 | 2026-10-08 |
| [WO-103](WO-103-room-camera-aim-and-coverage.md) | Room plan: cameras turn toward the seat they show; seats tinted by their camera | 5 | review | 035, 039, 054, 071 | 2026-10-09 |
| [WO-104](WO-104-room-widgets.md) | Room widgets: voting, audio, presentation (DEC-030) | 3 | review | 021, 024, 049, 081 | 2026-10-08 |
| [WO-105](WO-105-presentation-into-dicentis.md) | Research: how a presentation gets into DICENTIS | 1 | done | — | 2026-10-08 |
| [WO-106](WO-106-dcnm-seat-assignment-and-prep-editing.md) | DCNM: seat assignment, participant and agenda editing on a wired system | 3 | draft | 101 | 2026-10-08 |
| [WO-107](WO-107-strip-bosch-text-and-release.md) | Ship specs without Bosch's text; fix ignore rules; release v0.1.0 | 4 | done | 097, 100 | 2026-10-09 |
| [WO-108](WO-108-director-faster-shots.md) | Director: faster preset recalls, immediate overview (DEC-031) | 5 | review | 039, 056 | 2026-10-10 |
| [WO-109](WO-109-web-ui-reconnects-to-backend.md) | Web UI reconnects to the backend by itself (no refresh needed) | 4 | done | 012, 018 | 2026-10-10 |
| [WO-110](WO-110-release-v0-1-1.md) | Release v0.1.1 (WO-108, WO-109) | 4 | done | 107, 108, 109 | 2026-10-10 |

## Suggested order / parallelism

- Phase 1 complete (WO-001…007). Wired backend complete (WO-008…013). Launcher (WO-030), UI shell (WO-018), views discussion/meetings/voting/participants/interpretation/system (WO-019…025) done.
- **Waiting on the user:** WO-016 real-server smoke test (`npm run smoke:wired`).
- Wireless backend (WO-014/015), domain layer (WO-017) and UI on both systems (WO-027) done.
- Real wired server (DICENTIS 6.50): read-only (WO-016) and full end-to-end incl. writes (WO-032) verified; 6.50 operations added (WO-031). Dev server has a **demo licence** (voting etc. blocked). **Wireless verified on a real WAP (WO-075, 2026-10-07):** 32/32 operations, `npm run e2e:wireless`; undocumented WAP endpoints → WO-076 (review, DEC-024) and the configuration views WO-086…089 (review; real WAP check pending).
- Room workspace + PTZ/ATEM camera automation (WO-033…040) done against simulated devices (2026-10-03). Resizable room workspace (WO-042) and the LikeABosch name (WO-043) done. Spec updated from the DICENTIS 7.0 CHM (WO-044, e2e on 6.50: 123/123 ops). Meeting area (WO-046), seat details (WO-047), interpreter desks (WO-048) and Settings → Audio (WO-049) done. WO-050 Windows sidecar (seat assignment editing, DICENTIS audio/Dante) **deferred by the user** (DEC-014). **Next:** WO-041 hardware verification (Avonic, ATEM) when available; WO-026 Plugins (use the plugin CHM); WO-029 security + packaging.
- **DCN (2026-10-05, DEC-017):** third system, DCN NG through the DCN-SW API (.NET Remoting) via a Windows bridge. WO-059, 060, 062, 063 done; WO-061 (bridge) in review: verified with `--fake` on .NET 10, the net48 exe with the real Bosch DLLs is untested. **User decision (DEC-018):** the main DCN connection is the read-only Streaming Meeting Data (`dcn-smd`, WO-066/067 done, no Windows component); the bridge stays as optional control mode. **Next for DCN:** WO-065 on a real system; RS-232 (WO-064) later.
- **DICENTIS full API (2026-10-07, DEC-021/022):** the DCNM .NET API through a Windows **dicentis-bridge** next to the
  Conference Protocol; the launcher starts the bridges on Windows. WO-077 → WO-078 → WO-079 → WO-080; features WO-081,
  real system WO-082.
- **2026-10-08 (next.md):** WO-098 simulation in the launcher + web UI links (review); WO-099 Bitfocus Companion
  triggers per seat / interpreter desk (DEC-027, review); WO-064 re-scoped to DCN-SW 3.10 with an RS-232 CCU
  (DEC-028 proposed), blocked on the 3.10 server port from the user.
- **2026-10-08 (user batch):** DICENTIS audio & Dante (WO-081, refined) and languages (WO-102) over the DCNM API via a
  backend feature layer (DEC-029), testable in a simulated wired system with the linked mock bridge (WO-101); camera aim
  + seat tint on the plan (WO-103); Room widgets voting/audio/presentation (WO-104, DEC-030); presentation research
  (WO-105). Order: 105, 103, 101, 081, 102, 104.
- **2026-10-10 (next.md):** faster camera shots + immediate overview (WO-108, DEC-031); web UI reconnects to the
  backend without a refresh (WO-109).
- Then WO-009 + WO-010 (client and mock together), then WO-011, WO-012, WO-013.
- WO-016 (smoke test on real hardware) as soon as WO-011 works, since it surfaces spec errors early.
- WO-030 (launcher) can start once WO-013 is done; it doesn't need the full UI.
- Phase 3 starts with WO-018 (includes a DEC on UI structure); WO-019 … WO-026 are mostly independent.
- Wireless (WO-014, WO-015, WO-017, WO-027) after the wired backend is stable (DEC-001).
