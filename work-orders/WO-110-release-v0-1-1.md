# WO-110: Release v0.1.1

| | |
|---|---|
| **Status** | in-progress |
| **Phase** | 4 Hardening |
| **Depends on** | WO-107, WO-108, WO-109 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-10 |
| **Updated** | 2026-10-10 |

## Goal
Publish v0.1.1 on GitHub with the installers, carrying WO-108 (faster camera shots) and WO-109 (UI reconnects by
itself). User request 2026-10-10: "commit push and create a release".

## Context
Release process as in WO-107 (v0.1.0): `npm run dist` (Windows setup + zip, macOS arm64/x64 dmg + zip, unsigned,
specs stripped of Bosch's text), tag, `gh release create` with the 6 assets and install notes.

## Scope
- In: version 0.1.0 → 0.1.1 (root + launcher package.json and lockfiles); build; check the builds; tag `v0.1.1`;
  push; GitHub release with assets and notes (changes since v0.1.0 + the install notes of v0.1.0).
- Out: code signing (WO-029).

## Deliverables
Version bump, tag `v0.1.1`, GitHub release.

## Acceptance criteria
- [ ] `npm test` green on the release commit.
- [ ] `npm run dist` produces the 6 assets named `LikeABosch-0.1.1-*`; no Bosch text in the bundles (scan as in WO-107).
- [ ] Tag `v0.1.1` pushed; release published with 6 assets.

## Work log
- 2026-10-10 (Claude Opus): Created. WO-108/109 committed (`5d7dc85`). Versions bumped with
  `npm version 0.1.1 --no-git-tag-version` (root + launcher). Status → in-progress.
- 2026-10-10 (Claude Opus): `npm test` 322/322. `npm run dist` exit 0: 6 assets `LikeABosch-0.1.1-*` (mac x64 + arm64
  dmg/zip, win x64 setup/zip). All three unpacked bundles contain `web/js/live-stream.js` and version 0.1.1. Bosch-text
  scan of the three bundles with 4 sample description strings (Conference Protocol, DCN-SW API, DCNM API, Wireless
  swagger): 0 hits; the same strings found in `docs/protocol` (positive control: 2/1/1/2 files).

## Decisions
- Patch version (0.1.1): bug fixes and timing changes, no new features or breaking changes.

## Handoff
