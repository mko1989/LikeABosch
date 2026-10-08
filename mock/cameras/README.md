# Mock PTZ Camera Servers

Test servers for camera driver development. Each mock replicates the protocol behavior specified in `/docs/protocol/cameras/README.md`.

## Usage

### VISCA (Sony, Avonic, others)

```javascript
import { createMockViscaCamera } from './visca.js';

// Sony framing over UDP (default)
const mock = await createMockViscaCamera({
  transport: 'udp',
  framing: 'sony',
  port: 52381,
});

// Raw VISCA over TCP
const mock = await createMockViscaCamera({
  transport: 'tcp',
  framing: 'raw',
  port: 5678,
});

// port=0 → random; check mock.port
await mock.close();
```

**Options:**
- `transport`: `'udp'` (default) or `'tcp'`
- `framing`: `'sony'` (default) or `'raw'`
- `port`: listening port; 0 = random (check `mock.port` after creation)
- `host`: listening address; default `'127.0.0.1'`

**State:**
- `state.currentPreset`: current recalled preset number or null
- `state.presets`: Set of stored preset numbers
- `state.moving`: `{ pan, tilt, zoom }` — strings like `'left'`, `'right'`, `'up'`, `'down'`, `'tele'`, `'wide'`, `'stop'`, or null
- `state.commands`: array of hex strings; each VISCA payload received is recorded

**Test helpers:**
- `failNext(errorCode)`: next command returns error `90 6y <code> FF`

### Panasonic AW

```javascript
import { createMockPanasonicCamera } from './panasonic.js';

const mock = await createMockPanasonicCamera({
  port: 80,
  username: 'admin',
  password: 'admin',
});

// GET /cgi-bin/aw_ptz?cmd=<command>&res=1
// With basic auth if username/password configured

await mock.close();
```

**Options:**
- `port`: listening port; 0 = random (check `mock.port`)
- `host`: listening address; default `'127.0.0.1'`
- `username`, `password`: if set, require HTTP basic auth

**State:**
- `state.currentPreset`: current recalled preset number (1–100) or null
- `state.presets`: Set of stored preset numbers
- `state.lastPanTilt`: last `xxyy` value sent to `#PTSxxyy` or null
- `state.lastZoom`: last `xx` value sent to `#Zxx` or null
- `state.commands`: array of command strings received

### ONVIF PTZ

```javascript
import { createMockOnvifCamera } from './onvif.js';

const mock = await createMockOnvifCamera({
  port: 8080,
  username: 'admin',
  password: 'admin',
});

// POST to mock.deviceUrl (/onvif/device_service)
// Requires WS-Security UsernameToken PasswordDigest auth

await mock.close();
```

**Options:**
- `port`: listening port; 0 = random (check `mock.port`)
- `host`: listening address; default `'127.0.0.1'`
- `username`: default `'admin'`
- `password`: default `'admin'`

**State:**
- `state.currentPreset`: current recalled preset token or null
- `state.presets`: Map of `token → name` (initialized with `'1' → 'Chair'`, `'2' → 'Speaker left'`)
- `state.moving`: `{ x, y, zoom }` from last ContinuousMove, or null
- `state.commands`: array of operation names (e.g. `'GetCapabilities'`, `'GotoPreset'`)

**Assumptions:**
- Device service, Media service, and PTZ service are at `/onvif/device_service`, `/onvif/media_service`, `/onvif/ptz_service` relative to `http://host:port/`
- Profiles always use token `"Profile_1"` and PTZConfiguration token `"PTZ_1"`
- SetPreset with no PresetToken creates a new one (assigned next available number)
- GotoPreset with invalid token returns SOAP Fault with subcode `tptz:NoToken`
- WS-Security password verification uses SHA-1 digest

## Implementation Notes

### VISCA Sony framing (UDP)
- 8-byte header: payload type (2 bytes BE), length (2 bytes BE), sequence (4 bytes BE)
- Payload type `0x0100` = VISCA command, `0x0110` = VISCA inquiry, `0x0111` = VISCA reply, `0x0200` = control command, `0x0201` = control reply
- Reset sequence: client sends type `0x0200` payload `01` seq 0; server replies type `0x0201` payload `01`
- For VISCA commands: server sends ACK (type `0x0111` payload `90 41 FF`) then Completion/response (type `0x0111` payload carries the reply), both with the same sequence

### VISCA raw TCP
- Plain VISCA bytes; packet boundaries may not align with command boundaries
- Commands end with `0xFF` and are split on that byte
- Responses are plain VISCA bytes (no framing header)

### Panasonic HTTP
- Query parameter `cmd` contains the command string (e.g., `#R00`)
- Optional `res=1` parameter (ignored in mock)
- Basic auth required if username/password configured
- Response is plain text (no XML, HTML, or JSON)

### ONVIF SOAP 1.2
- Each request is a SOAP 1.2 envelope with namespaces `s`, `tds`, `trt`, `tptz`, `tt`
- WS-Security: Nonce (base64 of random bytes), Created (ISO UTC timestamp), Password type PasswordDigest
- Digest = base64( SHA-1( nonceBytes + created + password ) )
- If auth fails, return HTTP 400 with SOAP Fault containing subcode `tds:NotAuthorized`

## Tests

Run `mocks.test.js` with `node --test`:

```bash
node --test mock/cameras/mocks.test.js
```

Tests exercise each mock with raw clients (dgram, net, fetch), not project drivers.
