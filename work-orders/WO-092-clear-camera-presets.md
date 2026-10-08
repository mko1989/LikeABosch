# WO-092: Delete / clear saved camera presets (seat shots)

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-039, WO-040, WO-056 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
Delete one seat's camera preset, all presets of a camera, or all of them, in Settings → Automation and in the Room editor.

## Context
Seat shots (`room.json` `shots`: seat → camera + preset, WO-039/056) and the overview shot. The presets stored inside the cameras are not deleted (VISCA/Panasonic/ONVIF differ; ONVIF has RemovePreset): out of scope unless the user asks.

## Scope
- In: `DELETE /api/room/shots` (all, or `?cameraId=`), UI: per-row delete in Automation, "Clear presets…" (all / per camera) with confirmation and undo where the Room editor has undo; group panel "Remove presets" for selected seats.
- Out: deleting presets in the camera hardware.

## Acceptance criteria
- [x] Endpoint tests (all / per camera); UI delete per seat, per camera, all; ui-check + screenshots looked at; `npm test` green.

## Work log
- 2026-10-07 (Claude Opus): created from the user's list in `next.md` ("delete clear saved camera presets"); scope set (ready).

- 2026-10-07 (Claude Opus): `DELETE /api/room/shots[?cameraId=]` (`RoomStore.clearShots`; the overview shot goes too when it uses
  that camera). Settings → Camera automation: "Delete presets" for all cameras or one (with counts, confirmation) and a
  ✕ per seat row (first a "Delete" button that pushed "Take" out of view; screenshot showed it). Room → Edit: seat
  inspector "Delete" next to Save; the group panel's existing "Clear shots" (with undo) renamed "Delete presets".
  Tests in `projects.test.js` (per camera / all). ui-check flakiness seen once in the wired room scenario (a DOM node
  read during a re-render): the affected steps now wait for the node; two re-runs OK. `npm test` 257/257, `node scripts/ui-check.mjs` (all systems) OK, `npm run e2e:wireless:mock` 23/23 checks, `npm run e2e:mock` 31/31.

## Decisions
- Presets stored inside the cameras are not deleted (said in the confirmation text).

## Handoff
Delivered: delete saved camera presets per seat, per camera, all. Status `review`.
