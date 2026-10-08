// Simulated DCN-SW server behind the mock dcn-bridge (WO-060). Implements the documented semantics of the DCN-SW API
// (docs/protocol/dcn-swapi) closely enough for the adapter, the domain layer and the UI. Not verified against a real
// system: where the CHM is silent the choices are marked ASSUMPTION (see mock/dcn/README.md).
import { EventEmitter } from 'node:events';
import { loadDcnSpec } from '../../backend/src/dcn/spec.js';

/** DCN-SW API constants as the bridge reports them in `hello.constants`: the real values, read from the DLLs (WO-068). */
export const MOCK_CONSTANTS = Object.fromEntries(Object.entries(loadDcnSpec().types)
  .flatMap(([type, t]) => (t.fields ?? []).filter(f => f.constant && f.value !== undefined).map(f => [`${type}.${f.name}`, f.value])));

const DEFAULT_AREA = MOCK_CONSTANTS['SEAT_ASSIGNMENT.DEFAULT_AREA']; // 1 on the real DLLs
const NO_SEAT = MOCK_CONSTANTS['PARTICIPATION_INFO.NO_SEAT'];
const MAX_VOLUME = 30; // ASSUMPTION: range not documented

const ANSWERS = { 1: ['Yes', 'No'], 2: ['Yes', 'No', 'Abstain'], 3: ['Yes', 'No', 'Abstain', 'Dnpv'], 4: ['--', '-', '0', '+', '++'], 5: ['1', '2', '3', '4', '5'] };
const ANSWERSET_BY_NAME = { ParliamentaryYesNo: 1, ParliamentaryYesNoAbstain: 2, ParliamentaryYesNoAbstainDnpv: 3, AudienceResponse: 4, OpinionPoll: 5 };

const R = (returns = 'NONE', out = {}) => ({ returns, out });
const ids = list => list.map(x => x.id);
const strip = ({ id, ...rest }) => rest;

/**
 * Events: `event` (api, event, args).
 */
export class DcnSwSimulation extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.seats]          default 20 (seat 1 = chairman)
   * @param {boolean} [opts.meetingActive] start with meeting 1 / session 11 running (default true)
   */
  constructor({ seats = 20, meetingActive = true } = {}) {
    super();
    this.seats = Array.from({ length: seats }, (_, i) => ({ id: i + 1, name: i === 0 ? 'Chairman' : `Seat ${i + 1}` }));
    const names = [['Anna', 'Novak'], ['Ben', 'Okafor'], ['Clara', 'Ruiz'], ['David', 'Kim'], ['Eva', 'Lindqvist'],
      ['Farid', 'Haddad'], ['Grace', 'Moreau'], ['Hiro', 'Tanaka'], ['Ines', 'Costa'], ['Jan', 'Kowalski']];
    this.delegates = names.map(([FirstName, LastName], i) => ({
      id: 101 + i, Title: i === 0 ? 'Chair' : '', FirstName, MiddleName: '', LastName, Country: '', Region: '',
      PinCode: 1111, MeetingGroupId: 0, DisplayLanguageId: 1, NativeLanguageId: 0, SpokenLanguageId: 0,
    }));
    this.cards = new Map();
    this.meetings = [{ id: 1, Title: 'Council meeting', Description: 'Monthly council meeting' }, { id: 2, Title: 'Budget committee', Description: '' }];
    this.sessions = new Map([[1, [{ id: 11, Subject: 'Morning session', Description: '' }, { id: 12, Subject: 'Afternoon session', Description: '' }]], [2, [{ id: 21, Subject: 'Session 1', Description: '' }]]]);
    /** meetingId → Map<delegateId, PARTICIPATION_INFO> */
    this.registrations = new Map([[1, new Map(this.delegates.map((d, i) => [d.id, { AssignedSeatId: i + 1, Rights: 7, VoteWeight: 1 }]))], [2, new Map()]]);
    this.voteTemplates = [{ id: 1, Name: 'Default', Description: 'Simple majority' }];
    this.votes = new Map([[11, [
      { id: 1001, VotingNumber: '1', VotingName: 'Agenda', Subject: 'Approve the agenda', DocumentationURL: '', VoteAnswerSet: 2, VoteTemplateId: 1 },
      { id: 1002, VotingNumber: '2', VotingName: 'Minutes', Subject: 'Approve the minutes', DocumentationURL: '', VoteAnswerSet: 3, VoteTemplateId: 1 },
    ]], [12, []], [21, []]]);
    this.languages = [{ id: 1, Name: 'English', Abbreviation: 'EN', ShortName: 'Eng', IsUserDefined: false }, { id: 2, Name: 'Deutsch', Abbreviation: 'DE', ShortName: 'Deu', IsUserDefined: false }];
    this.channels = ['Floor', 'Interpretation', 'Interpretation', 'Unassigned'];
    this.nextId = 5000;
    this.activeMeetingId = meetingActive ? 1 : null;
    this.activeSessionId = meetingActive ? 11 : null;
    this.volume = 15;
    this.mute = false;
    this.discussion = {
      MicControlMode: 0, AllowCancelRequest: true, AllowMicrophoneOff: true, AmbientMicrophone: false, AttentionTone: 0,
      AutomaticMicrophoneOff: false, CancelAllSpeakersAndRequests: false, ChairmanMicrosOnCount: 0, LedFollowsMicLed: false,
      MaximumNumberOfRequestToRespond: 5, MaximumNumberOfRequests: 10, MicrophonesOffAfterShift: false, NumberOfOpenMicrophones: 4,
      ShowLastMinuteOnDelegateUnits: false,
    };
    this.#resetDiscussion();
    this.voting = null; // { id, state: 'selected'|'running'|'hold', answers, votes: Map<seat, answer> }
    this.calls = [];
    this.handlers = this.#handlers();
  }

  #resetDiscussion() {
    this.speakers = []; // seat ids, in order
    this.requests = [];
    this.respond = [];
    this.requestsToRespond = [];
    this.prio = new Set();
  }

  #emit(api, event, args = {}) { this.emit('event', api, event, args); }

  // ------------------------------------------------------------------ helpers

  get meetingRunning() { return this.activeMeetingId !== null; }

  /** participantId wins over seatId (CHM remark); 0 = unknown. → seat id or an API_ERROR name */
  #resolveSeat(participantId, seatId) {
    if (participantId) {
      const reg = this.registrations.get(this.activeMeetingId)?.get(participantId);
      if (!this.delegates.some(d => d.id === participantId)) return 'INVALID_PARAMETER';
      if (!reg) return 'INVALID_PARTICIPANT_FOR_MEETING';
      if (!reg.AssignedSeatId) return 'PARTICIPANT_NOT_ASSIGNED';
      return reg.AssignedSeatId;
    }
    return this.seats.some(s => s.id === seatId) ? seatId : 'INVALID_PARAMETER';
  }

  #delegateAt(seatId) {
    for (const [id, p] of this.registrations.get(this.activeMeetingId) ?? []) if (p.AssignedSeatId === seatId) return id;
    return 0;
  }

  /** PARTICIPANT struct for a seat in a discussion list */
  #participant(seatId, list) {
    return {
      SeatId: seatId, ParticipantId: this.#delegateAt(seatId), IsSpeaking: list === 'speakers', IsNextToSpeak: list === 'requests' && this.requests[0] === seatId,
      IsInterrupted: false, SpeechTimeLimitInMillis: 0, IndividualSpeechTimeLimitInMillis: 0, GroupSpeechTimeLimitInMillis: 0,
    };
  }

  #list(name) { return this[name].map(s => this.#participant(s, name)); }

  #listsChanged(...names) {
    const ev = { speakers: 'SpeakersListUpdated', requests: 'RequestToSpeakListUpdated', respond: 'RespondListUpdated', requestsToRespond: 'RequestToRespondListUpdated' };
    for (const n of names) this.#emit('control.DiscussionApi', ev[n], { ParticiantInfo: this.#list(n) });
  }

  #micOn(seatId) {
    if (this.speakers.includes(seatId)) return;
    if (this.speakers.length >= this.discussion.NumberOfOpenMicrophones) {
      const out = this.speakers.shift(); // ASSUMPTION: FIFO override when the speakers list is full
      this.#emit('control.DiscussionApi', 'MicOff', { ParticiantInfo: [this.#participant(out, 'speakers')] });
    }
    this.speakers.push(seatId);
    const wasRequest = this.requests.includes(seatId);
    this.requests = this.requests.filter(s => s !== seatId);
    this.#emit('control.DiscussionApi', 'MicOn', { ParticiantInfo: [this.#participant(seatId, 'speakers')] });
    this.#listsChanged('speakers', ...(wasRequest ? ['requests'] : []));
  }

  #micOff(seatId) {
    if (!this.speakers.includes(seatId)) return;
    this.speakers = this.speakers.filter(s => s !== seatId);
    this.#emit('control.DiscussionApi', 'MicOff', { ParticiantInfo: [this.#participant(seatId, 'speakers')] });
    this.#listsChanged('speakers');
  }

  /** Common guard + seat resolution for discussion calls. */
  #seatCall(args, fn) {
    if (!this.meetingRunning) return R('NOT_ACTIVE');
    const seat = this.#resolveSeat(args.participantId ?? 0, args.seatId ?? 0);
    if (typeof seat === 'string') return R(seat);
    return fn(seat) ?? R();
  }

  #voteInfo(id) {
    for (const list of this.votes.values()) { const v = list.find(x => x.id === id); if (v) return v; }
    return null;
  }

  /**
   * VoteResultEventArgs as in the DLLs (WO-068): ControlEventArgs { ConfigId, ServiceId } + TotalResults
   * { PresentCount, NotVotedCount, Answers: [{ AnswerId, CastCount }] }. ASSUMPTION: ConfigId = voting id,
   * AnswerId = 1-based position in the answer set.
   */
  #results() {
    const v = this.voting;
    const present = (this.registrations.get(this.activeMeetingId)?.size ?? 0);
    return {
      ConfigId: v.id, ServiceId: 0,
      TotalResults: {
        PresentCount: present, NotVotedCount: present - v.votes.size,
        Answers: v.answers.map((a, i) => ({ AnswerId: i + 1, CastCount: [...v.votes.values()].filter(x => x === a).length })),
      },
    };
  }

  #stopAll() {
    if (this.voting) this.voting = null;
    const hadSpeakers = this.speakers.length || this.requests.length;
    this.#resetDiscussion();
    if (hadSpeakers) this.#listsChanged('speakers', 'requests', 'respond', 'requestsToRespond');
  }

  // ------------------------------------------------------------------ test/dev helpers (also used by `npm run mock:dcn`)

  /** A delegate presses the request button. */
  requestToSpeak(seatId) {
    if (!this.meetingRunning || this.requests.includes(seatId) || this.speakers.includes(seatId)) return;
    this.requests.push(seatId);
    this.#listsChanged('requests');
  }

  /** A delegate presses the mic button (speaks directly, as in open mode). */
  pressMic(seatId) { if (this.meetingRunning) { if (this.speakers.includes(seatId)) this.#micOff(seatId); else this.#micOn(seatId); } }

  /** A delegate votes during a running voting. */
  castVote(seatId, answer) {
    const v = this.voting;
    if (!v || v.state !== 'running' || !v.answers.includes(answer)) return false;
    v.votes.set(seatId, answer);
    this.#emit('control.VoteApi', 'VotingQuorumUpdated', this.#results());
    return true;
  }

  // ------------------------------------------------------------------ method handlers

  /** @returns {Record<string, (args: any) => { returns: string, out: object }>} */
  #handlers() {
    const disc = 'control.DiscussionApi.';
    const meet = 'control.MeetingApi.';
    const vote = 'control.VoteApi.';
    const notActive = fn => args => (this.meetingRunning ? fn(args) : R('NOT_ACTIVE'));
    return {
      // DcnSystemApi
      'control.DcnSystemApi.GetMasterVolume': () => R('NONE', { masterVolume: this.volume }),
      'control.DcnSystemApi.SetMasterVolume': ({ masterVolume }) => {
        if (masterVolume < 0 || masterVolume > MAX_VOLUME) return R('OUT_OF_RANGE');
        if (masterVolume !== this.volume) { this.volume = masterVolume; this.#emit('control.DcnSystemApi', 'masterVolumeChange', { Count: masterVolume }); }
        return R();
      },
      'control.DcnSystemApi.GetMasterMute': () => R('NONE', { masterMute: this.mute }),
      'control.DcnSystemApi.SetMasterMute': ({ masterMute }) => {
        if (masterMute !== this.mute) { this.mute = masterMute; this.#emit('control.DcnSystemApi', 'masterMuteChange', { OnOff: masterMute }); }
        return R();
      },

      // DiscussionApi
      [`${disc}RetrieveSpeakersList`]: notActive(() => R('NONE', { participants: this.#list('speakers') })),
      [`${disc}RetrieveRequestToSpeakList`]: notActive(() => R('NONE', { participants: this.#list('requests') })),
      [`${disc}RetrieveRespondList`]: notActive(() => R('NONE', { participants: this.#list('respond') })),
      [`${disc}RetrieveRequestToRespondList`]: notActive(() => R('NONE', { participants: this.#list('requestsToRespond') })),
      [`${disc}RetrieveNotebookersList`]: notActive(() => R('NONE', { notebookers: [] })),
      [`${disc}RetrieveGroupTimers`]: notActive(() => R('NONE', { sessionGroupTimer: [] })),
      [`${disc}RetrieveMicrophoneStatus`]: notActive(() => R('NONE', {
        seatMicStatus: [
          ...this.speakers.map(s => ({ SeatId: s, MicStatus: 'ON' })),
          ...this.requests.map((s, i) => ({ SeatId: s, MicStatus: i === 0 ? 'FIRST_REQUEST' : 'REQUEST' })),
        ],
      })),
      [`${disc}RetrieveDiscussionSettings`]: notActive(() => R('NONE', { discussionInfo: { ...this.discussion } })),
      [`${disc}SetDiscussionSettings`]: notActive(({ discussionInfo }) => {
        const next = { ...this.discussion, ...discussionInfo, ChairmanMicrosOnCount: this.discussion.ChairmanMicrosOnCount };
        if (next.NumberOfOpenMicrophones < 1 || next.NumberOfOpenMicrophones > 25) return R('INVALID_ACTIVE_MIC_COUNT');
        if (next.MaximumNumberOfRequests < 0 || next.MaximumNumberOfRequests > 100) return R('INVALID_MAX_REQUEST');
        this.discussion = next;
        this.#emit('control.DiscussionApi', 'DiscussionSettingsUpdate', { DiscussionInfo: { Key: 'NumberOfOpenMicrophones', Value: String(next.NumberOfOpenMicrophones) } });
        return R();
      }),
      [`${disc}GetNumberOfActivePrios`]: notActive(() => R('NONE', { keyPrio: this.prio.size, virtualPrio: 0 })),
      [`${disc}SpeakNow`]: args => this.#seatCall(args, seat => { this.#micOn(seat); }),
      [`${disc}StopSpeaking`]: args => this.#seatCall(args, seat => { this.#micOff(seat); }),
      [`${disc}AppendRequestToSpeak`]: args => this.#seatCall(args, seat => {
        if (this.discussion.MaximumNumberOfRequests === 0) return R('REQUEST_QUEUE_NOT_ENABLED');
        if (this.requests.includes(seat) || this.speakers.includes(seat)) return R();
        if (this.requests.length >= this.discussion.MaximumNumberOfRequests) return R('EXCEED_MAX_REQUEST_COUNT');
        this.requests.push(seat);
        this.#listsChanged('requests');
        return R();
      }),
      [`${disc}InsertRequestToSpeak`]: ({ newParticipantId, newSeatId, oldParticipantId, oldSeatId }) => this.#seatCall({ participantId: newParticipantId, seatId: newSeatId }, seat => {
        const before = this.#resolveSeat(oldParticipantId, oldSeatId);
        if (typeof before === 'string') return R(before);
        const i = this.requests.indexOf(before);
        if (i < 0) return R('NOT_IN_REQUEST_LIST');
        this.requests = this.requests.filter(s => s !== seat);
        this.requests.splice(this.requests.indexOf(before), 0, seat);
        this.#listsChanged('requests');
        return R();
      }),
      [`${disc}ReplaceRequestToSpeak`]: ({ participantId, seatId, withParticipantId, withSeatId }) => this.#seatCall({ participantId: withParticipantId, seatId: withSeatId }, withSeat => {
        const seat = this.#resolveSeat(participantId, seatId);
        if (typeof seat === 'string') return R(seat);
        const i = this.requests.indexOf(seat);
        if (i < 0) return R('NOT_IN_REQUEST_LIST');
        this.requests[i] = withSeat;
        this.#listsChanged('requests');
        return R();
      }),
      [`${disc}RemoveRequestToSpeak`]: args => this.#seatCall(args, seat => {
        if (!this.requests.includes(seat)) return R();
        this.requests = this.requests.filter(s => s !== seat);
        this.#listsChanged('requests');
        return R();
      }),
      [`${disc}RemoveRequestToRespond`]: args => this.#seatCall(args, seat => {
        this.requestsToRespond = this.requestsToRespond.filter(s => s !== seat);
        this.#listsChanged('requestsToRespond');
        return R();
      }),
      [`${disc}RemoveAllRequests`]: notActive(() => { this.requests = []; this.requestsToRespond = []; this.#listsChanged('requests', 'requestsToRespond'); return R(); }),
      [`${disc}CancelAll`]: notActive(() => {
        for (const s of [...this.speakers]) this.#micOff(s);
        this.requests = []; this.respond = []; this.requestsToRespond = [];
        this.#listsChanged('requests', 'respond', 'requestsToRespond');
        return R();
      }),
      [`${disc}Shift`]: args => this.#seatCall(args, seat => {
        if (!this.requests.includes(seat)) return R('NOT_IN_REQUEST_LIST');
        if (this.discussion.MicrophonesOffAfterShift) for (const s of [...this.speakers]) this.#micOff(s);
        this.#micOn(seat);
        return R();
      }),
      [`${disc}SetChairmanPriority`]: ({ participantId, seatId, priorityStatus }) => this.#seatCall({ participantId, seatId }, seat => {
        if (priorityStatus) {
          this.prio.add(seat);
          if (this.discussion.CancelAllSpeakersAndRequests) {
            for (const s of this.speakers.filter(x => x !== seat)) this.#micOff(s);
            this.requests = [];
            this.#listsChanged('requests');
          }
          this.#micOn(seat);
        } else {
          this.prio.delete(seat);
          this.#micOff(seat);
        }
        this.#emit('control.DiscussionApi', 'ChairmanPriorityListUpdated', { Keyprio: this.prio.size, Virtualkeyprio: 0 });
        return R();
      }),

      // MeetingApi (control)
      [`${meet}RetrieveActiveMeetingId`]: () => (this.meetingRunning ? R('NONE', { meetingId: this.activeMeetingId }) : R('NOT_ACTIVE', { meetingId: 0 })),
      [`${meet}RetrieveActiveSessionId`]: () => (this.activeSessionId ? R('NONE', { sessionId: this.activeSessionId }) : R('NOT_ACTIVE', { sessionId: 0 })),
      [`${meet}RetrieveDelegatesForActiveMeeting`]: notActive(() => R('NONE', { delegates: [...(this.registrations.get(this.activeMeetingId)?.keys() ?? [])].map(DelegateId => ({ DelegateId })) })),
      [`${meet}StartMeetingById`]: ({ meetingId }) => {
        if (!this.meetings.some(m => m.id === meetingId)) return R('UNKNOWN_MEETING');
        if (this.meetingRunning) return R('ALREADY_ACTIVE');
        this.activeMeetingId = meetingId;
        this.#emit('control.MeetingApi', 'MeetingStart', {});
        return R();
      },
      [`${meet}StopMeetingById`]: ({ meetingId }) => {
        if (this.activeMeetingId !== meetingId) return R('NOT_ACTIVE');
        if (this.activeSessionId) { this.activeSessionId = null; this.#emit('control.MeetingApi', 'SessionStop', {}); }
        this.#stopAll();
        this.activeMeetingId = null;
        this.#emit('control.MeetingApi', 'MeetingStop', {});
        return R();
      },
      [`${meet}StartSessionById`]: ({ sessionId }) => {
        if (!this.meetingRunning) return R('NOT_ACTIVE');
        if (!(this.sessions.get(this.activeMeetingId) ?? []).some(s => s.id === sessionId)) return R('UNKNOWN_SESSION');
        if (this.activeSessionId) return R('ALREADY_ACTIVE');
        this.activeSessionId = sessionId;
        this.#emit('control.MeetingApi', 'SessionStart', {});
        return R();
      },
      [`${meet}StopSessionById`]: ({ sessionId }) => {
        if (this.activeSessionId !== sessionId) return R('NOT_ACTIVE');
        this.voting = null;
        this.activeSessionId = null;
        this.#emit('control.MeetingApi', 'SessionStop', {});
        return R();
      },
      [`${meet}InsertCard`]: notActive(({ seatId }) => (this.seats.some(s => s.id === seatId) ? R() : R('INVALID_SEAT_ID'))),

      // VoteApi (control)
      [`${vote}RetrieveActiveVotingId`]: () => (this.voting ? R('NONE', { votingId: this.voting.id }) : R('NOT_ACTIVE', { votingId: 0 })),
      [`${vote}RetrieveVotingsForActiveSession`]: () => (this.activeSessionId ? R('NONE', { votingIds: ids(this.votes.get(this.activeSessionId) ?? []) }) : R('NOT_ACTIVE', { votingIds: [] })),
      [`${vote}SelectVotingById`]: ({ votingId }) => {
        if (!this.activeSessionId) return R('NOT_ACTIVE');
        if (this.voting && this.voting.state !== 'selected') return R('ALREADY_ACTIVE');
        const v = (this.votes.get(this.activeSessionId) ?? []).find(x => x.id === votingId);
        if (!v) return R('UNKNOWN_VOTING');
        this.voting = { id: votingId, state: 'selected', answers: ANSWERS[v.VoteAnswerSet] ?? ANSWERS[1], votes: new Map() };
        this.#emit('control.VoteApi', 'VotingSelect', { ConfigId: votingId, ServiceId: 0 });
        return R();
      },
      [`${vote}StartVotingById`]: ({ votingId }) => {
        if (!this.activeSessionId) return R('NOT_ACTIVE');
        if (this.voting && this.voting.state !== 'selected') return R('ALREADY_ACTIVE');
        const v = (this.votes.get(this.activeSessionId) ?? []).find(x => x.id === votingId);
        if (!v) return R('UNKNOWN_VOTING');
        this.voting = { id: votingId, state: 'running', answers: ANSWERS[v.VoteAnswerSet] ?? ANSWERS[1], votes: new Map() };
        this.#emit('control.VoteApi', 'VotingStart', { ConfigId: votingId, ServiceId: 0 });
        return R();
      },
      [`${vote}StartAdhocVoting`]: ({ votingSettings }) => {
        if (!this.meetingRunning) return R('NOT_ACTIVE');
        if (this.voting && this.voting.state !== 'selected') return R('ALREADY_ACTIVE');
        const set = ANSWERSET_BY_NAME[votingSettings.AnswerSet] ?? votingSettings.AnswerSet;
        if (!ANSWERS[set]) return R('INVALID_PARAMETER');
        const id = this.nextId++;
        this.adhoc = { id, VotingNumber: votingSettings.VotingNumber ?? '', VotingName: votingSettings.VotingName ?? '', Subject: votingSettings.Subject ?? '', VoteAnswerSet: set };
        this.voting = { id, state: 'running', answers: ANSWERS[set], votes: new Map() };
        this.#emit('control.VoteApi', 'VotingStart', { ConfigId: id, ServiceId: 0 });
        return R();
      },
      [`${vote}HoldVoting`]: () => {
        if (!this.voting || this.voting.state === 'selected') return R('NOT_ACTIVE');
        if (this.voting.state === 'hold') return R('ON_HOLD');
        this.voting.state = 'hold';
        this.#emit('control.VoteApi', 'VotingHold', { ConfigId: this.voting.id, ServiceId: 0 });
        return R();
      },
      [`${vote}ContinueVoting`]: () => {
        if (!this.voting || this.voting.state !== 'hold') return R('NOT_ON_HOLD');
        this.voting.state = 'running';
        this.#emit('control.VoteApi', 'VotingContinue', { ConfigId: this.voting.id, ServiceId: 0 });
        return R();
      },
      [`${vote}StopVoting`]: () => {
        if (!this.voting || this.voting.state === 'selected') return R('NOT_ACTIVE');
        const results = this.#results();
        const count = label => results.TotalResults.Answers[this.voting.answers.indexOf(label)]?.CastCount ?? 0;
        const yes = count('Yes');
        const no = count('No');
        this.voting = null;
        this.#emit('control.VoteApi', 'VoteResults', results);
        this.#emit('control.VoteApi', 'VotingStop', { ConfigId: results.ConfigId, ServiceId: 0 });
        this.#emit('control.VoteApi', yes > no ? 'VotingAccepted' : 'VotingRejected', {});
        return R();
      },
      [`${vote}SummonVoting`]: () => (this.voting ? R() : R('NOT_ACTIVE')),

      // DelegateApi (config)
      'config.DelegateApi.RetrieveDelegates': () => R('NONE', { delegateIds: ids(this.delegates), delegates: this.delegates.map(strip) }),
      'config.DelegateApi.RetrieveDelegatesById': ({ delegateIds }) => {
        const found = delegateIds.map(id => this.delegates.find(d => d.id === id));
        return found.includes(undefined) ? R('RETRIEVE_FAILED') : R('NONE', { delegates: found.map(strip) });
      },
      'config.DelegateApi.StoreDelegates': ({ delegates }) => {
        const added = delegates.map(d => ({ id: this.nextId++, ...d }));
        this.delegates.push(...added);
        this.#emit('config.DelegateApi', 'DelegateStore', { ConfigIds: ids(added) });
        return R('NONE', { delegateIds: ids(added) });
      },
      'config.DelegateApi.UpdateDelegates': ({ delegateIds, delegates }) => {
        if (delegateIds.length !== delegates.length || delegateIds.some(id => !this.delegates.some(d => d.id === id))) return R('UPDATE_FAILED');
        delegateIds.forEach((id, i) => Object.assign(this.delegates.find(d => d.id === id), delegates[i]));
        this.#emit('config.DelegateApi', 'DelegateUpdate', { ConfigIds: delegateIds });
        return R();
      },
      'config.DelegateApi.DeleteDelegates': ({ delegateIds }) => {
        if (delegateIds.some(id => !this.delegates.some(d => d.id === id))) return R('DELETE_FAILED');
        this.delegates = this.delegates.filter(d => !delegateIds.includes(d.id));
        for (const reg of this.registrations.values()) for (const id of delegateIds) reg.delete(id);
        this.#emit('config.DelegateApi', 'DelegateDeletion', { ConfigIds: delegateIds });
        return R();
      },
      'config.DelegateApi.RetrieveRegisteredDelegatesForMeeting': ({ meetingId }) => {
        const reg = this.registrations.get(meetingId);
        if (!reg) return R('UNKNOWN_MEETING');
        return R('NONE', { delegateIds: [...reg.keys()], participation: [...reg.values()].map(p => ({ ...p })) });
      },
      'config.DelegateApi.RegisterDelegatesForMeeting': ({ meetingId, delegateIds, participation }) => this.#register(meetingId, delegateIds, participation, 'DelegateRegistration'),
      'config.DelegateApi.UpdateRegistrationForDelegates': ({ meetingId, delegateIds, participation }) => this.#register(meetingId, delegateIds, participation, 'DelegateRegistrationUpdate'),
      'config.DelegateApi.UnregisterDelegatesForMeeting': ({ meetingId, delegateIds }) => {
        const reg = this.registrations.get(meetingId);
        if (!reg) return R('UNKNOWN_MEETING');
        delegateIds.forEach(id => reg.delete(id));
        this.#emit('config.DelegateApi', 'DelegateUnregistration', { ConfigIds: delegateIds, MeetingIds: [meetingId] });
        return R();
      },
      'config.DelegateApi.RetrieveSeatAssignmentForArea': ({ meetingId, areaId }) => {
        const reg = this.registrations.get(meetingId);
        if (!reg) return R('UNKNOWN_MEETING');
        if (areaId !== DEFAULT_AREA) return R('INVALID_PARAMETER'); // CHM: only DEFAULT_AREA is supported
        const byseat = new Map([...reg].map(([id, p]) => [p.AssignedSeatId, id]));
        return R('NONE', { assignments: this.seats.map(s => ({ SeatId: s.id, SeatName: s.name, DelegateId: byseat.get(s.id) ?? 0 })) });
      },
      'config.DelegateApi.AssignDelegateIdCards': ({ delegateIds, cardCodes }) => {
        if (delegateIds.length !== cardCodes.length) return R('ASSIGNMENT_FAILED');
        delegateIds.forEach((id, i) => this.cards.set(id, cardCodes[i]));
        this.#emit('config.DelegateApi', 'DelegateUpdate', { ConfigIds: delegateIds });
        return R();
      },
      'config.DelegateApi.RetrieveDelegateIdCardAssignments': ({ delegateIds }) => R('NONE', { cardCodes: delegateIds.map(id => this.cards.get(id) ?? 0) }),
      'config.DelegateApi.ReadCard': () => R('NO_CARD_DEVICE', { cardCode: 0, delegateId: 0 }),
      'config.DelegateApi.ProduceCardForDelegate': () => R('NO_CARD_DEVICE'),
      'config.DelegateApi.AddRequestToSpeak': ({ sessionId, delegateId }) => {
        if (sessionId !== this.activeSessionId) return R('UNKNOWN_SESSION');
        const seat = this.#resolveSeat(delegateId, 0);
        if (typeof seat === 'string') return R(seat);
        this.requestToSpeak(seat);
        return R();
      },
      'config.DelegateApi.RemoveRequestToSpeak': ({ sessionId, delegateId }) => {
        if (sessionId !== this.activeSessionId) return R('UNKNOWN_SESSION');
        const seat = this.#resolveSeat(delegateId, 0);
        if (typeof seat === 'string') return R(seat);
        this.requests = this.requests.filter(s => s !== seat);
        this.#listsChanged('requests');
        return R();
      },
      'config.DelegateApi.RemoveAllRequestToSpeak': ({ sessionId }) => {
        if (sessionId !== this.activeSessionId) return R('UNKNOWN_SESSION');
        this.requests = [];
        this.#listsChanged('requests');
        return R();
      },

      // MeetingApi (config)
      'config.MeetingApi.RetrieveMeetings': () => R('NONE', { meetingIds: ids(this.meetings), meetings: this.meetings.map(strip) }),
      'config.MeetingApi.RetrieveMeetingsById': ({ meetingIds }) => {
        const found = meetingIds.map(id => this.meetings.find(m => m.id === id));
        return found.includes(undefined) ? R('UNKNOWN_MEETING') : R('NONE', { meetings: found.map(strip) });
      },
      'config.MeetingApi.RetrieveMeetingSessions': ({ meetingId }) => {
        const list = this.sessions.get(meetingId);
        return list ? R('NONE', { sessionIds: ids(list), sessions: list.map(strip) }) : R('UNKNOWN_MEETING');
      },
      'config.MeetingApi.RetrieveSessionsById': ({ sessionIds }) => {
        const all = [...this.sessions.values()].flat();
        const found = sessionIds.map(id => all.find(s => s.id === id));
        return found.includes(undefined) ? R('UNKNOWN_SESSION') : R('NONE', { sessions: found.map(strip) });
      },
      'config.MeetingApi.AddSessionsToMeeting': ({ meetingId, sessions }) => {
        const list = this.sessions.get(meetingId);
        if (!list) return R('UNKNOWN_MEETING');
        const added = sessions.map(s => ({ id: this.nextId++, Subject: '', Description: '', ...s }));
        list.push(...added);
        added.forEach(s => this.votes.set(s.id, []));
        this.#emit('config.MeetingApi', 'SessionStore', { ConfigIds: ids(added), MeetingIds: [meetingId] });
        return R('NONE', { sessionIds: ids(added) });
      },
      'config.MeetingApi.UpdateMeetingTitle': ({ meetingId, newMeetingTitle }) => {
        const m = this.meetings.find(x => x.id === meetingId);
        if (!m) return R('UNKNOWN_MEETING');
        m.Title = newMeetingTitle;
        this.#emit('config.MeetingApi', 'MeetingUpdate', { ConfigIds: [meetingId] });
        return R();
      },
      'config.MeetingApi.UpdateSessionTitle': ({ sessionId, newSessionTitle }) => {
        const s = [...this.sessions.values()].flat().find(x => x.id === sessionId);
        if (!s) return R('UNKNOWN_SESSION');
        s.Subject = newSessionTitle;
        this.#emit('config.MeetingApi', 'SessionUpdate', { ConfigIds: [sessionId], MeetingIds: [...this.sessions].filter(([, l]) => l.includes(s)).map(([k]) => k) });
        return R();
      },

      // VoteApi (config)
      'config.VoteApi.RetrieveVoteTemplates': () => R('NONE', { voteTemplatedIds: ids(this.voteTemplates), voteTemplates: this.voteTemplates.map(strip) }),
      'config.VoteApi.RetrieveVotingScript': ({ sessionId }) => {
        const list = this.votes.get(sessionId);
        return list ? R('NONE', { voteIds: ids(list), votes: list.map(strip) }) : R('UNKNOWN_SESSION');
      },
      'config.VoteApi.RetrieveVotesById': ({ voteIds }) => {
        const found = voteIds.map(id => this.#voteInfo(id));
        return found.includes(null) ? R('UNKNOWN_VOTING') : R('NONE', { votes: found.map(strip) });
      },
      'config.VoteApi.StoreVotesInVotingScript': ({ sessionId, votes }) => {
        const list = this.votes.get(sessionId);
        if (!list) return R('UNKNOWN_SESSION');
        const added = votes.map(v => ({ id: this.nextId++, VotingNumber: '', VotingName: '', Subject: '', DocumentationURL: '', VoteAnswerSet: 1, VoteTemplateId: 1, ...v }));
        list.push(...added);
        this.#emit('config.VoteApi', 'VoteStore', { ConfigIds: ids(added), SessionIds: [sessionId] });
        return R('NONE', { voteIds: ids(added) });
      },
      'config.VoteApi.UpdateVotes': ({ voteIds, votes }) => {
        if (voteIds.length !== votes.length || voteIds.some(id => !this.#voteInfo(id))) return R('UPDATE_FAILED');
        voteIds.forEach((id, i) => Object.assign(this.#voteInfo(id), votes[i]));
        this.#emit('config.VoteApi', 'VoteUpdate', { ConfigIds: voteIds, SessionIds: [] });
        return R();
      },
      'config.VoteApi.DeleteVotes': ({ voteIds }) => {
        for (const [k, list] of this.votes) this.votes.set(k, list.filter(v => !voteIds.includes(v.id)));
        this.#emit('config.VoteApi', 'VoteDeletion', { ConfigIds: voteIds, SessionIds: [] });
        return R();
      },

      // LanguageApi, SystemApi (config)
      'config.LanguageApi.RetrieveInterpretationLanguages': () => R('NONE', { interpretationLanguageIds: ids(this.languages), languages: this.languages.map(strip) }),
      'config.SystemApi.RetrieveChannelDefinition': () => R('NONE', { channelDefinition: [...this.channels] }),
    };
  }

  #register(meetingId, delegateIds, participation, event) {
    const reg = this.registrations.get(meetingId);
    if (!reg) return R('UNKNOWN_MEETING');
    if (delegateIds.length !== participation.length || delegateIds.some(id => !this.delegates.some(d => d.id === id))) return R('REGISTRATION_FAILED');
    delegateIds.forEach((id, i) => reg.set(id, { AssignedSeatId: NO_SEAT, Rights: 7, VoteWeight: 1, ...reg.get(id), ...participation[i] }));
    this.#emit('config.DelegateApi', event, { ConfigIds: delegateIds, MeetingIds: [meetingId] });
    return R();
  }

  /**
   * Execute a call. Methods without a handler return NONE with default out values from the spec.
   * @param {ReturnType<import('../../backend/src/dcn/spec.js').loadDcnSpec>} spec
   * @param {string} key
   * @param {Record<string, unknown>} args
   */
  call(spec, key, args) {
    this.calls.push({ key, args });
    const handler = this.handlers[key];
    if (handler) return handler(args);
    const m = spec.get(key);
    return R('NONE', Object.fromEntries(m.outParams.map(p => [p.name, defaultValue(spec, p.type)])));
  }
}

function defaultValue(spec, type) {
  if (type.endsWith('[]')) return [];
  if (['int', 'long', 'short', 'byte', 'double'].includes(type)) return 0;
  if (type === 'bool') return false;
  if (type === 'string') return '';
  const t = spec.types[type];
  if (t?.kind === 'enum') return t.values[0].name;
  const ms = spec.members(type);
  return ms ? Object.fromEntries(ms.map(m => [m.name, defaultValue(spec, m.type)])) : null;
}
