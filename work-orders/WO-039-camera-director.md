# WO-039: Camera director: seat → preset → switcher automation

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-034, WO-038 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
Automation per DEC-012 §4.

## Scope
- `backend/src/director/director.js`: input `domain.discussion` + room shot map; rules: last-activated wins, priority overrides, fall back to previous active, overview when none; delay after mic-on, minimum shot duration; strategy `safe` (never move on-air camera: cut to overview/other first) or `live`; program cut on ATEM.
- Manual mode / pause; manual shot trigger; state topic `director` (mode, current shot, pending, last actions log).
- Pure decision core (testable with fake clock) + effects layer.

## Acceptance criteria
- [x] Unit tests for all rules incl. safe/live strategy with a fake clock; integration test: wired mock mic on → mock camera recalled → mock switcher cut.

## Work log
- 2026-10-03 (Claude Opus): Pure core `backend/src/director/decide.js` (activation order, last-activated/priority target, shot/overview, plan safe/live) + executor `director.js` (debounce delayMs, minShotMs, single job with latest-target-wins re-planning, VISCA completion or settleMs before cutting, tracks on-air camera from switcher program incl. panel cuts) + `routes.js` (GET /api/director, POST /api/director/shot). Tests `backend/test/director.test.js`: 5 pure + 2 end-to-end (wired mock mic on → mock camera preset → mock switcher cut; safe move via overview; fallback to previous speaker; overview when all off; manual shot; disabled automation).

## Decisions

## Handoff
Done (backend). UI: WO-035 / WO-040.
