# Quick actions (`/api/quick`) — for Bitfocus Companion

DEC-035, WO-117. One button per seat: microphone on, off or toggle, with the button lit while the seat speaks.
Works on every connected system: DICENTIS (wired), DICENTIS Wireless, CCS 1000 D and DCN. No JSON body is needed,
so a plain URL is enough for Companion's Generic HTTP module.

Base path `/api/quick`. Responses use the usual envelope (see [README.md](README.md)).

## Seat references

`:seat` can be any of these, tried in this order:

1. the seat **id** (for example `seat-3` on wired, `3` on wireless),
2. the seat **name**, case-insensitive (for example `Chairman`, `Seat 4`),
3. the seat's **position** in the seat list, 1-based (`1` = first seat).

Put names in the URL encoded: `Seat 4` becomes `Seat%204`. Positions are stable only while the seat list
stays the same, so use the id or name for buttons that must not move.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/api/quick` | Compact state: connection, seats with mic state, speakers, requests |
| GET | `/api/quick/events` | Server-sent events: `state` (same shape as GET) on every change |
| GET | `/api/quick/seats/:seat` | One seat |
| POST | `/api/quick/seats/:seat/mic/:action` | Seat microphone on, off or toggle |
| POST | `/api/quick/seats/:seat/request/:action` | Seat request to speak on, off or toggle (not on wired) |
| POST | `/api/quick/seats/:seat/priority/:action` | Seat priority on, off or toggle |
| POST | `/api/quick/mics/off` | Every speaker off (requests stay) |
| POST | `/api/quick/requests/clear` | Every request removed |
| POST | `/api/quick/discussion/clear` | Speakers and requests cleared |
| POST | `/api/quick/next` | First request in the queue gets the floor |

`:action` is `on`, `off` or `toggle`. Any other action gives `404 NOT_FOUND`.

### Action responses

Each seat action returns the seat and what was done:

```json
{ "ok": true, "data": { "seat": "seat-3", "name": "Seat 3", "did": "on" } }
```

`did` is `on` or `off` for mic, `request` or `no request` for requests, and `priority on` or `priority off` for priority.

`/mics/off` returns `{ "off": 2 }`, `/requests/clear` returns `{ "removed": 1 }`, and `/discussion/clear` returns
`{ "speakers": 2, "requests": 1 }` (the counts before the call). `/next` returns `{ "seat": "7" }`.

## Compact state

`GET /api/quick` returns:

```json
{
  "ok": true,
  "data": {
    "connected": true,
    "state": "loggedIn",
    "system": "wired",
    "systemName": "DICENTIS",
    "seats": [
      { "number": 1, "id": "seat-1", "name": "Chairman", "person": "Anna Berg", "connected": true,
        "mic": "off", "priority": false, "canPrio": true, "requestPosition": null }
    ],
    "speakers": ["seat-3"],
    "requests": ["7"],
    "latestSpeaker": { "id": "seat-3", "name": "Seat 3", "person": "" },
    "firstRequest": { "id": "7", "name": "Seat 7", "person": "" }
  }
}
```

### Top-level fields

| Field | Type | Meaning |
|---|---|---|
| `connected` | boolean | `true` when the session is logged in (`state` is `loggedIn`) |
| `state` | string | connection state: `disconnected`, `connecting`, `connected`, `loggedIn`, `reconnecting` (`disconnected` when unknown) |
| `system` | string or null | `wired`, `wireless`, `dcn`, `dcn-smd` or `ccs1000` |
| `systemName` | string or null | readable name of `system`: `DICENTIS`, `DICENTIS Wireless`, `DCN`, `DCN (meeting data)`, `CCS 1000 D` |
| `seats` | array | every seat, in list order (fields below) |
| `speakers` | string[] | seat ids with an open microphone or a muted speaker slot |
| `requests` | string[] | seat ids in the request queue, in order |
| `latestSpeaker` | object or null | `{ id, name, person }` of the seat that joined the speakers last |
| `firstRequest` | object or null | `{ id, name, person }` of the first seat in the queue |

### Seat fields

| Field | Type | Meaning |
|---|---|---|
| `number` | number | position in the seat list, 1-based |
| `id` | string | seat id |
| `name` | string | seat name |
| `person` | string | name of the person on the seat (empty if none) |
| `connected` | boolean | the seat is connected to the system |
| `mic` | string | `on` (speaker, microphone open), `muted` (speaker, microphone muted), `request` (waiting in the queue) or `off` |
| `priority` | boolean | the seat has priority (only while it is a speaker) |
| `canPrio` | boolean | the seat is allowed to get priority |
| `requestPosition` | number or null | place in the request queue, 1 = first; null when not waiting |

`mic` is `muted` for any speaker whose microphone is not on, so a seat that is a speaker is never `off`.

## Live stream

`GET /api/quick/events` is a server-sent events stream (`text/event-stream`):

```
event: state
data: {"connected":true,"state":"loggedIn", ... }

: ping
```

- The first event is sent as soon as the stream opens.
- After that, a `state` event is sent whenever the seats, the discussion or the connection change. Changes that come
  close together are merged into one event (about 30 ms).
- A `: ping` comment is sent every 15 seconds to keep the connection open. Ignore it.
- Each `data:` line holds the same JSON as `GET /api/quick`.

## Behaviour notes

- **Idempotent.** `on` on a seat that is already a speaker does nothing, and so does `off` on a seat that is not one.
  `mic/on` on a muted speaker unmutes it (wired DICENTIS, Response mode).
- **`toggle`** reads the current state first. For mic, a seat that is a speaker (on or muted) is switched off, and any
  other seat (including one waiting in the queue) is added as a speaker. For requests, a waiting seat is removed and any
  other seat is added to the queue. For priority, the flag is flipped.
- **`discussion/clear`** asks the system to clear everything in one call. Wired systems have no such call, so the
  backend removes each speaker and each request one by one.
- **Requests on wired** cannot be added: `request/on` gives `400 NOT_SUPPORTED`. Use the mic actions on wired.
- **Actions run in order** and stop at the first error. The response shows the result of the whole call only when all
  steps worked.
- Actions change the system. Wait for the next state (or GET) to see the new state; the action response does not include it.

## Errors

| HTTP | code | when |
|---|---|---|
| 400 | `NOT_SUPPORTED` | the system does not support the action (requests on wired) |
| 400 | `VALIDATION` | `/next` when nobody is waiting |
| 404 | `NOT_FOUND` | unknown seat reference, or unknown action |
| 503 | `NOT_CONNECTED` | no session with a discussion system (seat actions, `/mics/off`, `/requests/clear`, `/discussion/clear`, `/next`) |
| 502, 504 | `UPSTREAM_ERROR`, `UPSTREAM_TIMEOUT` | the system answered with an error or did not answer |

`GET /api/quick` and `GET /api/quick/events` never fail on a missing connection: they return `connected: false` instead.

## Bitfocus Companion

There are two ways to use this API from Companion.

### 1. The `likeabosch` Companion module (recommended)

The module is a thin client of this API (WO-118). It gives live button feedback: a seat button lights while the seat
speaks. Install it in Companion and point it at the LikeABosch host.

### 2. Companion's Generic HTTP module (no install)

Use the **Generic HTTP** module, action **POST**, with the URL below and no body. Example for the third seat's mic
toggle:

```
http://<likeabosch-host>:3000/api/quick/seats/3/mic/toggle
```

Replace `<likeabosch-host>` with the LikeABosch PC's address. Port 3000 is the default; use the port set in the launcher if
it differs. This method sends commands only. Use the `likeabosch` module if the buttons must show whether a seat is speaking.

**Network:** LikeABosch listens only on `127.0.0.1` unless **LAN access** is on in the launcher. If Companion runs on
another PC, turn LAN access on, then use that PC's address for `<likeabosch-host>`.

## curl examples

```sh
# state
curl http://localhost:3000/api/quick

# mic on for the seat named "Chairman" (URL-encoded if the name has spaces)
curl -X POST http://localhost:3000/api/quick/seats/Chairman/mic/on

# toggle seat 4 by name
curl -X POST http://localhost:3000/api/quick/seats/Seat%204/mic/toggle

# every speaker off, requests kept
curl -X POST http://localhost:3000/api/quick/mics/off

# live stream (Ctrl+C to stop)
curl -N http://localhost:3000/api/quick/events
```
