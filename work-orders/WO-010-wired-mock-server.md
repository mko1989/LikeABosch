# WO-010: Wired mock DICENTIS server

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-003, WO-006 |
| **Assignee** | Claude Opus (core) + Haiku (behaviours per area) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
A local WSS server that behaves like a DICENTIS server well enough for development and
automated tests (DEC-006).

## Scope
- In: `mock/wired/server.js` (`npm run mock:wired`, also importable for tests with a random port):
  - Self-signed cert generated on the fly (node `crypto` / `selfsigned`-free approach; if a dependency is needed, record it).
  - Path `/Dicentis/API`, subprotocol `DICENTIS_1_0`; message format, error rules (unknown op, unknown params → error; bad JSON → close), login required.
  - Generic handler: any spec operation without a behaviour returns a default response shaped from `response` notation.
  - In-memory state + behaviours for core areas: permissions, seats (≈20 seats), participants, discussion list (Add/Remove/Activate/Deactivate mic), meeting/agenda, voting lifecycle, power mode, master volume.
  - Event engine with fire-once + reset-on-Get semantics, using `events.json` (WO-006).
  - Test hook: `mock.trigger(eventName)` / direct state mutation helpers.
- Out: wireless mock (WO-014).

## Acceptance criteria
- [x] Tests: protocol rules (unknown op/param error, login required, bad JSON closes), fire-once event semantics.
- [x] Vendor-like sample data documented in `mock/wired/README.md`.

## Work log
- 2026-10-02 (Claude Opus): Implemented `mock/wired/` (server.js, state.js, behaviours/{session,seats,meeting,voting,system}.js, certs/, README.md). Uses the shared spec loader `backend/src/wired/spec.js` (written here, also used by WO-011) for operation lookup, parameter validation and default responses, and `events.json` for re-arm rules. Tests `mock/wired/server.test.js` (8): login rules, protocol errors, malformed JSON close, fire-once/re-arm (implicit + explicit), unregistered/unknown events, discussion behaviour, voting lifecycle, spec-shaped defaults. All pass. Manual: `MOCK_PORT=31499 node mock/wired/server.js` + WiredClient → GetMeetingInfo/GetPermissions OK.

- 2026-10-02 (Haiku subagents, reviewed by Claude Opus): added `behaviours/interpretation.js` and `behaviours/files.js` (files/images/notes). Mock now has behaviours for all areas except plugins. New test: every read operation returns a spec-conformant response.

## Decisions
- TLS: committed self-signed **test-only** cert (`mock/wired/certs`, 10 years, localhost/127.0.0.1) instead of generating at runtime (Node can't create X.509 natively; avoids a dependency and openssl on Windows).
- State is shared across connections; event registration is per connection.
- Mock error message texts imitate the PDF examples where known; clients must not parse them anyway (PDF p.50).
- `npm test` now also runs `mock/**/*.test.js`.

## Handoff
Done. Extending: add behaviours per area in `mock/wired/behaviours/` (see its README), seed data in `state.js`. Areas without behaviours yet: interpretation, files/images/notes, plugins, illumination setters, participant access denied. Add them when the matching UI WO needs realistic data.
