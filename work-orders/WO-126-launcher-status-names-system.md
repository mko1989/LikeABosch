# WO-126: Launcher status pill names the connected system (not always "DICENTIS")

| | |
|---|---|
| **Status** | review |
| **Phase** | 3 Web UI |
| **Depends on** | WO-030, WO-063, WO-095 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-16 |
| **Updated** | 2026-10-16 |

## Goal
User (next.md, 2026-10-16): "the launcher at the top it says dicentis: not connected and doesnt change to dcn when its a
different system." The launcher's connection pill shows the system type in use: DICENTIS, DICENTIS Wireless,
CCS 1000 D, DCN NG, DCN NG (meeting data).

## Context
`launcher/renderer/app.js` (`renderDicentis`, `DICENTIS_LABELS`), `launcher/renderer/index.html` (`#dicentis-pill`).
`/api/connection` already returns `system` (`ConnectionManager.status()`), the simulated system included.

## Scope
- In: system label from `status.system` while the server runs; from the form's system (or simulated system) while it
  is stopped, updated when the selection changes; simulation keeps its "Simulation:" prefix.
- Out: renaming the IPC channel / element id (`dicentis:status`, `dicentis-pill`): internal names, unchanged.

## Acceptance criteria
- [x] Pill text follows the system: stopped server + DCN selected → "DCN NG: not connected"; running → the running system.
- [x] Launcher tests (`npm test` in launcher/ if present) and root `npm test` pass.

## Work log
- 2026-10-16 (Claude Opus): created (ready → in-progress).
- 2026-10-16 (Claude Opus): in-progress → review. `renderDicentis` takes the label from `SYSTEM_LABELS[status.system]`
  (DICENTIS / DICENTIS Wireless / CCS 1000 D / DCN NG / DCN NG (meeting data)), "Simulated <system>" while simulating
  (the profile name in brackets once connected); with the server stopped it names the form's system / simulated system
  and follows a change of either (`updatePortPlaceholder` re-renders it). Static HTML text "Not connected" until the
  script runs. Checked in a headless Electron with a stubbed preload (scratchpad, not committed): stopped + dcn →
  "DCN NG: not connected"; switch to wireless → "DICENTIS Wireless: not connected"; simulate dcn-smd → "Simulated DCN NG
  (meeting data): not connected"; running dcn → "DCN NG: connected (op@10.0.0.5)"; simulated ccs1000 → "Simulated
  CCS 1000 D: connected (CCS 1000 D demo)"; wired error → "DICENTIS: connection failed". `npm test` 376/376 (includes
  launcher/test).

## Decisions

## Handoff
- Delivered as in Scope. Not checked in the real packaged launcher (only the renderer with a stubbed preload).
