# WO-083: Room plan: participant names alternate top/bottom and never overlap

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-035, WO-058 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
User (2026-10-07): "when participant names are used on seats they are overlaying the ones next to them. the text needs
to be aware of surrounding and not crash into any. seats should alternate labels top/bottom."

## Context
`web/js/views/room.js` `seatNode()`: the name is a `text.seat-person` 5 units below the disc, counter-rotated so it is
always horizontal, cut at 18 characters. Font size follows the label size (WO-058, `--label-scale`). In rows of
seats 100 units apart, names wider than ~100 units run into each other (seen in WO-058's screenshot).

## Scope
- In:
  - Pure layout module `web/js/labels.js`: given seat centres, label sizes and obstacles, choose for each name a side
    (below / above the disc), one or two lines, or a shortened text that fits; never overlapping another name, a seat
    disc or a camera.
  - Alternation: neighbouring seats in a row (similar y, side by side) alternate below / above; seats on their own
    keep the name below.
  - room.js measures the texts (SVG `getComputedTextLength`, same font as the label), runs the layout after each
    canvas render and after a label-size change, and draws the names accordingly. Full name stays in the tooltip.
  - Unit tests for the layout (`web/test/labels.test.js`); ui-check step + screenshot.
- Out: hiding names (WO-058 follow-up idea), seat number labels inside the disc, desk/camera labels (obstacles only).

## Acceptance criteria
- [x] Neighbouring seats in a row alternate names below / above.
- [x] No two name boxes overlap, and no name box overlaps a seat disc (unit tests incl. a dense row with long names).
- [x] Names that don't fit are wrapped on two lines or shortened with "…"; the tooltip has the full name.
- [x] Re-layout on label size − / +.
- [x] `npm test` and `npm run ui:check` green; screenshots looked at.

## Work log
- 2026-10-07 (Claude Opus): WO created from the user request; scope set (ready → in-progress).

- 2026-10-07 (Claude Opus): `web/js/labels.js` (pure): rows = seats within 0.6 R in y, left → right; neighbours (< 4 R
  apart or names touching) alternate below / above; candidates in order: preferred side one line, preferred side two
  lines (split at the space nearest the middle), other side one / two lines; else shortened with "…" to the free
  width; null if not one letter fits. Obstacles: every seat disc, cameras (r 26), desks (r = half diagonal × label
  size). room.js: `layoutSeatNames()` after each canvas render and after Labels − / +, measures with a hidden
  `text.seat-person` (`getComputedTextLength`, cache per label size; retries once on the next frame when the view is
  not in the document yet). Old 18-character cut removed; full name stays in the seat tooltip.
- 2026-10-07 (Claude Opus): first ui-check run: at 200 % every name went above. Cause: the gap grows with the label
  size (6 units at 200 %) and the "below" offset (R + 4) was smaller than R + gap, so the seat's own disc counted as
  an obstacle. Offsets now below = R + gap + 2, above = R + max(gap, 6) + 3; two-line wrap on the preferred side is
  tried before switching sides (keeps the alternation). Tests added for both.
- 2026-10-07 (Claude Opus): `web/test/labels.test.js` 8 tests (alternation, separate rows, dense row of long names:
  no overlap with names or discs, column / U arm at large size, camera obstacle, helpers, large gap, wrap before
  switching). ui-check (wired room scenario): no name box overlaps another or a disc at 100 % and 200 %, both
  `.below` and `.above` present; wireless room scenario: no overlaps in the grid. Screenshots looked at:
  `wired-room-labels-scenario-light.png` (200 %: all names placed, alternating, long ones wrapped / "Julia…"),
  `wireless-room-participant-scenario-light.png` (grid rows alternate). `npm test` 249/249, `node scripts/ui-check.mjs`
  (all systems) OK.

## Decisions
- Name positions are computed in the browser (they depend on font metrics and the label size), not stored.
- Alternation is per row of neighbouring seats; a seat on its own keeps the name below.
- A name with no room at all is hidden on the plan (tooltip and inspector still show it) rather than drawn over others.

## Handoff
Delivered: collision-free, alternating participant names on the room plan (`web/js/labels.js`, room.js
`layoutSeatNames`). Status `review`: user to check on the real room layout. Known gaps: names are not re-laid out during
a drag (only after the drop); camera labels and the HTML cogs / desk strips are not obstacles (cameras and desks are, as
circles). Follow-up idea from WO-058 still open: a toggle to hide names.
