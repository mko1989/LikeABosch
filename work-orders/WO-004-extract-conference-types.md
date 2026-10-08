# WO-004: Extract Conference Protocol types and enums to JSON

| | |
|---|---|
| **Status** | done |
| **Phase** | 1 Protocol extraction |
| **Depends on** | WO-002 |
| **Assignee** | Haiku subagents ×2 (core types; wrapper classes), reviewed by Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
All classes/structs/enums from PDF pp.246–462 exist as `docs/protocol/conference/types/<Name>.json`.

## Context
Format: [SPEC-FORMAT.md](../docs/protocol/conference/SPEC-FORMAT.md) ("Type file"). Index:
`source-index.json` → `types`. Class pages list property names + descriptions but **not types**;
real wire shapes come from the operation files. The per-property pages (pp.301–462) only repeat
names, so they were skipped except the class/enum overview pages.

## Scope
- In: 14 core types (Permission, AgendaTopic, Meeting, Participant, SeatInfo, PowerMode, Voting,
  VotingState, FileInfo, NotesFileSearchCriteria, AgendaState, PluginDescription,
  PluginCommandDescription, PluginEventDescription) + 23 `ConferenceApiHandler*` wrapper classes.
- Out: inferring field types from operations (could be a later enrichment step in WO-007).

## Acceptance criteria
- [x] Validator: 0 errors.
- [x] Every enum has all members (spot-check Permission, VotingState against PDF).
- [x] Truncated names resolved or noted.

## Work log
- 2026-10-02 (Claude Opus): Spawned 2 Haiku agents.

- 2026-10-02 (Claude Opus): Both agents returned, validator 0 errors. 14 core types (Permission: 22 members, VotingState: 8, PowerMode: 4, AgendaState: 2) + 23 wrapper classes. 7 wrapper names were truncated in the PDF index; agents restored the full names from page text, and `source-index.json` was updated (`truncatedNameInPdf` keeps the original).

## Handoff
Delivered 37 type files. Class field types are `null` (PDF doesn't state them); the operation JSON has the real wire shapes. Missing descriptions in the PDF are noted per file (Meeting, Participant, SeatInfo, PluginCommand/EventDescription).
