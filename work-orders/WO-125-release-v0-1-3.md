# WO-125: Release v0.1.3

| | |
|---|---|
| **Status** | done |
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
- [x] `npm test` green on the release commit.
- [x] `npm run dist` produces the 6 assets `LikeABosch-0.1.3-*`; no Bosch text in the bundles (scan as in WO-107).
- [x] Tag `v0.1.3` pushed; release published with the assets.

## Work log
- 2026-10-14 (Claude Opus): created, in-progress. Features committed (`fb6e59b`: WO-124 + WO-122/123 docs); versions
  bumped with `npm version 0.1.3 --no-git-tag-version` (root + launcher).
- 2026-10-14 (Claude Opus): `npm test` 373/373. `npm run dist` exit 0: 6 assets `LikeABosch-0.1.3-*` (mac x64 + arm64
  dmg/zip, win x64 setup/zip). All three unpacked bundles: package.json 0.1.3, `web/js/views/seating.js` with the seat
  picker and without the "planned, WO-081" text. Bosch-text scan of the three bundles (app + bridges) with 4 sample
  sentences (Wireless swagger, CCS 1000 D swagger, DCNM api summary, Conference Protocol operation): 0 hits each;
  positive control in docs/protocol: 4/4/1/3 files. Companion module packages rebuilt (`npm run package`:
  `likeabosch-1.0.0.tgz`, `bosch-discussion-system-1.0.0.tgz`; module code unchanged since v0.1.2).
- 2026-10-14 (Claude Opus): committed `094e985`, annotated tag `v0.1.3`, pushed main + tag. First
  `gh release create` with all assets failed at the end: a retried upload of the Windows zip got HTTP 422 "ReleaseAsset.name
  already exists" and gh deleted the draft. Redone as draft without assets → `gh release upload --clobber` per file
  (all 8 ok first try; sizes match the local files) → `gh release edit --draft=false --latest`. Release
  https://github.com/mko1989/LikeABosch/releases/tag/v0.1.3 (Latest, not a draft, not a pre-release). Status → done.

## Decisions
- Patch bump (0.1.3): the release carries one UI fix (WO-124) and docs.

## Handoff
Delivered: release v0.1.3 (6 installers, 2 Companion module packages unchanged since 0.1.2). Not signed (WO-029).
WO-124 stays in review until seat assignment is checked with the dicentis-bridge on a real system (WO-082). For future
releases: upload large assets one by one (`gh release upload --clobber`); a single create with all assets can fail
and remove the draft.
