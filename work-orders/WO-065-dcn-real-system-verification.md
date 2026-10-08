# WO-065: DCN on a real system: bridge install, verification, spec corrections

| | |
|---|---|
| **Status** | draft |
| **Phase** | 4 Hardening |
| **Depends on** | WO-061, WO-062, WO-066, WO-068 |
| **Assignee** | human + Claude |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
Run dcn-bridge on the DCN-SW PC of a real DCN NG system, verify the adapter end to end, and correct the spec, mock and
bridge from observed behaviour (observed behaviour outranks the CHM, as in DEC-013 §2).

## Open questions (to refine before `ready`)
- Answered offline from the user's DLLs (WO-068): DCN-SW 4.70.6, API DLLs x86-only, the types and constants.
  Run the bridge **on the DCN-SW PC** with `--dll-dir` = the DCN-SW folder (needs `Bosch.Dcn.Ecpc.Client.Logic.dll.config`).
- Is the DCN-SW API licence (and DCN-SWDB for participant-id calls) installed? Which DCN-SW user may we use?
- To observe: do MicOn/MicOff and list events arrive (callbacks)? Is `ConfigId` of voting events the voting id, and
  `AnswerId` the 1-based position in the answer set? What does `CancelSpeaking` do compared to `StopSpeaking`?
- Does `Initialize` return after login (vendor example) or block until `Terminate` (remark)?
- **Streaming Meeting Data (DEC-018, now the main DCN path):** is DCN-SWSMD in the CCU licence? Is an `AllowedClients`
  list set in `Server.exe.config`? Real encoding (UTF-16LE/UTF-8), `TimeStamp` spelling, element names of the
  discussion lists and voting answers (`smdLog` + `GET /api/dcn-smd/state` show what arrived; `parseErrors` in
  `smdStream`). Does the server send anything on connect besides the queue?

## Work log
- 2026-10-05 (Claude Opus): created as draft.
