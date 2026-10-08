# WO-082: dicentis-bridge on a real DICENTIS system (selftest, connect as device, e2e)

| | |
|---|---|
| **Status** | draft |
| **Phase** | 4 Hardening |
| **Depends on** | WO-078, WO-079, WO-080 |
| **Assignee** | — |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
Run the dicentis-bridge on a Windows PC with the DICENTIS software against a real system: `--selftest` against the
installed DLLs (bitness, references, api.json differences), connect sequence incl. the device seat assignment, the
initial request sweep, events, and an e2e of the passthrough like `e2e:wired`.

## Context
DEC-021, WO-068 (how the dcn-bridge was checked against real DLLs), WO-078 README.

## Open questions
- Which PC (DICENTIS server or a client PC with the software), DICENTIS version (must match the DLLs), licence.

## Work log
- 2026-10-07 (Claude Opus): created as draft.
