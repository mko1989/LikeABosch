# DCN Streaming Meeting Data (`system: dcn-smd`, WO-066)

Read-only connection to the DCN-SW server's DCN-SWSMD stream (DEC-018). Protocol: `docs/protocol/dcn-swsmd/README.md`.

## Connection settings
`PUT /api/connection/settings { "system": "dcn-smd", "host": "<DCN-SW server PC>", "port": 20000 }`, then
`POST /api/connection/connect`. No user/password: the DCN-SW server accepts or rejects clients by IP address
(`AllowedClients`). `state: loggedIn` = TCP stream open. A connection closed by the server right after connecting gives
`lastError.reason: "rejected"` (AllowedClients). The backend reconnects with backoff.

## Endpoints
| Endpoint | |
|---|---|
| `GET /api/dcn-smd/state` | `{ stream, system, meeting, discussion, seats, participants, voting, serviceCalls, interpretation, micTest, log }` |
| `POST /api/dcn-smd/reset` | forget the reconstructed state (and `<dataDir>/dcn-smd-state.json`) |

All `/api/domain` actions return 400 `NOT_SUPPORTED` ("read-only"). `domain.capabilities.features.readOnly = true`, no actions.

## Topics
| Topic | Content |
|---|---|
| `smdStream` | `{ state, origin: empty\|restored\|live, connectedAt, messages, bytes, encoding, parseErrors, activities, unknownActivities, lastActivityAt }` |
| `smdSystem` | `{ running, since, activities, lastActivityAt, unknown }` |
| `smdMeeting` | `{ meeting: { id, subject, dateTime, description, attendanceRegistration, participantIds, sessionIds, channels, booths } \| null, session: { id, state: running\|suspended }, sessions: [...] }` |
| `smdDiscussion` | `{ activeMicrophones, active, activeResponses, requests, responses, specialEquipment: [{ participantId, seatId }], activeGroups, priority: [seatId] }` |
| `smdSeats`, `smdParticipants` | everything seen so far (`{ id, name, microphoneActive, seatType, participantId }`, `{ id, firstName, …, present, votingAuthorisation, seatId, group }`) |
| `smdVoting` | `{ id, state: closed\|ready\|opened\|onHold\|done, since, current: { name, subject, answers, results: { approved, quorum/majority, answers: [{ answerId, casts, percentage }], individual, groups } }, votings }` |
| `smdServiceCalls` | `{ open: [{ id, seatId, state: called\|servicing, since }], done: [...] }` |
| `smdInterpretation` | `{ desks: [{ number, boothNumber, seatId, source, destination: { output, number, language }, translating }], booths: [{ number, inUse }] }` |
| `smdMicTest`, `smdLog` | microphone/channel test; last 100 activities `{ at, topic, type, summary }` |

Seats and participants are only known once they appear in an activity (MeetingStarted lists all participants with
their seats; seats without a participant appear with SeatAdded/SeatUpdated or in a list). The state is persisted, so a
backend restart keeps it; the server replays what happened while LikeABosch was disconnected.
