# WO-086: Wireless: discussion settings (the WAP's "Prepare → Discussion")

| | |
|---|---|
| **Status** | review |
| **Phase** | 3 Web UI |
| **Depends on** | WO-076 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
Settings → Discussion settings on DICENTIS Wireless: discussion mode, max open microphones, waiting list size, auto shift, cancel request, priority options, ambient / auto mic off, seat display hints (first in waiting list, possible to speak).

## Context
WAP web UI code (`/js/app.js`, firmware 1.73.2081; read 2026-10-07, see DEC-024). The real WAP is offline for now (user took it out): build against the wireless mock, verify on the WAP later (e2e:wireless). Web UI rules: `prepareController` (mode 0 Open / 1 Override / 2 Voice / 3 PTT; maxOpenMics 1…25 on DCNM-WAP; waitingListSize 0…100, ≥ 2 in PTT; participantMicOff forced true unless Open without autoShift).

## Scope
- In: view `wap-discussion` (feature `wapConfig`), reads `wirelessDiscuss`, writes `PUT /discuss` (whole body, as the web UI) through the passthrough; web UI validation rules; "unavailable" when the firmware has no `/discuss`.
- Out: wired discussion settings (Conference Protocol has none; DCNM later).

## Acceptance criteria
- [x] Every `/discuss` field editable with the web UI's limits; saved and re-read (mock).
- [x] ui-check scenario + screenshots looked at; `npm test` green.

## Work log
- 2026-10-07 (Claude Opus): created from the user's list in `next.md` ("discusion settings. that are in prepare discussion"); scope set (ready).

- 2026-10-07 (Claude Opus): `web/js/views/wap-discussion.js` (Settings → Discussion settings): mode, max open mics (1–25), waiting list
  size (0/2–100), priority option (shown as "Option n": its meaning is not in the web UI code), every boolean as a
  labelled checkbox (unknown future fields too), draft + Save / Discard, `normaliseDiscuss` = the web UI's rules
  (participantMicOff forced unless Open without auto shift). ui-check `discussion-settings`: max mics 2 → saved on the
  mock → restored. Screenshot looked at (`wireless-discussion-settings-scenario-light.png`). `npm test` 257/257, `node scripts/ui-check.mjs` (all systems) OK, `npm run e2e:wireless:mock` 23/23 checks, `npm run e2e:mock` 31/31.

## Decisions
- Whole body sent back on save (like the web UI), so fields LikeABosch does not know survive.

## Handoff
Delivered: discussion settings on wireless. Status `review`. Open: the priority options' meaning (check the WAP web
UI page "Prepare" when the WAP is back, then label them).
