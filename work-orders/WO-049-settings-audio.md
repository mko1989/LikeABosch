# WO-049: Settings → Audio (Conference Protocol scope)

| | |
|---|---|
| **Status** | done |
| **Phase** | 3 Web UI |
| **Depends on** | WO-044 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
User (2026-10-03) asked for audio settings incl. Dante sends/receives (= DICENTIS audio settings, DEC-014 §3). Those
need the Windows API (WO-050); this WO delivers what the Conference Protocol allows now.

## Scope
- In: Settings → **Audio** view: master volume (dB slider, range from the server), per-seat microphone sensitivity table
  (all seats from the `microphoneSensitivity` topic, step/range from the description, reset, bulk set selected),
  interpretation routing overview (desk → language, mic state); a panel that lists the deferred DICENTIS/Dante settings
  and why (links WO-050).
- Out: Dante out per seat, language channels to Dante, room gains/EQ/routing/VU (WO-050).

## Acceptance criteria
- [x] Master volume + sensitivity editable on the mock; real snapshot read-only screenshot ok.
- [x] `npm test`, `npm run ui:check` pass; screenshot reviewed.

## Work log
- 2026-10-03 (Claude Opus): `web/js/views/audio.js` (Settings → Audio, wired): microphone sensitivity table for every
  seat (from the `microphoneSensitivity` topic, WO-044) with −/+/reset per seat, multi-select + "Set selected" /
  "Reset selected" / "Reset all" (confirm), range/step from the description, permission-gated; master volume (moved here
  from System, which now links to Audio); interpretation routing list (live desks: hears → produces; links to the desk
  on the room plan); "DICENTIS audio & Dante" card listing the deferred settings (WO-050).
- ui:check `audio` scenario (volume 5, Seat 2 +0.5 dB, seats 4+5 set to −2 dB in bulk, reset all) replaces the volume
  part of the `system` scenario; screenshots reviewed (first version cut the routing table off in the narrow column →
  compact list). Real read-only snapshot: 8 seats at 0 dB, volume −2.5 dB (range −24…0), desks listed.
- Also fixed while running the full UI check repeatedly: the wired `discussion` scenario raced (two "Add" requests in
  flight could reach the server in either order → seat 7 became speaker, seat 6 the request); each step now waits for the
  seat to appear in a list, steps are labelled. 3 consecutive full runs OK.

## Handoff
Done. Real DICENTIS audio/Dante settings: WO-050 (deferred by the user).
