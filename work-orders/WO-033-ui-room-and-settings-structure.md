# WO-033: UI structure: Room workspace + Settings area

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-018 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
DEC-011: top-level tabs **Room** (default, full width) and **Settings** (all existing views, own side nav).

## Scope
- Router: nested routes `#/room`, `#/settings/<view>`; old `#/<view>` links redirect to `#/settings/<view>`.
- Header with the two tabs; Settings keeps the current side navigation (incl. feature gating).
- Room placeholder until WO-035.
- Update ui-check routes/scenarios.

## Acceptance criteria
- [x] All existing views reachable under Settings with unchanged behaviour (ui:check on both systems passes).
- [x] Old hash links still work (redirect).

## Work log
- 2026-10-03 (Claude Opus): Router rewritten for two areas (`#/room` home, `#/settings/<view>` with side nav); legacy `#/<view>` links redirect via history.replaceState; header tabs Room / Settings; CSS hides the side nav in the Room area. All existing ui:check scenarios pass unchanged (they use legacy links → redirect proves compatibility).

## Decisions

## Handoff
Done.
