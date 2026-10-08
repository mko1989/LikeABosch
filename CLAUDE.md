# LikeABosch — DICENTIS client (Node.js backend + web UI)

A Node.js server with a browser UI that acts as a **client** for Bosch DICENTIS conference
systems:

- **Wired DICENTIS** server — "Conference Protocol", JSON over secure WebSocket
  (`wss://<host>:31416/Dicentis/API`, subprotocol `DICENTIS_1_0`). Primary target.
- **DICENTIS Wireless** (WAP) — RESTful HTTP API v1.7. Secondary target, added after wired.

The backend talks to the DICENTIS system; the browser only talks to our backend.

## Start of every session (mandatory)

1. Read [work-orders/README.md](work-orders/README.md): process, status board, what's next.
2. Read [docs/decisions/README.md](docs/decisions/README.md): every accepted decision.
   **Do not contradict an accepted decision silently.** To change one, write a new DEC that
   supersedes it (see below) and mention it to the user.
3. Read [docs/architecture.md](docs/architecture.md) before touching code.
4. Open the work order you are going to work on and read its whole history (work log,
   decisions, handoff) plus the WOs it depends on.

## Work orders: the rules

All work happens through **work orders** (WOs) in `work-orders/`. A WO is a small,
self-contained chunk of work (ideally finishable in one session) documented well enough
that a fresh agent with no chat history can pick it up, or audit it later.

1. **No work without a WO.** If the user asks for something that has no WO, create one
   first (copy [work-orders/_TEMPLATE.md](work-orders/_TEMPLATE.md)), even a short one.
   Trivial fixes (typos, one-liners) can be logged in the WO they belong to.
2. **Numbering:** `WO-NNN-kebab-title.md`, NNN = next free number. Never renumber or reuse.
3. **Status lifecycle:** `draft` → `ready` → `in-progress` → `review` → `done`
   (or `blocked` / `cancelled` with a reason). A `draft` WO must be refined into `ready`
   (concrete scope + acceptance criteria) before implementation starts.
4. **Keep the status board in sync.** Whenever a WO's status changes, update both the WO
   header and the table in `work-orders/README.md`, including the `Updated` date.
5. **Work log is append-only.** Add dated entries as you go: what you did, what failed,
   how you resolved it. Don't rewrite history; correct it with a new entry.
6. **Record decisions.** Small, local choices go in the WO's "Decisions" section. Anything
   another WO depends on (architecture, API shape, naming, libraries, conventions) gets a
   `docs/decisions/DEC-NNN-*.md` file, is added to the decisions index, and is linked from
   the WO.
7. **Handoff before stopping.** When you finish or pause, fill "Handoff": what was
   delivered, known gaps, open questions, follow-up WOs (create them as `draft`).
8. **Scope discipline.** If you discover work outside the WO's scope, create a new WO
   rather than expanding the current one.
9. **Acceptance criteria are checked, not assumed.** Only mark `done` when every box is
   ticked with evidence (test output, validator output, manual check described in the log).

## Decisions (ADRs)

- Files: `docs/decisions/DEC-NNN-kebab-title.md`, index in `docs/decisions/README.md`.
- Sections: Status (`proposed` / `accepted` / `superseded by DEC-xxx`), Context, Decision,
  Consequences, Alternatives considered.
- Decisions are never edited to say something different. Supersede them with a new DEC
  and change the old one's status line only.
- Decisions the user made explicitly are marked "decided by user". Respect them strictly.

## Subagents

- Use **Haiku** subagents (`model: haiku`) for small, well-defined, parallelizable
  background jobs: extracting/transforming docs, writing boilerplate from a clear spec,
  generating test fixtures, mechanical refactors across files, doc updates.
- Use the main model for architecture, protocol semantics, reviewing subagent output,
  and anything requiring judgment across WOs.
- A subagent prompt must be self-contained: absolute paths, the files to read first,
  exact output location/format, a validation command to run, and "do not edit other files".
- Subagents do **not** edit WO files or the status board (avoids conflicting writes).
  They report back; the main agent reviews their output and records it in the WO log.
- Always verify subagent output (validator/tests + spot checks) before accepting it.

## Project layout

```
CLAUDE.md                   this file: rules for agents
work-orders/                WOs + status board (README.md) + _TEMPLATE.md
docs/
  architecture.md           system overview, layers, directory map
  decisions/                DEC-NNN ADRs + index
  protocol/conference/      wired Conference Protocol: README (fundamentals),
                            SPEC-FORMAT.md, operations/*.json, types/*.json, source-index.json
  protocol/wireless-rest/   wireless REST API: swagger.yaml (source of truth) + README
  protocol/dcn-swapi/       DCN NG DCN-SW API (.NET): api.json + types.json (from DCN-SWAPI.chm), BRIDGE.md
  source/                   original vendor docs (PDF, HTML, CHM) + extracted text; chm/ = CHMs unpacked with 7zz (scripts/chm/); never edit
scripts/                    dev tooling (pdf-pages.sh, spec validator, doc generators)
backend/                    Node.js server (from WO-008)
mock/                       mock DICENTIS servers for dev/tests (from WO-010)
web/                        static web UI served by the backend (Phase 3)
launcher/                   Electron desktop launcher, own package.json (DEC-008, WO-030)
bridge/dcn/                 dcn-bridge: Windows .NET host for the DCN-SW API (DEC-017, WO-061)
```

## Protocol source of truth

- Wired: `docs/protocol/conference/operations/*.json` + `types/*.json` (extracted from the
  PDF, validated by `node scripts/validate-conference-spec.mjs`). If you find an error,
  fix the JSON, cite the PDF page, and log it in the relevant WO.
- Wireless: `docs/protocol/wireless-rest/swagger.yaml` (exact copy of the vendor spec
  embedded in the HTML doc).
- Read PDF pages with `scripts/pdf-pages.sh FROM TO`; page index in
  `docs/protocol/conference/source-index.json`.

## Code conventions (see DEC-002)

- Node.js ≥ 22, plain JavaScript, ES modules (`"type": "module"`), no TypeScript, no build
  step. Use JSDoc type annotations on exported functions and protocol data shapes.
- Frontend: plain HTML/CSS/ES modules, no framework, no bundler.
- Tests: built-in `node:test` + `node:assert/strict`. Run with `npm test`.
  New backend code comes with tests against the mock server.
- UI changes: run `npm run ui:check` (headless Electron: console errors, live update, screenshots in
  `data/ui-check/`) and **look at the screenshots** before marking a UI WO done. Follow DEC-009 (no `innerHTML`
  with server data; state only from the store; writes via `web/js/api.js`).
- Real-system tools (never put host/credentials in files; pass via env): `npm run smoke:wired` (read-only),
  `node scripts/ui-snapshot.mjs` (read-only screenshots), `npm run e2e:wired` (**changes state**, dev systems only;
  `npm run e2e:mock` runs the same suite against the mock); wireless: `npm run e2e:wireless` (**changes state**, restores it) /
  `npm run e2e:wireless:mock`. Run the mock variants after changing mock or bridge semantics.
- Builds: `npm run dist` (Windows NSIS setup .exe + portable zip, macOS dmg + zip for x64 and arm64, in `dist/` with
  install notes `dist/README.txt`; unsigned; `--test` for a dated test version; WO-097, WO-100). App icon source:
  `launcher/build/icon.svg` → re-render `icon.png` (rsvg-convert, 1024 px) after changing it. Simulated systems ship the
  mocks (DEC-026): mock changes affect the app, not only tests.
- Keep dependencies minimal; adding a runtime dependency needs a DEC or a WO decision entry.
- Secrets (DICENTIS credentials, real server host) go in `.env` (gitignored), never in
  code, docs, or WO logs.
