# WO-070: dcn-bridge token optional (DEC-019)

| | |
|---|---|
| **Status** | done |
| **Phase** | 6 Windows API |
| **Depends on** | WO-061, WO-063, WO-069 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
The bridge and LikeABosch work without a token (user decision, DEC-019): `dcn-bridge.exe` starts with no arguments,
LikeABosch connects to DCN with an empty bridge token.

## Context
DEC-017, DEC-019, WO-069 (user's first run: "a token is required"). Token handling: `bridge/dcn/src/{Program,Server}.cs`,
`backend/src/connection/manager.js` (connect refuses DCN without token), `mock/dcn/server.js`, launcher + web
Connection form, `BRIDGE.md`, bridge README, `mock/dcn/README.md`.

## Scope
- In: bridge without token accepts every hello (start-up warning); token still checked when set; backend no longer
  requires `bridgeToken`; mock default without token; UI labels "optional"; docs; tests (conformance: no-token mode).
- Out: other hardening (WO-029).

## Acceptance criteria
- [x] `dotnet build bridge/dcn -c Release` 0 warnings / 0 errors; `npm run bridge:test` 8/8 incl. a no-token bridge (starts, WARN line, client without token logs in).
- [x] Backend connects to the mock bridge without a token (`backend with system dcn` now runs tokenless; new client test); token still enforced when set (mock + conformance `BAD_TOKEN` tests).
- [x] `npm test` 201/201; `e2e:mock` 31/31; `npm run ui:check -- --system dcn` UI CHECK OK; `dcn-connection-light.png` looked at (connected without token, field "Bridge token (optional)").

## Work log
- 2026-10-05 (Claude Opus): created after the user's decision (DEC-019).
- 2026-10-05 (Claude Opus): bridge: no token → `""`, `Server` skips the check when empty, start-up `WARN no token: …`;
  help text. Backend: removed the "Bridge token is not configured" connect check. Mock: default token `''`, check only
  when set. Launcher/web: label "Bridge token (optional)", placeholder "only if dcn-bridge runs with --token". Docs:
  BRIDGE.md, bridge README (run steps, options table, firewall note), mock README, example config `"token": ""`,
  DEC-017 status line, DEC-019 + index. Tests: client tests use a mock with token (keeps the wrong-token test) + a
  tokenless client test; backend dcn suite runs tokenless; conformance `startBridge()` helper + no-token test.
  Trivial tooling fix found on the way: `scripts/ui-check.mjs` took `--system` as outDir when it came first
  (`npm run ui:check -- --system dcn` wrote to `./--system/`, removed); options are now parsed anywhere.

## Decisions
- See DEC-019.

## Handoff
Done. `dcn-bridge.exe` runs with no arguments (DLL folder auto-detected, WO-069; no token). Rebuild + copy
`bin/Release/net48` needed on the Windows PC. Real-system check remains WO-065.
