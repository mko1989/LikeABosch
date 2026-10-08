# WO-029: UI authentication, security and packaging

| | |
|---|---|
| **Status** | draft |
| **Phase** | 4 Hardening |
| **Depends on** | WO-028 |
| **Assignee** | — |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Optional UI login (DEC-005 currently assumes trusted LAN), HTTPS for the UI, secret handling review, run as a service (systemd/pm2/Windows service), install/run docs.

## Scope (draft: refine into concrete tasks + acceptance criteria before starting)
- Read DEC-002 (plain HTML/JS, no framework) and the UI conventions decided in WO-018.
- Use only `web/js/api.js` + the SSE store for data; never call DICENTIS directly.
- Hide or disable controls the current permissions don't allow (`GET /api/connection` → permissions).
- Test manually against the mock and note the steps in the work log; real-server check goes into WO-028.

## Acceptance criteria
_(define when moving to ready)_

## Work log
- 2026-10-07 (Claude Opus): test builds (unsigned zip/dmg, Windows portable zip) done in WO-097; this WO keeps signing, installer, service, UI auth.
- 2026-10-08 (Claude Opus): installers (Windows NSIS setup, macOS dmg, app icon) done in WO-100; this WO keeps code signing / notarisation, firewall rule, service, UI auth.

## Handoff
