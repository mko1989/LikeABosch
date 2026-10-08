# WO-050: Windows sidecar for the DCNM .NET API (meeting preparation, DICENTIS audio/Dante)

| | |
|---|---|
| **Status** | cancelled |
| **Phase** | 6 Windows API |
| **Depends on** | — |
| **Assignee** | — |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-07 |

## Goal
Deferred by the user (2026-10-03, DEC-014). Write access the Conference Protocol lacks: assign participants to seats,
register/edit participants, create/edit agenda topics, DICENTIS audio settings (seat Dante out, interpretation language
channels to Dante, room audio gains/EQ/routing, VU meters).

## Context
DEC-013 §3, DEC-014. `docs/source/chm/DcnmApiDocumentation` (interfaces IPrepareParticipant2, IPrepareAgendaTopic,
IPrepareMeeting, IRoomAudioControl, ISystemAudioControl, IPrepareSystemChannels, IConfigInterpretation, IEquipment).

## Open questions (to refine before `ready`)
- Windows host: the DICENTIS server PC or a separate PC with DICENTIS software? Where does `Bosch.Dcnm.Interfaces.Api.dll`
  come from, and which licence/user rights does the API connection need?
- Transport sidecar ↔ backend (HTTP + SSE/WebSocket), auth, packaging (Windows service).
- Which operations first (seat assignment is the user's first wish).

## Work log
- 2026-10-03 (Claude Opus): created as draft; deferred by the user.
- 2026-10-07 (Claude Opus): cancelled, replaced: the user asked for the DICENTIS bridge (DEC-021). Work continues in
  WO-077 (reference), WO-078 (bridge), WO-079 (Node adapter), WO-080 (launcher), WO-081 (features), WO-082 (real system).
