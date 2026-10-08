# DEC-030: Room widgets: voting, audio and presentation on the operator's main screen

- **Status:** accepted (requested by the user 2026-10-08: "voting is hidden in settings. there should be a widget kind of
  thingy for voting. also widgets for audio and presentation"; design by Claude)
- **WO:** WO-104
- **Builds on:** DEC-011 / DEC-014 (Room = main workspace, full views under Settings), DEC-009 (UI rules), DEC-010
  (domain actions + capabilities)

## Decision
1. The Room's operate-mode side panel gets a **widget dock** above the inspector. Widgets are small cards with a header
   (title, collapse, link to the full Settings view). Which widgets are shown and collapsed is a per-browser preference
   (`localStorage`, like the label size, WO-058); default: every widget the connected system supports.
2. Widgets are modules in `web/js/widgets/<id>.js` exporting `{ id, title, settingsHref, available(store), topics,
   render(store, api) }`; the dock rebuilds a widget only when one of its topics changes (same rule as the side slots,
   WO-054), never while the user is dragging a slider.
3. First widgets: **Voting** (state, open/hold/resume/close/abort/accept/reject through `/api/domain/voting/*`, live
   counts as bars, ad-hoc start where the system can), **Audio** (master volume; DICENTIS room gains and level meters when
   `dicentis.audio` is available, DEC-029), **Presentation** (state + on/off; the stream address from WO-105 as a hint).
4. The Settings views stay the place for full configuration; widgets only operate.

## Alternatives considered
- Floating, draggable windows over the plan: hide seats; more code; rejected for now.
- A separate "Control" tab: the operator would leave the plan, which is what the user complained about.
