# Live state API (cache + SSE)

The backend keeps the DICENTIS state in a cache and pushes changes to browsers (WO-012, DEC-005).
The UI should **read from here**, not poll passthrough endpoints.

## Endpoints
| Endpoint | Returns |
|---|---|
| `GET /api/events` | SSE stream (`text/event-stream`) |
| `GET /api/state` | `{ topics: { <topic>: { data, updatedAt } }, unavailable: { <topic>: reason } }` |
| `GET /api/state/<topic>` | `{ data, updatedAt }`; 404 if not cached (message includes the unavailable reason) |

## SSE events
| `event:` | `data` |
|---|---|
| `snapshot` | sent once on connect: same shape as `GET /api/state` |
| `topic` | `{ topic, data, updatedAt }`; `data: null` means the topic was removed (disconnect, lost permission) |
| `notification` | `{ topic, data }`: transient, not cached (`participantAccessDenied`; plugin queues `pluginEventData`, `pluginCommands`) |
| `connection` | connection state changes (added in WO-013) |

```js
const es = new EventSource('/api/events');
es.addEventListener('snapshot', e => { const { topics } = JSON.parse(e.data); /* … */ });
es.addEventListener('topic', e => { const { topic, data } = JSON.parse(e.data); /* … */ });
```
`EventSource` reconnects automatically and receives a fresh `snapshot` each time.

## Topics (wired)
Topic payload = the response `parameters` of its refresh operation (see `docs/protocol/conference/REFERENCE.md`).
Defined in `docs/protocol/conference/events.json`:

permissions (GetPermissions) · seats (GetSeats) · discussionList (GetDiscussionList) · meetingInfo (GetMeetingInfo) ·
meetings (GetMeetings) · agendaTopics (GetAgendaTopics) · participants (GetParticipants) · participantSeats (GetParticipantSeats) ·
votings (GetVotings) · votingState (GetVotingState) · votingInfo (GetVotingInfo) · votingResults (GetVotingResults) ·
seatVotingResults (GetSeatVotingResults) · individualVotingResults (GetIndividualVotingResults) · majorityResult · quorumResult ·
systemPowerMode · masterVolume · masterVolumeRange · presentationState · seatIlluminationEnabled · illuminatedSeat ·
interpretationLanguages · interpretationRoutings · interpreterSeats · interpreterBooths · boothNotifications ·
interpretationMetaFunctionStatus · files (ListFiles) · images (ListImages) · imageServerInfo · notesFileList ·
roomName · roomContactEmail · plugins · discussionOptions · speechTimerOptions · microphoneSensitivityDescription (6.50, no events) · domain.* (see domain.md). `pluginEventData`/`pluginCommands` are notifications, not topics.

Topics without a change event (`images`, `imageServerInfo`) are fetched at login; `images` is also refreshed after the backend's own `SaveImage`/`DeleteImage` calls (`refreshAfter` in events.json).

A topic is in `unavailable` when the account lacks a required permission (`missing permission: …`) or the
server returned an error (e.g. a missing licence). The UI should hide or disable the related features.
