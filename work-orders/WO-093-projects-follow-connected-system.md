# WO-093: Projects follow the connected DICENTIS system (DEC-025)

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-057, WO-091 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
User (2026-10-07, on "better project awareness"): "when connecting to another system it still loads with the same project which doesn't make sense." A project belongs to the system it is used with; connecting to another system opens (or creates) that system's project.

## Context
DEC-016 (projects; the connection stays outside projects), DEC-025 (this rule), WO-091 (project bar).

## Scope
- In: `system` link in project meta; `ProjectManager.useSystem` / `link`; `backend/src/projects/system-link.js` (status → system key + reported name → useSystem); `PATCH /api/projects/:id {system}`; project bar: system per project in the dialog, warning tag + "Use with <system>", toasts for automatic switches.
- Out: storing connection settings in projects (rejected in DEC-016).

## Acceptance criteria
- [x] Connect → unlinked project adopted (named system from the room name); another system → its own new project; back → the first reopens; reconnect same system → no change; new/copy/import belong to the connected system; manual link/unlink (`backend/test/project-system.test.js`).
- [x] ui-check: projects dialog shows "for Mock Council Chamber"; `npm test` 259/259, `node scripts/ui-check.mjs` OK; screenshot looked at.

## Work log
- 2026-10-07 (Claude Opus): DEC-025 + implementation as in Scope. The label waits up to 3 s for the system's own name
  (wired `roomName`, wireless `wirelessSystemInfo.Hostname`), else "<type> <host>". First test run failed on a race in my
  code (adopt wrote the link before recording `lastOpen`); fixed. ui-check wired room: the dialog lists the system per
  project (`wired-projects-dialog-scenario-light.png` looked at). `npm test` 259/259, ui-check (all systems) OK.

- 2026-10-07 (Claude Opus): correction: "open the most recently changed project of the system" picked the wrong one when coming back from a simulation; projects now record `openedAt` and the project *last used* with the system opens (DEC-025 §2 adjusted the same day, before review; WO-095).

## Decisions
- Switch automatically (no question) with an 8 s toast; existing unlinked projects are adopted by the first system they are used with; a reconnect to the same system never switches (a project opened by hand stays).

## Handoff
Delivered: projects per system. Status `review`: user to try with two real systems (WAP + wired server). Note: the key is type + host + port, so the same system under a different IP counts as another system (relink with "Use with …").
