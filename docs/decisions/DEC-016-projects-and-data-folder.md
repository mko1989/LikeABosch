# DEC-016: Projects (room + cameras) and one shared per-user data folder

- **Status:** accepted (decided by user 2026-10-05: contents, data folder, passwords in downloads, auto-save;
  storage layout and API proposed by Claude); extended by DEC-025 (projects belong to a system)
- **WO:** WO-057

## Context
Starting the server directly used `./data` (repo), the launcher used `<launcher userData>/backend-data`, so the two
showed different room layouts and cameras. The user wants a project name plus save, load and download in the top bar.

## Decision
1. **A project** = the room (outline, floor plan image, seat/camera/desk placements, seat shots, overview, director
   and operate settings) + the cameras and the video switcher (`devices.json`, including camera passwords). The
   DICENTIS connection is **not** part of a project: it stays a per-machine setting (env / launcher / `settings.json`),
   so opening a project never reconnects to another DICENTIS (user).
2. **Auto-save** (user): every edit is written into the open project immediately; there is no "unsaved" state.
   "Save as…" copies the open project under a new name and opens the copy.
3. **One data folder** for direct start and launcher (user): default `~/Library/Application Support/LikeABosch`
   (Windows `%APPDATA%\LikeABosch`, Linux `$XDG_CONFIG_HOME/LikeABosch` or `~/.config/LikeABosch`).
   `DATA_DIR` still overrides it (tests use temp dirs). The launcher no longer passes its own `DATA_DIR`.
4. **Layout:** `<data>/settings.json` (machine), `<data>/project.json` (`{ current }`), `<data>/projects/<id>/`
   with `project.json` (`{ name, createdAt, updatedAt }`), `room.json`, `devices.json`, `room-background.*`.
5. **Migration (never deletes):** an old-layout data folder (room.json/devices.json at its root) is converted in
   place into a project. When the default folder is new, existing data from the repo's `data/` and the launcher's
   `backend-data/` is **copied** in as one project each ("Imported: server data", "Imported: launcher data"), and the
   most recently changed one is opened; the repo's `settings.json` is copied if the new folder has none.
6. **File format** for download/load: one JSON file `<name>.likeabosch.json`
   `{ format: "likeabosch-project", version: 1, name, exportedAt, room, devices: { cameras, switcher },
   background: { type, data (base64) } | null }`. **Camera passwords are included** (user): treat the file as
   sensitive. Loading a file creates a new project (name made unique) and opens it; unknown/invalid entries are
   dropped, ids are kept so shots still point at the right cameras.
7. **API:** `GET /api/projects`, `POST /api/projects {name, copyCurrent?}`, `PATCH /api/projects/:id {name}`,
   `POST /api/projects/:id/open`, `DELETE /api/projects/:id` (not the open one), `GET /api/projects/:id/download`,
   `POST /api/projects/import` (raw file body). Live topic `project` `{ current, projects }`.

## Consequences
- RoomStore and DeviceManager can switch directories (`open(dir)`); opening a project reconnects cameras/switcher
  and resets the director's preset memory.
- Anyone with a downloaded project file can read the camera passwords.

## Alternatives considered
- Projects including the DICENTIS target: conflicts with the launcher's pinned connection settings; rejected by user.
- Explicit save with an unsaved-changes state: rejected by user in favour of auto-save.
- Keeping two data folders and only moving setups by file: rejected by user.
