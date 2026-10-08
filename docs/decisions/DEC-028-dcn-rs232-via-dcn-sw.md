# DEC-028: DCN with an RS-232 CCU = DCN-SW 3.x through the existing DCN-SW API path (no serial adapter)

- **Status:** proposed (from the user's description 2026-10-07; waiting for the user to confirm and to give the
  DCN-SW 3.10 server port). Supersedes DEC-017 §1 (second sentence: "A future RS-232 interface … gets a separate system
  id and adapter") once accepted.
- **WO:** WO-064
- **Builds on:** DEC-017 (DCN-SW API through the dcn-bridge), DEC-018/020 (meeting data stream)

## Context
User, 2026-10-07 (next.md): "id also like to add support for rs-232 version of the ccu dcn. the options for type of
connection are set in configurator bosch software. the v of first gen ccu has software version of 3.10 and api too. but
it should be compatible with the 4.7 version. the main difference is port number of the server application."

So the RS-232 link is between the **first-generation DCN CCU and the DCN-SW server PC** (chosen in the Bosch DCN-SW
configurator), not between LikeABosch and the CCU. The DCN-SW server 3.10 offers the DCN-SW API 3.10, which is said to
be compatible with 4.70 (our `docs/protocol/dcn-swapi/api.json`); its .NET Remoting server listens on another port than
4.70's 9461. DEC-017 §1 assumed a serial "open interface" to the CCU with its own protocol; that is not what is needed.

## Decision (proposed)
1. No serial port, no `serialport` dependency, no new system id. "DCN with an RS-232 CCU" = `system: dcn` (bridge) with
   the DCN-SW 3.10 server's address in `dcnServer` (`tcp://<host>:<3.10 port>`), and the bridge loading the 3.10 DLLs
   from the 3.10 installation (`--dll-dir`).
2. Settings / launcher / web UI get a **DCN-SW version** choice (4.x / 3.x) that only changes the default port of
   `dcnServer` and the hints; an explicit `dcnServer` always wins.
3. The bridge tolerates an API that lacks methods/events of 4.70: missing members answer `NOT_SUPPORTED` per call
   instead of failing the connection; `hello`/`status` report what was found.
4. Whether DCN-SW 3.10 has the meeting data stream (DCN-SWSMD) is unknown: the stream stays optional (DEC-020).

## Consequences
- Cheap if 3.10 really matches 4.70: a port default plus robustness in the bridge.
- Needs from the user / a real system: the 3.10 server port, the 3.10 DLL names (the bridge looks for
  `Bosch.Dcn.Ecpc.Client.Api.Logic.dll` and `Bosch.Dcn.Ecpc.Client.Logic.dll.config`), and a test on a 3.10 system
  (WO-065 style).

## Alternatives considered
- Serial protocol to the CCU from Node (DEC-017 §1 plan): only needed if LikeABosch had to replace DCN-SW; the user's
  setup keeps DCN-SW in between. Rejected unless that changes.
