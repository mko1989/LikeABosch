# DEC-001: Support both DICENTIS systems, wired first

- **Status:** accepted (decided by user, 2026-10-02)
- **WO:** WO-001

## Context
The vendor docs in `docs/source/` describe two different systems:
- `ConferenceProtocol.pdf`: wired DICENTIS server, JSON over secure WebSocket, ~96 operations and ~34 push events.
- `DICENTIS Wireless Conference System RESTful API.html`: DICENTIS Wireless (WAP), HTTP REST v1.7, 32 operations, no push events.

## Decision
Support both through separate **adapters** in the backend. The wired Conference Protocol is
implemented first (Phases 1–3). The wireless REST adapter follows, then the UI gains wireless
support through the unified domain layer (DEC-004).

## Consequences
- Backend code is split per system: `backend/src/wired/`, `backend/src/wireless/`.
- Features that exist only in the wired system (meetings, agenda, interpretation, files, plugins)
  are exposed only when a wired system is connected; the UI uses capability flags.
- The two systems' authentication and update models differ (permissions + events vs. session cookie + polling), so they are abstracted only at the domain layer.

## Alternatives considered
- Wired only / wireless only: rejected by user.
