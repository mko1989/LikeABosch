# WO-098: Simulation easy to find: launcher option + links in the web UI

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-095, WO-030 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-08 |

## Goal
User (2026-10-07, next.md): "i dont see a simulate option anywhere." WO-095 put simulation only in a card at the bottom
of Settings → Connection; the launcher (the first screen) has none. Make it findable where people look first.

## Context
DEC-026 (simulated systems), WO-095 (backend + Connection card), DEC-008 / WO-030 (launcher), DEC-025 (projects per
system). `launcher/lib/settings-store.js` (`backendEnv`), `backend/src/config.js`, `backend/src/connection/manager.js`.

## Scope
- In:
  - Launcher: a "Simulation (no hardware)" choice (type + seats). The real-system fields stay as they are.
  - Backend: env `LIKEABOSCH_SIMULATE=<type>:<seats>` from the launcher → at start the backend creates/updates the
    profile `launcher-<type>` and simulates it (connects even without login fields). Without the env, a
    `launcher-*` simulation left over from an earlier start is switched off again. Nothing is pinned (DEC-026 §1): the
    web UI can still go back to the real system.
  - Launcher status pill says "Simulated" while a simulation runs.
  - Web UI: the "Not connected" banner and the Connection status card offer "Simulate a system"; the link
    `#/settings/connection?simulate` scrolls to the Simulation card (and opens the add form if there are no profiles).
- Out: scripted activity in simulations (WO-095 handoff).

## Acceptance criteria
- [x] Unit tests: `backendEnv` passes `LIKEABOSCH_SIMULATE` only when a simulation is chosen (launcher/test/bridges.test.js);
      the backend with that env simulates `launcher-<type>` with the given seats and has its own project; a renamed profile
      keeps its name; without the env it leaves the simulation (backend/test/simulation.test.js).
- [x] `npm test` 272/272; full `node scripts/ui-check.mjs data/ui-check` OK (connection scenario clicks "Simulate a
      system…" and checks the card is on screen); screenshots looked at.
- [x] Launcher smoke test with `LAUNCHER_SCREENSHOT`: "Simulation (no hardware)" section at the top, looked at.

## Work log
- 2026-10-07 (Claude Opus): created from next.md. Cause found: only the Connection card at the bottom of the page; the
  launcher has no option.
- 2026-10-07 (Claude Opus): implemented. Backend: `config.launcherSimulation` from `LIKEABOSCH_SIMULATE=<type>:<seats>`,
  `ConnectionManager.#applyLauncherSimulation()` at load (profile `launcher-<type>`, names "DICENTIS demo" etc.; a
  renamed profile keeps its name), connects even with auto-connect off; settings writing factored into `#persist()`.
  Launcher: `simulate` + `simulateSeats` settings, fieldset at the top, real-system fieldsets dimmed while simulating,
  bridges not started while simulating, status pill "Simulation: … (simulated: <name>)". Web: banner link
  "Simulate a system" (`#/settings/connection?simulate`), "Simulate a system…" button in the Status card (opens the add
  form when there are no profiles). `.env.example` documents the variable.
  Problems: my first ui-check run passed `connection` as the first argument, which is the output folder: 155 screenshots
  landed in `./connection/`; moved to `data/ui-check/`. The "card in view" check was too strict when the page cannot
  scroll further (card header still visible): relaxed to "header on screen".

## Decisions
- The launcher simulation is a normal profile with the fixed id `launcher-<type>` (its own project `sim:launcher-<type>`,
  DEC-026 §3), so changing the seat count keeps the project. Not pinned: an extension of DEC-026 §1, not a change.

## Handoff
Delivered. Status `review`. To try: launcher → "Connect to: Simulated DICENTIS (wired)", seats → Start server → Launch
GUI. Or in the web UI: banner "Simulate a system" / Settings → Connection → "Simulate a system…".
