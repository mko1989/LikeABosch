# WO-067: DCN Streaming Meeting Data in the UI and the launcher

| | |
|---|---|
| **Status** | done |
| **Phase** | 3 Web UI |
| **Depends on** | WO-066 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
"DCN – meeting data stream (read-only)" can be chosen in Settings → Connection and in the launcher, the shared views
behave as read-only, and a Settings view shows the stream's meeting, voting, service calls, interpretation and log.

## Scope
- In: connection form + launcher option (port 20000, no username/password), views branching on `dcn` also handle
  `dcn-smd` (overview, voting, seating, system), new view `views/dcn-stream.js` (`feature: 'dcnStream'`): stream
  status and data age, reset, meeting/session/attendance, voting (subject, answers, totals, quorum/majority,
  approved), service calls, interpretation desks, microphone test, activity log. `ui:check` pass `dcn-smd`.
- Out: control (DEC-018: read-only).

## Acceptance criteria
- [x] dcn-smd selectable in web Connection view and launcher; launcher tests green (7/7, test extended).
- [x] ui:check `dcn-smd` pass (light + dark) with a live update from the mock; screenshots looked at; other passes still OK (`UI CHECK OK` for wired, wireless, dcn, dcn-smd).
- [x] `npm test` green (199/199); `e2e:mock` 31/31; `bridge:test` 7/7.

## Work log
- 2026-10-05 (Claude Opus): created (ready), then in-progress after WO-066.
- 2026-10-05 (Claude Opus): web: Connection option "DCN Next Generation: meeting data stream (read-only)" (port 20000,
  user/password/TLS hidden, hint about AllowedClients and the licence), bridge option renamed "full control (via
  dcn-bridge)"; overview DCN-meeting-data + Meeting cards; voting (domain-only, read-only note); seating (no
  seated/device columns, DCN wording); system (no power, stream card); new `views/dcn-stream.js` (Settings → DCN,
  `feature: 'dcnStream'`): stream health + Reset, meeting/sessions/channels, voting with percentages/quorum/majority/
  groups, usher calls, interpretation desks, tests, activity log. Launcher: `dcn-smd` option, login fieldset hidden.
  ui-check: `dcn-smd` pass (fresh mock per theme so its queue replays the meeting), scenarios `discussion`
  (read-only: no control buttons) and `dcn-stream`.
- 2026-10-05 (Claude Opus): found while doing this: in the **launcher** `label.check { display: flex }` beat the
  `hidden` attribute, so the TLS row hidden for DCN in WO-063 was still visible there → global `[hidden]` rule in
  `launcher/renderer/style.css`. Web: `.hint[hidden]` added to the existing scoped rule. Screenshots reviewed
  (stream view after a voting/usher call/interpretation/mic test, discussion dark, connection, overview, voting,
  seating, system); fixed "Stream: Logged in" → "Receiving". Full `npm run ui:check`: `UI CHECK OK`.

## Decisions
- One "DCN" entry per DCN mode in Settings: `dcn-stream` (stream) or `dcn` (bridge), chosen by capability flag.
- The stream view's Reset is the only write in this mode; it clears LikeABosch's reconstructed state, not the DCN system.

## Handoff
Done. Known limitation (by design of the stream): seats without a participant appear only once the stream mentions
them; after connecting mid-meeting the picture fills in with the next activities (or comes from the persisted state).
Real-system check: WO-065.
