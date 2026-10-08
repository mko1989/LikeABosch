# WO-032: End-to-end test of the full API on the real server

| | |
|---|---|
| **Status** | done |
| **Phase** | 4 Hardening |
| **Depends on** | WO-016, WO-031 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
Every operation of the wired API (110 in scope + 4 excluded) called and verified end to end on the real DICENTIS 6.50 dev server, through our own backend: HTTP passthrough / domain API → server → DICENTIS events → event bridge → state cache.

## Context
User (2026-10-03): the server at the office is a dev system; any change is allowed; "full API coded and checked end to end". Credentials (`admin`, empty password) and host are passed via environment only, never stored.

## Deliverables
- `scripts/e2e-wired.mjs` (`npm run e2e:wired`, needs DICENTIS_* env): 28 checks in 13 areas, call log, per-operation coverage, spec validation of every response, restore list (volume, test file/image/plugin, power). Reports in `data/` (gitignored).
- `scripts/e2e-mock.mjs` (`npm run e2e:mock`): same suite against the mock (keeps mock semantics aligned with the real server).
- `scripts/ui-snapshot.mjs`: read-only UI screenshots against any system.

## Acceptance criteria
- [x] 114/114 operations called on the real server; 28/28 checks pass (run 3, `data/e2e-wired-real-3.md`).
- [x] 0 spec deviations in responses after the corrections below.
- [x] Same suite passes against the mock (28/28, 114/114).
- [x] `npm test` 91/91, `npm run ui:check` OK on both systems.
- [x] Server left as found (powered off, meeting opened).

## Work log
- 2026-10-03 (Claude Opus): Run 1: 18/29. **Critical bug found:** the real server sends event names in **PascalCase** (`MasterVolumeChanged`); the bridge matched camelCase exactly, so on real hardware *no live updates were processed*. Fixed (case-insensitive lookup); the mock now sends PascalCase too so tests cover it.
- Run 2: 25/28. Findings: discussion commands are processed asynchronously (remove within ~100 ms of add is a no-op) → waits now require a fresh cache update; with discussionMode 1 RequestSpeech grants immediately; RequestResponse/GrantResponse have no effect, RemoveResponse fails without a response entry; microphone sensitivity returns status:false on all seats of this installation (devices report supportsSpeaking:false) → reported as hardware limitation; **CloseMeeting deactivates the meeting and the built-in "Default" meeting (not in GetMeetings) becomes active**; ActivateMeeting with autoOpenOnActivate opens directly; MeetingListChanged never fires; **the plugin queues are consumed by GetPluginEventData/GetPluginCommands**, so the bridge emptied them before anyone could read → plugin queues are now notification topics; notes written seconds ago read as empty/"tampered".
- **Spec bug found by review:** RegisterPlugin request/response were swapped by the WO-003 extraction (PDF p.204). Fixed; validator now warns about this pattern.
- Run 3 (after fixes, harness reworked): **28/28 checks, 114/114 operations, 0 spec deviations**. Real shapes captured: plugin events `{pluginName, event, parameters}`, plugin commands `{correlationId, pluginCommand:{pluginName, command, parameters}}`, SendPluginCommand answers with the SetPluginCommandResult result; power off ≈10 s via poweringOff; signed notes verify (isDocumentSigned, certificate).
- Mock aligned: PascalCase events, Default meeting semantics, 6.50 ops, plugin registry with async SendPluginCommand, `failOperation()` test hook, real error texts.
- UI: Meetings view treats the built-in Default meeting as "no prepared meeting active"; speech time controls.
- Side effects on the dev server: 3 old notes files deleted (deletion test, once per run), new notes files from meeting close/activate, booth notifications PhoneCall/Alarm raised; test file/image/plugin removed; power restored to off.

## Decisions
- E2E runs through the backend, not the raw socket (only alternative request forms are probed raw).
- Plugin event/command queues and access-denied are SSE notifications, not cached state.
- Mutating checks restore state; the notes deletion test deletes the oldest file (dev server, user-approved).

## Handoff
Done. Not verifiable with this account/installation: voting (account lacks canViewVoting/canControlVoting: all voting calls answered "No permission"), seat illumination selection (canEnableSeatIllumination), Activate/DeactivateMicrophone (canDeactivateMicrophone, response mode), microphone sensitivity effect (devices reject), response requests (discussion mode), wireless (no WAP). These are listed in WO-028.
