# WO-104: Room widgets: voting, audio, presentation (DEC-030)

| | |
|---|---|
| **Status** | review |
| **Phase** | 3 Web UI |
| **Depends on** | WO-021, WO-024, WO-049, WO-081 (audio widget's DICENTIS part) |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-08 |
| **Updated** | 2026-10-08 |

## Goal
User (2026-10-08): "voting is hidden in settings. there should be a widget kind of thingy for voting. also widgets for
audio and presentation." The Room's operate mode shows compact, live widgets for these, so the operator never leaves
the plan.

## Context
DEC-030, DEC-009, DEC-010. `web/js/views/room.js` (`renderSide`, `slot()`), `web/js/views/voting.js` (controls per
system), `web/js/views/system.js` (presentation), `web/js/views/audio.js` (master volume), domain voting routes.

## Scope
- In: `web/js/widgets/{dock,voting,audio,presentation}.js`; dock in the operate side panel with a "Widgets" menu
  (show/hide, collapse; per browser); Voting: state, subject, controls per system (reuse the control tables moved to
  `web/js/voting-controls.js`), live result bars, ad-hoc start (wired); Audio: master volume slider (wired/DCN/wireless
  where available), DICENTIS room gains + mini VU meters when `dicentis.audio` exists; Presentation: on/off + state +
  (wired) RTSP stream hint from WO-105.
- Out: drag-to-rearrange widgets, floating windows (DEC-030 alternatives).

## Acceptance criteria
- [x] ui-check on simulated wired (+ full API) and wireless: widgets visible, open a voting from the widget, change
  volume, toggle presentation; screenshots looked at.
- [x] Pure module tests for the voting controls table and the dock preference parsing.
- [x] `npm test` passes.

## Work log
- 2026-10-08 (Claude Opus): created (ready).
- 2026-10-08 (Claude Opus): in-progress → review. `web/js/voting-controls.js` (control tables + result rows moved out
  of the voting view, which now imports them), `web/js/widgets/{dock,prefs,voting,audio,presentation}.js`; dock in the
  Room operate side panel (an open inspector goes above the widgets so it stays in view; otherwise widgets first),
  "Choose widgets" menu (per browser), collapse, "More" link to the full view; a widget body is rebuilt only when its
  topics change and not while typing / dragging a slider. Voting: state, controls per system, result bars, prepared
  voting + ad-hoc start (wired). Audio: master volume + (full API) loudspeaker / sound-reinforcement gains and level
  meters. Presentation: on/off + source note + RTSP address (WO-105). `web/test/widgets.test.js` 3/3. ui-check: wired
  `voting` scenario runs an ad-hoc voting from the widget (5 votes, close, accept), presentation on/off, collapse;
  wireless `voting` opens/closes from the widget. Screenshots looked at: first version showed an empty menu box
  (`display: grid` beat `[hidden]`) and a side panel wider than its column (clipped right edge) → `[hidden]` rule,
  `minmax(0, 1fr)` column, compact grid sizes; second look OK (light wired, dark wireless).

## Decisions
- Audio widget shows only the room gains an operator touches during a meeting (loudspeakers, sound reinforcement) and
  3 meters; everything else stays in Settings → Audio.

## Handoff
- Delivered as in Scope. Ideas not done: drag to reorder widgets, more widgets (e.g. discussion mode, camera
  automation): say which.
