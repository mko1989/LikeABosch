# DEC-012: PTZ camera + video switcher control ("camera director")

- **Status:** accepted (behaviour choices decided by user 2026-10-03; architecture proposed by Claude)
- **WO:** WO-034 … WO-041

## Goal
When a seat's microphone becomes active, the camera assigned to that seat recalls the seat's preset and the video
switcher cuts to that camera.

## Decisions
1. **Drivers in the backend**, one interface per device class:
   - `CameraDriver`: `connect()`, `recallPreset(preset)`, `storePreset(preset)`, `move({pan, tilt, zoom})` / `stop()`
     (jog for setting up presets), `status()`, `close()`. Implementations:
     - **VISCA over IP**: transport UDP or TCP, framing **Sony** (8-byte VISCA-over-IP header, default UDP 52381) or
       **raw** VISCA (no header; used by many PTZ brands, e.g. Avonic/PTZOptics-style ports). Port and framing are
       configurable per camera because brands differ; the Avonic defaults are an assumption until verified on hardware.
     - **Panasonic AW** HTTP CGI (`/cgi-bin/aw_ptz?cmd=#Rxx&res=1`, optional auth).
     - **ONVIF** PTZ (SOAP: GetProfiles, GetPresets, GotoPreset, SetPreset, ContinuousMove, Stop) with WS-Security
       UsernameToken digest; implemented in-house (small, no dependency).
   - `SwitcherDriver`: `connect()`, `programCut(input)`, `state()` (program/preview/inputs), `close()`. Implementation:
     **Blackmagic ATEM** via the `atem-connection` library (MIT, Sofie/NRK; supports all ATEM models). Only **program cut**
     on a configurable M/E (decided by user); auto transition/AUX can be added later.
   - A **mock driver** for each class (in-memory) for demos/tests; protocol-level mocks (VISCA UDP/TCP server,
     Panasonic HTTP, ONVIF SOAP) test the real drivers without hardware.
2. **Dependency exception:** `atem-connection` (ATEM protocol is proprietary and large). It loads under Node and under
   Electron's Node (native part is ABI-stable). All other device protocols are implemented without dependencies.
3. **Configuration** lives in the backend's data dir (our format, versioned JSON): `devices.json` (cameras, switcher,
   camera → switcher input), `room.json` (floor plan, seat/camera positions, seat → {camera, preset}, director settings).
   Not stored in DICENTIS synoptic files (format unknown; import may come later).
4. **Director rules** (user decisions):
   - **Last activated mic wins**; when it goes off, fall back to the previous still-active mic. A priority/chair
     speaker always overrides.
   - No active mic → **overview** shot (configurable camera + preset).
   - **On-air move strategy is configurable per room**: `safe` = never move the camera that is on program (cut to the
     overview/another camera first, move, then cut back), `live` = recall and cut immediately.
   - Timing: configurable delay after mic-on and a minimum shot duration to avoid flicker.
   - Operator can pause automation (manual mode) and trigger shots by hand.
5. The director consumes **`domain.discussion`** (DEC-010), so it works for wired and (later) wireless systems.
6. Device state is pushed to browsers via the state cache/SSE (`devices.*`, `director` topics).

## Consequences
- New backend areas: `backend/src/devices/{cameras,switchers}/`, `backend/src/room/`, `backend/src/director/`.
- Real-hardware verification (Avonic VISCA/ONVIF, ATEM) is a separate WO once hardware is reachable.
