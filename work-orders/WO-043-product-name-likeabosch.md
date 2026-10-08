# WO-043: Product name "LikeABosch" in the UI and launcher

| | |
|---|---|
| **Status** | done |
| **Phase** | 4 Hardening |
| **Depends on** | WO-018, WO-030 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
User (2026-10-03): "i wanted this to be called LikeABosch and not a generic dicentis client". DEC-013 §1.

## Scope
- In: web UI `<title>`, header brand, per-view `document.title` suffix (`<view> · LikeABosch`); launcher window title,
  `<title>`, heading, README, package description; tests/smoke checks that matched the old name.
- Out: Electron `productName` (would move the launcher's userData folder and lose saved settings; revisit with packaging, WO-029).
  "DICENTIS" stays wherever it names the Bosch system (connection settings, docs).

## Acceptance criteria
- [x] No user-visible "DICENTIS Client" / "DICENTIS Launcher" left (`grep`); `npm test`, `npm run ui:check` pass.

## Work log
- 2026-10-03 (Claude Opus): renamed in `web/index.html`, `web/js/router.js`, `web/css/app.css` (comment),
  `backend/test/scaffold.test.js`, `launcher/renderer/index.html`, `launcher/main.js` (window title + smoke check),
  `launcher/README.md`, `launcher/package.json` (description).

## Handoff
Done. Packaging (app name, icon, bundle id) belongs to WO-029.
