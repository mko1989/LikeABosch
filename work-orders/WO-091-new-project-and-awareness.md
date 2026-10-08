# WO-091: Projects: start a new (empty) project, clear the room, clearer "which project is open"

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-057 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
The user can start a fresh project or clear the current one, and always sees which project is open and that changes go into it.

## Context
DEC-016 / WO-057 (projects in the top bar, auto-save, Save as / Load / Download). Missing: "New project", "Clear" (layout, shots, devices).

## Scope
- In: backend `POST /api/projects` with `{ name, blank: true }` (empty room + devices) and `POST /api/projects/:id/clear { room?, shots?, devices? }`; project bar: "New…" and in the project dialog "Clear…" (choose what), project name in the browser title and on the Room toolbar, toast "Project X opened".
- Out: multi-user locking.

## Acceptance criteria
- [x] New project starts empty and becomes current; Clear removes the chosen parts (tests).
- [x] UI flow in ui-check + screenshots looked at; `npm test` green.

## Work log
- 2026-10-07 (Claude Opus): created from the user's list in `next.md` ("better project awernes. there is no option to clear or start a fresh project"); scope set (ready).

- 2026-10-07 (Claude Opus): Found that "New empty project" already existed but only inside the Load… dialog, which explains the user's
  "no option". Project bar now: label PROJECT, name, saved time, **New…**, **Projects…** (was Load…), Save as…,
  Download; window title = project name; a toast when another window opens a different project (not for this window's
  own switches: first version showed two toasts, fixed). Projects… dialog: **Clear…** with checkboxes (room layout,
  camera presets + overview, floor plan, cameras + switcher). Backend `POST /api/projects/current/clear`,
  `RoomStore.clear`, `DeviceManager.clearAll`. Test in `projects.test.js`; ui-check: New… → empty "Fresh start" →
  Clear shots keeps the layout → back to "Council chamber". Screenshots looked at (`wired-project-clear-scenario`,
  `wired-project-bar-scenario`). `npm test` 257/257, `node scripts/ui-check.mjs` (all systems) OK, `npm run e2e:wireless:mock` 23/23 checks, `npm run e2e:mock` 31/31.

- 2026-10-07 (Claude Opus): the user clarified "project awareness": projects should follow the connected system → WO-093 / DEC-025.

## Decisions
- Clear asks what to remove (no all-or-nothing); director/operate settings are never cleared.

## Handoff
Delivered: New / Clear / clearer project bar. Status `review`. Ask the user whether "better project awareness" meant
more (e.g. a warning when the room's seats don't match the connected system).
