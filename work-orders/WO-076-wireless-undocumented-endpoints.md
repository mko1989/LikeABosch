# WO-076: Wireless: use the WAP's undocumented endpoints (discussion settings, volume, audio, cameras)

| | |
|---|---|
| **Status** | review |
| **Phase** | 2 Backend |
| **Depends on** | WO-075 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
The WAP's own web UI uses 36 endpoints that are not in the REST API v1.7 swagger (WO-075). Some fill gaps LikeABosch has
on wireless: discussion mode (Open/Override/Voice/PTT, max speakers, waiting list size), master volume, audio
routing/EQ, cameras and the camera switcher, battery and diagnostics.

## Context
WO-075 log, `docs/protocol/wireless-rest/README.md` ("Undocumented endpoints"), the WAP web UI (`/js/app.js`,
`/partials/pages/*.html`, `/locales/locale-en_US.json` on the WAP). Undocumented = may change with firmware.

## Open questions (to refine before `ready`)
- Which of them does the user want first (discussion mode and master volume look most useful)?
- Feature-detect per firmware (GET answers 404 → feature off) and mark them "undocumented" in the UI?
- `/cameras` returns camera passwords in clear text: never forward them to the browser.
- A small reference file (paths, bodies, enums from the web UI) like `swagger.yaml`, or extend the swagger as a separate
  `undocumented.yaml`?

## Scope (refined 2026-10-07, DEC-024)
- In: `docs/protocol/wireless-rest/undocumented.json` (curated paths from the WAP web UI: `/discuss`, `/audio`,
  `/audio/master`, `/audio/equalizer/delegate-loudspeaker[/coefficients]`, `PUT /seats/{seat_id}`,
  `PUT /seats/{seat_id}/selected`, `/seats/status`, `PUT /seats/deinit`, `PUT /seats/remove`, `/seats/range-test`,
  `/system/settings`, `/upgrades`), loaded next to `swagger.json` (`undocumented: true`); poller topics
  `wirelessDiscuss`, `wirelessAudio`, `wirelessMasterVolume`, `wirelessEqualizer`, `wirelessSeatsStatus`,
  `wirelessSystemSettings`, `wirelessUpgrades`; multipart upload route for `/upgrades/file`; capability feature
  `wapConfig` (wireless); the wireless mock implements all of it; README section updated.
- Out: `/cameras`, `/network`, `/users`, licensing, factory reset (DEC-024 §2). The UI is WO-086…089.

## Acceptance criteria
- [x] Passthrough serves the curated operations (and still refuses unknown ones); topics fill from the mock.
- [x] Upload route forwards multipart `firmware` to the mock; tests.
- [ ] `npm test`, `npm run e2e:wireless:mock` green. Real WAP: `npm run e2e:wireless` when it is back (user).

## Work log
- 2026-10-07 (Claude Opus): created as draft from WO-075's findings.
- 2026-10-07 (Claude Opus): refined (draft → ready → in-progress) for the user's `next.md` list: open questions answered
  by DEC-024 (curated second spec file, secrets excluded, feature detection via 404 → unavailable topic). Request
  shapes read from the WAP web UI `app.js` (fw 1.73.2081) before the WAP was taken offline.
Delivered: the WAP web UI endpoints the features need, safely curated, in the passthrough, poller and mock. Status
`review`. **Open:** run `npm run e2e:wireless` on the real WAP when it is back: it verifies the endpoints answer and
records the real field names (EQ band fields, audio fields and `/upgrades` rows are assumptions until then).
