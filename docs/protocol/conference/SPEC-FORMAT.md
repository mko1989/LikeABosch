# Conference Protocol — machine-readable spec format

The DICENTIS Conference Protocol (wired system) is described in a 462-page PDF
(`docs/source/ConferenceProtocol.pdf`). We convert it once into small JSON files that
are the **source of truth** for the backend (route generation, parameter validation),
the mock server, and the generated reference docs. See decision
[DEC-003](../../decisions/DEC-003-protocol-spec-as-json.md).

- One file per operation: `operations/<OperationName>.json`
- One file per type/enum: `types/<TypeName>.json`
- Page index of the PDF: `source-index.json`
- Raw PDF text: `docs/source/conference-protocol.txt` — print pages with
  `scripts/pdf-pages.sh FROM TO`

If the PDF is ambiguous, record that in `extractionNotes`; never invent fields.

## Type notation

Used for every value in `request` / `response` (and `type` in type files).

| Notation | Meaning | PDF form |
|---|---|---|
| `"string"`, `"bool"`, `"int"`, `"long"`, `"double"`, `"object"`, `"any"` | primitive | `<string>`, `<bool>`, `<int>` … |
| `"enum:a\|b\|c"` | string enum, values exactly as written in the PDF. **Compared case-insensitively**: the real server (6.50) returns some enums in PascalCase (`"Local"`, `"Fixed"`) and parses request enums case-insensitively. | `"a"\|"b"\|"c"` |
| `"ref:TypeName"` | a named type documented in `types/` | `<TypeName>` |
| `[ <notation> ]` (JSON array with one element) | array of that element | `[ … ]` |
| `{ "field": <notation>, … }` (JSON object) | nested object | `{ … }` |
| `{}` | empty object (no parameters / no result) | `{ }` |

Keep field names **exactly** as they appear in the JSON blocks of the PDF (camelCase on
the wire, e.g. `seatId`). The PDF wraps long lines mid-word (`"seatsCha` / `nged"`):
join them back. The PDF also interleaves columns, so a JSON block can be interrupted
by `Remarks` / `See Also` text and continue afterwards — reassemble it.

## Operation file

```json
{
  "operation": "GetDiscussionList",
  "summary": "Gets the list of speakers, requests, request responders, important and priority speakers of the active discussion.",
  "category": "discussion",
  "permissions": ["canViewSynoptic"],
  "licenses": [],
  "request": {},
  "response": {
    "discussionList": [
      {
        "activeImage": "bool",
        "microphoneState": "enum:off|on|mute",
        "seatId": "string"
      }
    ],
    "referenceTime": "int"
  },
  "remarks": "Cleaned remarks text from the PDF, or empty string.",
  "seeAlso": ["AddSeatToSpeakers", "ActivateMicrophone"],
  "sourcePages": [114, 115],
  "extractionNotes": ""
}
```

| Field | Rule |
|---|---|
| `operation` | Exact operation name (PascalCase) as in the page title. Operation names are case-insensitive on the wire. |
| `summary` | First description sentence(s) under the title. |
| `category` | One of: `auth`, `system`, `events`, `permissions`, `meeting`, `agenda`, `discussion`, `seats`, `participants`, `voting`, `interpretation`, `presentation`, `volume`, `power`, `illumination`, `files`, `images`, `notes`, `plugins`, `room`, `license`, `token`. |
| `excluded` | *Optional.* If present (a string giving the reason), the operation is out of scope: no backend route, no mock behaviour, no UI. See DEC-007. |
| `permissions` | Permission names from "Requires:" in Remarks (e.g. `canManageMeeting`). `[]` if none listed. |
| `licenses` | DICENTIS licences named in "Requires:" (e.g. `DCNM-LMPM`, `DCNM-LIPM`, `DCNM-LVPM`, `DCNM-LSVT`, `DCNM-LPD`). Never put them in `permissions`. `[]` if none. *(added in WO-007 normalization)* |
| `request` / `response` | The `parameters` object of the request/response message, in type notation. |
| `remarks` | Remarks text with line breaks joined into normal sentences. Omit the "Requires:" list (it is in `permissions`). |
| `seeAlso` | Operation names from "See Also" (exclude "Reference", "Permission", and type names). |
| `sourcePages` | `[from, to]` pages from `source-index.json`; `null` for operations not in the PDF. |
| `since` | *Optional.* DICENTIS version that introduced the operation, when newer than the dev server (6.50), e.g. `"6.7"`. Such operations are in the API but unverified; a 6.50 server answers "unknown operation" (WO-044). |
| `source` | *Only for operations not in the PDF* (e.g. DICENTIS 6.50 additions, WO-031): where the shape comes from (real server, vendor client). |
| `extractionNotes` | Anything uncertain: truncated JSON, guessed types, contradictions. Empty string if clean. |

## Type file

```json
{
  "name": "PowerMode",
  "kind": "enum",
  "summary": "The power modes",
  "wrapper": false,
  "fields": [],
  "members": [
    { "name": "poweredOn", "value": 0, "description": "The power is on." }
  ],
  "sourcePages": [274, 275],
  "extractionNotes": ""
}
```

| Field | Rule |
|---|---|
| `name` | Full type name. Some names in `source-index.json` are truncated by the PDF layout (`…Respons`) — use the full name if the page text reveals it, else keep the index name and note it. |
| `kind` | `class`, `struct` or `enum`. |
| `wrapper` | `true` for `ConferenceApiHandler*` request/response wrapper classes. |
| `fields` | Classes/structs: `[{ "name": "SeatId", "type": "string" \| null, "description": "…" }]`. The PDF class pages give property names (PascalCase, C# side) and descriptions but usually **no types** — set `type` only when the PDF states it, else `null`. Wire names are camelCase (see operation responses). |
| `members` | Enums: `[{ "name", "value", "description" }]`. `value` is the integer if listed, else `null`. |
