# DEC-015: Per-device automation switches (cameras, video switcher)

- **Status:** accepted (toggles requested by user 2026-10-05; semantics proposed by Claude)
- **WO:** WO-056
- **Extends:** DEC-012 §4 (the global Auto/Manual switch stays)

## Context
DEC-012 has one global switch (`room.director.enabled`). Operators need to take a single camera, or the switcher, out
of the automation, e.g. to use one camera by hand or to cut by hand while cameras still follow the speakers.

## Decision
1. Every camera and the switcher have `automation: boolean` in `devices.json` (default `true`; missing = `true`).
   Set when adding/editing a device and toggled live by the operator: `PUT /api/devices/cameras/:id {automation}`,
   `PATCH /api/devices/switcher {automation}` (partial update; reconnects only when connection fields change).
2. **Camera automation off:** the director never moves that camera or cuts to it automatically. Seats whose shot
   uses it are treated like seats without a shot (→ overview); if it is the overview camera, there is no automatic
   overview (and no safe cut-away through it).
3. **Switcher automation off:** the director still recalls presets on the cameras but never cuts. With the
   `safe` strategy it does not move the camera that is currently on program (it would move live); `live` moves it.
4. The flags only affect **automatic** shots. A manual shot (Take / 📷 / Overview button) is an explicit operator
   command and is executed fully.
5. The global Auto/Manual switch remains the master switch (off = nothing automatic at all).

## Consequences
- Director decisions take an "effective room" (shots/overview filtered by enabled cameras) and a `cuts` flag;
  `plan()` stays pure and testable.
- UI shows the state wherever devices appear: Settings → Cameras (form + list), room plan (camera marked
  "manual"), camera inspector and the automation side panel (switcher).

## Alternatives considered
- Per-seat automation switches: more granular but not asked for; seats can simply have no shot.
- Removing the camera's shots when automation is off: destructive; the operator wants to switch it back on.
