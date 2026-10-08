# WO-048: Room: interpreter desks as special devices with quick controls

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-035, WO-023 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
User (2026-10-03): "interpreter desks available as special devices with their settings like which channel is on and
which language it's listening, with a quick way to change it from the room view". DEC-014 §4.

## Scope
- In: room.json `desks` placements (+ API `PUT/DELETE /api/room/desks/:seatId`), tray of unplaced desks, drag/rotate/remove.
- In: desk node on the plan: booth/desk number, live output (A/B/C with language, red when mic on), listening language
  (routing source: floor / relay / language), connected/selected/disconnected.
- In: side panel quick controls (permission canControlInterpretation): mic off/A/B/C (GrantInterpretation), listen to
  floor / relay / a language (SelectInterpretationFloor / SelectRelayInterpretation / SelectInterpretationInputLanguage
  preset A), output B/C language (SetInterpretationOutputPreset), speak-slowly meta function; operate mode click = panel.
- In: mock: input selection updates the routing source language; floor/relay reflected.
- Out: configuring booths/desks/languages (Windows API, WO-050).

## Acceptance criteria
- [x] Desks can be placed; node + panel show output/input state live; quick controls change state on the mock (and on the real server, probe).
- [x] Tests for desk placements; `npm test`, `npm run ui:check` scenario; screenshot reviewed.

## Work log
- 2026-10-03 (Claude Opus): backend: `room.json` `desks` placements + `PUT/DELETE /api/room/desks/:deskId` (test).
  Room view: desk nodes (purple outline; "B1 · D1", live output "● B NL" in red when the mic is on, "hears FR" = routing
  source), tray chips "🎧 Booth n · Desk m", drag/rotate/remove/place, click (both modes) opens the desk panel: status /
  type / on-air / speak-slowly badges, mic Off/A/B/C with preset languages (GrantInterpretation), "Listening to"
  Floor / Relay / any meeting language (SelectInterpretationFloor / SelectRelayInterpretation /
  SelectInterpretationInputLanguage on input preset A), output B/C presets from the desk's lists
  (SetInterpretationOutputPreset), producing language + quality, auto-relay, headphone, speak-slowly meta function;
  permission-gated (canControlInterpretation) and disabled for disconnected desks.
- Mock: GrantInterpretation now sets the routing destination to the active output's language; SetInterpretationOutputPreset
  changes the desk's B/C preset (validated against its list, fires interpreterSeatsChanged) and only moves the routing
  when that output is live (before: overwrote the destination regardless). e2e:mock 31/31.
- ui:check room scenario (wired): place Booth 1 · Desk 1 from the tray, operate mode → panel, mic B → node live
  "● B NL", listen to FR → "hears FR", B preset FR → "● B FR", mic off. Screenshot reviewed. (First attempt inserted
  the steps into the *wireless* room scenario, which shares the same text; moved to the wired one.)
- `npm test` 135/135.
- 2026-10-03 (Claude Opus): **real-server probe** (dev server, desk 1: mic A → input EN → floor → relay → mic B → off):
  GetInterpretationRoutings lists a desk **only while its mic is on**; floor = id of the language with index 0 ("FLR");
  relay = source '' with quality "Unknown"; values PascalCase; SelectInterpretationInputLanguage also fires
  InterpreterSeatsChanged. Consequences: new `web/js/interp.js` (shared by Room, Audio, Interpretation): mic state
  camel-cased (**fixes the Interpretation view on real servers**: "ActiveOnOutputA" never matched "activeOnOutputA"),
  floor/relay mapping, floor language hidden from the language list; desk node shows "hears …" only while live; panel
  input select shows "— shown while the mic is on —" instead of pretending "Floor". Mock aligned (floor language at
  index 0, routings only for live desks, relay = '', quality) + mock test; spec extractionNotes record the evidence.
- Real read-only snapshot of `#/room?desk=<id>`: desk 1 panel with real presets (A polski, B English, C none), headphone.
- `npm test` 136/136, e2e:mock 31/31, `npm run ui:check` OK.

## Decisions
- Input selection by language uses input preset A (`SelectInterpretationInputLanguage`): the protocol has no way to read
  the desk's A–G input presets, so presets B–G are left as configured.

## Handoff
Done. Booth/desk/language configuration needs the Windows API (WO-050).
