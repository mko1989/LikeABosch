# WO-046: Meeting area: meeting, agenda, participants, seating (read-only assignment)

| | |
|---|---|
| **Status** | done |
| **Phase** | 3 Web UI |
| **Depends on** | WO-020, WO-022, WO-044 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
User (2026-10-03): "another tab with all the meeting settings, participants, agenda etc.; easy assigning seats to
participants". DEC-014: a top-level **Meeting** tab; assignment is read-only for now (Conference Protocol limit).

## Context
DEC-014, DEC-011, DEC-009, DEC-010; existing views `web/js/views/meetings.js` (WO-020), `participants.js` (WO-022).

## Scope
- In: router with three areas (room / meeting / settings), tabs, per-area side navigation, legacy redirects
  (`#/meetings`, `#/participants`, `#/settings/meetings`, `#/settings/participants` → Meeting area).
- In: Meeting area views: **Meeting** (current meeting + list, activate/open/close: existing view), **Agenda** (split out of
  the meetings view: topics, open/close), **Participants** (existing view; adds userName/screenLine when present),
  **Seating**: every seat with its assigned and seated participant, unassigned participants, filter/search, "show on plan"
  (opens the room with that seat selected), and a clear note that assignment is done in Bosch's Meeting Application.
- In: domain participants carry `assignedSeatId` / `seatedSeatId` (ids, not only names) for the seating view.
- Out: editing assignments, participants, agenda (WO-050, Windows sidecar). Wireless: Meeting area shows only what the
  wireless domain offers (participants; meetings/agenda hidden by capability).

## Acceptance criteria
- [x] Three tabs; Meeting area views work on the wired mock; legacy links redirect; wireless shows participants (+ seating) only.
- [x] Seating view lists seat ↔ participant (assigned + seated) and "show on plan" selects the seat in the room.
- [x] `npm test`, `npm run ui:check` (scenario for the Meeting area) pass; screenshots reviewed.

## Work log
- 2026-10-03 (Claude Opus): router rewritten around a generic area list (`web/js/router.js`): Room + areas with side
  navigation (Meeting, Settings), last view per area, legacy redirects (`#/<view>`, `#/settings/meetings` →
  `#/meeting/meetings`); tabs hide an area with no usable view. `main.js`: Meeting area = Meeting (`meetings.js`, agenda
  part moved out), **Agenda** (`agenda.js`), Participants (+ userName / screen line from 6.3), **Seating** (`seating.js`:
  seat ↔ assigned/seated participant, filter + search, participants without a seat, "Show on plan" →
  `#/room?seat=<id>`, read-only note pointing to WO-050; wireless variant: no "seated" column, seat set in Participants).
  Domain participants gained `assignedSeatId`, `seatedSeatId`, `userName`, `screenLine` (unit test).
- ui:check: new `seating` scenario (legacy redirect, three tabs, area nav, 20 seating rows, Show on plan → room selects
  seat 3 and the plan renders); `meetings` scenario continues on the Agenda view. Screenshots reviewed (seating light/dark,
  agenda, wireless seating). First layout had the table squeezed (Device/Show on plan cut off) → `split wide-main`.
- **Found a real bug** (from WO-034/038/039): `ConnectionManager.disconnect()` cleared the whole state cache incl.
  LikeABosch's own topics (room, devices.*, director), so after a DICENTIS disconnect/reconnect new browsers showed
  "Loading room…" forever. `StateCache.clear()` now keeps local topics (`isLocalTopic`); connection test updated; the
  seating scenario (dark pass runs after the light pass's disconnect test) asserts the plan renders.
- One unexplained failure of the dark `discussion` scenario in one full run; passed in 3 reruns (isolated and full). Watch.
- `npm test` 134/134, `npm run ui:check` OK.

## Decisions
- Meeting area views keep their ids (`meetings`, `participants`) so old links and scenarios redirect instead of breaking.

## Handoff
Done. Editing (assignments, participants, agenda) waits for WO-050.
