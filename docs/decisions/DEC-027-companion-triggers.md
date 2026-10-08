# DEC-027: Bitfocus Companion buttons triggered by seats and interpreter desks

- **Status:** accepted (requested by the user 2026-10-07: "push a companion button when a certain seat or desk is
  activated/deactivated … add companion button action from a seat's inspector settings and open companion page viewer
  to pick a button"; design by Claude)
- **WO:** WO-099
- **Builds on:** DEC-012 (devices + director react to `domain.discussion`), DEC-016 (project = room + devices),
  DEC-026 (WO-096 remap moves seat data)

## Context
Bitfocus Companion (checked on 5.0.6, same API since 3.x) has an HTTP remote-control API on its web port (default 8000):
`POST /api/location/<page>/<row>/<column>/press | down | up` → `200 "ok"`; a location without a button (empty, or
outside the grid) → `204` (nothing happens);
`GET /api/connections` lists connections (cheap reachability check). No authentication, `Access-Control-Allow-Origin: *`.
There is no endpoint for button images or the grid size. Companion's own "web buttons" page
`/tablet?pages=<p>&min_row&max_row&min_col&max_col&display_cols&noconfigure=1&nofullscreen=1` can be framed
(no X-Frame-Options); its layout is regular: 12 px side padding, 20 px top, square buttons of (width − 24) / columns.

## Decision
1. **Connection per project** (venue equipment like the cameras): `devices.json` gets `companion: { host, port
   (8000), enabled, rows (4), cols (8) } | null`. Status topic `devices.companion` (config, last result, log). Rows/cols
   only describe the grid for the picker (Companion does not report it).
2. **Triggers per seat and per interpreter desk** in the room (`room.json`): `triggers: { seats: { <seatId>: { on: [A],
   off: [A] } }, desks: { <deskId>: … } }`, `A = { page, row, column, action: 'press' | 'down' | 'up' }`, at most 8 per
   list. They travel with the project and move with "Match seats" (WO-096 remap) like the shots.
3. **Activated / deactivated** = microphone on / off: seats from `domain.discussion` (speaker `micState === 'on'`,
   all systems); desks from `interpretationRoutings` (wired: listed with a microphone state other than off) and
   `domain.interpreterDesks` (DCN: `live`). The backend fires on **edges** only. After a (re)connect or opening another
   project the first state is the baseline: mics already on do not fire.
4. **The backend sends the requests** (`backend/src/companion/`), not the browser: triggers work with no browser open.
   Requests run in order per trigger, time out after 3 s, failures are logged in the topic and never retried (a late
   button press is worse than none). A master switch (`enabled`) turns all triggers off; it is independent of the
   camera automation (DEC-015).
5. **Picker ("page viewer")**: the browser frames Companion's `/tablet` page for one page (pointer events off, so
   nothing is pressed by looking) and lays a clickable grid over it with the geometry above; it falls back to a plain
   grid when Companion cannot be framed or reached. "Test" presses the chosen button through the backend.
6. No dependency: Node's `fetch`. A mock Companion (`mock/companion/`) records requests for tests.

## Consequences
- The picker shows real button faces only when the browser can reach Companion directly (same network). The plain grid
  always works.
- The UI's Content-Security-Policy gets `frame-src 'self' http: https:` (Companion's host is configurable at run time, so
  it cannot be listed). The frame is sandboxed (`allow-scripts allow-same-origin`, no top navigation) and takes no
  pointer events.
- If Companion's grid is larger than rows×cols in LikeABosch, buttons outside it cannot be picked (set rows/cols).
  Companion grids that start at negative rows/columns are not supported by the picker (the API accepts them; the data
  model allows −99…99).
- A future "send to Companion on other events" (votes, meeting start) can reuse the client and action shape.

## Alternatives considered
- **Satellite API** (TCP 16622, LikeABosch as a virtual surface, gets button bitmaps): registers a fake surface in
  Companion, follows the surface's own page, more protocol for a picker. Rejected.
- **Custom variables** (`/api/custom-variable/<name>/value`) instead of button presses: flexible but the operator must
  build triggers in Companion; the user asked for buttons. Can be added as a second action kind later.
- **Browser sends the presses**: needs an open browser and CORS; triggers must run unattended. Rejected.
