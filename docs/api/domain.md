# Domain API (system-independent)

DEC-010, WO-017. The UI's shared views use only this layer, so they work on wired DICENTIS, DICENTIS Wireless and DCN NG (WO-062) alike.

## Topics (via `/api/events` / `/api/state`)
| Topic | Shape |
|---|---|
| `domain.capabilities` | `{ system: 'wired'|'wireless'|'dcn', features: {…}, actions: { manageDiscussion, muteMicrophones, controlVoting, powerOn, powerOff, editParticipants, controlMeeting } }`, always present while a system is configured |
| `domain.seats` | `[{ id, name, person, connected, canVote, canPrio, remote, diagnostics: null | { batteryHours, batteryCharges, signalDbm, rangeTest } }]` |
| `domain.discussion` | `{ speakers: [Entry], requests: [Entry & { first }], referenceTime }`; `Entry = { seatId, seatName, name, micState: on|mute|off, priority, kind, timer: null | { remainingSpeechDuration, speechStartTime, show } }` |
| `domain.voting` | `{ state: closed|ready|opened|onHold|done|canceled|accepted|rejected, subject, description, reference, answers[], results: [{ answer, count }] }` |
| `domain.power` | `{ state: on|standby|off|poweringOn|poweringOff }` |
| `domain.participants` | `[{ id, name, sortName, group, seat, present, canVote, nfc }]` (null = not provided by this system) |
| `domain.meeting` | wired + dcn (WO-072): `{ meetings: [{ id, title }], current: null | { id, title, state, running }, session: null | { id, title } }`; wired ignores the built-in Default meeting; dcn `session` = active session |
| `domain.interpreterDesks` | dcn (from the meeting data stream next to the bridge, DEC-020) + dcn-smd (WO-074): `[{ id: 'desk-<booth>-<desk>', booth, desk, seatId, seatName, live, boothInUse, output: null | { output: A|B|C, language, abbreviation, channel }, source: null | { language, abbreviation, channel } }]`; wired desks use the raw `interpreter*` topics |

Seat ids are strings (wireless and DCN integers as strings). Timers follow the speech-timer formula in the conference README.

### Features by system
| feature | wired | wireless | dcn |
|---|---|---|---|
| discussion, voting core, participants | ✓ | ✓ | ✓ |
| power | ✓ | ✓ | – (no power API) |
| muteMicrophones, speechTimers, votingAcceptReject | ✓ | – | – |
| requestQueueAdd, clearDiscussion, priorityCalls | – | ✓ | ✓ |
| meetingControl (Room top bar Start/Stop) | ✓ | – | ✓ |
| powerStandby, votingParameters, participantsEdit, identificationMode, seatDiagnostics | – | ✓ | – |
| meetings, agenda, votingPrepared, votingAdHoc, interpretation, files, plugins, presentation, masterVolume, illumination | ✓ | – | – (DCN versions: WO-063) |

DCN `actions` follow the bridge's `Is*Allowed` flags: `manageDiscussion` = `DiscussionApi.IsDiscussStandardControllAllowed`,
`controlVoting` = `VoteApi.IsParliamentaryVotingControlAllowed` or `IsMultiVotingControlAllowed`, `controlMeeting` = `MeetingApi.IsMeetingControlAllowed` (wired: `canManageMeeting`).
DCN seats = seat assignment of the active meeting + seats seen in mic status/discussion lists (DCN has no seat list);
`connected` is always true (not reported). Speaker `priority` is always false (DCN only counts active priorities).

## Actions (`/api/domain`)
| Request | Wired | Wireless | DCN (`control.*`) |
|---|---|---|---|
| `POST /discussion/speakers {seatId}` | AddSeatToSpeakers | POST /speakers [id] | DiscussionApi.SpeakNow |
| `DELETE /discussion/speakers/:seatId` | RemoveSeatFromDiscussionList | DELETE /speakers/{id} (or /priority/{id} for a priority call) | StopSpeaking |
| `POST /discussion/requests {seatId}` | NOT_SUPPORTED | POST /waiting-list [id] | AppendRequestToSpeak |
| `DELETE /discussion/requests/:seatId` | RemoveSeatFromDiscussionList | DELETE /waiting-list/{id} | RemoveRequestToSpeak (RemoveRequestToRespond for a response request) |
| `POST /discussion/speakers/:seatId/mute`, `/unmute` | Deactivate/ActivateMicrophone | NOT_SUPPORTED | NOT_SUPPORTED |
| `POST /discussion/speakers/:seatId/time/:action` increase, decrease, reset | Increase/Decrease/ResetSpeechTime (6.50) | NOT_SUPPORTED | NOT_SUPPORTED |
| `DELETE /discussion` | NOT_SUPPORTED | DELETE /speakers | CancelAll |
| `POST`/`DELETE /discussion/priority/:seatId` | NOT_SUPPORTED | POST /priority [id] / DELETE /priority/{id} | SetChairmanPriority true/false |
| `PUT /power {state}` | SetSystemPowerMode (on/off) | PUT /system/status 0/1/2 | NOT_SUPPORTED |
| `POST /voting/:action` open, hold, resume, close, abort, accept, reject | the matching *Voting op | open/resume → 1, hold → 2, close → 0; others NOT_SUPPORTED | open → VoteApi.StartVotingById(selected/active voting; 400 if none), hold → HoldVoting, resume → ContinueVoting, close → StopVoting; others NOT_SUPPORTED |
| `PUT /voting/parameters {subject?, mode?}` | NOT_SUPPORTED | PUT /voting | NOT_SUPPORTED |
| `POST /meeting/start {meetingId}` | ActivateMeeting (unless already active) + OpenMeeting; 400 if another meeting is active | NOT_SUPPORTED | MeetingApi.StartMeetingById (unless running) + StartSessionById of the meeting's first session (config.MeetingApi.RetrieveMeetingSessions); 400 if another meeting runs |
| `POST /meeting/stop` | CloseMeeting (6.50 also deactivates) | NOT_SUPPORTED | StopSessionById (if a session runs) + StopMeetingById |
| `GET /capabilities` | same as the `domain.capabilities` topic | |

Unsupported → `400 NOT_SUPPORTED`. Results arrive via the topics (wireless writes trigger an immediate refresh).
