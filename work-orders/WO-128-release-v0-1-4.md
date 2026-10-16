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
- [x] `npm test` green on the release commit.
- [x] `npm run dist` produces the 6 assets `LikeABosch-0.1.4-*`; no Bosch text in the bundles (scan as in WO-107).
- [ ] Tag `v0.1.4` pushed; release published with the assets.

## Work log
- 2026-10-16 (Claude Opus): created, in-progress. Features committed locally (`243bc06`, not pushed); versions bumped to
  0.1.4 (root + launcher, uncommitted). Paused by the user before the build: widgets did not appear (fixed in WO-127).
- 2026-10-16 (Claude Opus): resumed after the WO-127 fixes (`e3353e4`: layer survives "Loading room…", camera buttons
  in the PTZ widget). `npm test` 376/376. `npm run dist` exit 0: 6 assets `LikeABosch-0.1.4-*` (mac x64 + arm64 dmg/zip,
  win x64 setup/zip). All three unpacked bundles: app package.json 0.1.4, `web/js/widgets/layer.js` present, room.js
  with the "Loading room…" fix, ptz.js with the camera buttons. Bosch-text scan of the three bundles with 4 sample
  sentences (Wireless swagger, CCS 1000 D swagger, DCNM api summary, Conference Protocol operation summary): 0 hits
  each; positive control in docs/protocol: 4/4/1/2 files. Companion modules unchanged since v0.1.3 (`git diff v0.1.3 --
  companion-module-dev` empty): the same two packages are attached.

## Decisions
- Patch bump (0.1.4): one launcher fix (WO-126) and a Room UI change (WO-127).

## Handoff
