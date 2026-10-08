# DEC-006: Mock servers for automated tests, real hardware for manual verification

- **Status:** accepted (decided by user, 2026-10-02)
- **WO:** WO-001

## Decision
- `mock/wired/`: a WSS server (self-signed cert generated at startup) implementing the
  Conference Protocol message format, login, events, and in-memory state for the operations, driven by the spec JSON.
  Operations without hand-written behaviour return a schema-shaped default response.
- `mock/wireless/`: an HTTP server implementing the Swagger paths with in-memory state.
- All automated tests (`npm test`) run against the mocks only, so no hardware is needed.
- The user has access to a real DICENTIS system. Manual verification steps against it are written
  as checklists in WOs; the user runs them or provides host/credentials via `.env`. Results,
  including protocol deviations from the PDF, are logged in the WO and fed back into the spec JSON.

## Consequences
- Mock fidelity matters. When the real server behaves differently, fix the mock, the spec, and
  add a regression test.
- Never put real hostnames or credentials in committed files.
