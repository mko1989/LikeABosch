# WO-114: Kramer MV-6 and tvONE CORIO on real hardware

| | |
|---|---|
| **Status** | draft |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-112 |
| **Assignee** | — |
| **Created** | 2026-10-12 |
| **Updated** | 2026-10-12 |

## Goal
The WO-112 drivers verified on a real Kramer MV-6 and a tvONE CORIOmaster / CORIOmatrix; mocks corrected.

## Context
WO-112 handoff (points to check first), DEC-033. Like WO-041 for ATEM.

## Scope (to refine before `ready`)
- MV-6: reply to `#SRC-VID` (trailing OK?), unsolicited front-panel messages, layout preset numbers (which preset is "Full").
- CORIO: login with and without security, `!Error` texts, input names on the installed modules, a preview window.
- Optional: tvONE C2-2355A (CORIO2 protocol) if a user has one; RS-232.

## Work log
- 2026-10-12 (Claude Opus): created as draft (needs the hardware).
