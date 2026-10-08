# WO-087: Wireless: audio settings, master volume and loudspeaker equaliser

| | |
|---|---|
| **Status** | review |
| **Phase** | 3 Web UI |
| **Depends on** | WO-076 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
Settings → Audio on DICENTIS Wireless: master / PA / loudspeaker / line in-out levels in dB, routing, test tone, AFS, loudspeaker off when mic on, line-out channel seats, and the delegate loudspeaker equaliser bands.

## Context
WAP web UI code (`/js/app.js`, firmware 1.73.2081; read 2026-10-07, see DEC-024). The real WAP is offline for now (user took it out): build against the wireless mock, verify on the WAP later (e2e:wireless). `configAudioController`: levels are steps; dB = start + step × value (minus one step and "mute" at 0 for fields with mute); DCNM-WAP: master/pa/lsp 0…24 from −11 dB in 1 dB, lineIn1 0…16 from −18 dB in 1.5 dB, lineOut1 0…22 from −24 dB in 1.5 dB. `lspOffWhenMicOn` is shown inverted by the web UI. EQ: `configEqualizerController`, PUT an array with one band, gain −12…12, `enabled` inverted in the web UI.

## Scope
- In: view `wap-audio` (feature `wapConfig`): levels as − / + steppers with dB, the other `/audio` fields generic (selects / checkboxes for known ones, raw values otherwise), EQ band table; `PUT /audio` with one field (as the web UI), `PUT /audio/master`, `PUT /audio/equalizer/delegate-loudspeaker`.
- Out: wired DICENTIS audio (needs DCNM, WO-081).

## Acceptance criteria
- [x] Levels change in steps and show dB; EQ band gain/enable saved (mock).
- [x] ui-check scenario + screenshots looked at; `npm test` green.

## Work log
- 2026-10-07 (Claude Opus): created from the user's list in `next.md` ("audio settings and eq"); scope set (ready).

- 2026-10-07 (Claude Opus): `web/js/views/wap-audio.js` (Settings → Audio on wireless; the wired Audio view stays for wired): master
  (`/audio/master`) and every level `/audio` reports as − / + steps with dB per the web UI's scales (mute at 0 where
  the web UI has mute), routing/options generic (booleans → checkboxes, `lineOutNSeatId` → seat select, other numbers →
  inputs), EQ table from whatever band fields the WAP returns (gain clamped −12…12). Cards rebuild only when their data
  changes. ui-check `wap-audio`: loudspeaker level +1 and its dB text, EQ band 1 gain −3, restored. Screenshot looked
  at. `npm test` 257/257, `node scripts/ui-check.mjs` (all systems) OK, `npm run e2e:wireless:mock` 23/23 checks, `npm run e2e:mock` 31/31.

## Decisions
- `lspOffWhenMicOn` and EQ `enabled` shown with their API meaning (the web UI inverts both for its own labels): to
  confirm on the real WAP.

## Handoff
Delivered: wireless audio levels, options and loudspeaker EQ. Status `review`. Open (real WAP): field list and EQ band
fields, the meaning of `routingOption`/`testTone`/`afsMode` values (shown as numbers), and the inverted booleans.
