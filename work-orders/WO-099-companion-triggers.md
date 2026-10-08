# WO-099: Bitfocus Companion: press buttons when a seat or interpreter desk is activated / deactivated

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-038, WO-047, WO-048, WO-074, WO-096 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-08 |

## Goal
User (2026-10-07, next.md): "add a bitfocus companion http api integration, so it is also possible to push a companion
button when a certain seat or desk is activated/disactivated. should be possible to add companion button action from a
seats inspector settings and open companion page viewer to pick a button."

## Context
[DEC-027](../docs/decisions/DEC-027-companion-triggers.md) (design + the Companion API facts checked on 5.0.6). Seat
activation = `domain.discussion` speakers (director, DEC-012); desks: `interpretationRoutings` (wired, `web/js/interp.js`)
and `domain.interpreterDesks` (DCN, WO-074). Devices/projects: `backend/src/devices/manager.js`, `room/store.js`.

## Scope
- In:
  - `mock/companion/server.js`: HTTP mock of the remote-control API (records requests, 204 outside the grid, `/tablet` page).
  - `backend/src/companion/`: `client.js` (press/down/up, reachability), `triggers.js` (edge detection → requests,
    log, topic), `routes.js` (`/api/companion`: GET, PUT config, POST test, POST press).
  - Device config `companion` in `devices.json` (+ project import sanitising); topic `devices.companion`.
  - Room `triggers` (seats, desks) with API `PUT/DELETE /api/room/triggers/:kind/:id`; sanitising; remap moves seat triggers.
  - Web: Settings → Companion (connection, master switch, grid size, test, list of all triggers, recent log);
    seat and desk inspector section "Companion" (on activated / on deactivated, add / remove / test); picker dialog
    (Companion page framed + click grid, page ◀ ▶, action press/down/up).
- Out: other events (votes, meeting state) as triggers; custom variables; Companion grids with negative coordinates
  in the picker (DEC-027 consequences).

## Acceptance criteria
- [x] `backend/test/companion.test.js` (7 tests) against the mock: config saved in the project's devices.json, seat mic
      on → `on` actions in order, off → `off` actions, baseline after reconnect does not fire, wired desk triggers,
      switched off = nothing (logged), unreachable Companion → logged error, remap moves triggers, sanitising for
      project import keeps triggers and target and drops junk.
- [x] Client verified against a real Companion 5.0.6 (headless, throwaway config): press/down/up → ok; empty button and
      outside the grid → error "no button at …"; `/api/connections` reachability; picker frame over the real page lines up
      (screenshot looked at).
- [x] ui-check scenario `companion` (wired): settings + test, picker from the seat inspector, trigger saved, mic on →
      logged press, settings list; screenshots looked at. Full ui-check (all systems) OK.
- [x] `npm test` 272/272.

## Work log
- 2026-10-07 (Claude Opus): created. Probed a headless Companion 5.0.6 (bundled `main.js` with a throwaway
  `--config-dir` on port 8899; the user's own Companion uses port 8888 and was not touched): press/down/up → 200 "ok",
  out-of-grid → 204, GET on press → 404, CORS `*`, `/tablet` frameable, layout measured at 480/640/1000/1400 px:
  left 12, top 20, cell (W − 24) / cols. Results in DEC-027.

- 2026-10-07 (Claude Opus): correction to the probe: `204` means "no button at that location" (an empty button inside the
  grid answers 204 too, e.g. 1/2/5 on a fresh config), not only "outside the grid". DEC-027 context, client message and
  mock adjusted the same day (DEC written in this WO, not yet reviewed; same practice as WO-095). Triggers on empty
  buttons now show as errors in the log, which is what the operator needs to know.
- 2026-10-07 (Claude Opus): implemented backend (`companion/client.js`, `service.js`, `routes.js`; `DeviceManager`
  `companion` config + `setCompanion`; room `triggers` + `setTrigger` + remap; `/api/companion`, `/api/room/triggers`),
  mock (`mock/companion/server.js`), UI (`web/js/companion.js`: inspector section + picker; Settings → Companion view;
  seat, wired desk and DCN desk inspectors). The UI's CSP had `default-src 'self'` and blocked the frame: added
  `frame-src 'self' http: https:` (DEC-027 consequences); inline style strings are also blocked by the CSP, so the
  picker uses style objects (CSSOM). The service publishes copies (the cache compares deeply; a mutated log array would
  never publish). `fetch` refuses the browser "bad ports" (1, 9, 6000, 6665–6669, …): not a problem for Companion's
  ports. Test races (speaker added again before the removal reached the state) fixed with a helper that waits for the
  state. `connection.test.js` expectation gained the new local topic `devices.companion`.
- 2026-10-08 (Claude Opus): ui-check gets a mock Companion (`UI_CHECK_COMPANION_PORT` overrides it, e.g. a real
  Companion). Against the real one the scenario's last step fails by design (1/0/2 is empty there → logged error); the
  only console message is Companion's own page asking for a screen wake lock inside the frame.

## Decisions
- See DEC-027.
- Rapid on/off that falls between two state updates is not seen (the trigger works on state, not on raw events). Fine
  for "mic on / off"; noted.

## Handoff
Delivered. Status `review`.
- Use: Settings → Companion: host + port (the user's own Companion runs on **8888**, not the default 8000), Test
  connection. Room → select a seat or interpreter desk → Companion → "+ Button…" → pick page and button → Use this
  button. "press" for one-shot buttons; "down" on mic on + "up" on mic off for buttons that should be held.
- Companion must have its HTTP API on (Settings → Protocols). The picker shows Companion's own buttons only when the
  browser can reach Companion; otherwise untick "Show Companion's buttons" for a plain grid.
- Not done: triggers for other events (votes, meeting start), custom variables, grids with negative coordinates in the
  picker. Create a WO if wanted.
