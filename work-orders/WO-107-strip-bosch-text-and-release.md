# WO-107: Ship specs without Bosch's text; fix the repository's ignore rules; release v0.1.0

| | |
|---|---|
| **Status** | in-progress |
| **Phase** | 4 Hardening |
| **Depends on** | WO-097, WO-100 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-09 |
| **Updated** | 2026-10-09 |

## Goal
User (2026-10-09): "push and create a release" → the installers contain the protocol specs, which carry text copied
from Bosch's documents (the Wireless swagger verbatim) → user: "strip the copied text. leave the code as is. the docs
were downloaded from public support download page." Installers and the release then contain interface facts only
(names, parameters, types, permissions, events), no Bosch prose.

## Context
WO-001 (repo setup, 2026-10-09 entries), WO-097/WO-100 (`npm run dist`, `scripts/dist/build.mjs`). Spec loaders:
`backend/src/{wired,wireless,dcn,dcnm}/spec.js`, mocks. Prose fields are only shown in the passthrough listings
(`/api/*/ops`), never used for behaviour.

## Scope
- In: `scripts/dist/strip-specs.mjs` (structure-aware stripping per spec family; docs `.md`, `swagger.yaml`, the PDF
  page index not shipped); `build.mjs` stages the stripped specs instead of `docs/protocol`; tests (prose guard: no
  sentence-like strings left outside our own files; the full backend test suite passes on stripped specs). App code
  unchanged. Local full specs unchanged (source of truth for development, gitignored).
- In: `.gitignore` fix found on the way: `dcn/`, `dist/`, `data/` matched every folder with that name, so
  `backend/src/dcn`, `mock/dcn`, `bridge/dcn`, `scripts/dist` were never committed → anchored to the root;
  `bridge/dcn/src/Fake/Fake.generated.cs` (generated from the DCN-SW reference) and `bridge/**/bin|obj` ignored.
- In: build installers (`npm run dist`), GitHub release v0.1.0 with installers + notes.
- Out: publishing stripped specs in the repository (a fresh clone still needs the spec files): ask the user.

## Acceptance criteria
- [x] `scripts/dist/strip-specs.mjs` + tests: prose guard passes; `npm test` passes with the stripped specs in place.
- [x] Installer contents checked: no Bosch sentences in the shipped specs; the packaged app starts (smoke test).
- [ ] Release v0.1.0 on GitHub with the installers and notes.

## Work log
- 2026-10-09 (Claude Opus): created (in-progress).
- 2026-10-09 (Claude Opus): `scripts/dist/strip-specs.mjs`: per-family stripping (conference operations: top-level only,
  since request maps use names like `description` as data; types: + field/member texts; swagger: operation/parameter/
  response/header/schema texts, schema property maps walked by value, shared parameters; DCN-SW/DCNM: prose keys whose
  value is text, `obsolete` kept truthy). First scan left 4 Wireless texts (shared `parameters`, response headers) →
  fixed. 168 files, 1.8 → 1.2 MB. `backend/test/strip-specs.test.js` 5/5 (incl. a prose guard on the real specs).
  Proof the app needs none of the text: a copy of the project with the stripped specs in `docs/protocol` → `npm test`
  308/308 and full `node scripts/ui-check.mjs` OK (54 scenarios, all systems).
- 2026-10-09 (Claude Opus): `npm run dist` (mac x64 + arm64, win x64). Packaged `--smoke-test` hung on the macOS keychain
  prompt (known since WO-100: unsigned rebuild) → stopped; dev launcher smoke: SMOKE TEST OK; packaged backend (bundle's
  Electron as Node, scratch DATA_DIR, `LIKEABOSCH_SIMULATE=wired:12`): health up, simulated wired logged in, dicentis
  bridge logged in, `dicentis.status` audio + languages true, Wireless ops listed with empty texts. Found a second
  path: the Windows build bundles the bridges' build output, which carries a full `api.json` → bridges are staged and
  their `api.json` stripped (the bridges never read the texts); Windows rebuilt. Final scan of the Windows zip and both
  macOS app bundles for five known Bosch sentences: 0 hits.

## Decisions
- The full specs stay in `docs/protocol` on the development machine (agents and docs use the texts); only the
  distribution gets the stripped copies.

## Handoff
