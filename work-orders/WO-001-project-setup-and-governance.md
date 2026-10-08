# WO-001: Project setup and governance

| | |
|---|---|
| **Status** | done |
| **Phase** | 0 Setup |
| **Depends on** | — |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Establish the documentation-first process so any fresh agent can continue the project from files alone.

## Context
User request (2026-10-02): build a Node.js server + web UI acting as a client for Bosch DICENTIS,
starting with extracting the API from the vendor docs and building a backend with an endpoint per
API point, then a web UI. Work must be split into documented work orders, Haiku subagents may be
used for small background jobs, and the rules go in CLAUDE.md.

## Scope
- In: CLAUDE.md rules, work-order process + template + status board, decision log, architecture
  overview, moving vendor docs to `docs/source/`, initial roadmap of WOs.
- Out: any application code.

## Deliverables
`CLAUDE.md`, `work-orders/README.md`, `work-orders/_TEMPLATE.md`, `docs/decisions/*`,
`docs/architecture.md`, WO-002 … WO-029.

## Acceptance criteria
- [x] CLAUDE.md contains WO rules, decision rules, subagent rules, layout, conventions.
- [x] Decisions DEC-001…006 recorded with the user's answers marked "decided by user".
- [x] Roadmap WOs exist for all phases; Phase 1–2 WOs are `ready` or further along, Phase 3–4 are `draft`.

## Work log
- 2026-10-02 (Claude Opus): Inspected `docs/source`. Found two different systems (wired Conference Protocol PDF, 462 pp; Wireless REST HTML/Swagger v1.7). Asked user 4 questions. Answers: support both, wired first; plain JavaScript; plain HTML/JS UI; real hardware available + also build mocks. Wrote governance docs and the roadmap.
- 2026-10-02 (Claude Opus): Vendor files moved from repo root to `docs/source/` (unchanged).
- 2026-10-09 (Claude Opus): user asked to commit and push to GitHub. The folder was not a git repository: `git init -b main`,
  public repo https://github.com/mko1989/LikeABosch (visibility chosen by the user). Not published (`.gitignore`, user
  decision): `docs/source/` (Bosch's original documents; the extracted specs in `docs/protocol/` are published),
  `bridge/dicentis/bin|obj`, scratch notes `last_response.md` / `next.md` (one names the office WAP's IP). Checked
  before the first push: no secrets (only test fixtures), `.env` ignored, largest file 327 KB.
- 2026-10-09 (Claude Opus): correction of the entry above. The user's "leave out the Bosch docs" meant all Bosch
  material, not only `docs/source/`; the first push had published the specs extracted from Bosch's documents. Now
  gitignored and never published (kept on disk): `docs/protocol/conference/*` (except our `SPEC-FORMAT.md`), the
  Wireless `swagger.yaml/json` + README, `docs/protocol/dcn-swapi/*` and `dcnm-api/*` (except our `BRIDGE.md`),
  `docs/protocol/dcn-swsmd/`, `bridge/dicentis/src/Fake/Fake.generated.cs` (generated from the DCNM reference).
  History rewritten (one clean commit) and force-pushed so the files are in no published commit. Consequence: a fresh
  clone does not run until those files are copied in from a machine that has them (the backend and mocks load them).

## Decisions
- DEC-001 … DEC-006 (see `docs/decisions/README.md`).
- WO numbering is global and sequential (not per phase); the phase is a header field.

## Handoff
Process is in place. Next agent: start from the status board in `work-orders/README.md`.
Suggested: `git init` + commit per finished WO, which gives an audit trail matching the work logs (not done yet; needs the user's go-ahead).
