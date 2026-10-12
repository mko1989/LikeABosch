# DEC-036: Two Companion modules: `bosch-discussion-system` (direct, network APIs only) and `likeabosch`

- **Status:** accepted (requested by the user 2026-10-12 in next.md; design by Claude, revisable)
- **WO:** WO-118 (likeabosch), WO-119 (bosch-discussion-system)

## Context
The user has three Companion modules (`companion-module-dev/`: bosch-dicentis with WebSocket + a REST mode, bosch-ccs-1000,
bosch-dcn with a C# bridge). They poll every 100 ms (GetDiscussionList), ignore the WAP's session rules and do not use
events. LikeABosch learned the systems' behaviour on real hardware (WO-032, WO-075) and in specs. The user wants one
combined module whose actions follow the system chosen in its configuration, **network APIs only (no bridge)**, and a
LikeABosch module that may use the bridges (through LikeABosch).

## Decision
1. **`companion-module-bosch-discussion-system`** (id `bosch-discussion-system`), in `companion-module-dev/`, systems:
   - **DICENTIS** (Conference Protocol, `wss://host:31416/Dicentis/API`, subprotocol `DICENTIS_1_0`, self-signed
     certificate accepted): Login → RegisterEvents → events are fire-once, refetch with the Get operation re-arms them
     (WO-012). No polling.
   - **DICENTIS Wireless** and **CCS 1000 D** (REST): login, session id as `Bosch-Sid` header + `sid` cookie, re-login on
     401, `override` on 409, one long-poll per path (`isPolling=true`, ~50 s hold) for seats / speakers / waiting list /
     power (WO-075, DEC-032).
   - **DCN NG meeting data** (DCN-SWSMD, TCP 20000, read-only): feedbacks and variables only.
   Actions are defined per system (capability table), so the action list changes with the configured system. The DCN
   control API (needs the Windows bridge) is not in this module.
2. One internal model for all systems (seats, speakers with mic state / priority, requests, power), so feedbacks,
   variables and presets are shared. Transports are plain classes without Companion dependencies, tested with node:test
   against LikeABosch's mocks.
3. **`companion-module-likeabosch`** (id `likeabosch`): talks to LikeABosch's quick-actions API (DEC-035) with its SSE
   stream for instant feedback, so it works with every system LikeABosch supports, including DCN control and the full
   DICENTIS API through the bridges. Extra actions: a raw passthrough to LikeABosch's bridge APIs (`/api/dcnm/ops/…`,
   `/api/dcn/ops/…`) and the camera director's overview / automation switches.
4. The user's three old modules stay untouched (reference). The two new module folders are tracked in this repository;
   the rest of `companion-module-dev/` (vendor PDFs, packages, node_modules) is gitignored.
5. Dependencies: `@companion-module/base` (same line as the user's modules), `ws` (combined module only).

## Consequences
- Two modules to maintain; the protocol code of the combined module duplicates parts of LikeABosch's backend in a
  smaller form (a Companion module must be self-contained).
- Not verified inside a real Companion yet (needs a Companion install); the transports are tested against the mocks.

## Alternatives considered
- **Update the three old modules:** the user preferred one combined module.
- **Combined module through LikeABosch only:** would need LikeABosch running for every Companion user. Rejected: that is
  the second module.
