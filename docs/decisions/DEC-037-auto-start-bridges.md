# DEC-037: The launcher starts a bridge by itself when the Bosch software is installed (Windows)

- **Status:** accepted (requested by the user 2026-10-12 in next.md: "the bridge should be run auto on start, when
  conditions are met: system windows, the dlls for a bosch system found"; design by Claude, revisable)
- **WO:** WO-120
- **Extends:** DEC-022 (the launcher runs the bridges the settings need).

## Context
DEC-022 starts a bridge only when the settings ask for it (system `dcn` with a local host, or `wired` + "full DICENTIS
API" on) and only when the server is started. Operators forget the switch, and the bridge then is not there.

## Decision
1. On Windows, when the launcher **starts** (and again before the server starts), it looks for the Bosch API DLLs the
   same way the bridges do: the configured DLL folder, else `Program Files[ (x86)]\Bosch\DICENTIS`
   (`Bosch.Dcnm.Interfaces.Api.dll`) / `…\Bosch\Digital Congress Network\DCN-SW` (`Bosch.Dcn.Ecpc.Client.Api.*.dll`), else
   a search below `Program Files[ (x86)]\Bosch` (depth 4).
2. **DICENTIS DLLs found → the dicentis-bridge starts** (port 9481, loopback), and a wired connection uses it
   (`DICENTIS_DCNM_BRIDGE=true`, host 127.0.0.1) unless the bridge host points to another PC.
   **DCN-SW DLLs found → the dcn-bridge starts** (port 9480, or the configured port when the system is `dcn` on this PC).
3. New launcher setting **`autoBridges`** (default on); `manageBridges` off still disables every bridge start (DEC-022).
   Bridges that are already running with the same command line are not restarted when the server restarts.
4. The launcher shows which Bosch software it found and the bridge state.

## Consequences
- On a PC with the DICENTIS software, LikeABosch has the full API (participants, audio, languages) without any setting.
- A bridge that cannot connect (no DICENTIS server, wrong user) only shows in its state; the Conference Protocol
  connection is not affected (DEC-021).

## Alternatives considered
- **Only a hint ("DICENTIS software found, turn on the bridge"):** one more click the user did not want. Rejected.
