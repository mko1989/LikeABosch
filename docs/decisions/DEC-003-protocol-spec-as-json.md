# DEC-003: Protocol spec extracted once into machine-readable JSON

- **Status:** accepted (2026-10-02)
- **WO:** WO-002, WO-003, WO-004

## Context
The wired protocol is only documented in a 462-page PDF with broken text layout. Re-reading it
for every task is slow and error-prone.

## Decision
- Extract the PDF once into `docs/protocol/conference/operations/<Op>.json` and
  `types/<Type>.json` using the format in `docs/protocol/conference/SPEC-FORMAT.md`.
- These JSON files are the **source of truth** for backend route generation, request
  validation, the mock server, and generated reference docs.
- Keep the extracted raw text (`docs/source/conference-protocol.txt`) and page index
  (`source-index.json`) so any JSON entry can be checked against the PDF page.
- Wireless: the vendor Swagger 2.0 YAML embedded in the HTML is extracted verbatim to
  `docs/protocol/wireless-rest/swagger.yaml` and used directly.
- `scripts/validate-conference-spec.mjs` must pass (0 errors) at all times.

## Consequences
- Fixes to the spec are made in JSON with a PDF page citation, never only in code.
- Field types are as precise as the PDF (often only `string`/`int`/`bool`); real-server testing
  may refine them. Log such refinements in the WO and in `extractionNotes`.
