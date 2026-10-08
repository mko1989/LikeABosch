# dcn-bridge

Small Windows program that lets LikeABosch control a **Bosch DCN Next Generation** system. It hosts Bosch's DCN-SW API
(.NET DLLs) next to the DCN-SW server and offers it to LikeABosch over the network. Why: DEC-017. Protocol:
[`docs/protocol/dcn-swapi/BRIDGE.md`](../../docs/protocol/dcn-swapi/BRIDGE.md).

```
LikeABosch (any OS) ──TCP 9480──▶ dcn-bridge.exe ──tcp://localhost:9461──▶ DCN-SW server ──▶ DCN NG CCU
                                   └─ runs on the DCN-SW PC (Windows, .NET Framework 4.8)
```

The bridge is generic: it discovers every interface, method and event of the DCN-SW API by reflection, so it needs no
changes when LikeABosch uses more of the API. It contains no Bosch code. The DLLs come from your DCN-SW installation.
Its transport, JSON and value conversion are shared with the dicentis-bridge (`bridge/common/`, DEC-021).

## Requirements
- Run it **on the PC with the DCN-SW server** (DCN Conference Software). The DCN-SW server delivers events (microphone
  on/off, lists, voting) by calling back into the bridge over .NET Remoting on a random port; on the same PC that is
  loopback, from another PC the firewall would have to allow those inbound connections.
- .NET Framework 4.8 (part of Windows 10/11). The process is **32-bit**: the DCN-SW API DLLs are x86-only.
- `--dll-dir` = the **DCN-SW installation folder** (the one with `Server.exe`). The API needs 13 Bosch DLLs from it
  (`Bosch.Dcn.Ecpc.Client.Api.*`, `…Client`, `…Client.Logic`, `…Client.Interfaces`, `…Server.Interfaces`,
  `…Operational`, `Bosch.Dcn.Operational`, `Bosch.Operational`, `…EquipmentResourceLibrary`, `…Driver`, `ZedGraph`)
  **and `Bosch.Dcn.Ecpc.Client.Logic.dll.config`** (the remoting channel set-up for those callbacks). The bridge
  switches its working directory to that folder because Bosch's library loads the config by bare file name.
- The **DCN-SW API licence** for operational control (DCN-SWDB for calls by participant id), and a DCN-SW user.

Verified offline against the DLLs of a DCN-SW 4.70.6 installation (WO-068, `npm run bridge:inspect`): every method,
parameter and event of the 4.70 documentation exists, plus 5 methods and 6 events the CHM does not mention
(`CancelSpeaking`, access control, attendance registration). Not yet run against a live DCN-SW server (WO-065).

## Build
On any OS with the .NET SDK (6 or newer):
```
dotnet build bridge/dcn -c Release          # → bridge/dcn/bin/Release/net48/dcn-bridge.exe (+ api.json, example config)
```
Copy the `net48` folder to the Windows PC.

## Install and run
1. The bridge finds the DCN-SW installation by itself when it is in the standard folder
   `C:\Program Files (x86)\Bosch\Digital Congress Network\DCN-SW` (it also searches below `Program Files\Bosch`, and
   logs `DCN-SW API found in …`). Otherwise pass `--dll-dir "<folder>"`, **in quotes** when the path contains spaces.
   Don't copy the DLLs next to the exe: the API also needs the other Bosch DLLs and the remoting config of that folder.
2. Check that everything loads, **without** connecting to anything:
   ```
   dcn-bridge.exe --selftest
   ```
   It lists the interfaces, methods, events and constants it found, checks the 32-bit process, the working directory,
   the remoting config file and that all referenced DLLs are present, and compares with `api.json`.
   `SELFTEST OK` = all good. `WARNING`, `MISSING …`/`PARAMS …` lines: send the output to the LikeABosch developers (WO-065).
3. Start it:
   ```
   dcn-bridge.exe
   ```
   Without a token it accepts every client (DEC-019, internal use) and says so in a `WARN` line. To restrict it, start
   it with `--token "<secret>"` and enter the same token in LikeABosch → Settings → Connection. Options can also go
   into `dcn-bridge.config.json` next to the exe (see `dcn-bridge.config.example.json`).
4. Allow inbound TCP 9480 in the Windows firewall, **only from the LikeABosch machine** if possible. The port is not
   encrypted and, without a token, open to anyone who reaches it. `--listen <ip>` binds it to one network card.
5. In LikeABosch: system **DCN**, host = this PC, port 9480, DCN-SW user/password, DCN-SW server
   `tcp://localhost:9461` (as seen from this PC); bridge token only if you set one.

Running it permanently: start it from Task Scheduler at log-on/boot, or wrap it as a service (e.g. NSSM). A proper
installer is WO-029.

| Option | Env | Default |
|---|---|---|
| `--listen <ip>` | `DCN_BRIDGE_LISTEN` | `0.0.0.0` |
| `--port <n>` | `DCN_BRIDGE_PORT` | `9480` |
| `--token <secret>` | `DCN_BRIDGE_TOKEN` | none: every client accepted (DEC-019) |
| `--dll-dir <folder>` | `DCN_BRIDGE_DLL_DIR` | folder of the exe if the DLLs are there, else the standard DCN-SW folder (see above) |
| `--config <file>` | | `dcn-bridge.config.json` next to the exe |
| `--init-timeout <s>` | | 60 |
| `--verbose` | | off: logs every call |
| `--fake` | | built-in stub API instead of the DLLs (testing) |
| `--selftest` | | check the DLLs and exit |

## Behaviour notes
- One LikeABosch at a time. A new connection replaces the old one.
- The DCN-SW API stays logged in when LikeABosch disconnects unexpectedly (a restarted backend is back immediately). An
  explicit Disconnect in LikeABosch logs it off (`Terminate`).
- Calls are executed one at a time, in order. Events are forwarded as they arrive.
- The process is 32-bit (x86) so it can load older 32-bit Bosch DLLs. If yours are 64-bit only:
  `dotnet build bridge/dcn -c Release -p:PlatformTarget=x64`.

## Development
- `npm run bridge:inspect` (macOS/Linux/Windows, .NET SDK): reads the DLLs in `dcn/` **as metadata only** (nothing is
  executed) and writes `data/dcn-dll-report.json`: versions, bitness, references, the full API surface, constants,
  remoting usage, and the differences to `api.json`. `python3 scripts/chm/dcn-dll-additions.py data/dcn-dll-report.json`
  then refreshes `docs/protocol/dcn-swapi/dll-additions.json`, which `scripts/chm/dcnswapi.py` merges into the spec.
  The Bosch DLLs themselves are never committed (`dcn/` is gitignored).
- `src/ApiHost.cs`: loading + reflection (interfaces, methods, events, flags, constants), Initialize watchdog.
- `src/ClrConvert.cs`: JSON ↔ .NET values. `src/Json.cs`: JSON without dependencies. `src/Server.cs`: protocol.
- `src/Fake/Fake.generated.cs`: stub of the documented API, generated from `docs/protocol/dcn-swapi` by
  `npm run bridge:gen`. It implements the interfaces **explicitly**, as obfuscated DLLs may, so the reflection paths are
  the real ones. `src/Fake/FakeBehavior.cs`: the little state behind it.
- `npm run bridge:test` builds a `net10.0` variant (`-p:DevTfm=net10.0`), starts it with `--fake` and runs the protocol
  conformance tests (`test/conformance.test.mjs`), including the LikeABosch backend syncing through it. The `net48`
  build itself (Remoting, Bosch DLLs) can only be run on Windows.
