# WO-028: Real-server verification and spec corrections

| | |
|---|---|
| **Status** | in-progress |
| **Phase** | 4 Hardening |
| **Depends on** | WO-016 |
| **Assignee** | — |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Run checklists against real wired DICENTIS and wireless WAP (user-assisted): inferred event map (WO-006), spec gaps (WO-003 handoff), wireless open questions (WO-005). Feed findings back into spec JSON, mocks and tests.

## Scope (draft: refine into concrete tasks + acceptance criteria before starting)
- Read DEC-002 (plain HTML/JS, no framework) and the UI conventions decided in WO-018.
- Use only `web/js/api.js` + the SSE store for data; never call DICENTIS directly.
- Hide or disable controls the current permissions don't allow (`GET /api/connection` → permissions).
- Test manually against the mock and note the steps in the work log; real-server check goes into WO-028.

## Checklist collected so far
- [x] Event map: events observed on the real server and processed by the bridge repeatedly (fire-once/re-arm works); names arrive PascalCase (WO-032). Voting events not observable (permissions).
- [ ] `apiStateChanged`: not observed in any run (GetApiState answers {online:true}).
- [x] History-only events `meetingListChanged`, `participantAccessDenied`: accepted, case-insensitive (2026-10-03, DICENTIS 6.50).
- [ ] `GetPluginCommands` element type; `dcnmPluginEvent` shape; `GetSeats.devices[].typeOf` full enum.
- [x] Permission names on DICENTIS 6.50: 3 new ones added to types/Permission.json (canControlMicrophoneSensitivity, canControlPresentation, hasPrepareMeetingLicense).
- [ ] Meeting/agenda operations: which permission do they really need? (PDF lists none; UI gates on canManageMeeting.) Meeting state transitions. Presentation: real permission `canControlPresentation` exists (UI updated).
- [ ] Does a failed Get (e.g. GetMeetingInfo with no active meeting) re-arm its event on the real server? (The bridge re-registers defensively either way.)
- [ ] Voting: answer sets, timers, majority/quorum payloads, whether `done` must be accepted/rejected before the next voting.
- [x] Interpretation: `speakSlow` accepted (status shows `SpeakSlow`), `PhoneCall`/`Alarm` accepted and listed; desk controls all accepted (WO-032).
- [x] ListImages returns relative URIs (`/Images/BackgroundImage.png`) → basename handling correct. [ ] What DeleteImage expects (write test); TransformNotesFile HTML (styles/scripts?) inside the sandboxed viewer; layout file attributes besides `Bosch.Synoptic.Layout`.
- [x] Wireless open questions 1–4 in `docs/protocol/wireless-rest/README.md`: answered on a real WAP in WO-075.

## Status 2026-10-03
Read-only verification (WO-016) and full end-to-end write verification (WO-032) done on the real 6.50 server: event map confirmed for all observed events (refresh ops re-arm them), meeting/presentation/files/plugins/interpretation verified. **Still open, needs a different account or hardware:** voting (needs canViewVoting/canControlVoting), seat illumination selection, microphone mute/unmute (response mode + canDeactivateMicrophone), microphone sensitivity effect, response requests, and the whole wireless part (no WAP available).

## User info 2026-10-03
- The office dev server runs a **demo licence**: some functions are blocked by licence, e.g. voting (explains "No permission" on all voting calls and the missing canViewVoting). Voting verification waits for a fully licensed system.
- **Wireless is deferred** ("will be done in the future"): wireless backend/UI exist and are tested against the mock; real-WAP verification is postponed.

## Acceptance criteria
_(define when moving to ready)_

## Work log

### 2026-10-05: read-only smoke on a fully licensed live system (during a show)
- User request: probe a live, fully licensed DICENTIS (host in `.env`), read-only only, paced queries.
- Added `--delay N` to `scripts/smoke-wired.mjs` (waits N ms before each request after Login). Ran `npm run smoke:wired -- --delay 1000`; report in `data/smoke-wired-live-172.16.4.1-2026-10-05.md`.
- Result: Login OK, 22 permissions (all known in types/Permission.json; **canViewVoting/canControlVoting present**, so voting can be verified on this kind of system). 34 documented + all history-only events accepted (both casings). 43/46 read ops ok, **0 spec deviations**.
- `GetPlugin` → UPSTREAM_ERROR "Unable to perform the operation" (smoke calls it without a plugin id; not a spec finding).
- `GetTransformedNotesFilesInfo` → "unknown operation": this server doesn't have the 7.0 op (WO-044), so it's probably running a pre-7.0 version. The UI must tolerate its absence.
- `GetEnableSeatIllumination` skipped (no canEnableSeatIllumination on this account).
- Event seen: `NotesFileListChanged`.

- 2026-10-07 (Claude Opus): the whole wireless part (open questions, real-WAP verification) was done in WO-075.

## Handoff
