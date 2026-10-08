# DEC-017: DCN (Next Generation) support through the DCN-SW API and a Windows bridge

- **Status:** accepted (scope "network now, RS-232 later" decided by user 2026-10-05; architecture proposed by Claude, revisable); primary DCN path superseded by DEC-018 (bridge = optional control mode); token requirement superseded by DEC-019 (token optional)
- **WO:** WO-059 (reference), WO-060 (Node adapter + mock), WO-061 (Windows bridge), WO-062 (domain), WO-063 (UI)
- **Extends:** DEC-001 (a third system), DEC-010 (domain layer). **Relates to:** DEC-013 §3, DEC-014 (Windows sidecar)

## Context
The user asked for support of the Bosch **DCN** conference system (DCN Next Generation), "network for now, RS maybe later",
and supplied `DCN-SWAPI.chm` (now `docs/source/DCN-SWAPI.chm`). It documents the **DCN-SW API 4.70.0006** (2018):
- A **.NET Framework class library** (`Bosch.Dcn.Ecpc.Client.Api.Interfaces.dll` + `…Logic.dll`, obfuscated), entry point
  the static class `DcnApi` with two roots, `ControlApi` (operation: discussion, meeting/session, voting, master
  volume/mute) and `ConfigApi` (preparation: delegates, meetings, sessions, voting scripts, languages, channels).
- It connects to the **DCN-SW server** (the Windows "DCN Conference Software" that drives the DCN NG master CCU) with
  `Initialize("tcp://<host>:9461", user, password)`. That is .NET Remoting: the wire format is internal to the
  obfuscated DLLs and not documented anywhere we have.
- 11 sub-interfaces, 104 methods (all return `API_ERROR`, results in `out` parameters), 62 events (.NET events with
  typed EventArgs). Operational use needs the DCN-SW API licence (`IsControlAllowed`); some calls by participant id need
  the DCN-SWDB licence.

Node.js therefore cannot talk to DCN directly. The same constraint made us defer the DCNM .NET API (DEC-013 §3, DEC-014),
but there it was an optional extra. For DCN it is the only documented network interface.

## Decision
1. **System id `dcn`** = DCN NG through the DCN-SW API over the network. A future RS-232 interface (the CCU's serial
   "open interface", needs its own documentation) gets a **separate system id and adapter** (draft WO-064); it does not
   share code with the bridge.
2. **A small Windows bridge ("dcn-bridge")** runs next to the DCN-SW server (normally the same PC, so the API connects
   to `tcp://localhost:9461`). It is a .NET Framework 4.8 console app (`bridge/dcn/`, C#). It loads the Bosch DLLs **at
   run time** from a configured folder (the DCN-SW installation) and dispatches by **reflection**, so:
   - it compiles without the Bosch DLLs (we don't ship them; the user's DCN-SW installation provides them), and
   - it is **generic**: every method/event in `docs/protocol/dcn-swapi/api.json` works without per-method code.
   No dependencies besides the .NET Framework (JSON via `System.Web.Script.Serialization`).
3. **Bridge protocol:** newline-delimited JSON over TCP (default port **9480**), one client at a time, described in
   `docs/protocol/dcn-swapi/BRIDGE.md`. Messages: `hello` (shared **token**, required), `connect`
   (connection string, user, password, which roots), `call` (`api` e.g. `control.DiscussionApi`, `method`, `args` by
   parameter name) → `{ returns: "<API_ERROR name>", out: { … } }`, `disconnect`, `ping`. Pushed: `status` (per root:
   initialized / available / every `Is*Allowed` property) and `event` (`api`, `event`, `args` serialised by
   reflection). Values: enums by name, structs as objects of their public instance fields/properties, arrays as arrays.
   The bridge does not interpret API semantics; the Node adapter does.
4. **Node adapter `backend/src/dcn/`**, same shape as wired/wireless: `client.js` (bridge connection, request ids,
   timeouts, reconnect, same `state` model), `spec.js` (loads api/types JSON, validates call args), `routes.js`
   (passthrough `POST /api/dcn/ops/<root.Api>/<Method>`, `GET` for methods without `in` parameters), `events.js`
   (event → refetch → cache topics `dcn*`, plus last-event topics for data only available in events such as vote
   results). `API_ERROR != NONE` → 502 `UPSTREAM_ERROR` with `upstream.apiError`; `NO_AUTHORIZATION` → 403 `UPSTREAM_AUTH`.
5. **Settings:** `system: "dcn"`, `host`/`port` = the **bridge**, `user`/`password` = the DCN-SW user, new
   `dcnServer` (connection string the bridge uses, default `tcp://localhost:9461`) and secret `bridgeToken`
   (`DICENTIS_BRIDGE_TOKEN`; like the password it is never written to disk).
6. **Mock:** `mock/dcn/` speaks the bridge protocol and emulates DCN-SW semantics (meeting/session, speakers/requests,
   mic status, voting, master volume) for tests and UI work on macOS/Linux.
7. **Domain layer:** DCN maps onto the existing `domain.*` topics and actions (WO-062) with its own feature flags.
   Seat ids are DCN integer seat ids as strings. DCN has no "all seats" call: seats come from the seat assignment of the
   active meeting plus every seat seen in mic status and discussion lists.

## Consequences
- Running against a real DCN needs a Windows PC with DCN-SW (and its API licence) to host the bridge. LikeABosch itself
  still runs anywhere.
- The bridge cannot be tested here (no Bosch DLLs, no DCN-SW). It is written against the documented signatures and
  verified on a real system later (draft WO-065). The mock follows the documented semantics, not observed behaviour.
- The bridge port is plain TCP with a token, no TLS (DCN-SW's own Remoting link is not encrypted either). Bind it to the
  control network. WO-029 (security) covers hardening.
- The Windows sidecar deferred in DEC-014 (DCNM) can later reuse the bridge's process model and protocol, but stays
  a separate decision.

## Alternatives considered
- **Reimplement .NET Remoting (MS-NRTP/MS-NRBF) in Node:** the framing is public, but the remote object URIs and
  message types are inside the obfuscated DLLs. That would need reverse engineering and packet captures, and breaks
  with any DCN-SW update. Rejected.
- **Hand-written bridge with one endpoint per method:** about 104 handlers to maintain. Rejected in favour of
  reflection driven by the extracted spec.
- **HTTP + SSE bridge:** works too, but NDJSON over TCP needs no HTTP stack in .NET Framework (HttpListener needs URL
  ACLs/admin on Windows) and maps 1:1 onto request/response/event.
- **.NET 8 bridge:** .NET Core/5+ has no .NET Remoting client, so it cannot host the Bosch DLLs. Rejected.
