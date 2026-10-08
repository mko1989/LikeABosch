# WO-036: PTZ camera drivers: VISCA (Sony/raw, UDP/TCP), Panasonic AW, ONVIF + protocol mocks

| | |
|---|---|
| **Status** | done |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-001 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
`CameraDriver` implementations (DEC-012 §1) tested against protocol-level mocks.

## Scope
- `backend/src/devices/cameras/{visca,panasonic,onvif,mock,index}.js`: recallPreset, storePreset, move/stop (jog), status/ping, close; timeouts, retries, error mapping.
- VISCA: Sony VISCA-over-IP header (payload type 0x0100, sequence numbers, ACK/completion parsing) or raw framing; UDP or TCP; configurable port; camera address 1.
- Panasonic AW: HTTP CGI `#Rxx` recall, `#Mxx` store, `#PTSxxyy` pan/tilt speed, `#Zxx` zoom, optional basic auth.
- ONVIF: device/media/PTZ SOAP with UsernameToken digest; GetProfiles → first PTZ profile; GetPresets, GotoPreset, SetPreset, ContinuousMove, Stop.
- `mock/cameras/`: VISCA UDP+TCP server (both framings), Panasonic HTTP server, ONVIF SOAP server; record received commands.
- Tests for each driver against its mock.

## Acceptance criteria
- [x] Each driver: recall/store/move/stop verified against its mock; malformed/timeout handling tested.

## Work log
- 2026-10-03 (Claude Opus): Protocol reference `docs/protocol/cameras/README.md` written first; Haiku agent built the protocol mocks (`mock/cameras/{visca,panasonic,onvif}.js` + tests) from it while I wrote the drivers (`backend/src/devices/cameras/{visca,panasonic,onvif,index}.js`) independently. `backend/test/cameras.test.js` (drivers vs. mocks): first run found real issues on both sides: driver didn't parse several VISCA messages per payload / several Sony frames per datagram (fixed; robust for brands that combine replies); **raw VISCA has no sequence numbers, so a late Completion was taken as the next command's reply** (fixed: raw framing always awaits Completion or its timeout); completion timeout after ACK now reports `acknowledged`; mock raw mode lacked ACK and failNext (fixed by me). Result: VISCA sony/raw × UDP/TCP, Panasonic (incl. auth, 1-based presets → R00), ONVIF (digest auth, profiles, presets, SetPreset token, jog) all pass; 19 tests.

## Decisions

## Handoff
Done against protocol mocks / stub. Real hardware: WO-041.
