# WO-026: Plugins

| | |
|---|---|
| **Status** | draft |
| **Phase** | 3 Web UI |
| **Depends on** | WO-018, WO-007 |
| **Assignee** | — |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Plugin list/details, send commands/events, subscribe to plugin events. Low priority; spec has gaps (see WO-003 handoff).

## Scope (draft: refine into concrete tasks + acceptance criteria before starting)
- Read DEC-002 (plain HTML/JS, no framework) and the UI conventions decided in WO-018.
- Use only `web/js/api.js` + the SSE store for data; never call DICENTIS directly.
- Hide or disable controls the current permissions don't allow (`GET /api/connection` → permissions).
- Test manually against the mock and note the steps in the work log; real-server check goes into WO-028.

## Acceptance criteria
_(define when moving to ready)_

## Work log

## Handoff
