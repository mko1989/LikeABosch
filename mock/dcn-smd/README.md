# DCN-SWSMD mock (Streaming Meeting Data of the DCN-SW server)

```
npm run mock:dcn-smd                       # 127.0.0.1:20000, UTF-16LE messages, meeting running
MOCK_SMD_PORT=20001 MOCK_SMD_ENCODING=utf8 npm run mock:dcn-smd
MOCK_SMD_IDLE=1 npm run mock:dcn-smd       # no random requests / microphones
```
Point the backend at it with `DICENTIS_SYSTEM=dcn-smd`, `DICENTIS_HOST=127.0.0.1`, `DICENTIS_PORT=20000` (no user/password).

Behaviour (`docs/protocol/dcn-swsmd/README.md`, WO-066):
- Frames `[Int32 LE topic][Int32 LE length][XML]`, XML in the XmlSerializer style of the manual (with `Container`
  suffixes and plural wrappers).
- **Queue:** activities while no client is connected are queued (`maxQueued`, default 50, oldest dropped) and sent
  once to the next client. At start it queues SystemStarted + MeetingStarted + SessionStarted (meeting running).
- **AllowedClients:** `allowedClients: ['10.0.0.5']` disconnects other IPs immediately, like the real server.
- Anything a client sends is ignored.
- Model: 12 seats `0001`…`0012` (seat 1 Chairman), 10 participants on seats 1–10 in groups A/B, interpreter desk seat
  50 (`1:1`, booth 1), sessions 1–2, votings 1 (Yes/No/Abstain) and 2 (Yes/No).

Helpers: `startMeeting()`, `stopMeeting()`, `startSession(id)`, `stopSession()`, `micOn(seat)`, `micOff(seat)`,
`request(seat)`, `cancelRequest(seat)`, `respond(seat)`, `priority(seat, on)`, `selectVoting(id)`, `startVoting(id)`,
`castVote(seat, answerId)` (sends VotingInterimResult), `holdVoting()`, `resumeVoting()`, `stopVoting()` (results,
Approved = more Yes than No), `serviceCall(seat)` → id, `serviceCallServicing(id)`, `serviceCallHandled(id)`,
`interpretation(on)`, `micTest()`, `raw(topic, type, innerXml)`, `dropClients()`, `setAllowedClients(list)`,
`queued`, `clientCount`, `stats`, `close()`. Aliases for ui-check: `requestToSpeak(seat)`, `pressMic(seat)`.

ASSUMPTIONS (the manual's examples are incomplete): discussion lists as `<ActiveList><Participants><ParticipantContainer>`,
voting answers as `<Answers><AnswerContainer Id AnswerText>`, votings in a session as `<Votings><VotingContainer>`.
The parser accepts the other plausible spellings too.
