# DEC-033: Kramer MV-6 and tvONE CORIO switcher drivers (the switchers DICENTIS camera control supports)

- **Status:** accepted (requested by the user 2026-10-12; protocol choices by Claude, revisable after a hardware test)
- **WO:** WO-112
- **Extends:** DEC-012 (camera control: the video switcher was ATEM only), DEC-015 (automation switch unchanged)

## Context
Bosch's DICENTIS camera control (DCNM-LCC data sheet) lists the **Kramer MV-6** and the **tvONE CORIOmatrix** as
supported video switchers (and tvONE C2-2355A + S2-108HD for the wired system). Users moving from Bosch's camera
control have these in the rack. Both are controlled over TCP with a plain text protocol:
- **Kramer MV-6** (3G HD-SDI multiviewer, 6 inputs): Kramer Protocol 3000, TCP **5000**, commands `#…␍`, replies
  `~nn@…␍␊`, front-panel changes are sent unsolicited. `#SRC-VID win,input` sets a window's input;
  `#SRC-VID? win` reads it; `#PRST-RCL n` recalls a layout preset; `#MODEL?` the model. (MV-6 user manual rev 11, §10–11.)
- **tvONE CORIOmaster / CORIOmatrix** (C3 series, CORIOmaster API): TCP **10001**, `login(user,password)`, then
  property writes `Window1.Input = Slot1.In1`, answered with the value and `!Done Window1.Input`; errors start with
  `!Error`. Default credentials admin / adminpw. (tvONE CORIOmaster Commands, API 4.11.)

## Decision
1. **Driver `kramer-mv6`:** program = the input of one window (`window`, default 1: the full-screen window in the
   "Full" layout). Optional `layoutPreset` (1–6) is recalled once after connecting, so the MV-6 shows that window full
   screen. `programCut(n)` = `#SRC-VID <window>,<n>`; program changes made on the front panel are followed (`program`
   event). Inputs 1–6. No preview bus: `previewInput` answers `NOT_SUPPORTED`.
2. **Driver `tvone-corio`:** program = the input of `window` (default `Window1`). Our integer switcher inputs map to
   CORIO input names through `inputs` (comma list, default `Slot1.In1 … Slot1.In4`; input `n` = the n-th name), because
   cameras store an integer `switcherInput` (DEC-012). Optional `previewWindow` (e.g. a monitor window) gives
   `previewInput`; without it `NOT_SUPPORTED`. Login with `username` / `password` (default admin / adminpw), stored in
   `devices.json` like camera passwords (DEC-012, mode 0600) and never returned by the API.
3. Both: one TCP connection, commands answered in order (one outstanding command, timeout 3 s), reconnect handled by
   the device manager like ATEM. **No new dependency** (`node:net`).
4. Mocks for both (`mock/switchers/`) and the in-app `simulated switcher` stays as it is.
5. tvONE C2-2355A (older CORIO2 protocol) is **not** covered; a follow-up WO if a user has one.

## Consequences
- New switcher fields: `window`, `layoutPreset` (Kramer), `inputs`, `previewWindow`, `username`, `password` (tvONE).
- Untested on real hardware until a user has one (WO-041 style hardware check).

## Alternatives considered
- **Kramer `#ROUTE` / `#VID` matrix commands:** the MV-6 is a multiviewer and documents only window commands. Rejected.
- **tvONE REST API (port 80):** newer firmware only and not documented in the command reference; the port-10001 API
  works on every CORIOmaster firmware ("old API still works in unsecure mode"). Rejected for now.
