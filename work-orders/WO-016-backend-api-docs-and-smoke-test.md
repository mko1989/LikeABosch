# WO-016: Backend API documentation and real-server smoke test

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-011, WO-012, WO-013 |
| **Assignee** | Claude Opus + user (real hardware) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Backend HTTP API is documented for UI developers, and the wired backend is verified against the real DICENTIS server.

## Scope (to refine before start)
- `docs/api/README.md`: envelope, error codes, connection endpoints, SSE topics + payloads, passthrough usage.
- `scripts/smoke-wired.mjs`: connects with `.env` credentials, logs in, fetches permissions + every allowed Get op, prints a report (no state-changing calls without `--write`).
- User runs it against the real server; deviations are logged and fed into spec JSON/mock.

## Acceptance criteria
- [x] `docs/api/README.md` covers envelope, error codes, connection endpoints, and links live-state + passthrough docs.
- [x] `npm run smoke:wired` (read-only) runs against the mock: 38/38 read ops ok, report written to `data/`.
- [x] **User:** run `npm run smoke:wired` against the real DICENTIS server (needs `.env` with DICENTIS_HOST/USER/PASSWORD) and share the report from `data/smoke-wired-*.md`.
- [x] Deviations from the report fed into spec JSON / mock / events.json (then this WO → done; remaining items → WO-028).

## Work log
- 2026-10-02 (Claude Opus): Refined from draft and implemented. `docs/api/README.md` (index), `docs/api/live-state.md` and `docs/api/wired-passthrough.md` (written in WO-012/011). `scripts/smoke-wired.mjs`: login, permissions (flags names not in the PDF enum), event registration probe (documented + history-only events in camelCase and PascalCase), every Get*/List* op with response validation against the spec (unknown fields, unexpected enum values), response samples. Never calls state-changing operations. Verified against the mock (all ok). Status → `review`: waiting for a run on the real server.

- 2026-10-03 (Claude Opus): **First contact with a real server** (`100.104.177.48`, given by the user; not stored in config). Unauthenticated probes only (no credentials yet):
  - Ports: 31416 open (WSS), 80 open (but `/api/system-info` → 404, so not a WAP), 443/8080 closed. TLS cert CN `DICENTIS-6B2C8B DICENTIS`, issuer `… DICENTIS Certification Authority` (self-signed CA, valid to 9999), so `tlsInsecure` is needed as expected.
  - WSS `/Dicentis/API` accepts subprotocol `DICENTIS_1_0`. Errors: unknown op → `"DUMMYOPERATION is an unknown operation"` (operation name **upper-cased**); any op before login, incl. parameter errors → `"Please login first"` (login check comes before parameter validation); missing `operation` → `"Bad message format"`. Socket closes without a close handshake (code 1006) when the client closes.
  - The server hosts the vendor demonstrator (public, no login): **DICENTIS 6.50** (`version="6.50.41024"`); our PDF documents ≤ 4.3. Its client code (downloaded to the session scratchpad only, vendor-copyrighted, not committed) calls **18 operations missing from our spec**: getApiState (`{online}`), getDiscussionOptions, getSpeechTimerOptions, getRemainingVoteTime, getSupportedHeadphones, requestSpeech/grantSpeech/removeSpeech and requestResponse/grantResponse/removeResponse (`{seatIds:[], participantIds:[]}`), increaseSpeechTime/decreaseSpeechTime/resetSpeechTime (`{seatId, participantId}` → `{status}`), getMicrophoneSensitivity (`{seatIds}`), getMicrophoneSensitivityDescription, updateMicrophoneSensitivity (`{seatMicrophoneSensitivity}`), resetMicrophoneSensitivity (`{seatIds}`). The vendor client does **not** use the 4 operations excluded by DEC-007 (confirms that decision).
  - Vendor client registers events in **PascalCase** (`"PermissionsChanged"`, …, `"MeetingListChanged"`, `"ParticipantAccessDenied"`), while the PDF's RegisterEvents enum is camelCase. Our backend uses camelCase: to verify after login whether both are accepted.
  - Follow-up WO-031 (draft): add the 6.50 operations to the spec (shapes from the authenticated run), mock, and UI where useful (speech-time adjust, microphone sensitivity).

- 2026-10-03 (Claude Opus): **Authenticated read-only run** (user `admin`, empty password, given by the user; credentials not stored anywhere). Report: `data/smoke-wired-real-1.md` (local, gitignored). Results:
  - Login OK; 20 permissions (incl. 3 not in our Permission type: canControlMicrophoneSensitivity, canControlPresentation, hasPrepareMeetingLicense; account lacks canViewVoting and canEnableSeatIllumination). System was **powered off**; one opened meeting "Meeting"; 8 seats (5 with `hideSeat`), interpretation with 2 booths, 3 languages; 3 layout files, 4 images, many notes files.
  - Event registration: all 34 documented events accepted; event names are parsed **case-insensitively** (PascalCase used by the vendor client also works); unknown names rejected with a .NET enum conversion error.
  - Read ops: 31/38 ok, 7 skipped by permission. Failures fixed: ListFiles needs `attributes` (`[]` = all), GetNotesFileList needs `searchDateRange` with both dates → `refreshParams` in events.json (bridge, validator and smoke script use them). GetPlugin needs `pluginName` (expected).
  - Deviations fixed in the spec (notes cite "Real server DICENTIS 6.50"): master volume is a **dB double** (−24…0, e.g. −2.5) in Get/SetMasterVolume and range; GetSeats adds `hideSeat`, `supportsSpeaking` and omits device fields; GetInterpreterSeats adds `headphone`, `automaticMicrophoneSelection`; several enums come back **PascalCase** (`Local`, `Fixed`, `None`, `Dicentis`, `Meeting`) → enum validation is now case-insensitive (SPEC-FORMAT updated); GetMeetingInfo rejects `meetingId: ""`; GetMeetings may return `agendaList: null`; GetQuorumResult may return `quorumResult: null`. Crosscheck KNOWN list documents the real-server-only fields.
  - 6.50-only read ops answered (shapes recorded for WO-031): GetApiState `{online}`, GetDiscussionOptions `{discussionMode:1,maxRequests,maxResponses}`, GetSpeechTimerOptions `{speechTimerOptions:{showSpeechTimer,speechTimerDurationInSeconds,canAdjustSpeechTimer}}`, GetSupportedHeadphones (20 types), GetMicrophoneSensitivityDescription (−6…+6 step 0.5), GetMicrophoneSensitivity `{seatMicrophoneSensitivities:[{seatId,seatName,sensitivityValue}]}`; GetRemainingVoteTime → "No permission".
  - Mock aligned with real error texts: `"<OP> is an unknown operation"` (upper-cased), `"Please login first"` (checked before parameter validation), `"Already logged in. Please disconnect to log off"`.
  - Our backend + UI against the real server (`scripts/ui-snapshot.mjs`, new: read-only, never clicks): all views render, no console errors; 35 topics synced. UI fixes from the screenshots: domain topics now carry the unavailable reason of their sources (Voting shows "missing permission: canViewVoting" instead of "Loading…", new cache `unavailable` event + SSE `reason`, test added), presentation gated on `canControlPresentation` (fallback canManageMeeting), master volume slider in 0.5 dB steps with unit, hidden seats behind a "Show hidden seats" toggle, unnamed seats labelled. `npm test` 90/90, mock `ui:check` OK on both systems.
  - **No state-changing operation was executed on the real server.**

## Handoff
How to run on real hardware:
```
cp .env.example .env    # fill DICENTIS_HOST, DICENTIS_USER, DICENTIS_PASSWORD
npm run smoke:wired     # → data/smoke-wired-<timestamp>.md
```
Review the report before sharing (it contains real names from the participant list). Then: fix spec JSON (with a note citing "real server, DICENTIS <version>"), re-run `npm run spec:check && npm run docs:spec`, and update the mock where needed.
