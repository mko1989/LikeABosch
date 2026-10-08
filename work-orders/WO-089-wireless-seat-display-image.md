# WO-089: Wireless: seat display image (logo upload), what the displays show, firmware upgrade status

| | |
|---|---|
| **Status** | review |
| **Phase** | 3 Web UI |
| **Depends on** | WO-076 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
Upload a PNG to the seat displays the way the WAP's firmware upgrade page does, choose whether the displays show it (`showCompanyLogo`), and see the upgrade progress per device.

## Context
WAP web UI code (`/js/app.js`, firmware 1.73.2081; read 2026-10-07, see DEC-024). The real WAP is offline for now (user took it out): build against the wireless mock, verify on the WAP later (e2e:wireless). `configUpgradeController`: multipart POST `/upgrades/file` (field `firmware`); a file name containing "png" targets device type DCNM-WDE ("logo"); then `POST /upgrades` with the selected device ids; `GET /upgrades` lists devices with `state` 1 idle, 2 missing, 3 downloading, 4 programming, 5 rebooting, 6 done, 7 failed. `navigationBarController`: `/system/settings` `showCompanyLogo`. Display hints in `/discuss` (WO-086).

## Scope
- In: backend route `POST /api/wireless-upload/upgrade` (raw body + file name → multipart to the WAP), view `wap-displays` (feature `wapConfig`): PNG picker with preview, target devices (DCNM-WDE), progress table, `showCompanyLogo` switch. Firmware files allowed too (same flow; the WAP picks the device type from the name).
- Out: image conversion/resizing (the user supplies a PNG the WAP accepts; size rules unknown until tested on the WAP).

## Acceptance criteria
- [x] PNG upload reaches the mock as multipart `firmware`, upgrade started for DCNM-WDE devices, progress shown.
- [x] `showCompanyLogo` toggles.
- [x] ui-check scenario + screenshots looked at; `npm test` green.

## Work log
- 2026-10-07 (Claude Opus): created from the user's list in `next.md` ("uploading image as a background for seats. in wireless done like upgrading fw / ability to choose what displays on the seats' displays"); scope set (ready).

- 2026-10-07 (Claude Opus): `web/js/views/wap-displays.js` (Settings → Seat displays): "Show the uploaded logo on the seat displays"
  (`/system/settings` showCompanyLogo, whole object sent back), display hints from `/discuss` with a link; picker for a
  PNG (preview as data: URL: the CSP blocks blob: — first ui-check run failed on exactly that) or firmware file, the
  target devices chosen by the web UI's file-name rule, Upload and install = `POST /api/wireless/upgrades/file` then
  `POST /upgrades [ids]`; device table with upgrade state. ui-check `seat-displays`: 2×1 PNG → DCNM-WDE → Done, logo
  switch on, restored. Screenshot looked at. `npm test` 257/257, `node scripts/ui-check.mjs` (all systems) OK, `npm run e2e:wireless:mock` 23/23 checks, `npm run e2e:mock` 31/31.

## Decisions
- No image resizing/validation beyond PNG: the WAP's size rules are unknown until tested.

## Handoff
Delivered: seat display logo upload + "show logo" switch + upgrade progress. Status `review`. Open (real WAP): which
PNG sizes the WDE displays accept, the `/upgrades` row fields, whether "png" in the name is really all it takes.
