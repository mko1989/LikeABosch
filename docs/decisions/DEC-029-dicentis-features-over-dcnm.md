# DEC-029: DICENTIS-only features (audio/Dante, languages) as a backend feature layer over the DCNM API; simulated wired systems include the full API

- **Status:** accepted (requested by the user 2026-10-08: "DICENTIS audio & Dante … this was supposed to be done. im trying
  a simulated wired dicentis with the additional api ticked" and "adding and assigning languages"; design by Claude)
- **WO:** WO-101 (simulation), WO-081 (audio & Dante), WO-102 (languages)
- **Builds on:** DEC-021 (dicentis-bridge, generic mirror), DEC-005 (state cache + SSE), DEC-009 (UI rules),
  DEC-026 (simulated systems). Answers WO-081's open question "domain actions or DCNM-specific views?".

## Context
WO-079 gives the whole DCNM API as passthrough (`/api/dcnm/ops/<Api>/<Method>`) and a mirror of every event
(`dcnm.<Api>.<Event>`). That is not enough for a UI: many values only come from `Get…Async(id)` calls (languages,
meeting languages, seats of an area), the matching events only say "something changed", writes need whole DCNM data
classes (PascalCase, enum names, Guids), and the active meeting / area ids must be looked up first. The simulated wired
system (DEC-026 §2) forced `dcnmBridge: false`, so none of this could be tried without Windows.

## Decision
1. **Feature layer `backend/src/dicentis/`** (one module per feature: `audio.js`, `languages.js`, shared `context.js` for
   the active meeting id and the area ids). It listens to the `DcnmClient` (events + loggedIn), calls the `Get…`/`Request…`
   methods it needs, and publishes **normalised topics** (camelCase, plain JSON) through the state cache:
   `dicentis.audio` (room gains, equaliser, audio selection, capabilities), `dicentis.vu` (level readings, only while a
   client asked for them), `dicentis.seatAudio` (per seat: Dante out option, headroom), `dicentis.languages` (system
   language list), `dicentis.meetingLanguages` (languages of the active meeting, order, Dante out, stream 2),
   `dicentis.desks` (interpreter desk output language setup). Topics are marked unavailable with a reason when the
   bridge is off/disconnected or the `Can…` capability is false.
2. **Writes are feature actions** `POST /api/dicentis/<feature>/<action>` with small validated JSON bodies; the backend
   builds the DCNM data classes (read-modify-write of the current object, so fields the UI does not know are kept).
   The UI never builds DCNM classes and keeps using `web/js/api.js` (DEC-009). The raw passthrough stays for scripts.
3. **Capability flag** in `domain.capabilities`: `dicentis: { audio, languages }` (true when the bridge is logged in and
   the matching `Can…` is true), so views decide what to show without knowing DCNM.
4. **Simulation:** a simulated *wired* profile also starts the mock dicentis-bridge (`mock/dcnm`) unless the profile
   says `fullApi: false`; the connection settings for the simulation then carry `dcnmBridge: true` with the mock's port.
   The two mocks are **linked** in-process (`mock/dcnm/wired-link.js`): same seat ids and names, the active meeting,
   and languages/desks created or changed through DCNM show up in the Conference Protocol mock's interpretation state
   (with its events), as on a real system where both APIs see one database.

## Consequences
- DCNM semantics live in one backend place; tests run against the linked mocks; the real-system check is WO-082.
- Field names follow the DCNM docs (types.json); if the real bridge serialises differently (casing, enum values), only
  the feature layer changes.
- Existing simulated wired profiles get the full API on their next start (no field = on).

## Alternatives considered
- **UI calls the passthrough directly:** every view would rebuild DCNM classes and id lookups; rejected.
- **Extend the generic mirror with Get-calls:** the mirror stays generic by design (DEC-021 §4); rejected.
- **Separate simulation profile type "wired + full API":** more choices for the same thing; a per-profile switch is
  enough.
