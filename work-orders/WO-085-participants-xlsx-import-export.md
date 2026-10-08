# WO-085: Participants and seating: Excel (XLSX) export and import

| | |
|---|---|
| **Status** | review |
| **Phase** | 3 Web UI |
| **Depends on** | WO-084 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
User (2026-10-07): "adding participants is cumbersome. ill need a an import/export xls of participants and seating
arrangment." Export the participants with their seats to an Excel workbook, edit it in Excel, import it back
(preview first, then apply).

## Context
DEC-023 (format, no dependency, import rules), WO-084 (participant domain actions), WO-027 (wireless participants),
WO-075 (WAP validation: name ≤ 32, seat taken → 400, NFC format/duplicates → 400).

## Scope
- In:
  - `backend/src/lib/xlsx.js`: minimal XLSX writer + reader (ZIP via `node:zlib`, no dependency), CSV reader.
  - `GET /api/domain/participants/export.xlsx`: sheets "Participants" (Name, Seat, NFC tag + read-only info columns
    of the system) and "Seats" (every seat with its participant and plan position), on every system.
  - `POST /api/domain/participants/import?apply=0|1&remove=0|1` (raw body: .xlsx or .csv): plan (create / update /
    unassign / delete, errors, warnings); `apply=1` executes it on the connected system (wireless; others
    NOT_SUPPORTED). Rules in DEC-023.
  - UI: Meeting → Participants and Meeting → Seating: "Export Excel" and "Import…" (file picker → preview dialog →
    Apply).
  - Tests: xlsx round trip, reading a workbook as Excel writes it (shared strings), import planning rules, apply on
    the wireless mock.
- Out: wired/DCN import (needs WO-081); importing plan positions (export only).

## Acceptance criteria
- [ ] Export opens in Excel/LibreOffice/Numbers (valid OOXML: checked by re-reading + `unzip -t`; manual check by the user). Automated part done (re-read, `unzip -t`, openpyxl); **Excel check by the user pending**.
- [x] Import preview shows creates/updates/seat changes/errors; nothing changes until Apply.
- [x] Apply on the wireless mock reaches the file's state, incl. seat swaps between participants.
- [x] `npm test`, `npm run ui:check` green; screenshots looked at.

## Work log
- 2026-10-07 (Claude Opus): WO created from the user request; scope set (ready → in-progress).

- 2026-10-07 (Claude Opus): `backend/src/lib/xlsx.js`: ZIP writer/reader (own CRC32: `zlib.crc32` is missing in
  early Node 22), small OOXML tokenizer (namespace prefixes stripped, text untrimmed), writer with inline strings,
  bold frozen header, column widths, "Normal" cell style; reader for shared strings (rich text runs, phonetic hints
  skipped), inline strings, `str`, `b`, numbers, sparse cells, relative/absolute part paths; CSV reader (separator
  guessed among ; tab ,; quotes; BOM); `readTable` sniffs ZIP vs CSV and refuses old .xls with a hint.
  `backend/src/domain/participants-io.js`: `exportSheets` (Participants: Name, Seat, NFC tag, info columns the system
  has, ID; Seats: seat, id, participant, plan position in m, rotation), `planImport` (rules of DEC-023 §3),
  `applyImport` (deletes → free kept holders → free moving seats / NFC tags → updates → creates; stops at the first
  refusal and reports done/total and the step). Routes `GET /api/domain/participants/export.xlsx`,
  `POST /api/domain/participants/import?apply&remove` (raw body, 5 MB).
- 2026-10-07 (Claude Opus): tests `backend/test/participants-io.test.js` (13): xlsx round trip, a workbook written by
  openpyxl 3.1.5 (fixture `backend/test/fixtures/participants-openpyxl.xlsx`), an Excel-shaped workbook with shared
  strings, CSV; planning (export → import = no changes, matching by name / ID, seat swap, kept holder loses seat,
  remove mode, every error case); apply against a simulated WAP that refuses a seat / NFC tag held twice (swap +
  NFC move succeed); endpoints on the wireless mock (export → edit → preview changes nothing → apply → mock state) and
  wired (export ok, preview ok, apply NOT_SUPPORTED). All passed.
- 2026-10-07 (Claude Opus): external check of our output: `unzip -t` "No errors"; openpyxl reads both sheets, frozen
  header, bold font; it warned "no default style" → added the Normal cell style, re-checked with warnings as errors.
  Not opened in Microsoft Excel itself (installed on this Mac, but it would open a window on the user's desktop).
- 2026-10-07 (Claude Opus): UI `web/js/participants-io.js`: "Export Excel" (download link) + "Import…" (file picker →
  preview dialog: new, changes, lose seat / NFC, deleted, row errors, "Remove participants not in the file" re-plans;
  "Apply n changes" only without errors and when the system can edit) in Meeting → Participants (both variants) and
  Meeting → Seating; seating hints updated (WO-050 → WO-081). ui-check wireless `seating` scenario: export answers
  spreadsheetml, CSV import preview (new + change + lose seat), Apply → mock state, restore. First screenshot showed
  the seating filter select squeezed by the buttons and the "Notes" list repeating "lose their seat": buttons moved
  to the summary row, notes limited to row warnings. Screenshots looked at (`wireless-seating-import-scenario-light`,
  `wired-seating-light`, `wireless-participants-dark`). `npm test` 249/249, `node scripts/ui-check.mjs` (all) OK.

## Decisions
- DEC-023 (format, own reader/writer, import rules).
- Import is sheet "Participants" or the first sheet with data; the Seats sheet is a reference (plan positions are not
  imported).
- The export is available on every system; on wired it is the way to get the DICENTIS assignments into Excel.

## Handoff
Delivered: Excel export / import (preview + apply) of participants and their seats. Status `review`.
Needs the user: open an export in Excel (and Numbers / LibreOffice if used) and import a file saved by Excel, ideally
against the real WAP (`e2e:wireless` does not cover import yet). Known gaps: wired / DCN import needs WO-081; dates and
formulas are read as values only; ZIP64 (> 4 GB) not supported.
