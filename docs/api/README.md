# Backend HTTP API

The browser UI (and any other client) talks only to this API. Base path `/api`. JSON in and out.

## Envelope (DEC-004)
```json
{ "ok": true,  "data": … }
{ "ok": false, "error": { "code": "VALIDATION", "message": "…", "details": ["…"], "upstream": "…" } }
```
| HTTP | code | meaning |
|---|---|---|
| 400 | `VALIDATION` | bad input (`details` lists problems) |
| 400 | `NOT_SUPPORTED` | the connected system doesn't support this domain action |
| 401 | `UPSTREAM_AUTH` | DICENTIS rejected the credentials |
| 403 | `MANAGED_BY_BACKEND` | operation reserved for the backend (Login, events) |
| 404 | `NOT_FOUND` | unknown endpoint / operation / topic |
| 500 | `INTERNAL` | backend bug (see server log) |
| 502 | `UPSTREAM_ERROR` | DICENTIS answered with an error (`upstream` = its message) |
| 503 | `NOT_CONNECTED` | no DICENTIS session |
| 504 | `UPSTREAM_TIMEOUT` | DICENTIS didn't answer in time |

## Endpoints
| Endpoint | Doc |
|---|---|
| `GET /api/health` | `{ status: "up", system }` |
| `GET /api/connection` | connection status: `{ system, host, port, user, state, connectedSince, lastError, permissions }`; `state` ∈ disconnected, connecting, connected, loggedIn, reconnecting |
| `GET /api/connection/settings` | `{ system, host, port, user, tlsInsecure, autoConnect, dcnServer, smd*, dcnmBridge, dcnmHost, dcnmPort, dcnmDevice, dcnmServer, passwordSet, bridgeTokenSet, pinned[] }` (never the password or bridge token). `system` ∈ wired, wireless, dcn-smd, dcn |
| `PUT /api/connection/settings` | partial update; fields in `pinned` (set by launcher/.env) are rejected; takes effect on next connect |
| `POST /api/connection/connect` / `disconnect` | (re)connect / close; returns status. Wireless: body `{ "override": true }` takes over a session of the same user (401 `reason: alreadyLoggedIn` otherwise) |
| `GET /api/events`, `GET /api/state[/:topic]` | live state: [live-state.md](live-state.md) |
| `GET/POST /api/wired/ops[/:Operation]` | one endpoint per Conference Protocol operation: [wired-passthrough.md](wired-passthrough.md) |
| `GET /api/wireless/ops`, `<METHOD> /api/wireless/<path>` | wireless passthrough mirroring the swagger paths (WO-015); live data in topics `wireless*` via `/api/events` |
| `GET /api/dcn/ops`, `GET\|POST /api/dcn/ops/:api/:method`, `GET /api/dcn/bridge` | DCN passthrough, one endpoint per DCN-SW API method: [dcn-passthrough.md](dcn-passthrough.md) |
| `GET /api/dcn-smd/state`, `POST /api/dcn-smd/reset` | DCN Streaming Meeting Data (read-only): [dcn-smd.md](dcn-smd.md) |
| `GET /api/dcnm`, `GET /api/dcnm/ops`, `POST /api/dcnm/ops/:api/:method`, `GET\|PUT /api/dcnm/props/…`, `POST /api/dcnm/callbacks/:id`, `DELETE /api/dcnm/handles/:handle` | Full DICENTIS DCNM API through the dicentis-bridge (wired + `dcnmBridge`): [dcnm-passthrough.md](dcnm-passthrough.md) |
| `GET /api/dicentis`, `POST /api/dicentis/<area>/<action>` | DICENTIS audio & Dante, languages over the full API (DEC-029): [dicentis.md](dicentis.md) |
| `/api/domain/...` + `domain.*` topics | system-independent actions and state: [domain.md](domain.md) |

## Settings precedence
Environment (launcher or `.env`) > `data/settings.json` (saved via API) > defaults. The password and the DCN bridge token are never written to disk by the backend.
