# WO-057: Projects in the top bar (name, save as, load, download) + one shared data folder

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-034, WO-038, WO-030, WO-056 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
User (2026-10-05): "kind of weird that by running the server directly and from launcher I get different 'projects'.
On that note I need project name, save, load, download in the top bar." Decisions in DEC-016.

## Context
DEC-016, DEC-008 (launcher), WO-034 (room store), WO-038 (device manager), WO-013 (settings.json).

## Scope
- In: `backend/src/lib/paths.js` default per-user data folder; config uses it when `DATA_DIR` is unset;
  launcher stops passing `DATA_DIR`; `.env.example` no longer sets it.
- In: ProjectManager (`backend/src/projects/`): layout, migration, create/copy/rename/open/delete, export/import,
  `project` topic, updatedAt on every room/devices save. RoomStore/DeviceManager `open(dir)`, director reset.
- In: routes per DEC-016 §7 + tests (CRUD, open switches room + devices, export/import round trip incl. background
  and passwords, invalid file rejected, migration of an old-layout folder).
- In: top bar: project name (click to rename), "Saved hh:mm", Save as…, Load… (dialog: projects list with Open /
  Delete, New empty project, From file…), Download. ui-check scenario + screenshots.
- Out: multi-user locking, project history/versions, DICENTIS connection in projects (DEC-016 §1).

## Acceptance criteria
- [x] Without `DATA_DIR`, direct start and launcher use the same folder (unit test of the path + launcher env test).
- [x] Old-layout folder migrates into a project; fresh default folder imports legacy data as projects (test with
      injected legacy dirs; never deletes the source).
- [x] Open/Save as/rename/delete/download/import work via API (tests); opening a project swaps room + cameras.
- [x] Top bar shows name + saved time, Save as / Load / Download work in the UI (ui-check + screenshots looked at).
- [x] `npm test` green, `npm run ui:check` OK, launcher tests green.

## Work log
- 2026-10-05 (Claude Opus): Camera model dropdown fix (WO-040 area, logged there). Asked the user 4 questions
  (contents, data folder, passwords in downloads, save model) → DEC-016. WO created.
- 2026-10-05 (Claude Opus): Backend: `lib/paths.js` (defaultDataDir per OS, legacyDataDirs = repo `data/` +
  `<appData>/likeabosch-launcher/backend-data`); config `dataDir` default + `dataDirIsDefault`; launcher `backendEnv`
  passes DATA_DIR only when given (tests), main.js passes none; `.env.example` no longer sets DATA_DIR.
  RoomStore/DeviceManager: `open(dir)`, `flush()`, `onSaved` hook, `sanitizeRoom` / `sanitizeDevices` for imports.
  `projects/manager.js` (ProjectManager: layout, migration, create/copy/rename/open/remove, export/import, `project`
  topic, updatedAt on every save) + `projects/routes.js`; `CONFLICT: 409` error code; `project` is a local cache
  topic (survives DICENTIS disconnect; connection.test.js expectation updated); `Director.reset()` on open.
  devices.test.js reads devices.json from the open project's folder.
- 2026-10-05 (Claude Opus): Tests `backend/test/projects.test.js` (6): paths + config + launcher env; fresh folder
  CRUD incl. unique names, 409 on deleting the open project; open swaps cameras (reconnected); download → load round
  trip (room, shots with camera ids, floor plan bytes, password included; invalid/foreign files 400; invalid entries
  dropped); old layout moved into "My project"; legacy import with injected dirs (2 projects, settings.json copied,
  sources kept). `npm test`: 158/158 pass.
- 2026-10-05 (Claude Opus): UI: `web/js/project-bar.js` in the header (name = rename, "✓ Saved hh:mm", Save as…,
  Load… dialog with Open / Delete / New empty project / Load from file… / Save as / Download, Download link);
  `promptText` dialog in dom.js; `api.upload`; room view clears selection + undo when another project opens;
  narrow screens keep name + Load… (Save as / Download are in the dialog). ui-check (wired room scenario): rename →
  Save as "Council B" (2 projects, same seats) → download JSON has format + 2 cameras → Load dialog → open "Council
  chamber" (confirm) → 2 cameras back on the plan. `node scripts/ui-check.mjs` (both systems): UI CHECK OK.
  Screenshots looked at: `wired-projects-dialog-scenario-light.png`, `wired-project-bar-scenario-light.png`.
- 2026-10-05 (Claude Opus): Checked (file names only) what the user's first start will import: repo `data/`
  (room 96 seats, 3 VISCA cameras + ATEM, settings.json) and launcher `backend-data/` (3 seats, mock cameras);
  the repo one is newer, so it opens first. `~/Library/Application Support/LikeABosch` does not exist yet.

## Decisions
- DEC-016.

## Handoff
Delivered: projects (auto-saved, one folder each) with name / Save as / Load / Download in the top bar, file
import/export incl. floor plan and camera passwords, one per-user data folder for direct start and launcher with a
one-time copy of the old data. Status `review`: the user's first real start performs the migration (not run here,
to avoid connecting to their cameras/DICENTIS from this session).
Known gaps: no per-project DICENTIS connection (by decision); no locking if two browsers switch projects at once
(last one wins, everyone follows the `project` topic); the old repo `data/room.json` etc. stay as a backup.
