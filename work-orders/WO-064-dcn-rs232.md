# WO-064: DCN over RS-232 (CCU serial interface)

| | |
|---|---|
| **Status** | blocked |
| **Phase** | 2 Backend |
| **Depends on** | WO-062 |
| **Assignee** | — |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-08 |

## Goal
Deferred by the user ("rs maybe later", 2026-10-05). Control a DCN NG system directly through the CCU's RS-232 interface,
without DCN-SW and the Windows bridge. Separate system id and adapter (DEC-017 §1), mapped onto the same domain topics.

## Refined scope (2026-10-08, from the user's description; see DEC-028, proposed)
The RS-232 link is CCU ↔ DCN-SW server (Bosch configurator). LikeABosch keeps using the DCN-SW API through the
dcn-bridge; DCN-SW 3.10 (first-generation CCU) differs mainly in the server port.
- In: "DCN-SW version" (4.x / 3.x) in settings, launcher and Settings → Connection, setting the default `dcnServer`
  port; bridge: missing methods/events → `NOT_SUPPORTED` per call instead of a failed connection, report what was
  found; mock option "3.x" (same API, other port); docs (BRIDGE.md, README).
- Out: a serial driver in Node (DEC-028 alternatives).

## Acceptance criteria (draft)
- [ ] Choosing 3.x without an explicit `dcnServer` uses `tcp://localhost:<3.10 port>`; 4.x keeps 9461 (tests).
- [ ] Bridge `--fake` with a reduced API reports missing members and answers `NOT_SUPPORTED` for them (bridge test).
- [ ] Verified on a real DCN-SW 3.10 with an RS-232 CCU (needs the user / site).

## Blocked on (user)
- The TCP port of the DCN-SW 3.10 server application (4.70: 9461).
- The DLL names in the 3.10 installation folder (the bridge expects `Bosch.Dcn.Ecpc.Client.Api.Logic.dll` and
  `Bosch.Dcn.Ecpc.Client.Logic.dll.config`), ideally the 3.10 API documentation (CHM) if there is one.
- Does the 3.10 server offer the meeting data stream (DCN-SWSMD, port 20000)?

## Open questions (2026-10-05, answered 2026-10-08: see refined scope)
- Protocol documentation: the DCN NG "open interface" / CCU serial protocol spec (not part of DCN-SWAPI.chm). The user must supply it.
- Hardware path: USB-serial adapter on the LikeABosch machine, or a serial-to-Ethernet converter (then it's TCP again)?
- Serial access from Node needs a native module (`serialport`) → DEC needed for the dependency.

## Work log
- 2026-10-05 (Claude Opus): created as draft.
- 2026-10-08 (Claude Opus): user (2026-10-07, next.md): RS-232 is the CCU's connection type set in the Bosch configurator;
  first-gen CCU with software/API 3.10, compatible with 4.7, main difference the server port. Re-scoped accordingly,
  DEC-028 written as `proposed` (supersedes DEC-017 §1 once accepted). Status `blocked` until the 3.10 port (and DLL
  names) are known. The existing `dcnServer` setting already accepts any port, so a 3.10 server can be tried today with
  `tcp://<host>:<port>` if the 3.10 DLLs have the same names.
