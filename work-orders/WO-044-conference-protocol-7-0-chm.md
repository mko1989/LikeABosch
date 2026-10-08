# WO-044: Update the spec from the DICENTIS 7.0 Conference Protocol docs (CHM)

| | |
|---|---|
| **Status** | done |
| **Phase** | 4 Hardening |
| **Depends on** | WO-031, WO-032 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
The user added newer vendor docs (2026-10-03) as CHM files. `ConferenceProtocol.chm` documents **DICENTIS 7.0** (our spec
came from an older PDF plus what we observed on the 6.50 dev server). Bring the spec, mock and backend up to date
without losing what the real server taught us (DEC-013 §2).

## Context
- Sources: `docs/source/*.chm`, extracted to `docs/source/chm/<name>/` with `7zz` (see `scripts/chm/README.md`).
- Diff tool: `python3 scripts/chm/chmdiff.py` (CHM method pages vs `docs/protocol/conference/operations/*.json`).
- History page (CHM "History"): 6.1 mic sensitivity, 6.2 speech timer + remaining vote time, 6.3 `Login.userId`,
  `Participant.userName/screenLine`, 6.4 `HasPrepareMeetingLicense`, 6.7 notes-file reading, 7.0 removes `activeVideo`.
- The other two CHMs are **not** wire protocols: `DcnmApiDocumentation.chm` is the Windows .NET API
  (`Bosch.Dcnm.Interfaces.Api`, 39 interfaces incl. `IControlCamera`/`IPrepareCamera`, "make your own external video
  switcher"); `DICENTIS_PluginDocumentation.chm` describes the Hybrid-meetings plugins (Chat, Presentation, DicentisHybrid)
  reachable through the Conference Protocol plugin operations: input for WO-026.

## Findings (diff run 2026-10-03: 122 CHM methods vs 114 spec operations)
New operations in the CHM:
- `GetTransformedNotesFilesInfo` {fileName} → {notesFileInfo{creationDateTime, fileName, fileSize, fileType, isTampered, needsTransform}} (6.7, canViewSynoptic)
- `ReadNotesFile` {fileName, offset, length} → {FileBytes:[byte]} (6.7, canViewSynoptic): chunked notes download
- `ValidateImageFile` {imageData, imageExt} → {isValidImageFile}
- `CanExecutePresentationPlugin`, `ExecutePluginCommand`: pages empty: probe on the server
- `GetNamecardStatus` {namecardUrl} → {isNamecardAvailable}: "internal use only": exclude (DEC-007 style)
- `CheckIfNoNullOrEmptyGuids`, `ConvertStringsToGuids`, `IsImageContent`: look like C# helpers, not wire ops: probe, then exclude
Field differences (CHM has, spec lacks):
- `ActivateMicrophone` / `DeactivateMicrophone` request: optional `seatIds[]`, `participantIds[]` (multi-seat)
- `GetDiscussionList` entries: `adjustSpeechTime`, `adjustSpeechTimeDuration`, `totalSpeechTime`; `activeVideo` removed in 7.0 (mark deprecated, keep optional)
- `GetNotesFileList.fileData[]`: `fileSize`, `needsTransform`; `GetParticipants.participants[]`: `userName`, `screenLine`; `Login`: `userId`
- `UpdateMicrophoneSensitivity` items: `seatName`; `RegisterPlugin`: `description`, command/event `description` + JSON schemas
- `GetRemainingVoteTime` response `{remainingVoteTime:int}` (spec empty: demo licence blocked it)
- Voting answers enum also `A|B|C|D` (multiple choice): GetVotingInfo/GetVotings/GetVotingResults/GetSeatVotingResults/GetIndividualVotingResults
- Permissions: `GetDiscussionOptions`, `GetSpeechTimerOptions` need `canViewSynoptic`
- Events in the CHM `RegisterEvents` list but not in `events.json`: `discussionOptionsChanged`, `imageServerUriChanged`, `seatMicrophoneSensitivityUpdated`
Where the spec is richer than the CHM (keep spec; CHM page empty or wrong): GetDiscussionOptions, GetInterpreterSeats,
GetPluginCommands, GetPluginEventData element shape, GetSupportedHeadphones, all `double` volume/sensitivity values (CHM says int),
date fields typed `string` (CHM `dateTime`).

## Scope
- In: update operations/*.json (fields, enums, permissions, `minVersion` for 6.7+ ops if SPEC-FORMAT gets that field),
  add the 3 events (bridge refresh mapping + mock), add the new ops (or exclude with reason), regenerate REFERENCE.md,
  validator + crosscheck clean, mock behaviours for the new ops, tests.
- In: probe the 6.50 dev server for the new ops/fields/events (e2e rules in CLAUDE.md; host/credentials via env only) and
  record results in each op's `extractionNotes`.
- Out: .NET DCNM API (Windows-only; not usable from Node: see DEC-013 §3). Plugin UI → WO-026.

## Acceptance criteria
- [x] `chmdiff.py` shows only differences that are explained in `extractionNotes` (real-server evidence or deliberate).
- [x] `npm run spec:check`, `npm test`, `npm run ui:check` pass; e2e against the dev server still 0 deviations.

## Work log
- 2026-10-03 (Claude Opus): CHMs extracted (7zz), diff tool written, findings above. Not yet applied to the spec.
- 2026-10-03 (Claude Opus): **6.50 probes** (scratchpad scripts, host/credentials via env): every new CHM operation answers
  "X is an unknown operation" on 6.50 (incl. ValidateImageFile, GetNamecardStatus, the plugin ones and the C# helpers);
  `Login` already returns `userId`; GetNotesFileList has no fileSize/needsTransform yet; RegisterEvents accepts all 39 CHM
  events in one call and rejects unknown names ("Error converting value … SynopticControl.Common.ConferenceEvent");
  GetMicrophoneSensitivity with `seatIds: []` returns every seat (missing seatIds → "Value cannot be null"); multi-seat
  Activate/DeactivateMicrophone reach the permission check (account lacks canDeactivateMicrophone, as in WO-032).
- Spec: field additions (Activate/DeactivateMicrophone seatIds/participantIds, GetDiscussionList adjustSpeechTime /
  adjustSpeechTimeDuration / totalSpeechTime + activeVideo deprecation note, GetNotesFileList fileSize/needsTransform,
  GetParticipants screenLine/userName, Login userId, UpdateMicrophoneSensitivity seatName, RegisterPlugin descriptions + schemas,
  GetRemainingVoteTime {remainingVoteTime}), voting answers A|B|C|D in 5 ops, canViewSynoptic on GetDiscussionOptions /
  GetSpeechTimerOptions, Register/UnregisterEvents enum → 39. New ops: GetTransformedNotesFilesInfo + ReadNotesFile (`since` 6.7),
  ValidateImageFile (`since` 7.0, assumed). Excluded (DEC-007 rule): GetNamecardStatus (CHM: internal use),
  CanExecutePresentationPlugin, ExecutePluginCommand (empty pages), CheckIfNoNullOrEmptyGuids, ConvertStringsToGuids,
  IsImageContent (C# helpers). New optional `since` field in SPEC-FORMAT.md; exposed by `GET /api/wired/ops`.
- Events: discussionOptionsChanged → discussionOptions, imageServerUriChanged → imageServerInfo (both moved out of
  topicsWithoutEvent), seatMicrophoneSensitivityUpdated → new topic `microphoneSensitivity` (GetMicrophoneSensitivity
  {seatIds: []}). meetingListChanged / participantAccessDenied are no longer "history-only". All five are `optional`;
  `spec.registrableEvents` now = documented list minus optional, so the bridge still registers those one by one.
- `scripts/crosscheck-conference-spec.mjs` now also checks against the CHM method pages (keys + enums; CHM keys missing
  from the spec are errors; ops outside the PDF are checked against the CHM). Mutation test: removing
  GetParticipants.userName → `chm-missing-key userName`. Result: 112 ops, 340 enum values, 0 unexpected.
- Mock: login userId; multi-seat mic on/off; 7.0 discussion entry fields; participants screenLine/userName; notes
  fileSize/needsTransform, GetTransformedNotesFilesInfo, ReadNotesFile (base64); ValidateImageFile (magic numbers);
  GetMicrophoneSensitivity [] = all seats; sensitivity update/reset fire SeatMicrophoneSensitivityUpdated; real 6.50 wording
  for unknown events; admin gets the 3 permissions the real admin has (canControlMicrophoneSensitivity, canControlPresentation,
  hasPrepareMeetingLicense): **found** because the new microphoneSensitivity topic was "unavailable" on the mock only.
- e2e suite: new checks (39-event registration, microphoneSensitivity topic, ValidateImageFile, 6.7 notes ops; ops a server
  doesn't know count as "not supported", not failures); probes every excluded op. **e2e:mock 31/31, 123/123 ops;
  e2e real (6.50) 31/31, 123/123 ops, 0 spec deviations** (data/e2e-wired-real-4.md, not versioned). The real server fired
  DiscussionOptionsChanged and ParticipantAccessDenied during the run (notes updated). Server left powered on (initial state).
- Tests: +2 (mock 7.0 additions, optional-event split); `npm test` 133/133; `npm run ui:check` OK; REFERENCE.md regenerated.
- Remaining `chmdiff.py` output (14) is explained: CHM pages that are empty/skeletal where our spec comes from the real
  server (GetDiscussionOptions, GetInterpreterSeats, GetPluginCommands/EventData, GetSupportedHeadphones), the excluded
  CreatePluginDescription, a parser artefact ("have" read as a permission), and pages the quick Python parser cannot read
  (the JS crosscheck reads them: 0 differences).

## Decisions
- Newer events are `optional` (registered one by one) even though the CHM lists them, so servers older than 6.1/4.2 keep working.
- `ReadNotesFile.FileBytes` typed `any`: CHM shows [byte], .NET usually serialises byte[] as base64; the mock uses base64.
- `ValidateImageFile` `since: "7.0"` is an assumption (absent on 6.50, not in the CHM history).
- Ops that only appear as empty CHM pages are excluded under the DEC-007 rule rather than guessed.

## Handoff
Done. Unverified until a 6.7+/7.0 server is available: GetTransformedNotesFilesInfo, ReadNotesFile (FileBytes encoding),
ValidateImageFile, the new GetDiscussionList fields, GetRemainingVoteTime (needs canViewVoting / full licence),
seatMicrophoneSensitivityUpdated / imageServerUriChanged firing. Follow-up: WO-045 (use the additions in the UI).
