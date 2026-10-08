# WO-011: Wired passthrough endpoints (one per operation)

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-009, WO-010, WO-007 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Every Conference Protocol operation is callable over HTTP via the backend, generated from the spec (DEC-004).

## Scope
- In: `backend/src/wired/spec.js` (load + index `operations/*.json`, case-insensitive lookup,
  validate request body: object, only declared top-level fields, basic type checks for primitives/enums);
  `backend/src/wired/routes.js`: `POST /api/wired/ops/:operation`, `GET` for `Get*`/`List*` (query → params, with type coercion of bool/int);
  `GET /api/wired/ops` → list of operations (name, category, permissions, request shape) for discovery/UI;
  errors per DEC-004; `Login`/`Logout`/`RegisterEvents`/`UnregisterEvents` blocked from passthrough
  (managed by the backend's connection layer; return 403 `MANAGED_BY_BACKEND`).
- Out: domain layer (WO-017).

## Acceptance criteria
- [x] Test enumerates all spec operations and calls each against the mock: none returns 404/500.
- [x] Validation tests: unknown field → 400, wrong enum value → 400.
- [x] `docs/api/wired-passthrough.md` generated or written (how to call, examples).

## Work log
- 2026-10-02 (Claude Opus): `backend/src/wired/spec.js` (written in WO-010) provides lookup/validation. Implemented `backend/src/wired/routes.js` and mounted it at `/api/wired` in `app.js`. `server.js` got a **temporary** autoconnect wiring (creates a WiredClient from env if `DICENTIS_HOST` is set) that WO-013 replaces; `start()` now returns `services`. Tests `backend/test/wired-passthrough.test.js` (9): listing, GET/POST passthrough, typed query, validation (unknown/type/enum/non-object), GET rejected for writes, 502 mapping, managed/excluded/unknown, **all 88 callable ops return 200 or 502** against the mock, 503 when not connected. `npm test`: 32/32. Docs: `docs/api/wired-passthrough.md`.

## Decisions
- Excluded operations → 404 with the reason; managed operations → 403 `MANAGED_BY_BACKEND`.
- GET is allowed only for `Get*`/`List*`; other operations return 400 on GET (no accidental state changes via links/prefetch).
- Validation errors carry `error.details: string[]`.
- Routes get the client through `getClient()` so WO-013 can swap/recreate clients without remounting routes.

## Handoff
Done. Remember: the server.js autoconnect block is temporary (WO-013).
