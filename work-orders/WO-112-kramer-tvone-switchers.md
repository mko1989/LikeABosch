# WO-112: Video switchers Kramer MV-6 and tvONE CORIOmaster/CORIOmatrix (DEC-033)

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-037, WO-038, WO-040 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-12 |
| **Updated** | 2026-10-12 |

## Goal
The camera director can cut on the video switchers Bosch's own DICENTIS camera control supports: Kramer MV-6 and tvONE
CORIOmaster / CORIOmatrix, configured in Settings → Cameras & switcher like the ATEM.

## Context
- User request 2026-10-12 ("support for connecting to the default bosch video switchers like kramer mv-6 and tvone corrio").
- DEC-012 (camera control), DEC-015 (automation switch), DEC-033 (this WO: protocols and config).
- Sources: Kramer MV-6 user manual rev 11 (Protocol 3000, §10–11); tvONE "CORIOmaster Commands" (API 4.11);
  Bosch DCNM-LCC data sheet (supported switchers).

## Scope
- In: drivers `kramer-mv6`, `tvone-corio` (node:net, line protocol, one outstanding command, program follow); TCP
  mocks in `mock/switchers/`; device manager fields; settings UI (type, port defaults, driver fields); tests.
- Out: tvONE C2 series (CORIO2 protocol); serial (RS-232) connections; hardware check (follow-up, like WO-041).

## Deliverables
backend/src/devices/switchers/{kramer.js,tvone.js,index.js}, backend/src/devices/manager.js, mock/switchers/*,
web/js/views/cameras.js, backend/test/switchers.test.js, architecture.md.

## Acceptance criteria
- [x] Tests: each driver against its mock: connect (+ login / layout preset), cut, program followed when changed on the
      device side, error reply → error, reconnect after the device drops the connection.
- [x] Settings UI can save each switcher type; cameras' switcher inputs list the driver's inputs; ui:check screenshots.
- [x] No new dependency.

## Work log
- 2026-10-12 (Claude Opus): created and refined to ready (protocol research in DEC-033).

- 2026-10-12 (Claude Opus): implemented.
  - Protocol sources read: Kramer MV-6 user manual rev 11 (Protocol 3000 §10–11: `#` handshake, `#SRC-VID win,in`,
    `#SRC-VID? win`, `#PRST-RCL n`, `#MODEL?`; TCP 5000; replies `~nn@… CR LF`; changes broadcast to all ports);
    tvONE CORIOmaster Commands (API 4.11: `login(u,p)`, `Window<n>.Input = SlotX.InY`, `!Done`, TCP 10001, admin/adminpw).
  - `backend/src/devices/switchers/line-connection.js` (TCP, line split, one command at a time, unsolicited lines),
    `kramer.js` (`KramerSwitcher`, `parseP3000`), `tvone.js` (`TvOneSwitcher`, `corioInputs`; program re-read every 2 s
    because the CORIO does not push), both reconnect on their own after a dropped connection (retry 5 s).
  - Device manager: fields `window`, `layoutPreset`, `previewWindow`, `inputs`, `username`, `password` (connection
    fields); `publicSwitcher()` hides the password (`passwordSet`); changing the type starts from that type's defaults.
  - Settings UI: type list (ATEM, Kramer MV-6, tvONE, simulated), per-type fields and notes; ATEM search only in the
    ATEM form ("Use" switches to ATEM and fills the address).
  - Mocks `mock/switchers/kramer-mv6.js`, `tvone-corio.js` (also runnable standalone).
  - Tests `backend/test/switchers-text.test.js` (10). Bugs found by them: undefined options overrode the line
    connection's defaults (fixed). ui:check (wired room scenario) now configures both through the form against the
    mocks; it found a race in the form (a save finishing after another type was picked reset the form) → fixed.
  - Evidence: `npm test` 341/341; `node scripts/ui-check.mjs data/ui-check --system wired room` UI CHECK OK;
    screenshots `wired-switcher-kramer-scenario-light.png`, `wired-switcher-tvone-scenario-light.png` checked.

## Decisions
- DEC-033.
- One shared `LineConnection` for both text protocols (no dependency).
- tvONE: an `!Error` answer to `login` is not fatal by itself (a CORIO without security may reject it but take
  commands); the window read right after decides.

## Handoff
- Delivered: Kramer MV-6 and tvONE CORIOmaster/CORIOmatrix as video switchers for the camera director, configured in
  Settings → Cameras & switcher, with mocks and tests.
- Not verified on hardware. Points to check first on a real device: the MV-6's reply to `#SRC-VID` (with or without a
  trailing OK, both parsed), whether a CORIO with security off answers `login`, the CORIO's exact `!Error` text.
- Not covered: tvONE C2-2355A (older CORIO2 protocol), RS-232 connections. Follow-up WO-114 (draft): hardware check.
