# DEC-007: Exclude undocumented, unneeded wired operations

- **Status:** accepted (decided by user, 2026-10-02)
- **WO:** WO-007

## Context
The vendor PDF gives no usable request/response for four operations (see WO-003 handoff), and
they serve no purpose in a client app:
`CheckforLicense` (permissions already come from `GetPermissions`), `GenerateJwtToken` and
`ValidateJwtToken` (we log in with user/password), and `CreatePluginDescription` (plugin authoring).

## Decision
Mark them in the spec with `"excluded": "<reason>"` (field documented in SPEC-FORMAT.md). Excluded
operations get no passthrough route, no mock behaviour, and no UI, and they are not counted as spec gaps.

## Consequences
- 92 operations are in scope. Route generation and tests must filter on `!op.excluded`.
- To re-include one later: document its shape (e.g. from the real server) and remove the field, via a new DEC.
