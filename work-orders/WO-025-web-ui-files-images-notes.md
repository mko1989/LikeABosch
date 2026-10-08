# WO-025: Files, images, synoptic layouts and notes

| | |
|---|---|
| **Status** | done |
| **Phase** | 3 Web UI |
| **Depends on** | WO-018 |
| **Assignee** | Claude Opus (main) + Haiku (mock data) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Image management (list/save/delete) for synoptic backgrounds, layout files (create/list/load/update/delete), notes files (list/delete/transform/tamper check).

## Scope (draft: refine into concrete tasks + acceptance criteria before starting)
- Read DEC-002 (plain HTML/JS, no framework) and the UI conventions decided in WO-018.
- Use only `web/js/api.js` + the SSE store for data; never call DICENTIS directly.
- Hide or disable controls the current permissions don't allow (`GET /api/connection` → permissions).
- Test manually against the mock and note the steps in the work log; real-server check goes into WO-028.

## Acceptance criteria
- [x] Notes: list, date-range search, view (sandboxed), verify, delete (permission-gated).
- [x] Layout files: list, download, upload, delete; images: list, upload (≤ 2 MB), delete with automatic list refresh.
- [x] ui:check scenario passes light/dark; screenshot reviewed.

## Work log
- 2026-10-02 (Haiku subagent): `mock/wired/behaviours/files.js` (2 layouts, 2 images, 3 notes files; all 13 operations; date-range filter). Reviewed by Claude Opus; covered by the mock spec-conformance test.
- 2026-10-02 (Claude Opus): `web/js/views/files.js` ("Files & notes"): notes list (newest first, type tag, tampered badge) with date-range search via `GetNotesFileList(searchDateRange)`, View (TransformNotesFile → sandboxed iframe dialog), Verify (CheckNotesFileTampered → toast), Delete (confirm); layout files (ListFiles) with Download (LoadFile payload → file), Upload (CreateFile, attribute `Bosch.Synoptic.Layout`), Delete; background images with Upload (SaveImage, base64, 2 MB limit) and Delete. Backend: `events.json` `topicsWithoutEvent[].refreshAfter` + `WiredEventBridge.operationSucceeded()` + passthrough `onSuccess` hook, so the image list refreshes after the backend's own SaveImage/DeleteImage (validator checks the ops; passthrough test added). ui:check scenario: date filter, sandboxed view, verify, image delete → list refresh. `npm test` 63/63.

## Decisions
- **Server-provided notes HTML is only rendered in `<iframe sandbox="">` via `srcdoc`** (no scripts, opaque origin); never in the page DOM (DEC-009). The page CSP also applies, so inline styles in notes may not render, which is acceptable for readability.
- Images: the listed value may be a relative URI (PDF) or a name (mock); the UI passes the basename to DeleteImage → verify on the real server (WO-028). No thumbnails: images live on the DICENTIS image server (other origin, self-signed cert), so they'd need a backend image proxy if wanted later.
- Images have no change event; changes by other clients appear only after a resync.

## Handoff
Done against the mock. Possible follow-up: image thumbnails via a backend proxy for `GetImageServerInfo` URIs; editing layout titles (UpdateFile).
