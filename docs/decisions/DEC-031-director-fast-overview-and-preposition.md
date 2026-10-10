# DEC-031: Director timing: immediate overview, pre-positioning, capped travel wait

- **Status:** accepted (problem reported by user 2026-10-10 in next.md; semantics proposed by Claude)
- **WO:** WO-108
- **Extends:** DEC-012 §4 (timing rules); DEC-015 unchanged

## Context
Operators found preset recalls slow and the way back to the overview slow. The director did everything in sequence:
wait `delayMs` (misclick filter) → recall → wait for the camera's completion reply (VISCA: up to 10 s when a camera only
ACKs) → wait `settleMs` → cut. The overview also waited `delayMs` and the remaining minimum shot time. A mic that went
off again within `delayMs` while the previous speaker was on air still got its shot (the pending timer was not cancelled).

## Decision
1. **Nobody speaking → overview at once:** no `delayMs`, no `minShotMs`. (A seat without a shot still waits `delayMs`
   like any speaker, so a misclick there does not flash the overview.)
2. **`minShotMs` holds speaker shots only**, not the overview: a new speaker right after the overview is not held back.
3. **Pre-positioning:** when a new speaker's shot is on a camera that is not on program (and not the current target),
   the director recalls the preset immediately; only the **cut** waits for `delayMs`. A misclick then only moves an
   off-air camera.
4. **Arrival wait = camera's completion reply or `settleMs` after sending the recall, whichever comes first** (safe
   strategy, before cutting to a camera that was just moved, incl. a pre-positioned one). `settleMs` is therefore the
   longest wait ("camera travel time"). The live strategy does not wait at all (recall, then cut).
5. A newer discussion state always cancels a pending shot (fixes the misclick case above).
6. Default `delayMs` 500 → **250 ms** for new rooms/projects. Saved projects keep their value (it may have been set by
   the operator; the store cannot tell).

## Consequences
- Typical safe change to an off-air camera: max(`delayMs`, travel) instead of `delayMs` + travel.
- Cameras that really report arrival later than `settleMs` are cut to while still moving; raise `settleMs` for them.
- A speaker → overview → speaker sequence (mic handed over with a gap) shows the overview briefly; that is intended.

## Alternatives considered
- Only lowering the `delayMs` default (the user's first guess): helps little; travel time dominates.
- Learning per VISCA camera whether it sends completions: needs hardware data (WO-041); the `settleMs` cap covers it.
