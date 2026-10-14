# WO-123: `bosch-dicentis` 2.0.0 upgrade checked inside a real Companion

| | |
|---|---|
| **Status** | draft |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-122 |
| **Assignee** | human + Claude |
| **Created** | 2026-10-14 |
| **Updated** | 2026-10-14 |

## Goal
Evidence that a Companion page built with `bosch-dicentis` 1.1.2 keeps working after installing 2.0.0: the upgrade
script runs, buttons, feedbacks and variable texts work, against the LikeABosch mocks (simulated systems) or hardware.

## Context
WO-122 / DEC-038. The upgrade script and the 1.x key resolution are unit tested, but not run by Companion itself.

## Scope
- In: install 1.1.2 in Companion, make a DICENTIS connection and a REST connection, buttons with every 1.x action and
  feedback and 1.x variables in their texts; export; install 2.0.0 (`bosch-dicentis-2.0.0.tgz` as a developer module);
  check the upgraded config, actions, feedbacks and texts against the simulated systems.
- Out: publishing.

## Acceptance criteria
- [ ] To be refined (draft).

## Work log
- 2026-10-14 (Claude Opus): created as draft from WO-122's handoff.

## Decisions

## Handoff
