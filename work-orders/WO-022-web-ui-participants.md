# WO-022: Participants

| | |
|---|---|
| **Status** | done |
| **Phase** | 3 Web UI |
| **Depends on** | WO-018 |
| **Assignee** | Claude Opus (main) + Haiku (mock data) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Participant list with seat assignment and presence (wired: read-only; wireless: CRUD via domain API when available), access-denied notifications.

## Scope (draft: refine into concrete tasks + acceptance criteria before starting)
- Read DEC-002 (plain HTML/JS, no framework) and the UI conventions decided in WO-018.
- Use only `web/js/api.js` + the SSE store for data; never call DICENTIS directly.
- Hide or disable controls the current permissions don't allow (`GET /api/connection` → permissions).
- Test manually against the mock and note the steps in the work log; real-server check goes into WO-028.

## Acceptance criteria
- [x] Table with search/group/present filters and sorting; seat assignment shown.
- [x] Access-denied notifications shown (toast + history), no replay at login.
- [x] ui:check scenario passes; screenshots reviewed.

## Work log
- 2026-10-02 (Claude Opus): Refined + implemented `web/js/views/participants.js`: summary (participants / present / may vote), sortable table (surname order, aria-sort), search, group filter, "present only", assigned vs. seated seat (GetParticipantSeats), access-denied history for this session. Store keeps the last 20 notifications (`store.notifications`); the toast now shows the reasons. Mock: `GetParticipantAccessDeniedReasons` behaviour + `mock.denyAccess(...reasons)` helper. ui:check scenario (filters, present-only, simulated access denial via a new stdout request channel `{"type":"mock","fn":...}` from the headless browser to the orchestrator) passes light/dark; screenshot reviewed.
- Found and fixed: (1) the bridge fetched notification topics during the initial sync, so a stale "access denied" toast would appear at every login; notification topics are now fetched only on their event (test added). (2) The GetPermissions response enum (PDF p.151) is an older subset; the new mock-conformance test flagged it, so the spec now uses an open string array (extractionNotes keep the PDF list), and smoke-wired checks against types/Permission.json instead.

## Decisions
- Read-only: the wired Conference Protocol has no participant-editing operations. Editing (wireless REST has CRUD) comes with WO-017/027.
- Sorting by name uses surname + first name; titles are displayed but don't affect order.

## Handoff
Done against the mock.
