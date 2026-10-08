# WO-051: Interpreter desk quick controls on the room plan

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-048 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
User (2026-10-03): "the interpreter nodes in the room view need to have the output chs under them, as well as the drop
down for relay. operator needs a very quick way to change those when the interpreter makes a mistake."

## Scope
- In: under every placed desk (operate mode) a control strip: output channel buttons Off / A / B / C with their
  languages (GrantInterpretation) and the input dropdown Floor / Relay / languages (SelectInterpretationFloor /
  SelectRelayInterpretation / SelectInterpretationInputLanguage); one click, no side panel needed.
- In: HTML overlay positioned from the view (constant size at any zoom, follows pan/zoom/resize); per-desk rebuild only
  when that desk's state changes (an open dropdown is not closed by unrelated live updates); inert preview in edit mode.
- In: permission/connection gating as in the desk panel; ui:check scenario uses the strip.
- Out: changing the B/C preset languages (stays in the desk panel).

## Acceptance criteria
- [x] Strip under each placed desk in operate mode; channel + input changes work on the mock and update live.
- [x] Stays attached while panning/zooming; `npm test`, `npm run ui:check` pass; screenshot reviewed.

## Work log
- 2026-10-03 (Claude Opus): `room.js`: shared builders `deskOutputs()` (Off/A/B/C with preset languages, live = red) and
  `deskInput()` (Floor / Relay / languages; "in: —" while the mic is off, since DICENTIS only reports the input then),
  used by the desk panel and by new **desk strips**: an HTML layer (`.desk-overlays`) over the plan with one strip per
  placed desk in operate mode, positioned below the (rotated) desk body from the view centre/zoom (`positionStrips()` on
  every view change), constant size at any zoom, wheel over a strip still pans/zooms the plan. A strip is rebuilt only
  when its desk's state changes, and not while its dropdown has focus (refresh on blur). Hidden in edit mode.
- ui:check room scenario now drives the strip: B on air → input FR → "mistake" fixed with A + Floor → strip stays under
  the desk after zooming in (geometry check) → B preset language via the panel → off. One run failed with a null element
  in the geometry check; not reproducible in 4 further runs: the check is null-safe and prints positions if it fails again.
- `npm test` 136/136, `npm run ui:check` OK; screenshot reviewed.

## Handoff
Done. Possible later: keyboard shortcuts for the selected desk (0/A/B/C, F = floor, R = relay).
- 2026-10-03 (Claude Opus): user: "they are not visible in edit mode so i cant see how much space they will take". Edit
  mode now shows the strips as **inert previews** (dashed, dimmed, `inert`, pointer-events none so dragging/panning
  underneath still works); a dragged desk's strip follows it live (`positionStrips({ id, x, y, rotation })` in
  pointermove). Note for operators: strips keep a fixed on-screen size (readable at any zoom), so their footprint
  relative to the plan depends on the zoom: the preview shows exactly what operate mode looks like at the current zoom.
  ui:check: preview present + inert in edit mode, below the desk, follows mid-drag and after the drop, interactive again
  in operate mode; screenshot reviewed. `npm test` 136/136, `npm run ui:check` OK.
