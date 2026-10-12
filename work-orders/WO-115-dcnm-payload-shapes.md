# WO-115: DCNM payloads the real bridge accepts (audio, languages): strict constructor check everywhere

| | |
|---|---|
| **Status** | review |
| **Phase** | 2 Backend |
| **Depends on** | WO-081, WO-102, WO-106 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-12 |
| **Updated** | 2026-10-12 |

## Goal
Every DCNM write LikeABosch sends can be built by the real dicentis-bridge, proven by the mock bridge's constructor-shape
check switched on for all interfaces.

## Context
The bridge builds a DCNM data class without a parameterless constructor through the constructor whose parameters are
exactly the JSON members; leftover members fail (bridge/common/ClrConvert.cs `ToObject` / `Construct`). WO-106 added
the same check to the mock (`createMockDcnmBridge({ strictApis })`, `checkShape` in mock/dcnm/server.js), on for
RegisterPerson / PrepareParticipant2 only. Switched on for all (`strictApis: true`) it fails three existing writes:
- `/api/dicentis/audio/equalizer`: DcnmAudioEqualizerSettings wants `(equalizerType, filterNumber, filterType,
  filterEnabled, gain, frequency, qualityFactor)`; we send `QFactor`.
- `/api/dicentis/audio/seat-dante`: DcnmSeatConfigurationInfo wants one of its constructors' full member lists (id, name,
  areaId, visType, canDiscuss, canManageMeeting, canUsePriority, hasLanguageDistributionLicense, hasVotingLicense,
  cameraId, prepositionId, …); we send a partial object.
- `/api/dicentis/languages/create`: DcnmLanguageInfo wants `(abbreviation, shortAbbreviation, enLabel, orgLabel,
  userDefined, orderId)`; we send the first four.
(Probe: scratch script calling each `/api/dicentis/*` action against a simulated wired system with strictApis true.)

## Scope
- In: fix the three payloads (backend/src/dicentis/audio.js, languages.js) and the mock behaviours' field names to the
  constructors; switch the mock to `strictApis: true` by default; keep `npm test`, `e2e:mock`, `ui:check` green.
- Out: real-system check (WO-082).

## Acceptance criteria
- [x] `strictApis` default `true`; `npm test` passes.
- [x] Each `/api/dicentis/*` write passes the strict check (a test calls each once).

## Work log
- 2026-10-12 (Claude Opus): created as ready (found during WO-106).
- 2026-10-12 (Claude Opus): in progress → review.
  - `strictApis` default `true` in mock/dcnm/server.js: 3 failing tests (equaliser, language create via the raw API,
    meeting-language update), as expected plus one more: `meeting-languages/update` sent the object as read, with
    `MinimumStream2Headroom` / `MaximumStream2Headroom`, which no constructor takes. Seat Dante out had the same problem
    (`HasVotingLicense2`, `HasLanguageDistributionLicense2`, `HasIdentificationLicense2`).
  - New `backend/src/dcnm/shape.js` `toConstructor(className, obj)`: the largest constructor whose parameters the object
    has (from the DCNM type spec, case-insensitive), only those members; error naming the missing members otherwise.
    Used for every read-modify-write: seat Dante out (DcnmSeatConfigurationInfo, 18-member constructor), language
    create / update (DcnmLanguageInfo), meeting-language update (DcnmMeetingLanguageInfo), desk update (DcnmMeetingDeskInfo).
  - Equaliser: the property is `QFactor` when read but the constructor parameter is `qualityFactor` → the payload sends
    `QualityFactor`; the mock behaviour reads `QualityFactor` and stores `QFactor`.
  - Gain, selection, meeting-language add, participants (WO-106) already matched their constructors.
  - Tests changed because their payloads would also fail on the real bridge: dcnm-sim (language create with `UserDefined`,
    `OrderId`; desk update read → changed → `toConstructor`), dcnm-behaviours (equaliser `QualityFactor`). New: dcnm-shape
    tests (3), `languages/update` called in dicentis.test (was the only `/api/dicentis/*` write without a test).
  - Evidence: `npm test` 373/373; `npm run e2e:mock` 31/31, 123/123 ops; `npm run bridge:test` 16/16; likeabosch
    Companion module tests 7/7 (linked simulation); `npm run ui:check` UI CHECK OK.
## Decisions
- One helper (`toConstructor`) for read-modify-write payloads instead of hand-written member lists: follows the type
  spec, so a new property in a later DICENTIS version is dropped instead of breaking the call.

## Handoff
- Delivered: every DCNM write LikeABosch sends matches a constructor of its class; the mock bridge checks every
  interface the way the real bridge converts (DEC-034 §5).
- Limit of the evidence: the fake Bosch DLLs (bridge conformance test) have public setters, so they accept leftover
  members the real DLLs refuse; the mock's check is the faithful one. Only a real DICENTIS system proves it (WO-082).
  A follow-up could generate the fake with read-only properties (bridge/dicentis/tools/gen-fake.mjs).
