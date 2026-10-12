# CCS 1000 D REST API (CCSD-CU): LikeABosch notes

Written for LikeABosch (WO-111, DEC-032); contains no text from Bosch's documents.

- `swagger.yaml`: the Swagger 2.0 document embedded in the vendor HTML (`<script id="embedded-swagger">`), unchanged.
  API version 1.8. **Gitignored** (Bosch material, kept locally; copy it in from `docs/research/ccs-1000/` on a fresh
  clone: extract the embedded script). `swagger.json`: the same, converted once (YAML → JSON, integer response keys as
  strings; the converter that reproduces `wireless-rest/swagger.json` exactly: PyYAML `safe_load` + `json.dump`).
- Loaded by `backend/src/wireless/spec.js` (`loadWirelessSpec(CCS_SPEC_FILE)`); the mock uses it too
  (`createMockWirelessServer({ variant: 'ccs1000' })`).

## Compared with the DICENTIS Wireless API (1.7)
| | WAP 1.7 | CCSD-CU 1.8 |
|---|---|---|
| login / logout / system-info / system status | yes | yes (status: 0 on, 1 standby; no off) |
| seats | battery, signal, range test, voting, identification, dual | `mode` 0 normal, 2 button, 3 PTT; serial number |
| microphone sensitivity | — | `GET/PUT /seats/microphonesensitivity/{seat_id}` `{ sensitivity: 0..15 }` (−6…+9 dB, 1 dB steps, 6 = 0 dB); `POST /seats/resetmicrophonesensitivities` |
| speakers, waiting list, priority | yes | yes, same shapes |
| participants, identification | yes | — |
| voting | yes | — |
| session id | cookie `sid` / header `Bosch-Sid` (swagger said header `sid`) | cookie `sid` or header `Bosch-Sid` (now documented) |
| long-poll `isPolling` | yes | yes |
| undocumented web UI endpoints (DEC-024) | used | not investigated (firmware image is a UBI file system; follow-up) |

Rights named in the descriptions: `can_manage` for microphone sensitivity, as for the speaker lists.

## Not verified on hardware
Everything above is from the swagger. The mock assumes the WAP's observed behaviour (WO-075) for the shared endpoints.
