# PTZ camera protocols (WO-036, DEC-012)

Reference for the camera drivers (`backend/src/devices/cameras/`) and the protocol mocks (`mock/cameras/`).
Compiled from public vendor documentation (Sony VISCA / VISCA over IP, Panasonic AW integrated camera interface,
ONVIF PTZ service). **Brand specifics marked "assumption" must be verified on hardware (WO-041).**

## Preset numbering in this project
`preset` is the camera-native preset identifier, as shown on the camera's own UI/remote:
- VISCA: number 0–255 sent unchanged as `pp`.
- Panasonic AW: number 1–100 → command `R00`…`R99` (`R` + two digits of `preset - 1`).
- ONVIF: preset **token** string (from GetPresets / SetPreset).

## 1. VISCA (Sony, Avonic, many others)

Camera address 1 → first byte `0x81`. Every packet ends with `0xFF`.

| Function | Command (hex) | Notes |
|---|---|---|
| Preset recall | `81 01 04 3F 02 pp FF` | pp = preset 0x00–0xFF |
| Preset set (store) | `81 01 04 3F 01 pp FF` | |
| Pan/tilt drive | `81 01 06 01 VV WW XX YY FF` | VV pan speed 0x01–0x18, WW tilt speed 0x01–0x17; XX: `01` left, `02` right, `03` stop; YY: `01` up, `02` down, `03` stop |
| Pan/tilt stop | `81 01 06 01 VV WW 03 03 FF` | |
| Zoom tele (variable) | `81 01 04 07 2p FF` | p = speed 0–7 |
| Zoom wide (variable) | `81 01 04 07 3p FF` | |
| Zoom stop | `81 01 04 07 00 FF` | |
| Power inquiry (ping) | `81 09 04 00 FF` | reply `90 50 02 FF` = on, `90 50 03 FF` = standby |

Replies (`y` = socket number 1–2):
- ACK `90 4y FF`; Completion `90 5y FF` (inquiry completion carries data: `90 50 … FF`).
- Errors `90 6y ee FF`: `02` syntax error, `03` command buffer full, `04` command canceled, `05` no socket, `41` command not executable.

### 1a. Sony VISCA over IP framing (default UDP 52381)
Each UDP datagram = 8-byte header + VISCA payload:

| Bytes | Field |
|---|---|
| 0–1 | payload type: `01 00` VISCA command, `01 10` VISCA inquiry, `01 11` VISCA reply, `02 00` control command, `02 01` control reply |
| 2–3 | payload length (big endian) |
| 4–7 | sequence number (big endian, increments per command; replies echo it) |

- Before the first command the client sends **reset sequence number**: type `02 00`, payload `01`, seq 0; the
  camera answers type `02 01`, payload `01`.
- The camera replies with type `01 11` messages carrying ACK and then Completion (same sequence number), or an error.

### 1b. Raw VISCA framing (no header)
VISCA bytes sent as-is over **UDP or TCP**; replies are plain VISCA bytes. Used by many non-Sony PTZ cameras.
**Assumption (Avonic):** raw VISCA over UDP port 1259 and/or TCP port 5678; some models also speak Sony framing on
52381. Driver settings expose transport, port and framing, so the right combination can be chosen per camera.

## 2. Panasonic AW (HTTP CGI)
`GET http://<host>/cgi-bin/aw_ptz?cmd=<urlencoded command>&res=1` (optional HTTP basic auth). Commands start with `#`.

| Function | Command | Response |
|---|---|---|
| Preset recall | `#R00`…`#R99` (preset 1–100) | `s00`…`s99` |
| Preset store | `#M00`…`#M99` | `s00`… |
| Pan/tilt speed | `#PTSxxyy` (xx pan, yy tilt; `50` = stop, `01`–`49` left/down, `51`–`99` right/up) | `pTSxxyy` |
| Zoom speed | `#Zxx` (`50` stop, `01`–`49` wide, `51`–`99` tele) | `zSxx` |
| Power query (ping) | `#O` | `p1` on, `p0` standby |

Errors: `er1` unsupported command, `er2` busy, `er3` out of range (case may differ by model).

## 3. ONVIF PTZ (SOAP 1.2)
- POST to the service address with `Content-Type: application/soap+xml; charset=utf-8`.
- Device service: `http://<host>[:port]/onvif/device_service`. `GetCapabilities` (`tds`) returns the **Media** and
  **PTZ** service XAddr URLs (fall back to the device URL if absent).
- **WS-Security UsernameToken** in the SOAP header: `Nonce` (base64 of 16 random bytes), `Created` (UTC ISO),
  `Password` type PasswordDigest = base64( SHA1( nonceBytes + created + password ) ).

Namespaces: `tds` http://www.onvif.org/ver10/device/wsdl · `trt` http://www.onvif.org/ver10/media/wsdl ·
`tptz` http://www.onvif.org/ver20/ptz/wsdl · `tt` http://www.onvif.org/ver10/schema.

| Function | Request body | Response |
|---|---|---|
| Capabilities | `<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>` | `…<tt:Media><tt:XAddr>URL</tt:XAddr>…<tt:PTZ><tt:XAddr>URL</tt:XAddr>` |
| Profiles | `<trt:GetProfiles/>` | `<trt:Profiles token="Profile_1">…<tt:PTZConfiguration token="…">` (use the first profile with a PTZConfiguration) |
| Presets | `<tptz:GetPresets><tptz:ProfileToken>T</tptz:ProfileToken></tptz:GetPresets>` | `<tptz:Preset token="1"><tt:Name>…</tt:Name>…` |
| Go to preset | `<tptz:GotoPreset><tptz:ProfileToken>T</tptz:ProfileToken><tptz:PresetToken>P</tptz:PresetToken></tptz:GotoPreset>` | `<tptz:GotoPresetResponse/>` |
| Store preset | `<tptz:SetPreset><tptz:ProfileToken>T</tptz:ProfileToken>[<tptz:PresetName>N</tptz:PresetName>][<tptz:PresetToken>P</tptz:PresetToken>]</tptz:SetPreset>` | `<tptz:PresetToken>P</tptz:PresetToken>` |
| Jog | `<tptz:ContinuousMove><tptz:ProfileToken>T</tptz:ProfileToken><tptz:Velocity><tt:PanTilt x="0.5" y="0"/><tt:Zoom x="0"/></tptz:Velocity></tptz:ContinuousMove>` | |
| Stop | `<tptz:Stop><tptz:ProfileToken>T</tptz:ProfileToken><tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>` | |

Faults: SOAP `<s:Fault>` with `<s:Reason><s:Text>…`; authentication failure is typically HTTP 400/401 with a
`NotAuthorized` subcode.

## Driver interface (DEC-012)
```js
connect()                      // open sockets / discover ONVIF services; resolves when usable
recallPreset(preset)           // VISCA/Panasonic: number, ONVIF: token
storePreset(preset)            // returns the preset id actually stored (ONVIF may assign a token)
move({ pan, tilt, zoom })      // each -1…1 (0 = stop for that axis); jog for setting up presets
stop()
listPresets()                  // ONVIF only (others: null)
status()                       // { connected, power?, lastError? }
close()
```
