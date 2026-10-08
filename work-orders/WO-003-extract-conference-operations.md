# WO-003: Extract Conference Protocol operations to JSON

| | |
|---|---|
| **Status** | done |
| **Phase** | 1 Protocol extraction |
| **Depends on** | WO-002 |
| **Assignee** | Haiku subagents ×8 (batches B1–B8), reviewed by Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Every one of the 96 operations of the wired DICENTIS Conference Protocol exists as a
validated JSON file in `docs/protocol/conference/operations/`. These files are the source
of truth for backend routes, validation and the mock server.

## Context
- Format: [SPEC-FORMAT.md](../docs/protocol/conference/SPEC-FORMAT.md)
- Gold example (hand-written): [GetDiscussionList.json](../docs/protocol/conference/operations/GetDiscussionList.json)
- Page index: [source-index.json](../docs/protocol/conference/source-index.json)
- Print PDF pages: `scripts/pdf-pages.sh FROM TO`
- Decision: [DEC-003](../docs/decisions/DEC-003-protocol-spec-as-json.md)

## Scope
- In: one JSON per operation listed in `source-index.json`, request/response in type
  notation, permissions, remarks, seeAlso, notes on ambiguities.
- Out: data-type/enum files (WO-004); event→reset mapping (WO-006); human-readable
  reference doc generation (WO-007).

Batches (operation, PDF pages):
- B1: AbortVoting 71-72, AcceptVoting 73-74, ActivateAdHocVoting 75-76, ActivateMeeting 77, ActivateMicrophone 78-79, ActivatePresentation 80, ActivateVoting 81-82, AddSeatToSpeakers 83-84, CancelInterpreterMetaFunction 85, CheckforLicense 86, CheckNotesFileTampered 87-88, CloseAgenda 89
- B2: CloseMeeting 90, CloseVoting 91-92, CreateFile 93-94, CreatePluginDescription 95-96, DeactivateMeeting 97, DeactivateMicrophone 98-99, DeactivatePresentation 100, DeleteFile 101-102, DeleteImage 103-104, DeleteNotesFiles 105-106, EnableSeatIllumination 107-108, GenerateJwtToken 109
- B3: GetAgendaTopics 110-111, GetBoothNotifications 112-113, GetEnableSeatIllumination 116-117, GetIlluminatedSeat 118, GetImageServerInfo 119-120, GetIndividualVotingResults 121-122, GetInterpretationLanguages 123-124, GetInterpretationMetaFunctionStatus 125, GetInterpretationRoutings 126-127, GetInterpreterBooths 128-129, GetInterpreterSeats 130-131, GetMajorityResult 132-133
- B4: GetMasterVolume 134-135, GetMasterVolumeRange 136-137, GetMeetingInfo 138-140, GetMeetings 141-143, GetNotesFileList 144-145, GetParticipantAccessDeniedReasons 146, GetParticipants 147-148, GetParticipantSeats 149-150, GetPermissions 151-152, GetPlugin 153-154, GetPluginCommands 155, GetPluginEventData 156-157
- B5: GetPlugins 158-159, GetPresentationState 160, GetQuorumResult 161-162, GetRoomContactEmail 163, GetRoomName 164, GetSeats 165-168, GetSeatVotingResults 169-170, GetSystemPowerMode 171-172, GetVotingInfo 173-175, GetVotingResults 176-177, GetVotings 178-180, GetVotingState 181-182
- B6: GrantInterpretation 183-184, HoldVoting 185-186, IssueInterpreterMetaFunction 187, ListFiles 188-189, ListImages 190-191, LoadFile 192-193, Login 194, Logout 195, OpenAgenda 196, OpenMeeting 197, OpenVoting 198-199, RaiseBoothNotification 200-201
- B7: RegisterEvents 202-203, RegisterPlugin 204-205, RejectVoting 206-207, RemoveSeatFromDiscussionList 208, ResumeVoting 209-210, SaveImage 211-212, SelectInterpretationFloor 213-214, SelectInterpretationInputLanguage 215-216, SelectRelayInterpretation 217-218, SendPluginCommand 219-220, SendPluginEvent 221-222, SetIlluminateSeat 223-224
- B8: SetInterpretationOutputPreset 225-226, SetMasterVolume 227-228, SetPluginCommandResult 229-230, SetSystemPowerMode 231-232, SubscribePluginEvent 233-234, TransformNotesFile 235-236, UnregisterEvents 237-238, UnRegisterPlugin 239-240, UnSubscribePluginEvent 241-242, UpdateFile 243-244, ValidateJwtToken 245

## Deliverables
- `docs/protocol/conference/operations/<Operation>.json` × 96

## Acceptance criteria
- [x] `node scripts/validate-conference-spec.mjs` reports 0 errors for operations.
- [x] All 96 operations from `source-index.json` have a file.
- [x] Main agent spot-checked at least 10 files against the PDF (incl. the longest: GetSeats, GetMeetingInfo, GetMeetings, GetVotings, GetVotingInfo).
- [x] Every `extractionNotes` entry reviewed; real ambiguities copied to "Open questions" in the Handoff.

## Work log
- 2026-10-02 (Claude Opus): Gold example GetDiscussionList.json written by hand and validated. Spawned 8 Haiku subagents, one per batch.

- 2026-10-02 (Claude Opus): All 8 batches returned; validator 0 errors. Review findings:
  - Cross-batch inconsistency: licences (DCNM-LMPM/LIPM/LVPM/LSVT/LPD) were put in `permissions` by some agents and in notes by others. Normalized into a new `licenses` field for all 96 ops, detected directly from the PDF text (part of WO-007).
  - GetPluginCommands: the Haiku agent had *invented* a response shape. Replaced with what the wrapper class pages say (`pluginCommands`, element type unknown) and noted it.
  - CheckforLicense, GenerateJwtToken, ValidateJwtToken: the vendor pages are genuinely empty (verified p.86, 109, 245). CreatePluginDescription has request but no response (p.95). Notes rewritten to say so.
  - Mechanical cross-check (script, all 96 ops): every `"field":` key in the PDF pages matches the JSON keys (only diff: the deliberate GetPluginCommands fix). All 324 enum values appear verbatim in the PDF once whitespace is removed (3 apparent misses were page-footer/"Copy" splits, verified by hand).
  - Manually compared GetSeats (longest, interleaved columns) against pp.165–168: correct. Added note that `devices[].typeOf` enum is probably incomplete.

## Decisions
- Request fields are all treated as optional (PDF p.49: server fills defaults for missing fields; unknown fields cause an error).

## Handoff
Delivered 96 operation files, validator clean (0 errors). Warnings are documented notes only.

**Known spec gaps (vendor PDF incomplete, must be discovered on the real server; see WO-016/WO-028):**
- `CheckforLicense`: request field name and response unknown (takes a permission name).
- `GenerateJwtToken`, `ValidateJwtToken`: no request/response documented at all.
- `CreatePluginDescription`: response not documented.
- `GetPluginCommands`: element type of `pluginCommands` unknown.
- `GetPluginEventData`: refers to `ref:dcnmPluginEvent` with no type definition.
- `GetSeats` `devices[].typeOf`: enum likely incomplete, so validate as an open string.
- `canViewSynoptic`, `canPrepareMeetingAndAgenda`, `canViewMeetingNotes`, `canViewVotingNotes` etc. appear in remarks; check against `types/Permission.json` in WO-007.

Method used for the review (re-runnable): see the WO-003 work log; scripts were ad-hoc. WO-007 should turn the key/enum cross-check into `scripts/crosscheck-conference-spec.mjs`.
