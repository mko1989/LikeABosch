# WO-005: Wireless REST API reference

| | |
|---|---|
| **Status** | done |
| **Phase** | 1 Protocol extraction |
| **Depends on** | WO-001 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
The wireless (WAP) REST API is available as an exact machine-readable spec plus a short overview with open questions.

## Deliverables
- `docs/protocol/wireless-rest/swagger.yaml`: verbatim from `<script id="embedded-swagger">` in the vendor HTML (Swagger 2.0, v1.7, 20 paths / 32 operations, 13 definitions). Parses with a YAML parser.
- `docs/protocol/wireless-rest/README.md`: basics, endpoint table, wired↔wireless mapping, open questions.

## Acceptance criteria
- [x] YAML parses; 20 paths, 13 definitions.
- [x] README lists all 32 operations.

## Work log
- 2026-10-02 (Claude Opus): Found the full spec embedded in the HTML export, so no scraping was needed. Noted cookie-vs-header `sid` ambiguity and undocumented `isPolling` long-poll semantics as open questions (to verify in WO-014 against the real WAP).

## Handoff
Done. Open questions are listed in the README and must be answered during WO-014.
