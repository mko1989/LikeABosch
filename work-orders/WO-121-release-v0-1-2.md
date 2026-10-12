# WO-121: Release v0.1.2

| | |
|---|---|
| **Status** | in-progress |
| **Phase** | 4 Hardening |
| **Depends on** | WO-106, WO-111, WO-112, WO-115, WO-117, WO-118, WO-119, WO-120 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-12 |
| **Updated** | 2026-10-12 |

## Goal
Publish v0.1.2 on GitHub with the installers. User request 2026-10-12: "commit and push to github. bump to 0.1.2 and
publish release".

## Context
Release process as in WO-107 / WO-110: `npm run dist` (Windows setup + zip, macOS arm64/x64 dmg + zip, unsigned,
specs stripped of Bosch's text), tag, `gh release create` with the 6 assets and notes.

## Scope
- In: version 0.1.1 → 0.1.2 (root + launcher package.json and lockfiles); build; check the builds (incl. the new
  CCS 1000 D spec stripped); tag `v0.1.2`; push; GitHub release with assets and notes; the two Companion module
  packages attached as extra assets.
- Out: code signing (WO-029).

## Acceptance criteria
- [x] `npm test` green on the release commit.
- [x] `npm run dist` produces the 6 assets `LikeABosch-0.1.2-*`; no Bosch text in the bundles (scan as in WO-107,
      plus the CCS 1000 D swagger).
- [ ] Tag `v0.1.2` pushed; release published with the assets.

## Work log
- 2026-10-12 (Claude Opus): created; features committed (`d1032b0`); versions bumped with
  `npm version 0.1.2 --no-git-tag-version` (root + launcher).
- 2026-10-12 (Claude Opus): `npm test` 373/373. `npm run dist` exit 0: 6 assets `LikeABosch-0.1.2-*` (mac x64 + arm64
  dmg/zip, win x64 setup/zip). All three unpacked bundles contain version 0.1.2, backend/src/quick/routes.js,
  docs/protocol/ccs1000-rest/swagger.json (stripped) and launcher/lib/bosch-apis.js. Bosch-text scan of the three
  bundles with 4 sample sentences (CCS 1000 D swagger, DCNM API, Wireless swagger, DCNM entry summary): 0 hits; positive
  control in docs/protocol: 2/1/2/1 files. Companion module packages rebuilt from the release code
  (`bosch-discussion-system-1.0.0.tgz`, `likeabosch-1.0.0.tgz`) for the release as extra assets.

## Decisions
- Version 0.1.2 as the user asked (it carries new features; a minor bump would also have fitted).

## Handoff
