# WO-081: Use the DCNM API in LikeABosch: DICENTIS audio & Dante (seat assignment/editing split to WO-106)

| | |
|---|---|
| **Status** | review |
| **Phase** | 3 Web UI |
| **Depends on** | WO-079, WO-101 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-08 |

## Goal
With the dicentis-bridge connected, the Meeting area edits what DEC-014 kept read-only (seat ↔ participant assignment
first, the user's first wish), and Settings → Audio gains DICENTIS's own audio settings (seat Dante out, interpretation
channels, room audio gains/EQ/routing, VU meters).

## Context
DEC-014, DEC-021, WO-050 (replaced), WO-046/WO-049. Interfaces: IPrepareParticipant2, IPrepareAgendaTopic,
IPrepareMeeting, IRoomAudioControl, ISystemAudioControl, IPrepareSystemChannels, IConfigInterpretation, IEquipment.

## Open questions (to refine before `ready`)
- Order of features with the user; which licence the target system has.
- Domain actions/capabilities for the new features (DEC-010 extension), or DCNM-specific views?

## Scope (refined 2026-10-08)
- In: `backend/src/dicentis/audio.js` (DEC-029) → topics `dicentis.audio` (gains of `IRoomAudioControl` with ranges,
  mute, test tone; loudspeaker + sound-reinforcement equaliser bands; audio selection settings; capabilities),
  `dicentis.vu` (only while at least one browser subscribed via `POST /api/dicentis/audio/vu {on}` with a lease of 30 s),
  `dicentis.seatAudio` (per seat Dante out option + headroom from `ConfigArea.GetSeatsAsync`); actions
  `POST /api/dicentis/audio/{gain,equalizer,selection,seat-dante}`; capability `dicentis.audio`.
  UI: Settings → Audio replaces the "Not available yet" card with: room gains (sliders + mute/test tone), equaliser (two
  5-band tables), selection settings (toggles/selects), level meters, seat Dante out (table with bulk set), language
  Dante outputs (link to WO-102's meeting languages). Without the bridge: a short hint how to enable it (launcher
  checkbox / simulation), not "WO-050".
- Out: seat assignment, participant/agenda editing (→ WO-106), system channels (`PrepareSystemChannels`, follow-up).

## Acceptance criteria
- [x] Backend tests against the linked mocks (WO-101): topics fill after login, gain/EQ/selection/seat Dante out
  round trip, VU lease start/stop, 400 on bad bodies, topics unavailable after the bridge disconnects.
- [x] ui-check on a simulated wired system with the full API: Audio view shows the DICENTIS cards, a gain change sticks;
  screenshots looked at.
- [x] `npm test` passes.

## Work log
- 2026-10-07 (Claude Opus): created as draft (follow-up of DEC-021).
- 2026-10-08 (Claude Opus): refined to `ready`. User: "DICENTIS audio & Dante … this was supposed to be done. im trying
  a simulated wired dicentis with the additional api ticked." Open questions answered: DICENTIS-specific feature layer
  (DEC-029), not raw passthrough in views; audio first because the user asked for it. Seat assignment / participant /
  agenda editing split off to WO-106 (draft) for scope discipline. Simulation part → WO-101.
- 2026-10-08 (Claude Opus): in-progress → review. Backend `backend/src/dicentis/` (DEC-029): `service.js`
  (`DicentisFeatures` follows `manager.dcnmClient`; on login fetches areas, active meeting, room audio, seats,
  languages, meeting languages + desks; event-driven refresh; topics `dicentis.*`; VU lease 30 s), `audio.js` (pure
  mappers + validated builders), `languages.js` (WO-102), `routes.js` (`POST /api/dicentis/<area>/<action>`);
  `domain.capabilities.dicentis = { audio, languages }`; `api.dicentis()` in the web client. UI: `web/js/dicentis-audio.js`
  (gains with mute/test tone, level meters, equalisers, audio behaviour settings, seat mic → Dante table with bulk set,
  languages → Dante) mounted in Settings → Audio, replacing the "Not available yet (WO-050)" card; without the bridge a
  hint how to enable it. Tests: `backend/test/dicentis.test.js` 5/5 (one fix: after disconnect the status topic is
  cleared with the other system topics, so "off or cleared" is asserted). ui-check `audio` extended (gain −6 dB, mute,
  seat 2 Dante out, meters) OK light + dark. Screenshots looked at: first version had meter colours stretched with the
  level, oversized values and a clipped Q column → solid colour per level band, smaller values, equaliser card full
  width; second look OK. Docs: `docs/api/dicentis.md`, architecture.
- 2026-10-08 (Claude Opus): full `node scripts/ui-check.mjs` (all systems): 1 failure, wired/light `audio` step "muted"
  (passed alone and in dark). Cause found in the code: a DICENTIS update arriving while a gain slider's change request is
  still running is skipped (no fighting the user's slider) and nothing re-rendered afterwards → stale controls.
  `gainControls` now calls `onIdle` after the request and the card re-renders. The wired scenario sequence
  (companion … audio) then passed light + dark; full re-run: see next entry.
- 2026-10-08 (Claude Opus): full re-run had one different failure (room scenario, see WO-101 log), fixed in the check
  script; then `node scripts/ui-check.mjs` (all systems) **UI CHECK OK**, 54 scenarios ok; `npm test` 308/308.

## Decisions
- VU readings only while a browser leases them (30 s, renewed every 20 s by the page): the API streams many events
  per second; nobody watching = no traffic.
- Equaliser limits (±12 dB, 20…20000 Hz, Q 0.1…10) are our assumption (the CHM gives none); the API rejects what it
  does not accept.

## Handoff
- Delivered audio & Dante as in Scope. Not done: system channels (`PrepareSystemChannels`) → ask the user if wanted.
  Real-system field names/values to verify in WO-082. Seat assignment/editing: WO-106 (draft).
