# WO-040: Settings UI: cameras, switcher, presets, automation

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-038, WO-039, WO-033 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
Configure everything in Settings (DEC-011).

## Scope
- Cameras & switcher view: list/add/edit/delete cameras (driver-specific fields), test connection, PTZ jog pad (pan/tilt/zoom), recall/store preset, switcher settings and input mapping, live status.
- Camera automation view: per-seat shot table (camera + preset, store current position as the seat's preset), overview shot, strategy safe/live, timings, auto/manual.

## Acceptance criteria
- [x] ui:check scenario against mocks: add camera, jog, store preset for a seat, enable automation, mic on → shot.

## Work log
- 2026-10-03 (Claude Opus): `web/js/views/cameras.js` (camera list with status, add/edit with model templates: Avonic VISCA UDP/TCP, Avonic ONVIF, Sony VISCA over IP, Panasonic AW, generic ONVIF, simulated; driver-specific fields; switcher input mapping from the switcher's input list; control panel with press-and-hold jog pad, zoom, speed, preset recall/store, ONVIF preset list, test connection, cut; switcher card ATEM/simulated with host, M/E, model, program/preview). `web/js/views/automation.js` (auto toggle, safe/live with explanations, delay/min shot/travel time, overview shot, per-seat shot table with Save/Test/Store/Take, recent actions log). Covered by the `room` ui:check scenario; layout reviewed (seat-shot column widened).

- 2026-10-05 (Claude Opus, logged during WO-057): user report "when adding a camera I set VISCA UDP, it gets set but
  the dropdown still displays 'Choose camera model'". Cause: choosing a model rebuilds the form and the model select
  had no selected option (also "Add camera" pre-filled the first model while showing "Choose…"; typed name/host were
  lost on a model change). Fix in views/cameras.js: `_template` remembered and selected, typed values carried over.
  ui-check asserts the select keeps 'mock' after the rebuild.

## Decisions
- Avonic defaults in the templates (raw VISCA UDP 1259 / TCP 5678, ONVIF 80) are assumptions shown with a hint; verify in WO-041.

## Handoff
Done against simulated devices.
