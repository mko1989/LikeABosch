// DCN-SWSMD state model (WO-066, DEC-018): the stream has no snapshot request, so the meeting picture is rebuilt from
// activities. Pure apart from Date (no I/O): apply(root) → names of the sections that changed. Persistence is done by
// sync.js with toJSON()/fromJSON().
import { attr, bool, child, int, items } from './xml.js';

export const SECTIONS = ['system', 'meeting', 'discussion', 'seats', 'participants', 'voting', 'serviceCalls', 'interpretation', 'micTest', 'log'];
const LOG_SIZE = 100;
const DONE_CALLS = 20;

/**
 * @typedef {{ id: number, name?: string, microphoneActive?: boolean, seatType?: string, participantId?: number | null }} SmdSeat
 * @typedef {{ id: number, firstName?: string, middleName?: string, lastName?: string, title?: string, country?: string,
 *   present?: boolean, votingAuthorisation?: boolean, votingWeight?: number, microphoneAuthorisation?: boolean,
 *   remainingSpeechTime?: number, speechTimerOnHold?: boolean, seatId?: number | null, group?: string | null }} SmdParticipant
 * @typedef {{ participantId: number | null, seatId: number | null }} SmdListEntry
 */

const defined = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export class SmdState {
  constructor() { this.reset(); }

  reset() {
    this.system = { running: null, since: null };
    this.meeting = null; // { id, subject, dateTime, description, attendanceRegistration, participantIds, channels, booths }
    this.sessions = {}; // id → { id, subject, description, done, votingIds, groups }
    this.session = { id: null, state: null }; // running | suspended
    this.discussion = { id: null, activeMicrophones: null, requests: [], responses: [], active: [], activeResponses: [], specialEquipment: [], activeGroups: [] };
    /** @type {Record<string, SmdSeat>} */
    this.seats = {};
    /** @type {Record<string, SmdParticipant>} */
    this.participants = {};
    this.priority = []; // seat ids with the chairman priority button pressed
    this.votings = {}; // id → { id, name, subject, votingType, remainingVotingTime, answers, results }
    this.voting = { id: null, state: 'closed', since: null };
    this.serviceCalls = { open: {}, done: [] };
    this.desks = {}; // number → desk
    this.booths = {}; // number → { number, inUse }
    this.micTest = { state: null, at: null, results: [] };
    this.channelTest = null;
    this.log = [];
    this.stats = { activities: 0, lastActivityAt: null, unknown: 0 };
  }

  // ------------------------------------------------------------------ container readers (update the maps as a side effect)

  /**
   * <Seat Id><SeatData Name MicrophoneActive SeatType/><Participant …/></Seat> → seat id.
   * `full`: a Seat activity's own seat, where a missing <Participant> means nobody is seated (manual p. 12).
   */
  #seat(node, changed, full = false) {
    const id = int(node, 'Id');
    if (id === undefined) return null;
    const prev = this.seats[id] ?? { id };
    const data = child(node, 'SeatData');
    const p = child(node, 'Participant');
    const participantId = p ? this.#participant(p, changed, id) : undefined;
    const next = defined({
      ...prev,
      name: attr(data, 'Name') ?? prev.name,
      microphoneActive: bool(data, 'MicrophoneActive') ?? prev.microphoneActive,
      seatType: attr(data, 'SeatType') ?? prev.seatType,
      participantId: participantId ?? (full && data ? null : prev.participantId),
    });
    this.seats[id] = next;
    changed.add('seats');
    return id;
  }

  /** <Participant Id><ParticipantData …/><Seat/><Group Name/></Participant> → participant id */
  #participant(node, changed, seatIdFromParent) {
    const id = int(node, 'Id');
    if (id === undefined) return null;
    const prev = this.participants[id] ?? { id };
    const d = child(node, 'ParticipantData');
    const seatNode = child(node, 'Seat');
    const seatId = seatNode ? this.#seat(seatNode, changed) : seatIdFromParent;
    const group = child(node, 'Group');
    const next = defined({
      ...prev,
      firstName: attr(d, 'FirstName') ?? prev.firstName,
      middleName: attr(d, 'MiddleName') ?? prev.middleName,
      lastName: attr(d, 'LastName') ?? prev.lastName,
      title: attr(d, 'Title') ?? prev.title,
      country: attr(d, 'Country') ?? prev.country,
      present: bool(d, 'Present') ?? prev.present,
      votingAuthorisation: bool(d, 'VotingAuthorisation') ?? prev.votingAuthorisation,
      votingWeight: int(d, 'VotingWeight') ?? prev.votingWeight,
      microphoneAuthorisation: bool(d, 'MicrophoneAuthorisation') ?? prev.microphoneAuthorisation,
      remainingSpeechTime: int(d, 'RemainingSpeechTime') ?? prev.remainingSpeechTime,
      speechTimerOnHold: bool(d, 'SpeechTimerOnHold') ?? prev.speechTimerOnHold,
      seatId: seatId ?? prev.seatId,
      group: group ? (attr(group, 'Name') && attr(group, 'Name') !== '-' ? attr(group, 'Name') : null) : prev.group,
    });
    this.participants[id] = next;
    if (seatId != null && this.seats[seatId] && this.seats[seatId].participantId !== id && !seatIdFromParent) {
      this.seats[seatId] = { ...this.seats[seatId], participantId: id };
    }
    changed.add('participants');
    return id;
  }

  /** A discussion list: <RequestList><Participants><ParticipantContainer …/></Participants></RequestList> (lenient) */
  #list(node, changed) {
    if (!node) return [];
    return items(node, 'Participant').map(p => {
      const participantId = this.#participant(p, changed);
      const seatId = this.participants[participantId]?.seatId ?? null;
      return { participantId, seatId };
    });
  }

  #session(node, changed) {
    const id = int(node, 'Id');
    if (id === undefined) return null;
    const prev = this.sessions[id] ?? { id, votingIds: [], groups: [] };
    const d = child(node, 'SessionData');
    const votings = items(node, 'Voting', ['Votings']).map(v => this.#votingNode(v, changed)).filter(x => x !== null);
    const groupsNode = items(node, 'Group', ['Groups', 'ActiveGroups']);
    const discussion = child(node, 'Discussion');
    if (discussion) this.#discussion(discussion, changed);
    items(node, 'Participant').forEach(p => this.#participant(p, changed));
    this.sessions[id] = defined({
      ...prev,
      subject: attr(d, 'Subject') ?? prev.subject,
      description: attr(d, 'Description') ?? prev.description,
      done: bool(d, 'Done') ?? prev.done,
      votingIds: votings.length ? votings : prev.votingIds,
      groups: groupsNode.length ? groupsNode.map(g => this.#group(g)) : prev.groups,
    });
    changed.add('meeting');
    return id;
  }

  #group(g) {
    return defined({ name: attr(g, 'Name'), remainingGroupSpeechTime: int(g, 'RemainingGroupSpeechTime'), stopWatchState: attr(g, 'StopWatchState') });
  }

  #discussion(node, changed) {
    const d = this.discussion;
    d.id = int(node, 'Id') ?? d.id;
    const data = child(node, 'DiscussionData');
    if (data) d.activeMicrophones = int(data, 'NumberOfActiveMicrophones') ?? d.activeMicrophones;
    const LISTS = { RequestList: 'requests', ResponseList: 'responses', ActiveList: 'active', ActiveResponseList: 'activeResponses', SpecialEquipmentList: 'specialEquipment' };
    for (const [el, key] of Object.entries(LISTS)) {
      const list = child(node, el);
      if (list) d[key] = this.#list(list, changed);
    }
    const activeGroups = child(node, 'ActiveGroups');
    if (activeGroups) d.activeGroups = [...items(activeGroups, 'Group'), ...items(activeGroups, 'ActiveGroup')].map(g => this.#group(g));
    // Keep the seats' microphone flags in line with the speaker lists.
    if (child(node, 'ActiveList') || child(node, 'ActiveResponseList')) {
      const on = new Set([...d.active, ...d.activeResponses].map(e => e.seatId).filter(x => x != null));
      for (const s of Object.values(this.seats)) {
        const active = on.has(s.id);
        if (Boolean(s.microphoneActive) !== active && s.seatType !== 'Interpreter') this.seats[s.id] = { ...s, microphoneActive: active };
      }
      changed.add('seats');
    }
    changed.add('discussion');
  }

  /** <Voting Id><VotingData/><VotingResults/><Answers|VotingAnswers/></Voting> → voting id */
  #votingNode(node, changed) {
    const id = int(node, 'Id');
    if (id === undefined) return null;
    const prev = this.votings[id] ?? { id, answers: [], results: null };
    const d = child(node, 'VotingData');
    const answers = [...items(node, 'Answer', ['VotingAnswers']), ...items(node, 'VotingAnswer', ['Answers'])].map(a => defined({
      id: int(a, 'Id'), text: attr(a, 'AnswerText') ?? attr(a, 'Text'), legend: attr(a, 'LegendText'), correct: bool(a, 'Correct'), score: int(a, 'Score'),
    }));
    const resultsNode = child(node, 'VotingResults');
    this.votings[id] = defined({
      ...prev,
      name: attr(d, 'Name') ?? prev.name,
      subject: attr(d, 'Subject') ?? prev.subject,
      votingType: attr(d, 'VotingType') ?? prev.votingType,
      remainingVotingTime: int(d, 'RemainingVotingTime') ?? prev.remainingVotingTime,
      answers: answers.length ? answers : prev.answers,
      results: resultsNode ? this.#results(resultsNode, prev.results, changed) : prev.results,
    });
    changed.add('voting');
    return id;
  }

  /** VotingResults; interim results only carry changed values, so merge into the previous ones. */
  #results(node, prev, changed) {
    const out = { ...(prev ?? {}), answers: [...(prev?.answers ?? [])], individual: [...(prev?.individual ?? [])] };
    const total = child(node, 'VotingTotalResults');
    if (total) {
      for (const k of ['RequiredQuorum', 'ActualQuorum', 'MaximumQuorum', 'RequiredMajority', 'ActualMajority', 'MaximumMajority',
        'NumberOfAuthorizedPresentParticipants', 'NumberOfAuthorizedPresentParticipantsWithoutVote']) {
        const v = int(total, k);
        if (v !== undefined) out[k[0].toLowerCase() + k.slice(1)] = v;
      }
      const approved = bool(total, 'Approved');
      if (approved !== undefined) out.approved = approved;
      for (const r of items(total, 'VotingAnswerResult', ['VotingAnswerResults'])) {
        const answerId = int(r, 'AnswerId');
        const entry = defined({ answerId, casts: int(r, 'NumberOfCasts'), percentage: int(r, 'Percentage') }); // int() parses decimals too
        const i = out.answers.findIndex(a => a.answerId === answerId);
        if (i >= 0) out.answers[i] = { ...out.answers[i], ...entry }; else out.answers.push(entry);
      }
    }
    const individual = items(node, 'VotingIndividualResult', ['IndividualResults']);
    for (const r of individual) {
      const p = child(r, 'Participant');
      const participantId = p ? this.#participant(p, changed) : null;
      const answerId = int(r, 'AnswerId');
      const i = out.individual.findIndex(x => x.participantId === participantId);
      if (i >= 0) out.individual[i] = { participantId, answerId }; else out.individual.push({ participantId, answerId });
    }
    const groups = items(node, 'VotingGroupResult', ['VotingGroupResults']);
    if (groups.length) {
      out.groups = groups.map(g => ({
        group: attr(child(g, 'Group'), 'Name') ?? null,
        present: int(g, 'NumberOfAuthorizedPresentParticipants') ?? null,
        answers: items(g, 'VotingAnswerResult', ['VotingAnswerResults']).map(r => ({ answerId: int(r, 'AnswerId'), casts: int(r, 'NumberOfCasts') ?? 0 })),
      }));
    }
    return out;
  }

  #desk(node, changed, translating) {
    const number = int(node, 'Number') ?? int(node, 'Id');
    if (number === undefined) return null;
    const key = String(number);
    const prev = this.desks[key] ?? { number };
    const booth = child(node, 'Booth');
    const seat = child(node, 'Seat');
    const channel = c => (c ? defined({ number: int(c, 'Number'), language: attr(child(c, 'Language'), 'Name'), abbreviation: attr(child(c, 'Language'), 'Abbreviation') }) : undefined);
    const source = child(node, 'Source');
    const destination = child(node, 'Destination');
    this.desks[key] = defined({
      ...prev,
      id: int(node, 'Id') ?? prev.id,
      boothNumber: int(booth, 'Number') ?? prev.boothNumber,
      seatId: seat ? this.#seat(seat, changed) : prev.seatId,
      source: source ? channel(child(source, 'Channel')) ?? null : prev.source,
      destination: destination ? defined({ output: attr(destination, 'Output'), ...channel(child(destination, 'Channel')) }) : prev.destination,
      translating: translating ?? prev.translating,
    });
    if (seat && this.seats[this.desks[key].seatId]) this.seats[this.desks[key].seatId].seatType ??= 'Interpreter';
    changed.add('interpretation');
    return key;
  }

  // ------------------------------------------------------------------ activities

  /**
   * Apply one activity (parsed root element).
   * @param {import('./xml.js').XmlNode} root
   * @param {{ topicName?: string }} [frame]
   * @returns {Set<string>} changed sections
   */
  apply(root, frame = {}) {
    const changed = new Set(['system', 'log']);
    const type = attr(root, 'Type') ?? root.name;
    const topic = attr(root, 'Topic') ?? frame.topicName ?? '';
    const at = attr(root, 'TimeStamp') ?? new Date().toISOString();
    this.stats.activities += 1;
    this.stats.lastActivityAt = new Date().toISOString();
    const meetingNode = child(root, 'Meeting');
    const sessionNode = child(root, 'Session');
    const votingNode = child(root, 'Voting');
    const seatNode = child(root, 'Seat');
    let summary = '';

    switch (type) {
      case 'SystemStarted': this.system = { running: true, since: at }; break;
      case 'SystemStopped':
        this.system = { running: false, since: at };
        this.#endMeeting(changed);
        break;

      case 'MeetingStarted':
      case 'MeetingDataUpdated': {
        const id = int(meetingNode, 'Id');
        const d = child(meetingNode, 'MeetingData');
        const fresh = type === 'MeetingStarted' || this.meeting?.id !== id;
        if (type === 'MeetingStarted') { this.sessions = {}; this.votings = {}; this.session = { id: null, state: null }; }
        const prev = fresh ? { participantIds: [], channels: [], booths: [], attendanceRegistration: false } : this.meeting;
        const sessions = items(meetingNode, 'Session').map(s => this.#session(s, changed));
        const participants = items(meetingNode, 'Participant').map(p => this.#participant(p, changed)).filter(x => x !== null);
        const channels = items(meetingNode, 'Channel').map(c => defined({ number: int(c, 'Number'), language: attr(child(c, 'Language'), 'Name'), abbreviation: attr(child(c, 'Language'), 'Abbreviation') }));
        const booths = items(meetingNode, 'Booth').map(b => {
          const number = int(b, 'Number');
          const desks = items(b, 'Desk').map(dk => { dk.children.push({ name: 'Booth', attrs: { Number: String(number) }, children: [], text: '' }); return this.#desk(dk, changed); });
          this.booths[number] = { number, inUse: this.booths[number]?.inUse ?? false };
          return { number, desks };
        });
        this.meeting = defined({
          ...prev,
          id,
          subject: attr(d, 'Subject') ?? prev.subject,
          dateTime: attr(d, 'DateTime') ?? prev.dateTime,
          description: attr(d, 'Description') ?? prev.description,
          sessionIds: sessions.length ? sessions : prev.sessionIds ?? [],
          participantIds: participants.length ? participants : prev.participantIds,
          channels: channels.length ? channels : prev.channels,
          booths: booths.length ? booths : prev.booths,
          startedAt: type === 'MeetingStarted' ? at : prev.startedAt,
        });
        changed.add('meeting');
        summary = this.meeting.subject ?? `meeting ${id}`;
        break;
      }
      case 'MeetingStopped': this.#endMeeting(changed); summary = `meeting ${int(meetingNode, 'Id')}`; break;
      case 'ParticipantAdded': {
        if (!this.meeting) this.meeting = { id: int(meetingNode, 'Id'), participantIds: [], channels: [], booths: [] };
        for (const p of items(meetingNode, 'Participant')) {
          const id = this.#participant(p, changed);
          if (id !== null && !this.meeting.participantIds.includes(id)) this.meeting.participantIds.push(id);
          summary = this.#name(id);
        }
        changed.add('meeting');
        break;
      }
      case 'AttendanceRegistrationStarted':
      case 'AttendanceRegistrationStopped':
        if (this.meeting) this.meeting = { ...this.meeting, attendanceRegistration: type.endsWith('Started') };
        changed.add('meeting');
        break;

      case 'SessionStarted':
      case 'SessionDataUpdated': {
        const id = this.#session(sessionNode, changed);
        if (type === 'SessionStarted') this.session = { id, state: 'running', since: at };
        if (this.meeting && id !== null && !this.meeting.sessionIds?.includes(id)) this.meeting = { ...this.meeting, sessionIds: [...(this.meeting.sessionIds ?? []), id] };
        summary = this.sessions[id]?.subject ?? `session ${id}`;
        break;
      }
      case 'SessionStopped': this.session = { id: null, state: null }; this.voting = { id: null, state: 'closed', since: null }; changed.add('meeting').add('voting'); break;
      case 'SessionSuspended': this.session = { ...this.session, id: int(sessionNode, 'Id') ?? this.session.id, state: 'suspended' }; changed.add('meeting'); break;
      case 'SessionResumed': this.session = { ...this.session, id: int(sessionNode, 'Id') ?? this.session.id, state: 'running' }; changed.add('meeting'); break;

      case 'DiscussionDataUpdated':
      case 'RequestListUpdated':
      case 'ResponseListUpdated':
      case 'ActiveListUpdated':
      case 'ActiveResponseListUpdated':
      case 'SpecialEquipmentListUpdated': {
        const node = child(root, 'Discussion');
        if (node) this.#discussion(node, changed);
        const d = this.discussion;
        summary = type === 'ActiveListUpdated' ? `${d.active.length} speaking` : type === 'RequestListUpdated' ? `${d.requests.length} waiting` : '';
        break;
      }

      case 'VotingSelected':
      case 'VotingStarted':
      case 'VotingOnHold':
      case 'VotingResumed':
      case 'VotingStopped':
      case 'VotingDataUpdated':
      case 'VotingInterimResult':
      case 'VotingInterimResults': {
        const id = votingNode ? this.#votingNode(votingNode, changed) : this.voting.id;
        const STATE = { VotingSelected: 'ready', VotingStarted: 'opened', VotingOnHold: 'onHold', VotingResumed: 'opened', VotingStopped: 'done' };
        if (STATE[type]) this.voting = { id, state: STATE[type], since: type === 'VotingOnHold' || type === 'VotingResumed' ? this.voting.since : at };
        if (type === 'VotingStarted' && this.votings[id]) this.votings[id] = { ...this.votings[id], results: null }; // a fresh round
        changed.add('voting');
        summary = this.votings[id]?.subject || this.votings[id]?.name || `voting ${id}`;
        break;
      }

      case 'SeatAdded':
      case 'SeatUpdated':
      case 'SeatPriorityButtonActivated':
      case 'SeatPriorityButtonDeactivated': {
        const id = this.#seat(seatNode, changed, true);
        if (type === 'SeatPriorityButtonActivated' && !this.priority.includes(id)) this.priority = [...this.priority, id];
        if (type === 'SeatPriorityButtonDeactivated') this.priority = this.priority.filter(x => x !== id);
        if (type.startsWith('SeatPriority')) changed.add('discussion');
        summary = this.seats[id]?.name ?? `seat ${id}`;
        break;
      }
      case 'SeatRemoved': {
        const id = int(seatNode, 'Id');
        delete this.seats[id];
        this.priority = this.priority.filter(x => x !== id);
        changed.add('seats').add('discussion');
        summary = `seat ${id}`;
        break;
      }
      case 'ParticipantUpdated': {
        const id = this.#participant(child(root, 'Participant'), changed);
        summary = this.#name(id);
        break;
      }

      case 'InterpretationTranslationStarted':
      case 'InterpretationTranslationStopped':
      case 'DeskAdded':
      case 'DeskUpdated': {
        const desk = child(root, 'Desk');
        const key = desk ? this.#desk(desk, changed, type.startsWith('Interpretation') ? type.endsWith('Started') : undefined) : null;
        summary = key ? `desk ${key}` : '';
        break;
      }
      case 'DeskRemoved': {
        const desk = child(root, 'Desk');
        const key = String(int(desk, 'Number') ?? int(desk, 'Id'));
        delete this.desks[key];
        changed.add('interpretation');
        break;
      }
      case 'BoothInUse':
      case 'BoothNotInUse': {
        const number = int(child(root, 'Booth'), 'Number');
        this.booths[number] = { number, inUse: type === 'BoothInUse' };
        changed.add('interpretation');
        summary = `booth ${number}`;
        break;
      }

      case 'ServiceCallStarted':
      case 'ServiceCallIsBeingServiced':
      case 'ServiceCallHandled':
      case 'ServiceCallCanceled': {
        const call = child(root, 'ServiceCall');
        const id = int(call, 'Id');
        const seat = child(call, 'Seat');
        const seatId = seat ? this.#seat(seat, changed) : this.serviceCalls.open[id]?.seatId ?? null;
        if (type === 'ServiceCallStarted' || type === 'ServiceCallIsBeingServiced') {
          this.serviceCalls.open[id] = { id, seatId, state: type === 'ServiceCallStarted' ? 'called' : 'servicing', since: this.serviceCalls.open[id]?.since ?? at };
        } else {
          delete this.serviceCalls.open[id];
          this.serviceCalls.done = [{ id, seatId, state: type === 'ServiceCallHandled' ? 'handled' : 'canceled', at }, ...this.serviceCalls.done].slice(0, DONE_CALLS);
        }
        changed.add('serviceCalls');
        summary = this.seats[seatId]?.name ?? `seat ${seatId}`;
        break;
      }

      case 'ChannelTestStarted':
      case 'ChannelTestStopped':
        this.channelTest = { running: type.endsWith('Started'), at };
        changed.add('micTest');
        break;
      case 'MicrophoneTestStarted':
      case 'MicrophoneTestEnded':
      case 'MicrophoneTestCanceled':
      case 'MicrophoneTestFailed': {
        const STATES = { MicrophoneTestStarted: 'running', MicrophoneTestEnded: 'ended', MicrophoneTestCanceled: 'canceled', MicrophoneTestFailed: 'failed' };
        const results = items(child(root, 'MicrophoneTestResults'), 'MicrophoneTestResult').map(r => {
          // <Seat><SeatContainer Id/>…</Seat> (manual example) or <Seat Id/> directly
          const seatIds = items(r, 'Seat').flatMap(s => (int(s, 'Id') !== undefined ? [s] : items(s, 'Seat'))).map(s => this.#seat(s, changed));
          return { passed: Boolean(bool(r, 'Passed')), seatIds };
        });
        this.micTest = { state: STATES[type], at, results: type === 'MicrophoneTestEnded' ? results : type === 'MicrophoneTestStarted' ? [] : this.micTest.results };
        changed.add('micTest');
        break;
      }

      default:
        this.stats.unknown += 1;
        summary = 'not handled by LikeABosch';
    }

    this.log = [{ at, topic, type, summary }, ...this.log].slice(0, LOG_SIZE);
    return changed;
  }

  #endMeeting(changed) {
    this.meeting = null;
    this.session = { id: null, state: null };
    this.sessions = {};
    this.votings = {};
    this.voting = { id: null, state: 'closed', since: null };
    this.discussion = { id: null, activeMicrophones: null, requests: [], responses: [], active: [], activeResponses: [], specialEquipment: [], activeGroups: [] };
    this.priority = [];
    for (const s of Object.values(this.seats)) if (s.microphoneActive) this.seats[s.id] = { ...s, microphoneActive: false };
    ['meeting', 'discussion', 'voting', 'seats'].forEach(c => changed.add(c));
  }

  #name(id) {
    const p = this.participants[id];
    return p ? [p.title, p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || `participant ${id}` : `participant ${id}`;
  }

  // ------------------------------------------------------------------ views for the cache topics + persistence

  /** @param {string} section */
  view(section) {
    switch (section) {
      case 'system': return { ...this.system, ...this.stats };
      case 'meeting': return {
        meeting: this.meeting,
        session: this.session,
        sessions: Object.values(this.sessions),
      };
      case 'discussion': return { ...this.discussion, priority: this.priority };
      case 'seats': return Object.values(this.seats).sort((a, b) => a.id - b.id);
      case 'participants': return Object.values(this.participants).sort((a, b) => a.id - b.id);
      case 'voting': return { ...this.voting, current: this.votings[this.voting.id] ?? null, votings: Object.values(this.votings) };
      case 'serviceCalls': return { open: Object.values(this.serviceCalls.open), done: this.serviceCalls.done };
      case 'interpretation': return { desks: Object.values(this.desks).sort((a, b) => a.number - b.number), booths: Object.values(this.booths).sort((a, b) => a.number - b.number) };
      case 'micTest': return { ...this.micTest, channelTest: this.channelTest };
      case 'log': return this.log;
      default: return undefined;
    }
  }

  toJSON() {
    const { system, meeting, sessions, session, discussion, seats, participants, priority, votings, voting, serviceCalls, desks, booths, micTest, channelTest, log, stats } = this;
    return { version: 1, savedAt: new Date().toISOString(), system, meeting, sessions, session, discussion, seats, participants, priority, votings, voting, serviceCalls, desks, booths, micTest, channelTest, log, stats };
  }

  /** @param {any} json */
  static fromJSON(json) {
    const s = new SmdState();
    if (json?.version !== 1) return s;
    for (const k of Object.keys(s)) if (k in json) s[k] = json[k];
    return s;
  }
}
