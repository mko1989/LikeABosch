# DEC-004: Backend HTTP API shape (passthrough layer + domain layer)

- **Status:** accepted (proposed by Claude 2026-10-02; revisable via a superseding DEC)
- **WO:** WO-001 (detailed in WO-011, WO-015, WO-017)

## Decision
The backend exposes three groups of HTTP endpoints under `/api`:

1. **Wired passthrough: one endpoint per Conference Protocol operation**, generated from the
   spec JSON:
   - `POST /api/wired/ops/<Operation>`: JSON body = the operation's `parameters`.
   - Operations whose name starts with `Get`/`List` also accept `GET /api/wired/ops/<Operation>`
     with flat query parameters.
   - Request bodies are validated against the spec: unknown fields are rejected *before* hitting
     the server, because the server errors on unknown fields anyway (PDF p.49).
2. **Wireless passthrough**: mirrors the Swagger paths under `/api/wireless/...` with the same
   HTTP methods; the backend injects the `sid` session.
3. **Domain layer** (`/api/seats`, `/api/discussion`, `/api/voting`, …): system-independent
   endpoints the web UI uses, plus `GET /api/capabilities`. Designed in WO-017, after both
   passthrough layers exist.

Plus management endpoints: `/api/connection` (connect/disconnect/status/settings) and
`GET /api/events` (SSE stream, DEC-005).

**Response envelope** (all `/api` endpoints):
- success: `200 { "ok": true, "data": <result parameters> }`
- error: `{ "ok": false, "error": { "code": "<CODE>", "message": "...", "upstream"?: ... } }` with
  HTTP status 400 `VALIDATION`, 401/403 `UPSTREAM_AUTH`, 503 `NOT_CONNECTED`,
  502 `UPSTREAM_ERROR` (server replied `operation: "error"`), 504 `UPSTREAM_TIMEOUT`.

## Consequences
- "An endpoint for each API point" is satisfied mechanically and stays in sync with the spec.
- The UI depends only on the domain layer and SSE, so adding wireless support doesn't touch passthrough code.
