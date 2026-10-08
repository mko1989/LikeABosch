# WO-023: Interpretation

| | |
|---|---|
| **Status** | done |
| **Phase** | 3 Web UI |
| **Depends on** | WO-018 |
| **Assignee** | Claude Opus (main) + Haiku (mock data) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Languages, booths, interpreter seats, routings, booth notifications, meta-functions (speak slowly etc.), grant interpretation; only with canViewInterpretation / canControlInterpretation.

## Scope (draft: refine into concrete tasks + acceptance criteria before starting)
- Read DEC-002 (plain HTML/JS, no framework) and the UI conventions decided in WO-018.
- Use only `web/js/api.js` + the SSE store for data; never call DICENTIS directly.
- Hide or disable controls the current permissions don't allow (`GET /api/connection` → permissions).
- Test manually against the mock and note the steps in the work log; real-server check goes into WO-028.

## Acceptance criteria
- [x] Booths/desks/routings/languages shown; controls gated by permission.
- [x] ui:check scenario passes; screenshots reviewed.

## Work log
- 2026-10-02 (Haiku subagent): wrote `mock/wired/behaviours/interpretation.js` (4 languages, 2 booths × 2 desks, routings, notifications, meta-functions; all 14 operations; actions fire the matching events). Reviewed by Claude Opus (Get operations don't fire events; inputs validated) and covered by the new mock conformance test (`mock/wired/server.test.js`: every read operation's response validates against the spec).
- 2026-10-02 (Claude Opus): Implemented `web/js/views/interpretation.js`: language chips, booth cards with booth notifications (Phone call / Alarm), desk cards (type, status, A/B/C languages with B/C output-preset selects, routing source → destination + quality + auto-relay, mic segmented control Off/A/B/C, Floor/Relay input, Speak slowly issue/cancel). ui:check scenario (mic on A, speak slowly, phone call, cancel, mic off) passes light/dark; screenshot reviewed.

## Decisions
- View requires `canViewInterpretation`; all controls `canControlInterpretation` (spec); disconnected desks are read-only.
- Meta request value `speakSlow` (from the PDF example, p.125) and booth notification values `PhoneCall`/`Alarm` (from RaiseBoothNotification remarks) are assumptions → WO-028.
- `SelectInterpretationInputLanguage` (input presets A–G) is not exposed in the UI yet (specialist function); it is available via the passthrough.

## Handoff
Done against the mock. Real-server checks (WO-028): meta request and notification values, how `floor`/`relay` show up in routings, licence-less behaviour (DCNM-LIPM).
