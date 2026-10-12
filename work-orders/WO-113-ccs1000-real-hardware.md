# WO-113: CCS 1000 D on a real CCSD-CU (hardware check)

| | |
|---|---|
| **Status** | draft |
| **Phase** | 4 Hardening |
| **Depends on** | WO-111 |
| **Assignee** | — |
| **Created** | 2026-10-12 |
| **Updated** | 2026-10-12 |

## Goal
WO-111's CCS 1000 D support verified against a real CCSD-CU, with the mock corrected where the device differs.

## Context
WO-111, DEC-032, `docs/protocol/ccs1000-rest/README.md`. Assumed from the WAP (WO-075): login answer (`sid` cookie / body),
long-poll hold time, 409 on a second session, error texts. Firmware image `docs/research/ccs-1000/software/CCSD-CU-upgrade`
(zip with a UBI root file system) may contain the CCSD-CU web UI and its own endpoints (like DEC-024 for the WAP).

## Scope (to refine before `ready`)
- A read-only + a state-changing script like `e2e:wireless` for the 22 operations (restore state afterwards).
- Record observed behaviour in the README; fix mock/client differences.
- Optional: extract the web UI from the firmware image and list undocumented endpoints.

## Work log
- 2026-10-12 (Claude Opus): created as draft (follow-up of WO-111; needs a CCSD-CU from the user).
