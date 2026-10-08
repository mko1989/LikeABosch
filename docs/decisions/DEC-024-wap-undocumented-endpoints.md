# DEC-024: The WAP's undocumented endpoints as a second, curated spec file

- **Status:** accepted (user's feature list 2026-10-07, `next.md`: discussion settings, audio/EQ, seat settings
  (de-init, selection mode, remove), seat display image, what the seat displays show; design by Claude, revisable)
- **WO:** WO-076 (backend), WO-086…WO-089 (features)
- **Extends:** DEC-004 (passthrough), DEC-005 (poller topics), DEC-010 (capabilities)

## Context
Everything the user listed exists only in the WAP's own web UI, which uses endpoints that the REST API v1.7 swagger
does not document (WO-075 found 36). Their request shapes are known from the web UI code (`/js/app.js` of firmware
1.73.2081, read 2026-10-07: services `prepareServices`, `configAudioServices`, `configEqualizerServices`,
`configSeatsServices`, `configUpgradeServices`, `systemService`). Some of those endpoints return secrets (`/cameras`:
camera passwords; `/network`: Wi-Fi key; `/users`).

## Decision
1. `docs/protocol/wireless-rest/undocumented.json`: Swagger 2.0 paths (same shape as `swagger.json`) for the endpoints
   LikeABosch uses, each with `x-source` (web UI service it comes from) and minimal body schemas. `swagger.json`
   stays the verbatim vendor file. `loadWirelessSpec` loads both; operations from the second file carry
   `undocumented: true` (shown in `/api/wireless/ops`).
2. Curated, not complete: only endpoints a feature needs. **Never** `/cameras`, `/network`, `/users`, `/licensing/*`,
   `/system/resettofactorydefaults`.
3. New poller topics (plain GETs, `interval` or on login/after writes, no extra long-polls, WO-075):
   `wirelessDiscuss`, `wirelessAudio`, `wirelessMasterVolume`, `wirelessEqualizer`, `wirelessSeatsStatus`,
   `wirelessSystemSettings`, `wirelessUpgrades`. A firmware without an endpoint answers 404 → the topic is
   unavailable → the UI says so (feature detection per firmware).
4. File upload for the seat display image (PNG) and firmware: dedicated backend route that forwards a multipart POST
   to `/upgrades/file` (field `firmware`, as the web UI does), then `POST /upgrades [deviceIds]`.
5. The UI marks these settings "undocumented WAP API (firmware 1.73)". The wireless mock implements them with the
   same field names, so `npm test`/ui-check cover them; real-WAP verification is a separate step (e2e:wireless).

## Consequences
- A WAP firmware update may change these endpoints: the e2e:wireless run is the check.
- Field meanings partly come from the web UI's code, not from documentation (e.g. the EQ's `enabled` is inverted in
  the web UI; audio levels are steps with per-field dB start/step/max). Where unsure, LikeABosch shows raw values.

## Alternatives considered
- Add the paths to `swagger.json`: mixes vendor text with ours. Rejected.
- Generic "proxy anything" passthrough: would expose the secret-returning endpoints. Rejected.
