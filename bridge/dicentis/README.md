# dicentis-bridge

Small Windows program that gives LikeABosch the **full DICENTIS API**: Bosch's DCNM .NET API (DICENTIS 7.0: meeting
preparation, participants and seat assignment, agenda, voting, interpretation, room audio, cameras, plugins, … 39
interfaces). It hosts that API on a PC with the DICENTIS software and offers it to LikeABosch over TCP, next to the
Conference Protocol LikeABosch already uses. Why: [DEC-021](../../docs/decisions/DEC-021-dicentis-dcnm-api-bridge.md).
Protocol: [`docs/protocol/dcnm-api/BRIDGE.md`](../../docs/protocol/dcnm-api/BRIDGE.md).

```
LikeABosch backend ──TCP 127.0.0.1:9481──▶ dicentis-bridge.exe ──Bosch.Dcnm.Interfaces.Api──▶ DICENTIS server
                                            └─ Windows PC with the DICENTIS software, on the DICENTIS network
```

The bridge is generic: it discovers every interface, method, event and property of the API by reflection, so it needs no
changes when LikeABosch uses more of the API. It contains no Bosch code; the DLLs come from your DICENTIS installation.
It shares its transport and value conversion with the dcn-bridge (`bridge/common/`).

## Requirements
- A Windows PC with the **DICENTIS software** installed (`C:\Program Files\Bosch\DICENTIS`, which has
  `Bosch.Dcnm.Interfaces.Api.dll`), **the same DICENTIS version as the system** (the API reports
  `VersionMismatchErrorDetected` otherwise), on the DICENTIS network (the API finds the server itself; LikeABosch can
  also name it: setting `dcnmServer`).
- .NET Framework 4.8 (part of Windows 10/11). The process is 64-bit on 64-bit Windows (AnyCPU).
- A DICENTIS user with the rights LikeABosch needs (LikeABosch uses its Conference Protocol user).
- **Device seat assignment (once):** the bridge connects as a DICENTIS device named `LikeABosch` (setting
  `dcnmDevice`). "The API-client is discovered as a device by the server. It needs to be assigned to a seat and given
  manage rights." Do that in the DICENTIS configuration after the bridge connected the first time. Until then
  `/api/connection` shows `dcnm.enabled: false` and many functions are refused (their `Can…` properties are false).
- Licences decide which interfaces work (premium/ultimate participant licences for voting/interpretation, Dante, …).

## Build
On any OS with the .NET SDK (6 or newer):
```
dotnet build bridge/dicentis -c Release        # → bridge/dicentis/bin/Release/net48/dicentis-bridge.exe (+ api.json, example config)
```

## Run
Normally the **launcher starts it** when LikeABosch runs on that Windows PC (DEC-022): system *wired*, "DICENTIS
bridge" on, bridge host `127.0.0.1`. By hand:
1. Check that everything loads, **without** connecting to anything:
   ```
   dicentis-bridge.exe --selftest
   ```
   It lists the interfaces it found (and how: a `WindowsApiInstance` property, or an object implementing a documented
   interface), methods, events, properties and constants, checks the referenced DLLs, and compares with `api.json`.
   `SELFTEST OK` = all good. `MISSING …`/`PARAMS …`/`NOT REACHABLE …`/`WARNING` lines: send the output to the LikeABosch
   developers (WO-082).
2. Start it: `dicentis-bridge.exe` (listens on 127.0.0.1:9481). Other options: `--help`; or a
   `dicentis-bridge.config.json` next to the exe (see `dicentis-bridge.config.example.json`).
3. To serve LikeABosch on **another** PC: `--listen 0.0.0.0` (or one network card's address), allow inbound TCP 9481 in
   the firewall only from that PC, and consider `--token "<secret>"` (DEC-019: optional; enter the same token in
   LikeABosch → Connection). Without a token anyone reaching the port can control DICENTIS.

## Development
- `--fake` serves a generated stub of all 39 documented interfaces (`src/Fake/Fake.generated.cs` from api.json:
  `npm run bridge:gen:dicentis`; behaviour in `src/Fake/FakeBehavior.cs`), so the bridge runs on macOS/Linux with
  `dotnet build -c Release -p:DevTfm=net10.0 -f net10.0` and `dotnet bin/Release/net10.0/dicentis-bridge.dll --fake`.
- `npm run bridge:test` runs the protocol conformance tests of both bridges in fake mode, incl. a call of every
  documented method with spec-generated arguments and the backend against the real bridge.
- Not yet run against real DICENTIS DLLs or a live system (WO-082).
