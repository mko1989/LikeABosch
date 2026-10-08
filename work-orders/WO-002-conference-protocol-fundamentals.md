# WO-002: Conference Protocol fundamentals + PDF text/index

| | |
|---|---|
| **Status** | done |
| **Phase** | 1 Protocol extraction |
| **Depends on** | WO-001 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-02 |
| **Updated** | 2026-10-02 |

## Goal
Make the PDF usable for agents: greppable text, page index, a condensed fundamentals doc, and a
JSON spec format + validator so the extraction (WO-003/004) can be parallelized.

## Scope
- In: text extraction, page index, transport/message/error/event/auth/permission/speech-timer
  summary, SPEC-FORMAT.md, validator, gold example operation file.
- Out: per-operation extraction (WO-003), types (WO-004).

## Deliverables
- `docs/source/conference-protocol.txt`: pypdf text, `=== PAGE n ===` markers (462 pages)
- `docs/protocol/conference/source-index.json`: 96 operations + 37 type sections with page ranges
- `docs/protocol/conference/README.md`: fundamentals
- `docs/protocol/conference/SPEC-FORMAT.md`
- `scripts/pdf-pages.sh`, `scripts/validate-conference-spec.mjs`
- `docs/protocol/conference/operations/GetDiscussionList.json` (gold example)

## Acceptance criteria
- [x] `scripts/pdf-pages.sh 195` prints the Logout page.
- [x] Validator passes on the gold example.
- [x] Fundamentals doc cites PDF pages.

## Work log
- 2026-10-02 (Claude Opus): No pdftotext on machine; used `pypdf` in a throwaway venv to extract text (to regenerate: `pip install pypdf`, iterate `PdfReader(pdf).pages`, write `=== PAGE n ===` markers). PDF pages 1–29 are licence text (EN/RU) and can be ignored. Section starts were detected from the repeating "Conference Protocol Reference" page header.
- Findings: text layout interleaves columns (JSON blocks interrupted by Remarks), and long strings wrap mid-word. Per-event documentation pages referenced on p.52 are **absent** from this export.

## Decisions
- DEC-003 (spec as JSON).

## Handoff
Done. Fundamentals: `docs/protocol/conference/README.md`. Event → reset mapping is inferred (WO-006).
