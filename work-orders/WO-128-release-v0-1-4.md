# WO-128: Release v0.1.4 (WO-126, WO-127)

| | |
|---|---|
| **Status** | in-progress |
| **Phase** | 4 Hardening |
| **Depends on** | WO-126, WO-127 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-16 |
| **Updated** | 2026-10-16 |

## Goal
Publish v0.1.4 on GitHub with the installers. User request 2026-10-16: "bump the v to 0.1.4 and do a comit push and
relese".

## Context
Release process as in WO-107 / WO-110 / WO-121 / WO-125: `npm run dist` (Windows setup + zip, macOS arm64/x64 dmg +
zip, unsigned, specs stripped of Bosch's text), tag, `gh release create` as draft, upload assets one by one, publish.

## Scope
- In: version 0.1.3 → 0.1.4 (root + launcher package.json and lockfiles); build; check the builds (version, WO-126 /
  WO-127 code, no Bosch text); tag `v0.1.4`; push; GitHub release with assets and notes; the two Companion module
  packages as extra assets (as in v0.1.2 / v0.1.3).
- Out: code signing (WO-029).

## Acceptance criteria
- [ ] `npm test` green on the release commit.
- [ ] `npm run dist` produces the 6 assets `LikeABosch-0.1.4-*`; no Bosch text in the bundles (scan as in WO-107).
- [ ] Tag `v0.1.4` pushed; release published with the assets.

## Work log
- 2026-10-16 (Claude Opus): created, in-progress.

## Decisions
- Patch bump (0.1.4): one launcher fix (WO-126) and a Room UI change (WO-127).

## Handoff
