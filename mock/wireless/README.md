# Wireless mock (DICENTIS Wireless WAP, REST API v1.7)

```
npm run mock:wireless          # http://127.0.0.1:8080/api, user admin / password admin
MOCK_PORT=8090 npm run mock:wireless
```
Point the backend at it with `DICENTIS_SYSTEM=wireless`, `DICENTIS_HOST=127.0.0.1`, `DICENTIS_PORT=8080`.

Implements all 32 operations of `docs/protocol/wireless-rest/swagger.json` with the semantics of a real DCNM-WAP,
firmware 1.73 (WO-075; see "Observed behaviour" in `docs/protocol/wireless-rest/README.md`):
- Session: `POST /login` (JSON only) → `{id, sid}` + `Set-Cookie: sid=…`; other calls accept the sid as cookie or
  `Bosch-Sid` header (the swagger's `sid` header gets 401, like the WAP); dead session → 401 with no body; 409 when the
  user already has a session unless `override: true`.
- Seats (20, 18 connected; seat 1 = Chairman with priority; WAP extra fields, null battery/signal while disconnected),
  speakers (max `maxOpenMics` 4, full list replaces the oldest, `POST /speakers` without body = shift, connected seats
  only), waiting list (only in discussion mode Open, else bare 500), priority (chairman seats only; survive
  `DELETE /speakers` with mic off), participants CRUD (all fields on create, `{id}` back, WAP validation messages),
  identification (modes 0–2 need participants), power (standby drops every seat, on brings them back), voting
  parameters (accepted while open, apply to the next round), voting state machine, results (present/answers/notVoted +
  individuals array).
- Undocumented `GET`/`PUT /discuss` (discussion settings) as on the WAP.
- Error bodies `{error:{code, description, details?}}`.
- **Long-poll** (`?isPolling=true`): held until that resource changes or `longPollMs` (default 50 s, like the WAP)
  passes; one held long-poll per path and session (a new one releases the previous one).
- Not simulated: the WAP's ~48 s delay of logout/login behind held long-polls, and parked requests under load.

Test helpers: `requestToSpeak(seatId)`, `castVote(seatId, answer)`, `setDiscuss(settings)`, `expireSessions()`,
`sessionCount`, `state`, `close()`. `npm run e2e:wireless:mock` runs the real-WAP suite against it.
