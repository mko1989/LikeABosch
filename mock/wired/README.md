# Wired mock DICENTIS server

A local stand-in for a DICENTIS server speaking the Conference Protocol (WO-010, DEC-006).

```
npm run mock:wired            # wss://127.0.0.1:31416/Dicentis/API, user admin / password admin
MOCK_PORT=31500 npm run mock:wired
```

Point the backend at it with `DICENTIS_HOST=127.0.0.1`, `DICENTIS_PORT=31416`, `DICENTIS_USER=admin`,
`DICENTIS_PASSWORD=admin`, `DICENTIS_TLS_INSECURE=true`. Note: a real DICENTIS server on the same machine
would also use port 31416.

## What it emulates
- Transport: WSS with a self-signed cert (`certs/`, TEST ONLY), path `/Dicentis/API`, subprotocol `DICENTIS_1_0`.
- Protocol rules (PDF p.48–57): case-insensitive operations, operation echoed in the response,
  `error` responses for unknown operations / unknown parameters / bad format / not logged in / second login,
  socket closed on malformed JSON.
- Events: per-connection registration, **fire-once**, re-armed by calling the refresh operation from
  `docs/protocol/conference/events.json` or by `RegisterEvents` again. Events raised in the same tick are
  batched into one message. History-only events (`meetingListChanged`, `participantAccessDenied`) are
  accepted unless `historyEvents: false`.
- Behaviours (`behaviours/*.js`): permissions, room, seats, discussion list (max 4 speakers, requests queue,
  mic mute/unmute), meetings + agenda, voting lifecycle + results, power mode, master volume, presentation.
- Every other in-scope operation returns a default response shaped from the spec (empty strings/arrays,
  first enum value).

## Seed data (`state.js`)
20 seats (`seat-1` = Chairman, priority), 16 participants (12 seated), meetings `meeting-1`
"City Council" (active, opened, 3 agenda topics) and `meeting-2` "Budget Committee", votings
`meeting-1-voting-1|2`, `meeting-2-voting-1`, master volume 10 (range 0–20), powered on.

## Test API (`createMockWiredServer(options)`)
`{ port, url, state, fire(...events), castVote(seatId, answer), requestToSpeak(seatId), dropConnections(), connectionCount, close() }`.
Options: `port` (0 = random), `host`, `users` ({ name: password }), `historyEvents`, `log`.
Set `state.userPermissions[user] = [...]` to simulate a restricted account.
