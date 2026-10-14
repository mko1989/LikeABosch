# WO-125: Release v0.1.3

| | |
|---|---|
| **Status** | in-progress |
| **Phase** | 4 Hardening |
| **Depends on** | WO-124 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-14 |
| **Updated** | 2026-10-14 |

## Goal
Publish v0.1.3 on GitHub with the installers. User request 2026-10-14: "bump version and commit push to github and
make a release".

## Context
Release process as in WO-107 / WO-110 / WO-121: `npm run dist` (Windows setup + zip, macOS arm64/x64 dmg + zip,
unsigned, specs stripped of Bosch's text), tag, `gh release create` with the assets and notes.

## Scope
- In: version 0.1.2 → 0.1.3 (root + launcher package.json and lockfiles); build; check the builds (version, WO-124
  code, no Bosch text); tag `v0.1.3`; push; GitHub release with assets and notes; the two Companion module packages
  as extra assets (as in v0.1.2).
- Out: code signing (WO-029); publishing the `bosch-dicentis` 2.0.0 module (WO-122/123, separate repository, the
  user's).

## Acceptance criteria
- [ ] `npm test` green on the release commit.
- [ ] `npm run dist` produces the 6 assets `LikeABosch-0.1.3-*`; no Bosch text in the bundles (scan as in WO-107).
- [ ] Tag `v0.1.3` pushed; release published with the assets.

## Work log
- 2026-10-14 (Claude Opus): created, in-progress.

## Decisions
- Patch bump (0.1.3): the release carries one UI fix (WO-124) and docs.

## Handoff
