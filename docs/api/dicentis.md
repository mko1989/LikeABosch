# DICENTIS features over the full API (`/api/dicentis`, DEC-029)

DICENTIS-only settings that the Conference Protocol does not have, through the dicentis-bridge (DCNM API,
[dcnm-passthrough.md](dcnm-passthrough.md)): **audio & Dante** (WO-081) and **languages** (WO-102). Needs system
`wired` with `dcnmBridge` on, or a simulated wired system (`fullApi` not `false`, WO-101). The backend builds the DCNM
data classes; bodies here are small JSON objects. Errors: `400 VALIDATION` (message says what), `503 NOT_CONNECTED`
(bridge not logged in), `502` from the API.

## Live topics (SSE, `/api/state`)
| Topic | Data |
|---|---|
| `dicentis.status` | `{ state, meetingId, features: { audio, languages }, reason }` (also in `domain.capabilities.dicentis`) |
| `dicentis.audio` | `{ gains: [{ type, value, min, max, step, muted, testTone }], equalizers: { Loudspeaker: [band], SoundReinforcement: [band] }, selections: [{ type, value }], routing, canControl, canConfigure }`, band = `{ band, filter, enabled, gain, frequency, q }` |
| `dicentis.vu` | `{ readings: { <DcnmLevelSensorType>: dB }, at }` while leased |
| `dicentis.seatAudio` | `[{ id, name, number, kind: participant \| interpreter, danteOut, headroom }]` |
| `dicentis.languages` | `[{ id, abbreviation, short, label, native, userDefined, order }]` |
| `dicentis.meetingLanguages` | `{ meetingId, languages: [{ id, order, source, danteOut, stream2: { enabled, headroom, min, max, danteOut, floorFill } }], canConfigure, canDante, canDesks, canSystemLanguages }` |
| `dicentis.desks` | `[{ seatId, name, outA, outB, outC, setB, setC }]` (language ids, `null` = none) |

## Actions (`POST`)
| Path | Body |
|---|---|
| `/api/dicentis/audio/gain` | `{ type, value?, muted?, testTone? }` (type e.g. `Master`, `Loudspeaker`, `DanteDigitalOut0`) |
| `/api/dicentis/audio/equalizer` | `{ equalizer: Loudspeaker \| SoundReinforcement, band: 0…4, enabled?, filter?, gain? (±12), frequency? (20…20000), q? (0.1…10) }` |
| `/api/dicentis/audio/selection` | `{ type, value }` (DcnmAudioSelectionSettingType) |
| `/api/dicentis/audio/seat-dante` | `{ seatIds, danteOut?: Disabled \| DanteOutEnabledWhenMicOn \| DanteOutEnabledAlways, headroom?: -30…0 }` |
| `/api/dicentis/audio/vu` | `{ on }`: level meters for 30 s; repeat to keep them on, `on: false` stops |
| `/api/dicentis/languages/create` | `{ abbreviation, label, short?, native? }` → `{ id }` |
| `/api/dicentis/languages/update` / `delete` | `{ id, … }` / `{ id }` (user-defined languages only; delete only when not in the meeting) |
| `/api/dicentis/meeting-languages/add` / `remove` | `{ languageId, danteOut? }` / `{ languageId }` |
| `/api/dicentis/meeting-languages/order` | `{ languageIds }` (every meeting language once, new order) |
| `/api/dicentis/meeting-languages/update` | `{ languageId, danteOut?, stream2?: { enabled?, headroom?, danteOut?, floorFill? } }` |
| `/api/dicentis/desks/update` | `{ seatId, outA?, outB?, outC?, setB?, setC? }` (B/C outputs join their selectable set) |

Field mapping to the DCNM types is in `backend/src/dicentis/{audio,languages}.js`; verify on a real system (WO-082).
