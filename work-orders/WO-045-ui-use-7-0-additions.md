# WO-045: UI: use the DICENTIS 7.0 protocol additions

| | |
|---|---|
| **Status** | draft |
| **Phase** | 3 Web UI |
| **Depends on** | WO-044 |
| **Assignee** | — |
| **Created** | 2026-10-03 |
| **Updated** | 2026-10-03 |

## Goal
WO-044 added the 7.0 fields and operations to the spec, backend passthrough and mock. The UI doesn't use them yet.

## Context
WO-044 (findings, what is verified on 6.50 and what is not), DEC-013, DEC-009 (UI rules), DEC-010 (domain layer).

## Scope (to refine before `ready`)
- Participants: show `userName` / `screenLine` when present (6.3+).
- Notes files: show `fileSize`; download a notes file via `ReadNotesFile` chunks when the server supports it (6.7+;
  hide otherwise: `GET /api/wired/ops` exposes `since`, but a capability probe is needed because the server version
  is not reported: decide how, e.g. try once and remember "unknown operation").
- Microphone sensitivity: the `microphoneSensitivity` topic now holds every seat; show/edit per seat (System or Room).
- Discussion: `totalSpeechTime` / adjust-speech-time fields in the speaker list when present.
- Out: plugin UI (WO-026).

## Acceptance criteria
- [ ] (to define when refined)

## Work log
- 2026-10-03 (Claude Opus): created as follow-up of WO-044.
