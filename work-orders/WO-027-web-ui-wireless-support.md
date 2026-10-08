# WO-027: Wireless system support in the UI

| | |
|---|---|
| **Status** | draft |
| **Phase** | 3 Web UI |
| **Depends on** | WO-017, WO-019 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
UI works against a wireless WAP through the domain API and capability flags; wired-only views hidden.

## Scope (draft: refine into concrete tasks + acceptance criteria before starting)
- Read DEC-002 (plain HTML/JS, no framework) and the UI conventions decided in WO-018.
- Use only `web/js/api.js` + the SSE store for data; never call DICENTIS directly.
- Hide or disable controls the current permissions don't allow (`GET /api/connection` → permissions).
- Test manually against the mock and note the steps in the work log; real-server check goes into WO-028.

## Acceptance criteria
- [x] Shared views (Overview, Seats & discussion, Voting, Participants, System) work on wired and wireless; wired behaviour unchanged (all wired ui:check scenarios still pass).
- [x] Wired-only views (Meetings, Interpretation, Files, Plugins) hidden on wireless; wireless extras shown only on wireless.
- [x] `npm run ui:check` runs both systems (light + dark) with scenarios; screenshots reviewed.

## Work log

## Handoff

## Work log
- 2026-10-02 (Claude Opus): Store: `capabilities`, `system`, `feature()`, `action()`. Router: views with `feature` are hidden when the system lacks it; views re-mount on a system switch. Migrated to `domain.*` + `/api/domain`: Seats & discussion (wireless: Request, Priority/End priority on priority seats, Clear all, battery/signal diagnostics; wired: timers, mute), Overview (cards per feature; access-point card on wireless; cards watch extra topics), System (power on/standby/off via domain; identification mode + access-point cards on wireless; wired cards per feature), Voting (domain lifecycle; wireless controls + parameters form; wired prepared/ad-hoc/majority/quorum unchanged), Participants (wired table unchanged; wireless CRUD editor via passthrough). Connection view: wireless option, port default follows system, TLS option disabled for wireless, "Take over session" on 409 (manager status now carries `lastError.reason`). `api.domain()` / `api.wireless()` helpers. Plugins capability added (wired only).
- ui:check: `--system wired|wireless|both` (default both), wireless backend + mock pass with scenarios (discussion incl. nav gating, voting params + live results via mock votes, participant add/edit/delete, standby + identification mode, live request-to-speak from the WAP). Regression caught and fixed: Overview System card no longer re-rendered on volume changes after the migration (cards now take extra `watch` topics). Result: UI CHECK OK on both systems; `npm test` 89/89.

## Decisions
- Shared views read only `domain.*`; system-specific detail (wired meetings/prepared votings, wireless parameters/participants editing) uses raw topics + the system's passthrough, shown per `features`.
- Wireless participants editing lives in the Participants view (branch at mount) rather than a separate view.

## Handoff
Done against both mocks. Real-hardware checks: WO-028 (wired + WAP). Remaining roadmap: WO-026 Plugins (low priority), WO-028 verification, WO-029 security/packaging.
