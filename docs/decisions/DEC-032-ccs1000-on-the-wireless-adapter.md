# DEC-032: CCS 1000 D as a fourth system type on the wireless REST adapter

- **Status:** accepted (requested by the user 2026-10-12: "add support for CCS 1000"; design by Claude, revisable)
- **WO:** WO-111
- **Extends:** DEC-001 (target systems), DEC-010 (domain layer, capabilities), DEC-026 (simulated systems)

## Context
The user added Bosch's CCS 1000 D documents (`docs/research/ccs-1000/`: the CCSD-CU's RESTful API HTML, a firmware
image, Bosch's SynopticControl example). The embedded Swagger (API **v1.8**) is the DICENTIS Wireless (WAP) API v1.7
with a different product name, and:
- **no** `/participants*` and **no** `/voting*` endpoints;
- **added** `GET|PUT /seats/microphonesensitivity/{seat_id}` (`{ sensitivity: 0..15 }` = −6…+9 dB) and
  `POST /seats/resetmicrophonesensitivities`;
- seats have `mode` (0 normal, 2 button, 3 PTT) instead of battery / signal / range-test fields;
- `PUT /system/status` knows on (0) and standby (1), no off;
- the session id goes in the `sid` cookie **or** the `Bosch-Sid` header (exactly what `WirelessClient` already sends,
  learned on the real WAP, WO-075). Login, long-poll (`isPolling`), speakers, waiting list and priority are the same.
Bosch's SynopticControl says it works on both the WAP and the CCSD-CU, unchanged; it only uses documented endpoints.

## Decision
1. **System type `ccs1000`** ("CCS 1000 D"), default port 80, next to `wired`, `wireless`, `dcn`, `dcn-smd`.
2. **Same client and poller:** `WirelessClient` (product name in messages is an option) and `WirelessPoller` with a
   per-system topic list (`CCS_TOPICS`: system info, system status, seats, speakers, waiting list). Raw topics keep the
   `wireless*` names (same payloads), so the wireless domain mappers apply; the `ccs1000` mapper set overrides what
   differs (no participants, no voting, seat `mode`, no battery diagnostics, power on/standby).
3. **Own spec file:** `docs/protocol/ccs1000-rest/swagger.yaml` (verbatim from the HTML) + `swagger.json`, gitignored
   like the wireless spec (Bosch text, user decision 2026-10-09), stripped for distribution (WO-107). Passthrough
   `/api/ccs1000/<swagger path>`; `/api/wireless` only serves a WAP and `/api/ccs1000` only a CCSD-CU.
4. **Domain actions:** `run()` dispatches `ccs1000` to the wireless implementation unless the action names its own
   `ccs1000` handler or `null` (not supported: participants, voting, identification, power off).
5. **Capabilities:** discussion, request list, clear, priority calls, power standby, plus a new feature flag
   `micSensitivity` (Settings → Microphones). Participants, voting, identification, WAP configuration: off.
6. **Simulation:** the wireless mock gets `variant: 'ccs1000'` (CCS spec, CCS seats, sensitivities); simulated profiles
   and the launcher accept `ccs1000`.
7. The firmware image's own web UI endpoints (like DEC-024 for the WAP) are not used now; a research WO can mine them.

## Consequences
- A real CCSD-CU is untested; the semantics are assumed equal to the WAP's (fw 1.73, WO-075) where the API is equal.
- Any WAP-only UI (participants view, voting, WAP configuration) stays hidden for `ccs1000` through the capability flags.

## Alternatives considered
- **Treat a CCS 1000 D as `wireless`:** no code, but participant/voting calls would hit 404s and the UI would offer
  features the CCSD-CU lacks. Rejected.
- **Separate client/poller copy:** duplicates ~350 lines for a dialect that differs only in its path list. Rejected.
- **`ccs*` topic names:** cleaner names, but every wireless mapper and view would need a prefix parameter. Rejected.
