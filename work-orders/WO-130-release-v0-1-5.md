# WO-130: Release v0.1.5 (WO-129)

| | |
|---|---|
| **Status** | done |
| **Phase** | 4 Hardening |
| **Depends on** | WO-129 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-17 |
| **Updated** | 2026-10-17 |

## Goal
Publish v0.1.5 on GitHub with the installers. User request 2026-10-17: "comit push and create a relese. ive already
bumped v and ran dist."

## Context
Release process as in WO-107 / WO-110 / WO-121 / WO-125 / WO-128: `npm run dist`, tag, `gh release create` as draft,
upload assets one by one, publish.

## Scope
- In: version 0.1.5 (root bumped and `npm run dist` run by the user; launcher package.json + both lockfiles brought in
  line); check the builds (version, WO-129 code, no Bosch text); tag `v0.1.5`; push; GitHub release with assets and
  notes; the two Companion module packages as extra assets.
- Out: code signing (WO-029).

## Acceptance criteria
- [x] `npm test` green on the release commit.
- [x] `npm run dist` produced the 6 assets `LikeABosch-0.1.5-*`; no Bosch text in the bundles (scan as in WO-107).
- [x] Tag `v0.1.5` pushed; release published with the assets.

## Work log
- 2026-10-17 (Claude Opus): created, in-progress. The user bumped the root package.json to 0.1.5 and ran `npm run dist`
  (assets dated 2026-10-17 10:58–11:01, after the WO-129 changes). The build takes its version from the root
  package.json (`scripts/dist/build.mjs`); launcher package.json and both lockfiles still said 0.1.4 → set to 0.1.5
  (metadata only, the build is not affected). Checked the three unpacked bundles (mac x64, mac arm64, win x64): app
  package.json 0.1.5, `director.js` has `reevaluate`, `cameras.js` has the `automation-settings` form, `automation.js`
  has no `renderSettings`. Bosch-text scan with 3 sample sentences (Wireless swagger, Conference Protocol operation
  summary, DCN-SW API summary): 0 hits in each bundle; positive control in docs/protocol: 4/2/1 files. Companion modules
  unchanged since v0.1.4 (`git diff v0.1.4 -- companion-module-dev` empty): the same two packages are attached.
  `npm test` 379/379 (WO-129 run, no code change since).

- 2026-10-17 (Claude Opus): committed `fc39e07` (WO-129) and `ab7911a` (release), annotated tag `v0.1.5`, pushed main +
  tag. `gh release create --draft` without assets, then `gh release upload --clobber` per file: all 8 ok first try,
  sizes match the local files; `gh release edit --draft=false --latest`. Release
  https://github.com/mko1989/LikeABosch/releases/tag/v0.1.5 (Latest, not a draft, not a pre-release). Status → done.

## Decisions
- Patch bump (0.1.5): one director fix and a Settings layout change (WO-129).

## Handoff
Delivered: release v0.1.5 (6 installers + the 2 Companion module packages unchanged since 0.1.2). Not signed (WO-029).
WO-129 stays in review (checked against simulated cameras / switchers only).
