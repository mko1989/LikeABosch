# WO-063: DCN in the UI and the launcher

| | |
|---|---|
| **Status** | done |
| **Phase** | 3 Web UI |
| **Depends on** | WO-062 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
DCN can be chosen and configured in Settings → Connection and in the launcher, and every view behaves sensibly with a DCN
system: shared views via `domain.*`, wired-only areas hidden by capability flags, DCN-specific bits (master
volume/mute, meeting/session start/stop, discussion settings) where they exist.

## Context
DEC-009, DEC-010, DEC-017. Views branch on `store.system === 'wireless'` and treat everything else as wired
(`web/js/views/{voting,overview,system,seating,participants}.js`); `connection.js` and `launcher/{lib/settings-store.js,renderer/app.js}`
know only wired/wireless.

## Scope (refined 2026-10-05)
- In:
  - Web Settings → Connection: system option "DCN (via dcn-bridge)", fields **DCN-SW server** and **Bridge token**
    (memory only, like the password), TLS checkbox off for DCN, default port 9480, success toast names the system.
  - Launcher: same option and fields; bridge token stored encrypted with safeStorage (like the password) and passed as
    `DICENTIS_BRIDGE_TOKEN`; `DICENTIS_DCN_SERVER` when set. Launcher tests.
  - New view **Settings → DCN** (`feature: 'dcnControl'`, a new capability flag true only for DCN): bridge/API status
    and allowed flags, meeting + session start/stop, master volume + mute, voting script of the active session
    (select / start) and an ad-hoc voting, discussion settings (open mics, max requests). Writes through `api.dcn()`.
  - Views that treat "not wireless" as wired: check with the DCN mock; fix what breaks or shows wrong data.
  - `npm run ui:check -- --system dcn` pass (DCN mock), screenshots reviewed.
- Out: DCN delegate/meeting editing (config API) UI, interpretation/booth configuration, seat assignment editing; a
  follow-up WO if wanted.

## Acceptance criteria
- [x] DCN can be selected and configured in the web Connection view and in the launcher; secrets never saved in plain text (launcher test checks every file for the token); launcher tests 7/7.
- [x] Settings → DCN shows bridge status and can start/stop meeting+session, set volume/mute, start a voting from the script and an ad-hoc voting (ui:check `dcn` scenario, light + dark: ok).
- [x] ui:check: wired, wireless and dcn passes OK (all scenarios, live update, connect buttons; `UI CHECK OK`); screenshots looked at (see log).
- [x] `npm test` green (186/186).

## Work log
- 2026-10-05 (Claude Opus): created as draft.
- 2026-10-05 (Claude Opus): refined to ready (scope + criteria above) and started (in-progress), same session as WO-059…062.
- 2026-10-05 (Claude Opus): launcher: `settings-store.js` (system `dcn`, `dcnServer`, bridge token encrypted in
  `dcn-bridge-token.bin`, `backendEnv(…, bridgeToken)` → `DICENTIS_DCN_SERVER`/`DICENTIS_BRIDGE_TOKEN` for dcn only),
  `main.js`, `preload.cjs`, renderer form (DCN fields shown for dcn, TLS row hidden). New launcher test.
  Web: `connection.js` (DCN option + fields, toast names the system), `api.dcn()`, new view `views/dcn.js` (Settings →
  DCN, `feature: 'dcnControl'`, new capability flag), registered in `main.js`. ui-check: `--system dcn|all` (default
  all), DCN pass with the mock bridge, `dcn` + `discussion` scenarios, live check via a delegate request.
- 2026-10-05 (Claude Opus): first DCN ui:check run was green, but the **screenshots** showed problems the checks did
  not catch: Overview System card "Loading…" forever (no power on DCN) and an empty wired Room card; Voting view
  showed "No voting is active" for any non-wireless system because it read the wired `votingInfo` topic (a DCN voting
  would never have shown there); empty "Voting parameters" card; Seating with "Seated now: not logged in" and a fake
  "connected" device pill; DICENTIS text in "Changing assignments"; System view greyed out in the nav; Connection form
  still showing the TLS checkbox for DCN (`.field { display: grid }` beat the `hidden` attribute). Fixed: Overview
  shows DCN + Meeting cards for DCN; Voting uses `domain.voting` for wireless + DCN with DCN controls and a link to
  the voting script; Seating hides seated/device columns for DCN with DCN wording; System shows a DCN card and a power
  hint; `[hidden]` rule for `.field`/`.dcn-fields`. Re-ran and re-checked the screenshots (overview, DCN view during
  a voting, connection, seating, discussion, voting for dcn and wireless): OK.
  Full `npm run ui:check` (wired + wireless + dcn): `UI CHECK OK`. `npm test` 186/186.

## Decisions
- One DCN view in Settings rather than DCN variants of the wired Meeting/Agenda views: DCN's meeting model
  (meeting → sessions → voting script) doesn't match DICENTIS's (meeting → agenda → votings).
- Volume slider 0–30: the CHM documents no range (same ASSUMPTION as the mock); WO-065 replaces it with the real range.
- Seat `connected` stays `true` in `domain.seats` for DCN (the room plan and director need a boolean), but the Seating
  view does not claim a device state for DCN.

## Handoff
Done. DCN is selectable in the launcher and the web UI; shared views work through the domain layer; Settings → DCN
covers what the control API offers. Not in scope (possible follow-up, not created yet; ask the user): editing DCN
delegates, registrations/seat assignments, meetings/sessions and voting scripts through the config API. Real-system
check: WO-065.
