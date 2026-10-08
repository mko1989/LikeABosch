# WO-006: Event catalog and event → refresh-operation map

| | |
|---|---|
| **Status** | done |
| **Phase** | 1 Protocol extraction |
| **Depends on** | WO-003 |
| **Assignee** | Claude Opus or Haiku (mechanical part) + review |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
A single machine-readable table that tells the backend, for each of the 34 wired events, which
Get operation(s) to call to fetch the new data (and thereby re-arm the event), and which state
topic the result updates.

## Context
- `docs/protocol/conference/README.md` → Events. Event names are in `operations/RegisterEvents.json`.
- The PDF says per-event docs name the resetting operation, but those pages are missing, so the
  mapping is **inferred** from names (e.g. `seatsChanged` → `GetSeats`) and operation remarks.
  Also check the version history pp.32–43 for renamed events.

## Scope
- In: `docs/protocol/conference/events.json`:
  `[{ "event": "seatsChanged", "refresh": ["GetSeats"], "topic": "seats", "confidence": "inferred|documented", "notes": "" }]`;
  validator extension (each event in RegisterEvents is mapped; each refresh op exists);
  a human-readable section in the conference README.
- Out: implementing the refresh logic (WO-012).

## Acceptance criteria
- [x] All 34 events mapped; validator passes.
- [x] Events with no obvious Get op (e.g. `apiStateChanged`, `fileChanged`, `pluginEventAvailable`, `pluginCommandAvailable`) have an explicit decision + notes.
- [x] Items marked `inferred` are listed in a real-server verification checklist in WO-028.

## Work log
- 2026-10-02 (Claude Opus): Wrote `docs/protocol/conference/events.json`: 34 RegisterEvents events + 2 history-only optional events (`meetingListChanged`, `participantAccessDenied`, from the 4.2 history p.34), plus `topicsWithoutEvent` (images, imageServerInfo). Every Get op can be called with `{}` (optional meetingId etc.), so refreshes need no context. Validator extended: every registered event mapped, refresh ops exist and aren't excluded, topics unique, alsoRefreshTopics resolve. Event table added to the conference README.

## Decisions
- `apiStateChanged` → `action: "resync"` (full refresh + explicit re-arm via RegisterEvents), since no Get op matches.
- `votingResultChanged` refreshes both GetVotingResults and GetSeatVotingResults (unclear which re-arms).
- `meetingInfoChanged` also refreshes meetings/agendaTopics/participants/votings (`alsoRefreshTopics`).
- History-only events are registered in a **separate** RegisterEvents call so an unknown-event error can't break the main registration.
- `participantAccessDenied` is a notification: forward to the UI as a transient SSE message, not cached state.
- Event-name casing: camelCase as in the RegisterEvents enum (history uses PascalCase; to be verified).

## Handoff
Done. Verification items were added to WO-028. Backend implementation: WO-012; mock: WO-010.
