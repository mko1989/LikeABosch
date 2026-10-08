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
- [ ] `scripts/dist/strip-specs.mjs` + tests: prose guard passes; `npm test` passes with the stripped specs in place.
- [ ] Installer contents checked: no Bosch sentences in the shipped specs; the packaged app starts (smoke test).
- [ ] Release v0.1.0 on GitHub with the installers and notes.

## Work log
- 2026-10-09 (Claude Opus): created (in-progress).

## Decisions

## Handoff
