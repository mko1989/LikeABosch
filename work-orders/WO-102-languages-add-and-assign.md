# WO-102: Languages: add system languages, choose the meeting's languages, assign them to interpreter desks

| | |
|---|---|
| **Status** | review |
| **Phase** | 3 Web UI |
| **Depends on** | WO-101, WO-023, WO-048 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-08 |
| **Updated** | 2026-10-08 |

## Goal
User (2026-10-08): "adding and assigning languages." With the full DICENTIS API (real dicentis-bridge or the simulated
one), the operator can add/edit/delete languages in the system list, pick which languages the meeting uses (order,
Dante output, second stream), and assign output languages A/B/C (and the selectable B/C sets) to each interpreter desk.

## Context
DEC-029 (feature layer), DEC-021. DCNM: `ConfigLanguage` (Get/Create/Update/DeleteLanguageAsync, `Language*` events),
`ConfigInterpretation` (Get/Create/Delete/UpdateMeetingLanguage(s)Async, ChangeMeetingLanguagesOrderAsync,
RetrieveMeetingDesksAsync, UpdateMeetingDeskInfoAsync, `CanConfigureInterpretationLanguages`,
`CanConfigureDanteLanguageChannels`, `CanConfigureDesksAndBooths`), `ControlMeeting.ActiveMeetingStatusChanged` (meeting
id). Types: `DcnmLanguageInfo`, `DcnmMeetingLanguageInfo`, `DcnmMeetingDeskInfo`. UI: `web/js/views/interpretation.js`,
room desk inspector (WO-048/051).

## Scope
- In: `backend/src/dicentis/context.js` (active meeting id, area ids) + `languages.js` → topics `dicentis.languages`,
  `dicentis.meetingLanguages`, `dicentis.desks`; actions `POST /api/dicentis/languages/{create,update,delete}`,
  `/meeting-languages/{add,remove,order,update}`, `/desks/update` (validated); capability `dicentis.languages`.
  UI: Settings → Interpretation → "Languages" card (system list with add/edit/delete for user-defined languages; meeting
  languages with add from the list, ↑/↓ order, Dante out, stream 2; desks table: output A, B/C defaults + allowed sets);
  the room desk inspector links to it. Without the full API: read-only list from the Conference Protocol + a hint how to
  enable it.
- Out: booths configuration, interpretation modes (`UpdateInterpretationSettingsAsync`) → follow-up if wanted.

## Acceptance criteria
- [x] Backend tests against the linked mocks: create language → topic updates; add to meeting → wired
  `interpretationLanguages` topic shows it; reorder; desk output A change → `dicentis.desks` and wired
  `interpreterSeats` agree; validation errors (unknown id, missing fields) → 400.
- [x] ui-check scenario on a simulated wired system: add a language, add it to the meeting, assign it to a desk;
  screenshots looked at.
- [x] `npm test` passes.

## Work log
- 2026-10-08 (Claude Opus): created (ready).
- 2026-10-08 (Claude Opus): backend `backend/src/dicentis/languages.js` + the language actions of the service (see
  WO-081 log; one feature layer for both). Tests in `backend/test/dicentis.test.js` (create → add to meeting → wired
  `interpretationLanguages` shows it → reorder → stream 2 → desk output B (+ joins set B) → wired `interpreterSeats`
  agrees → validation 400s → remove → delete; built-in cannot be deleted).
- 2026-10-08 (Haiku subagent, reviewed by Claude Opus): `web/js/dicentis-languages.js` (`mountDicentisLanguages`):
  meeting languages (order ↑/↓, Dante, 2nd stream, remove, add), desks table (outputs A/B/C, selectable B/C sets),
  system languages in a `<details>` (add form kept across re-renders, inline edit, delete). Reviewed: DOM via h(), no
  innerHTML, writes via api.dicentis; accepted. Its open point (no h3 for system languages, summary instead) is fine.
- 2026-10-08 (Claude Opus): mounted as "Languages setup (add & assign)" in Settings → Interpretation (`#languages-setup`),
  link from the room desk inspector; CSS. ui-check `interpretation` extended (add Swedish, add to meeting, the wired
  Languages card shows SV, assign as output B of Booth 1 Desk 1, remove, delete) OK light + dark; screenshot
  `wired-languages-scenario-light.png` looked at.

## Decisions
- System languages: only user-defined ones can be changed/deleted (built-ins are DICENTIS's catalogue).
- Giving a desk output B/C a language adds it to that output's selectable set (the desk could not select it otherwise).

## Handoff
- Delivered as in Scope (DICENTIS via the full API; without it the card explains how to enable it). Booths and
  interpretation modes not included (follow-up if wanted). Real-system check: WO-082.
