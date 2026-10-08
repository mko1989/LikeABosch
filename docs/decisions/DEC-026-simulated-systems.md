# DEC-026: Simulated systems inside LikeABosch; projects carry seat names for matching

- **Status:** accepted (requested by the user 2026-10-07: "a simulate version too with different systems … export and
  import such projects with the ability to match the connected system with the simulated project"; design by Claude)
- **WO:** WO-095 (simulation), WO-096 (seat matching), WO-097 (test build ships the mocks)
- **Builds on:** DEC-006 (mocks), DEC-016 (projects), DEC-025 (projects per system)

## Decision
1. **Simulated systems** are profiles `{ id, name, type: wired | wireless | dcn | dcn-smd, seats }` in the machine
   settings (`simulators`), plus `simulate` = the profile to use instead of the configured system ('' = real system).
   Neither is pinned by the launcher, so simulation works next to a launcher-configured real system.
2. Connecting while `simulate` is set starts that type's **existing mock** (mock/…, the same code the tests use) inside
   the backend on 127.0.0.1 with a random port and connects to it normally. The effective system type is
   `manager.system` (status reports it and `simulated: { id, name, seats }`). Disconnect stops the simulator.
   The mocks therefore ship with the app.
3. A simulated system's project key is `sim:<profile id>` (stable across ports), label "<name> (simulated)".
4. **Seat names in projects:** `room.seatNames` (seat id → the system's name) is kept current while the open project
   belongs to the connected system; it travels in the project file. **Match seats** (Room → Edit → "Match seats…", and a
   banner when plan seats are unknown to the connected system) proposes a mapping (same id, same name, same number,
   chairman, then natural order), lets the operator correct it, and `POST /api/room/remap` moves placements, shots and
   names; optionally the project is linked to the connected system (DEC-025 §4).
5. Interpreter desks are not remapped (their ids come from the interpreter seats): follow-up if needed.

## Alternatives considered
- A separate "demo" build with its own fake data: duplicates the mocks; rejected.
- Remap by position on the plan / seat order only: names are what operators recognise; order is the last fallback.
