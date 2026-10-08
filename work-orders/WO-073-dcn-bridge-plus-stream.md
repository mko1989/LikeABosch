# WO-073: DCN: meeting data stream alongside the bridge (DEC-020)

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-060, WO-066, WO-067, WO-069 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
With `system: "dcn"` the backend also reads the DCN-SW Streaming Meeting Data, so live data the bridge lacks
(interpreter desks, WO-074) is available while the bridge controls the system.

## Context
DEC-020, DEC-017, DEC-018. `backend/src/connection/manager.js` (one `client`), `backend/src/dcn-smd/{client,sync}.js`,
`backend/src/config.js`, launcher `lib/settings-store.js` + renderer, `web/js/views/connection.js`.

## Scope
- In: settings `smdStream` / `smdHost` / `smdPort` (+ env, pinning, persistence); manager opens/closes the second
  client with the main one; `status().stream`; domain `run()` keeps refusing only for the `dcn-smd` system; web
  Connection view + launcher fields and stream status; docs (architecture, BRIDGE/bridge README note); tests with the
  DCN mock bridge + SMD mock together.
- Out: using the stream data in views (WO-074).

## Acceptance criteria
- [x] Backend test: dcn + stream → both connect, `smd*` and `dcn*` topics filled, `status.stream.state = loggedIn`;
  stream down → bridge stays loggedIn; disconnect closes both (`backend/test/dcn-stream.test.js` 3/3).
- [x] Launcher test for the new env vars; `npm test` 204/204; ui:check dcn connection OK, screenshot looked at
  (status row "Meeting data stream 127.0.0.1:<port> · Connected", checkbox + host/port fields).

## Work log
- 2026-10-05 (Claude Opus): created (ready) after the user chose "Bridge + stream together".
- 2026-10-05 (Claude Opus): in-progress → done. `config.js` (`smdStream` default true, `smdHost` '', `smdPort` 20000,
  env `DICENTIS_SMD_*`), manager (`streamClient`, `#openStream` after the bridge connected, closed in `disconnect()`,
  `status().stream`), launcher store/env (only for dcn; `DICENTIS_SMD_STREAM` always, host/port when set) + form,
  web Connection view (fields + status row + hint when it can't connect), ui-check DCN pass starts an SMD mock with a
  live desk. Docs: architecture, DEC-020. Tests: new `dcn-stream.test.js`, launcher test extended.
  Found on the way: my WO-069 change to `ui-check.mjs` argument parsing still makes the first positional the outDir,
  as documented (`[outDir] [route…]`); `--system dcn connection` wrote to `./connection/`. Removed the stray folders
  (`./connection`, `./room` from WO-071's run, which therefore checked all wired routes, still OK). Correct form:
  `npm run ui:check -- data/ui-check <route> --system <s>`.

## Decisions
- See DEC-020.

## Handoff
Done. On site: the stream needs the DCN-SW server to allow the LikeABosch machine (AllowedClients) and DCN-SWSMD in
the CCU licence; otherwise Settings → Connection shows the stream as reconnecting with the reason.
