// Mock DCN-SW server Streaming Meeting Data (WO-066, DEC-018, docs/protocol/dcn-swsmd/README.md).
// TCP, frames [Int32 LE topic][Int32 LE length][XML], activities as in the manual (XmlSerializer style).
// Queue semantics like the real server: activities that happen while no client is connected are queued (oldest dropped
// beyond maxQueued) and sent once to the next client. AllowedClients: other client IPs are disconnected at once.
// Run: npm run mock:dcn-smd   (port 20000)
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { TOPICS, encodeFrame } from '../../backend/src/dcn-smd/frames.js';

const esc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attrs = obj => Object.entries(obj).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
const NAMES = [['Anna', 'Novak', 'Chair'], ['Ben', 'Okafor'], ['Clara', 'Ruiz'], ['David', 'Kim'], ['Eva', 'Lindqvist'], ['Farid', 'Haddad'],
  ['Grace', 'Moreau'], ['Hiro', 'Tanaka'], ['Ines', 'Costa'], ['Jan', 'Kowalski']];

/**
 * @param {object} [opts]
 * @param {number} [opts.port]
 * @param {string} [opts.host]
 * @param {'utf16le' | 'utf8'} [opts.encoding]  message encoding (the manual's sample uses UTF-16LE)
 * @param {string[] | null} [opts.allowedClients]  IPs; null = everyone (default)
 * @param {number} [opts.maxQueued]  disconnected queue size (manual default 50)
 * @param {number} [opts.seats]
 * @param {boolean} [opts.meetingRunning]  queue SystemStarted + MeetingStarted + SessionStarted at start (default true)
 */
export async function createMockSmdServer({ port = 0, host = '127.0.0.1', encoding = 'utf16le', allowedClients = null, maxQueued = 50, seats = 12, meetingRunning = true } = {}) {
  const clients = new Set();
  let queue = [];
  const stats = { sent: 0, dropped: 0, rejected: 0, connections: 0 };

  // ------------------------------------------------------------------ model
  const seatList = Array.from({ length: seats }, (_, i) => ({ id: i + 1, name: String(i + 1).padStart(4, '0'), type: i === 0 ? 'Chairman' : 'Delegate', mic: false }));
  const deskSeat = { id: 50, name: '1:1', type: 'Interpreter', mic: false };
  const people = seatList.slice(0, NAMES.length).map((s, i) => ({ id: 100 + s.id, seatId: s.id, first: NAMES[i][0], last: NAMES[i][1], title: NAMES[i][2] ?? '', present: true, group: i < 5 ? 'Group A' : 'Group B' }));
  const votings = [
    { id: 1, name: 'Agenda', subject: 'Approve the agenda', answers: [[1, 'Yes'], [2, 'No'], [3, 'Abstain']] },
    { id: 2, name: 'Minutes', subject: 'Approve the minutes', answers: [[1, 'Yes'], [2, 'No']] },
  ];
  const m = { meeting: null, session: null, active: [], requests: [], responses: [], activeResponses: [], voting: null, votes: new Map(), calls: new Map(), nextCall: 1 };
  const seatOf = id => (id === deskSeat.id ? deskSeat : seatList.find(s => s.id === id));
  const personAt = seatId => people.find(p => p.seatId === seatId);

  const seatXml = (s, tag = 'Seat', withParticipant = false) => {
    const p = withParticipant ? personAt(s.id) : null;
    return `<${tag} Id="${s.id}"><SeatData${attrs({ Name: s.name, MicrophoneActive: s.mic, SeatType: s.type })} />${p ? participantXml(p, 'Participant', false) : ''}</${tag}>`;
  };
  const participantXml = (p, tag = 'ParticipantContainer', withSeat = true) => {
    const data = attrs({ Present: p.present, VotingWeight: 1, VotingAuthorisation: true, MicrophoneAuthorisation: true, FirstName: p.first, MiddleName: '', LastName: p.last, Title: p.title, Country: '', RemainingSpeechTime: -1 });
    return `<${tag} Id="${p.id}"><ParticipantData${data} />${withSeat ? seatXml(seatOf(p.seatId)) : ''}<Group Name="${esc(p.group)}" /></${tag}>`;
  };
  /** A list entry for a seat (with its participant if one sits there). */
  const entryXml = seatId => {
    const p = personAt(seatId);
    return p ? participantXml(p) : `<ParticipantContainer Id="${1000 + seatId}"><ParticipantData FirstName="${esc(seatOf(seatId).name)}" LastName="" Present="true" />${seatXml(seatOf(seatId))}</ParticipantContainer>`;
  };
  const listXml = (tag, seatIds) => `<${tag}><Participants>${seatIds.map(entryXml).join('')}</Participants></${tag}>`;
  const answersXml = v => `<Answers>${v.answers.map(([id, text]) => `<AnswerContainer${attrs({ Id: id, AnswerText: text, LegendText: '', Correct: false, Score: 0 })} />`).join('')}</Answers>`;
  const votingDataXml = v => `<VotingData${attrs({ Name: v.name, Subject: v.subject, VotingType: 'Parliamentary', RemainingVotingTime: -1 })} />`;
  const resultsXml = (v, final) => {
    const counts = v.answers.map(([id]) => [id, [...m.votes.values()].filter(a => a === id).length]);
    const total = m.votes.size;
    const yes = counts.find(([id]) => id === 1)?.[1] ?? 0;
    const no = counts.find(([id]) => id === 2)?.[1] ?? 0;
    const present = people.filter(p => p.present).length;
    return `<VotingResults>${final ? `<IndividualResults>${[...m.votes].map(([seatId, a]) => (personAt(seatId) ? `<VotingIndividualResultContainer AnswerId="${a}">${participantXml(personAt(seatId), 'Participant')}</VotingIndividualResultContainer>` : '')).join('')}</IndividualResults>` : ''}`
      + `<VotingTotalResults${attrs({ Approved: final ? yes > no : undefined, RequiredQuorum: 0, ActualQuorum: total, MaximumQuorum: present, RequiredMajority: Math.floor(total / 2) + 1, ActualMajority: yes, MaximumMajority: total, NumberOfAuthorizedPresentParticipants: present, NumberOfAuthorizedPresentParticipantsWithoutVote: present - total })}>`
      + `<VotingAnswerResults>${counts.map(([id, n]) => `<VotingAnswerResultContainer${attrs({ AnswerId: id, NumberOfCasts: n, Percentage: total ? Math.round((n / total) * 100) : 0 })} />`).join('')}</VotingAnswerResults></VotingTotalResults></VotingResults>`;
  };

  // ------------------------------------------------------------------ sending
  const ROOT = { System: 'SystemActivity', Meeting: 'MeetingActivity', Session: 'SessionActivity', Discussion: 'DiscussionActivity', Participant: 'ParticipantActivity',
    Seat: 'SeatActivity', Voting: 'VotingActivity', Interpretation: 'InterpretationActivity', ServiceCall: 'ServiceCallActivity', Booth: 'BoothActivity', Desk: 'DeskActivity', TestSystem: 'TestSystemActivity' };
  function send(topic, type, inner = '') {
    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<${ROOT[topic]} xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" Version="1" TimeStamp="${new Date().toISOString()}" Topic="${topic}" Type="${type}">${inner}</${ROOT[topic]}>`;
    const frame = encodeFrame(TOPICS.indexOf(topic), xml, encoding);
    if (clients.size) {
      for (const c of clients) c.write(frame);
      stats.sent += 1;
    } else {
      queue.push(frame);
      if (queue.length > maxQueued) { queue = queue.slice(-maxQueued); stats.dropped += 1; }
    }
  }
  const discussion = inner => send('Discussion', inner[0], `<Discussion Id="1">${inner[1]}</Discussion>`);
  const updateSeat = s => send('Seat', 'SeatUpdated', seatXml(s, 'Seat', true));

  const sim = {
    systemStarted: () => send('System', 'SystemStarted'),
    startMeeting() {
      m.meeting = { id: 1, subject: 'Council meeting' };
      const inner = `<Meeting Id="1"><MeetingData Subject="Council meeting" DateTime="${new Date().toISOString()}" Description="Monthly council meeting" />`
        + '<Sessions><SessionContainer Id="1"><SessionData Subject="Morning session" Description="" Done="false" /></SessionContainer><SessionContainer Id="2"><SessionData Subject="Afternoon session" Description="" Done="false" /></SessionContainer></Sessions>'
        + `<Participants>${people.map(p => participantXml(p)).join('')}</Participants>`
        + '<Channels><Channel Number="1"><Language Abbreviation="ENG" Name="English" /></Channel><Channel Number="2"><Language Abbreviation="NLD" Name="Dutch" /></Channel></Channels>'
        + `<Booths><Booth Number="1"><Desks><Desk Id="1" Number="1">${seatXml(deskSeat)}</Desk></Desks></Booth></Booths></Meeting>`;
      send('Meeting', 'MeetingStarted', inner);
    },
    stopMeeting() {
      m.meeting = null; m.session = null; m.active = []; m.requests = []; m.voting = null;
      seatList.forEach(s => { s.mic = false; });
      send('Meeting', 'MeetingStopped', '<Meeting Id="1" />');
    },
    startSession(id = 1) {
      m.session = id;
      send('Session', 'SessionStarted', `<Session Id="${id}"><SessionData Subject="${id === 1 ? 'Morning session' : 'Afternoon session'}" Description="" Done="false" />`
        + `<Votings>${votings.map(v => `<VotingContainer Id="${v.id}">${votingDataXml(v)}${answersXml(v)}</VotingContainer>`).join('')}</Votings>`
        + '<Groups><GroupContainer Name="Group A" RemainingGroupSpeechTime="-1" StopWatchState="STOPWATCH_IDLE" /><GroupContainer Name="Group B" RemainingGroupSpeechTime="-1" StopWatchState="STOPWATCH_IDLE" /></Groups></Session>');
    },
    stopSession() { send('Session', 'SessionStopped', `<Session Id="${m.session}" />`); m.session = null; },
    micOn(seatId) {
      const s = seatOf(seatId);
      if (!s || m.active.includes(seatId)) return;
      const wasRequest = m.requests.includes(seatId);
      m.active = [...m.active, seatId];
      m.requests = m.requests.filter(x => x !== seatId);
      s.mic = true;
      discussion(['ActiveListUpdated', listXml('ActiveList', m.active)]);
      if (wasRequest) discussion(['RequestListUpdated', listXml('RequestList', m.requests)]);
      discussion(['DiscussionDataUpdated', `<DiscussionData NumberOfActiveMicrophones="${m.active.length}" />`]);
      updateSeat(s);
    },
    micOff(seatId) {
      const s = seatOf(seatId);
      if (!s || !m.active.includes(seatId)) return;
      m.active = m.active.filter(x => x !== seatId);
      s.mic = false;
      discussion(['ActiveListUpdated', listXml('ActiveList', m.active)]);
      discussion(['DiscussionDataUpdated', `<DiscussionData NumberOfActiveMicrophones="${m.active.length}" />`]);
      updateSeat(s);
    },
    request(seatId) {
      if (m.requests.includes(seatId) || m.active.includes(seatId) || !seatOf(seatId)) return;
      m.requests = [...m.requests, seatId];
      discussion(['RequestListUpdated', listXml('RequestList', m.requests)]);
    },
    cancelRequest(seatId) {
      m.requests = m.requests.filter(x => x !== seatId);
      discussion(['RequestListUpdated', listXml('RequestList', m.requests)]);
    },
    respond(seatId) {
      m.responses = [...m.responses, seatId];
      discussion(['ResponseListUpdated', listXml('ResponseList', m.responses)]);
    },
    priority(seatId, on) {
      const s = seatOf(seatId);
      s.mic = on;
      send('Seat', on ? 'SeatPriorityButtonActivated' : 'SeatPriorityButtonDeactivated', seatXml(s, 'Seat', true));
    },
    selectVoting(id) { m.voting = { id, state: 'selected' }; const v = votings.find(x => x.id === id); send('Voting', 'VotingSelected', `<Voting Id="${id}">${votingDataXml(v)}</Voting>`); },
    startVoting(id) {
      const v = votings.find(x => x.id === id);
      m.voting = { id, state: 'running' };
      m.votes = new Map();
      send('Voting', 'VotingStarted', `<Voting Id="${id}">${votingDataXml(v)}${answersXml(v)}</Voting>`);
    },
    castVote(seatId, answerId) {
      if (m.voting?.state !== 'running') return false;
      m.votes.set(seatId, answerId);
      const v = votings.find(x => x.id === m.voting.id);
      send('Voting', 'VotingInterimResult', `<Voting Id="${v.id}">${resultsXml(v, false)}</Voting>`);
      return true;
    },
    holdVoting() { m.voting.state = 'hold'; send('Voting', 'VotingOnHold', `<Voting Id="${m.voting.id}" />`); },
    resumeVoting() { m.voting.state = 'running'; send('Voting', 'VotingResumed', `<Voting Id="${m.voting.id}" />`); },
    stopVoting() {
      const v = votings.find(x => x.id === m.voting.id);
      send('Voting', 'VotingStopped', `<Voting Id="${v.id}">${votingDataXml(v)}${resultsXml(v, true)}${answersXml(v)}</Voting>`);
      m.voting = null;
    },
    serviceCall(seatId) {
      const id = m.nextCall++;
      m.calls.set(id, seatId);
      send('ServiceCall', 'ServiceCallStarted', `<ServiceCall Id="${id}">${seatXml(seatOf(seatId), 'Seat', true)}</ServiceCall>`);
      return id;
    },
    serviceCallServicing(id) { send('ServiceCall', 'ServiceCallIsBeingServiced', `<ServiceCall Id="${id}">${seatXml(seatOf(m.calls.get(id)))}</ServiceCall>`); },
    serviceCallHandled(id) { send('ServiceCall', 'ServiceCallHandled', `<ServiceCall Id="${id}">${seatXml(seatOf(m.calls.get(id)))}</ServiceCall>`); m.calls.delete(id); },
    interpretation(on) {
      send('Interpretation', on ? 'InterpretationTranslationStarted' : 'InterpretationTranslationStopped',
        `<Desk Id="1" Number="1"><Booth Number="1" />${seatXml(deskSeat)}<Source><Channel Number="0"><Language Abbreviation="FLR" Name="Floor" /></Channel></Source><Destination Output="A"><Channel Number="2"><Language Abbreviation="NLD" Name="Dutch" /></Channel></Destination></Desk>`);
      send('Booth', on ? 'BoothInUse' : 'BoothNotInUse', '<Booth Number="1" />');
    },
    micTest() {
      send('TestSystem', 'MicrophoneTestStarted');
      send('TestSystem', 'MicrophoneTestEnded', `<MicrophoneTestResults><MicrophoneTestResultContainer Passed="true"><Seat>${seatList.slice(0, -1).map(s => seatXml(s, 'SeatContainer')).join('')}</Seat></MicrophoneTestResultContainer>`
        + `<MicrophoneTestResultContainer Passed="false"><Seat>${seatXml(seatList.at(-1), 'SeatContainer')}</Seat></MicrophoneTestResultContainer></MicrophoneTestResults>`);
    },
    /** Raw activity (tests): topic name, type, inner XML. */
    raw: send,
  };

  if (meetingRunning) { sim.systemStarted(); sim.startMeeting(); sim.startSession(1); }

  // ------------------------------------------------------------------ server
  const server = net.createServer(socket => {
    stats.connections += 1;
    const ip = String(socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (allowedClients && !allowedClients.includes(ip)) {
      stats.rejected += 1;
      socket.destroy();
      return;
    }
    socket.on('error', () => {});
    socket.on('close', () => clients.delete(socket));
    socket.on('data', () => {}); // the real server ignores anything a client sends
    clients.add(socket);
    if (queue.length) { for (const f of queue) socket.write(f); queue = []; }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });

  return {
    port: /** @type {net.AddressInfo} */ (server.address()).port,
    ...sim,
    // aliases used by scripts/ui-check (mock[fn](...args))
    requestToSpeak: seatId => sim.request(seatId),
    pressMic: seatId => (m.active.includes(seatId) ? sim.micOff(seatId) : sim.micOn(seatId)),
    get model() { return m; },
    get queued() { return queue.length; },
    get clientCount() { return clients.size; },
    stats,
    setAllowedClients(list) { allowedClients = list; },
    dropClients() { for (const c of clients) c.destroy(); },
    async close() {
      for (const c of clients) c.destroy();
      await new Promise(resolve => server.close(() => resolve()));
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const mock = await createMockSmdServer({ port: Number(process.env.MOCK_SMD_PORT ?? 20000), host: process.env.MOCK_SMD_HOST ?? '127.0.0.1', encoding: process.env.MOCK_SMD_ENCODING === 'utf8' ? 'utf8' : 'utf16le' });
  console.log(`mock DCN-SWSMD stream on 127.0.0.1:${mock.port} (meeting running, ${mock.queued} activities queued for the first client)`);
  if (process.env.MOCK_SMD_IDLE !== '1') {
    setInterval(() => {
      const seat = 2 + Math.floor(Math.random() * 10);
      if (Math.random() < 0.5) mock.request(seat); else mock.pressMic(seat);
    }, 6_000).unref();
  }
  const stop = async () => { await mock.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
