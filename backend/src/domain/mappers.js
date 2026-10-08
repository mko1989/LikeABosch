// Pure mappers: raw system topics → unified domain topics (DEC-010, WO-017).
// `get(topic)` returns the raw topic data (or undefined). Every mapper returns undefined when its sources are missing.
// Seat ids are strings in the domain (wired ids are strings; wireless integers are converted).

const SPEAKING = new Set(['isPrioritySpeaker', 'isSpeaker', 'isResponder', 'isImportant']);
const WAITING = new Set(['isRequest', 'isResponseRequest']);
const KIND = { isPrioritySpeaker: 'priority', isSpeaker: 'speaker', isResponder: 'responder', isImportant: 'important', isRequest: 'request', isResponseRequest: 'responseRequest' };
const WIRED_POWER = { poweredOn: 'on', poweredOff: 'off', poweringOn: 'poweringOn', poweringOff: 'poweringOff' };
const WIRELESS_POWER = ['on', 'standby', 'off'];
const WIRELESS_VOTING_STATE = ['closed', 'opened', 'onHold'];
/** Wireless VotingParameters.mode → answers (swagger description). */
export const WIRELESS_MODE_ANSWERS = [
  ['for', 'against'], ['for', 'against', 'abstain'], ['for', 'against', 'abstain', 'dnpv'],
  ['yes', 'no'], ['yes', 'no', 'abstain'], ['yes', 'no', 'abstain', 'dnpv'],
];

// ---------------------------------------------------------------- capabilities

const FEATURES = {
  wired: {
    discussion: true, muteMicrophones: true, requestQueueAdd: false, clearDiscussion: false, priorityCalls: false, speechTimers: true,
    speechTimeAdjust: true, meetings: true, agenda: true, votingPrepared: true, votingAdHoc: true, votingParameters: false, votingAcceptReject: true,
    interpretation: true, files: true, plugins: true, presentation: true, masterVolume: true, illumination: true,
    participantsEdit: false, identificationMode: false, powerStandby: false, seatDiagnostics: false, dcnControl: false, dcnStream: false, meetingControl: true, wapConfig: false,
  },
  // DCN NG via the DCN-SW API (DEC-017, WO-062). Wired-only views stay off until WO-063 gives DCN its own versions.
  dcn: {
    discussion: true, muteMicrophones: false, requestQueueAdd: true, clearDiscussion: true, priorityCalls: true, speechTimers: false,
    speechTimeAdjust: false, meetings: false, agenda: false, votingPrepared: false, votingAdHoc: false, votingParameters: false, votingAcceptReject: false,
    interpretation: false, files: false, plugins: false, presentation: false, masterVolume: false, illumination: false,
    participantsEdit: false, identificationMode: false, powerStandby: false, seatDiagnostics: false, dcnControl: true, dcnStream: false, meetingControl: true, wapConfig: false,
  },
  // DCN Streaming Meeting Data (DEC-018): read-only, so every control feature is off.
  'dcn-smd': {
    discussion: true, muteMicrophones: false, requestQueueAdd: false, clearDiscussion: false, priorityCalls: false, speechTimers: false,
    speechTimeAdjust: false, meetings: false, agenda: false, votingPrepared: false, votingAdHoc: false, votingParameters: false, votingAcceptReject: false,
    interpretation: false, files: false, plugins: false, presentation: false, masterVolume: false, illumination: false,
    participantsEdit: false, identificationMode: false, powerStandby: false, seatDiagnostics: false, dcnControl: false, dcnStream: true, readOnly: true, meetingControl: false, wapConfig: false,
  },
  wireless: {
    discussion: true, muteMicrophones: false, requestQueueAdd: true, clearDiscussion: true, priorityCalls: true, speechTimers: false,
    speechTimeAdjust: false, meetings: false, agenda: false, votingPrepared: false, votingAdHoc: false, votingParameters: true, votingAcceptReject: false,
    interpretation: false, files: false, plugins: false, presentation: false, masterVolume: false, illumination: false,
    participantsEdit: true, identificationMode: true, powerStandby: true, seatDiagnostics: true, dcnControl: false, dcnStream: false, meetingControl: false,
    wapConfig: true, // the WAP web UI's configuration endpoints (DEC-024)
  },
};

/**
 * @param {'wired' | 'wireless' | 'dcn' | 'dcn-smd'} system
 * @param {string[]} permissions  wired permissions; dcn: the true `Is*Allowed` flags (ignored for wireless: the WAP enforces rights)
 */
export function capabilities(system, permissions = []) {
  const features = FEATURES[system] ?? FEATURES.wired;
  if (system === 'dcn-smd') {
    return { system, features, actions: { manageDiscussion: false, muteMicrophones: false, controlVoting: false, powerOn: false, powerOff: false, editParticipants: false, controlMeeting: false } };
  }
  if (system === 'dcn') {
    const has = p => permissions.includes(p);
    return {
      system,
      features,
      actions: {
        manageDiscussion: has('DiscussionApi.IsDiscussStandardControllAllowed'),
        muteMicrophones: false,
        controlVoting: has('VoteApi.IsParliamentaryVotingControlAllowed') || has('VoteApi.IsMultiVotingControlAllowed'),
        powerOn: false,
        powerOff: false,
        editParticipants: false,
        controlMeeting: has('MeetingApi.IsMeetingControlAllowed'),
      },
    };
  }
  const has = p => system === 'wireless' || permissions.includes(p);
  return {
    system,
    features,
    actions: {
      manageDiscussion: features.discussion && has('canManageMeeting'),
      muteMicrophones: features.muteMicrophones && has('canManageMeeting') && has('canDeactivateMicrophone'),
      controlVoting: has('canControlVoting'),
      powerOn: has('canSwitchSystemPowerOn'),
      powerOff: has('canSwitchSystemPowerOff'),
      editParticipants: features.participantsEdit,
      controlMeeting: features.meetingControl && has('canManageMeeting'),
    },
  };
}

// ---------------------------------------------------------------- wired

/** Everything GetSeats says about a seat, for the room's seat panel (WO-047). Raw enum spellings are normalised to camelCase. */
function seatDetails(s) {
  const camel = v => (typeof v === 'string' && v ? v[0].toLowerCase() + v.slice(1) : v ?? null); // 6.50 returns PascalCase
  return {
    status: camel(s.status),
    seatType: camel(s.seatType),
    visType: camel(s.visType),
    supportsSpeaking: typeof s.supportsSpeaking === 'boolean' ? s.supportsSpeaking : null,
    hasVotingLicense: typeof s.hasVotingLicense === 'boolean' ? s.hasVotingLicense : null,
    attributes: s.attributes ?? [],
    assignedParticipantId: s.assignedParticipantId || null,
    seatedParticipantId: s.seatedParticipantId || null,
    devices: (s.devices ?? []).map(d => ({
      id: d.id,
      name: d.name || '',
      type: camel(d.typeOf),
      serial: d.serialNumber || '',
      version: d.version || '',
      state: camel(d.deviceState),
      capabilities: (d.capabilities ?? []).map(camel).filter(c => c !== 'hasNone'),
      foundAtSeat: d.isFoundAtSeat !== false,
      selected: Boolean(d.isSelected),
    })),
  };
}

export const wired = {
  /** Room top bar (WO-072). The built-in "Default" meeting (not in GetMeetings, real 6.50) counts as no meeting. */
  meeting(get) {
    const list = get('meetings')?.meetings;
    if (!list) return undefined;
    const info = get('meetingInfo')?.meetingInfo;
    const active = info && list.some(m => m.meetingId === info.meetingId) ? info : list.find(m => ['activated', 'opened', 'closed'].includes(m.state));
    return {
      meetings: list.map(m => ({ id: m.meetingId, title: m.title || m.meetingId })),
      current: active ? { id: active.meetingId, title: active.title || active.meetingId, state: active.state, running: active.state === 'opened' } : null,
      session: null,
    };
  },
  interpreterDesks: () => undefined, // the room view reads the wired interpreter* topics directly (WO-048)
  seats(get) {
    const seats = get('seats')?.seats;
    if (!seats) return undefined;
    return seats.map(s => ({
      id: s.seatId,
      name: s.seatName || 'Unnamed seat',
      person: s.screenLine && s.screenLine !== s.seatName ? s.screenLine : '',
      connected: String(s.status).toLowerCase() !== 'disconnected',
      canVote: Boolean(s.canVote),
      canPrio: Boolean(s.canPrio),
      remote: String(s.seatType).toLowerCase() === 'remote', // real 6.50 server returns "Local"/"Remote"
      hidden: Boolean(s.hideSeat), // 6.50: seat hidden in the synoptic
      diagnostics: null,
      details: seatDetails(s),
    }));
  },

  discussion(get) {
    const d = get('discussionList');
    if (!d) return undefined;
    const seatName = id => get('seats')?.seats?.find(s => s.seatId === id)?.seatName ?? id;
    const entry = e => ({
      seatId: e.seatId,
      seatName: seatName(e.seatId),
      name: e.screenLine || seatName(e.seatId),
      micState: e.microphoneState,
      priority: e.speakerType === 'isPrioritySpeaker',
      kind: KIND[e.speakerType] ?? e.speakerType,
      timer: { remainingSpeechDuration: e.remainingSpeechDuration, speechStartTime: e.speechStartTime, show: e.showSpeechTimer !== false },
    });
    const list = d.discussionList ?? [];
    return {
      speakers: list.filter(e => SPEAKING.has(e.speakerType)).map(entry),
      requests: list.filter(e => WAITING.has(e.speakerType)).map(e => ({ ...entry(e), first: Boolean(e.isFirst) })),
      referenceTime: d.referenceTime ?? null,
    };
  },

  voting(get) {
    const state = get('votingState')?.votingState;
    if (state === undefined) return undefined;
    const info = get('votingInfo')?.votingInfo;
    return {
      state,
      subject: info?.subject ?? '',
      description: info?.description ?? '',
      reference: info?.referenceNumber ?? '',
      answers: info?.votingAnswers ?? [],
      results: (get('votingResults')?.votingResults ?? []).map(r => ({ answer: r.answer, count: r.count })),
    };
  },

  power(get) {
    const mode = get('systemPowerMode')?.powerMode;
    return mode === undefined ? undefined : { state: WIRED_POWER[mode] ?? mode };
  },

  participants(get) {
    const list = get('participants')?.participants;
    if (!list) return undefined;
    const ps = new Map((get('participantSeats')?.participantSeats ?? []).map(p => [p.participantId, p]));
    const seatName = id => (id ? get('seats')?.seats?.find(s => s.seatId === id)?.seatName ?? id : null);
    return list.map(p => ({
      id: p.participantId,
      name: [p.title, p.firstName, p.middleName, p.lastName].filter(Boolean).join(' '),
      sortName: `${p.lastName ?? ''} ${p.firstName ?? ''}`.trim().toLowerCase(),
      group: p.group || null,
      seat: seatName(ps.get(p.participantId)?.seatedSeatId) ?? seatName(ps.get(p.participantId)?.assignedSeatId),
      assignedSeatId: ps.get(p.participantId)?.assignedSeatId || null,
      seatedSeatId: ps.get(p.participantId)?.seatedSeatId || null,
      userName: p.userName || null, // DICENTIS 6.3+
      screenLine: p.screenLine || null, // DICENTIS 6.3+
      present: Boolean(p.isAuthenticated),
      canVote: Boolean(p.canVote),
      nfc: null,
    }));
  },
};

// ---------------------------------------------------------------- wireless

export const wireless = {
  meeting: () => undefined,
  interpreterDesks: () => undefined,
  seats(get) {
    const seats = get('wirelessSeats');
    if (!seats) return undefined;
    const people = get('wirelessParticipants') ?? [];
    return seats.map(s => ({
      id: String(s.id), name: s.name, person: people.find(p => p.seatId === s.id)?.name ?? '', connected: Boolean(s.connected),
      canVote: Boolean(s.voting), canPrio: Boolean(s.prio), remote: false, hidden: false,
      diagnostics: { batteryHours: s.batteryStatus ?? null, batteryCharges: s.batteryCharges ?? null, signalDbm: s.signalStatus ?? null, rangeTest: s.rangeTest ?? null },
      details: {
        status: s.connected ? 'connected' : 'disconnected', seatType: 'local', visType: null, supportsSpeaking: null, hasVotingLicense: null,
        attributes: [], assignedParticipantId: null, seatedParticipantId: null, devices: [],
      },
    }));
  },

  discussion(get) {
    const speakers = get('wirelessSpeakers');
    const waiting = get('wirelessWaitingList');
    if (!speakers && !waiting) return undefined;
    return {
      speakers: (speakers ?? []).map(e => ({
        seatId: String(e.id), seatName: e.seatName, name: e.name || e.seatName, micState: e.micOn ? 'on' : 'off',
        priority: Boolean(e.prioOn), kind: e.prioOn ? 'priority' : 'speaker', timer: null,
      })),
      requests: (waiting ?? []).map((e, i) => ({
        seatId: String(e.id), seatName: e.seatName, name: e.name || e.seatName, micState: 'off', priority: false, kind: 'request', timer: null, first: i === 0,
      })),
      referenceTime: null,
    };
  },

  voting(get) {
    const st = get('wirelessVotingState')?.state;
    const res = get('wirelessVotingResults');
    if (st === undefined && !res) return undefined;
    const params = get('wirelessVoting');
    const state = WIRELESS_VOTING_STATE[st ?? res?.state] ?? 'closed';
    // Parameters changed during a round only apply to the next one: while open/on hold the results carry the
    // round's own mode and subject (WO-075).
    const round = state !== 'closed' && res ? res : null;
    const mode = round?.mode ?? params?.mode ?? res?.mode;
    return {
      state,
      subject: round?.subject ?? params?.subject ?? res?.subject ?? '',
      description: '',
      reference: '',
      answers: WIRELESS_MODE_ANSWERS[mode] ?? [],
      // The WAP also reports `present` (voters present, not an answer, WO-075): not a result row.
      results: (res?.results ?? []).filter(r => r.name !== 'present').map(r => ({ answer: r.name, count: r.value })),
    };
  },

  power(get) {
    const st = get('wirelessSystemStatus')?.state;
    return st === undefined ? undefined : { state: WIRELESS_POWER[st] ?? String(st) };
  },

  participants(get) {
    const list = get('wirelessParticipants');
    if (!list) return undefined;
    const seats = get('wirelessSeats') ?? [];
    return list.map(p => ({
      id: String(p.id),
      name: p.name,
      sortName: p.name.toLowerCase(),
      group: null,
      seat: p.seatId >= 0 ? seats.find(s => s.id === p.seatId)?.name ?? String(p.seatId) : null,
      assignedSeatId: p.seatId >= 0 ? String(p.seatId) : null,
      seatedSeatId: null,
      userName: null,
      screenLine: null,
      present: null,
      canVote: null,
      nfc: p.nfc || null,
    }));
  },
};

// ---------------------------------------------------------------- dcn (WO-062)
// Raw topics: backend/src/dcn/topics.js (.NET member names). DCN has no seat list: seats are the seat assignment of the
// active meeting plus every seat seen in mic status / discussion lists. Seat and participant ids are ints → strings.

const DCN_ANSWERS = { ANSWERSET_YES_NO: ['Yes', 'No'], ANSWERSET_YES_NO_ABSTAIN: ['Yes', 'No', 'Abstain'], ANSWERSET_YES_NO_ABSTAIN_DNPV: ['Yes', 'No', 'Abstain', 'Dnpv'],
  ANSWERSET_AUDIENCERESPONSE: ['--', '-', '0', '+', '++'], ANSWERSET_OPINIONPOLL: ['1', '2', '3', '4', '5'] };

const dcnName = d => (d ? [d.Title, d.FirstName, d.MiddleName, d.LastName].filter(Boolean).join(' ') : '');

function dcnContext(get) {
  const constants = get('dcnBridge')?.constants ?? {};
  const delegates = new Map((get('dcnDelegates') ?? []).map(d => [d.id, d]));
  const assignments = get('dcnSeatAssignments') ?? [];
  const noDelegate = constants['SEAT_ASSIGNMENT.NO_DELEGATE'] ?? 0;
  const seatNames = new Map(assignments.map(a => [a.SeatId, a.SeatName]));
  const seatName = id => seatNames.get(id) || `Seat ${id}`;
  const delegateAt = new Map(assignments.filter(a => a.DelegateId && a.DelegateId !== noDelegate).map(a => [a.SeatId, a.DelegateId]));
  return { constants, delegates, assignments, seatName, delegateAt, noDelegate };
}

/**
 * Interpreter desks from the DCN meeting data stream (WO-074): read-only, live while the stream runs. Used by `dcn`
 * (stream next to the bridge, DEC-020) and `dcn-smd`. Desk id = `desk-<booth>-<desk>` (placement key on the room plan).
 */
function smdInterpreterDesks(get) {
  const i = get('smdInterpretation');
  if (!i) return undefined;
  const seats = new Map((get('smdSeats') ?? []).map(x => [x.id, x]));
  const boothInUse = new Map((i.booths ?? []).map(b => [b.number, b.inUse]));
  const lang = c => (c ? { language: c.language ?? null, abbreviation: c.abbreviation ?? null, channel: c.number ?? null } : null);
  return (i.desks ?? []).map(d => ({
    id: `desk-${d.boothNumber ?? 0}-${d.number}`, booth: d.boothNumber ?? null, desk: d.number,
    seatId: d.seatId != null ? String(d.seatId) : null, seatName: seats.get(d.seatId)?.name || null,
    live: Boolean(d.translating), boothInUse: boothInUse.get(d.boothNumber) ?? null,
    output: d.destination ? { output: d.destination.output ?? null, ...lang(d.destination) } : null,
    source: lang(d.source),
  }));
}

/** Seat ids of interpreter desks according to the stream: not delegate seats. */
const smdDeskSeats = get => new Set((get('smdInterpretation')?.desks ?? []).map(d => d.seatId));

export const dcn = {
  /** Room top bar (WO-072): a running DCN meeting is "running"; the session is shown next to it. */
  meeting(get) {
    const list = get('dcnMeetings');
    if (!list) return undefined;
    const activeId = get('dcnActiveMeeting')?.meetingId ?? null;
    const sessionId = get('dcnActiveSession')?.sessionId ?? null;
    const active = list.find(m => m.id === activeId);
    const session = sessionId ? (get('dcnSessions') ?? []).find(x => x.id === sessionId) : null;
    return {
      meetings: list.map(m => ({ id: m.id, title: m.Title || `Meeting ${m.id}` })),
      current: activeId ? { id: activeId, title: active?.Title || `Meeting ${activeId}`, state: 'running', running: true } : null,
      session: sessionId ? { id: sessionId, title: session?.Subject || `Session ${sessionId}` } : null,
    };
  },
  interpreterDesks: smdInterpreterDesks, // from the stream next to the bridge (DEC-020)
  seats(get) {
    const assignments = get('dcnSeatAssignments');
    const mic = get('dcnMicStatus');
    if (!assignments && !mic) return undefined;
    const ctx = dcnContext(get);
    const regs = new Map((get('dcnRegisteredDelegates') ?? []).map(r => [r.id, r]));
    const rightVote = ctx.constants['PARTICIPATION_INFO.RIGHT_VOTE'];
    const ids = new Set([...(assignments ?? []).map(a => a.SeatId), ...(mic ?? []).map(m => m.SeatId),
      ...['dcnSpeakers', 'dcnRequests', 'dcnRespond'].flatMap(t => (get(t) ?? []).map(p => p.SeatId))]);
    const deskSeats = smdDeskSeats(get); // ASSUMPTION: stream seat ids = DCN-SW API seat ids (WO-074, check on site)
    return [...ids].filter(id => id > 0 && !deskSeats.has(id)).sort((a, b) => a - b).map(id => {
      const delegateId = ctx.delegateAt.get(id) ?? null;
      const reg = delegateId ? regs.get(delegateId) : null;
      return {
        id: String(id), name: ctx.seatName(id), person: dcnName(ctx.delegates.get(delegateId)), connected: true,
        canVote: reg && rightVote !== undefined ? Boolean(reg.Rights & rightVote) : false,
        canPrio: false, remote: false, hidden: false, diagnostics: null,
        details: {
          status: null, seatType: 'local', visType: null, supportsSpeaking: null, hasVotingLicense: null, attributes: [],
          assignedParticipantId: delegateId ? String(delegateId) : null, seatedParticipantId: null, devices: [],
        },
      };
    });
  },

  discussion(get) {
    const speakers = get('dcnSpeakers');
    const requests = get('dcnRequests');
    if (!speakers && !requests) return undefined;
    const ctx = dcnContext(get);
    const entry = (p, kind, micState) => ({
      seatId: String(p.SeatId),
      seatName: ctx.seatName(p.SeatId),
      name: dcnName(ctx.delegates.get(p.ParticipantId || ctx.delegateAt.get(p.SeatId))) || ctx.seatName(p.SeatId),
      micState,
      priority: false, // DCN reports only the number of active priorities (dcnPrios), not who
      kind,
      timer: null,
    });
    const reqs = requests ?? [];
    return {
      speakers: [...(speakers ?? []).map(p => entry(p, 'speaker', 'on')), ...(get('dcnRespond') ?? []).map(p => entry(p, 'responder', 'on'))],
      requests: [
        ...reqs.map((p, i) => ({ ...entry(p, 'request', 'off'), first: p.IsNextToSpeak || i === 0 })),
        ...(get('dcnRequestsToRespond') ?? []).map(p => ({ ...entry(p, 'responseRequest', 'off'), first: false })),
      ],
      referenceTime: null,
    };
  },

  voting(get) {
    const v = get('dcnVoting');
    if (!v) return undefined;
    const ctx = dcnContext(get);
    const info = (get('dcnVotingScript') ?? []).find(x => x.id === v.votingId);
    const set = info ? Object.entries(DCN_ANSWERS).find(([k]) => ctx.constants[`VOTE_INFO.${k}`] === info.VoteAnswerSet)?.[1] : null;
    // Results: VoteResultEventArgs.TotalResults (shape from the DLLs, WO-068) of the last VoteResults for this voting; while it
    // runs, VotingQuorumUpdated (same args). ConfigId = voting id and AnswerId = 1-based position in the answer set: ASSUMPTIONS.
    const pick = t => { const r = get(t); return r && (v.votingId == null || !r.ConfigId || r.ConfigId === v.votingId) ? r : null; };
    const res = v.state === 'opened' || v.state === 'onHold' ? pick('dcnVotingQuorum') : pick('dcnVoteResults') ?? pick('dcnVotingQuorum');
    const answersOf = set ?? [];
    const results = (res?.TotalResults?.Answers ?? []).map(r => ({ answer: answersOf[r.AnswerId - 1] ?? `Answer ${r.AnswerId}`, count: Number(r.CastCount) || 0 }));
    return {
      state: v.state === 'done' && v.outcome ? v.outcome : v.state,
      subject: info?.Subject ?? '',
      description: info?.VotingName ?? '',
      reference: info?.VotingNumber ?? '',
      answers: set ?? results.map(r => r.answer),
      results,
    };
  },

  power() {
    return undefined; // the DCN-SW API has no system power control
  },

  participants(get) {
    const delegates = get('dcnDelegates');
    if (!delegates) return undefined;
    const ctx = dcnContext(get);
    const regs = get('dcnRegisteredDelegates') ?? [];
    const meeting = get('dcnActiveMeeting')?.meetingId;
    const noSeat = ctx.constants['PARTICIPATION_INFO.NO_SEAT'] ?? 0;
    const rightVote = ctx.constants['PARTICIPATION_INFO.RIGHT_VOTE'];
    const byId = new Map(delegates.map(d => [d.id, d]));
    // With a running meeting: its registered delegates (like wired "participants of the active meeting"); else everyone.
    const list = meeting && regs.length ? regs.map(r => ({ d: byId.get(r.id) ?? { id: r.id }, r })) : delegates.map(d => ({ d, r: null }));
    return list.map(({ d, r }) => {
      const seat = r && r.AssignedSeatId && r.AssignedSeatId !== noSeat ? r.AssignedSeatId : null;
      return {
        id: String(d.id),
        name: dcnName(d) || `Delegate ${d.id}`,
        sortName: `${d.LastName ?? ''} ${d.FirstName ?? ''}`.trim().toLowerCase() || String(d.id),
        group: null,
        seat: seat ? ctx.seatName(seat) : null,
        assignedSeatId: seat ? String(seat) : null,
        seatedSeatId: null,
        userName: null,
        screenLine: null,
        present: null,
        canVote: r && rightVote !== undefined ? Boolean(r.Rights & rightVote) : null,
        nfc: null,
      };
    });
  },
};

// ---------------------------------------------------------------- dcn-smd (WO-066, DEC-018)
// Raw topics from backend/src/dcn-smd/sync.js (smd*): state rebuilt from Streaming Meeting Data activities.

const smdName = p => (p ? [p.title, p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') : '');

function smdContext(get) {
  const seats = new Map((get('smdSeats') ?? []).map(s => [s.id, s]));
  const people = new Map((get('smdParticipants') ?? []).map(p => [p.id, p]));
  const deskSeats = smdDeskSeats(get);
  const personAt = seatId => {
    const s = seats.get(seatId);
    return people.get(s?.participantId) ?? [...people.values()].find(p => p.seatId === seatId) ?? null;
  };
  const seatName = id => seats.get(id)?.name || `Seat ${id}`;
  return { seats, people, deskSeats, personAt, seatName };
}

export const dcnSmd = {
  meeting: () => undefined, // read-only: the Meeting data views show it (WO-067)
  interpreterDesks: smdInterpreterDesks,
  seats(get) {
    const seats = get('smdSeats');
    if (!seats) return undefined;
    const ctx = smdContext(get);
    return seats
      .filter(s => s.seatType !== 'Interpreter' && !ctx.deskSeats.has(s.id)) // interpreter desks are not delegate seats
      .map(s => {
        const p = ctx.personAt(s.id);
        return {
          id: String(s.id), name: s.name || `Seat ${s.id}`, person: smdName(p), connected: true,
          canVote: Boolean(p?.votingAuthorisation), canPrio: s.seatType === 'Chairman', remote: false, hidden: false, diagnostics: null,
          details: {
            status: null, seatType: s.seatType ? s.seatType[0].toLowerCase() + s.seatType.slice(1) : null, visType: null, supportsSpeaking: null,
            hasVotingLicense: null, attributes: s.seatType === 'Chairman' ? ['Chairman'] : [],
            assignedParticipantId: p ? String(p.id) : null, seatedParticipantId: p?.present ? String(p.id) : null, devices: [],
          },
        };
      });
  },

  discussion(get) {
    const d = get('smdDiscussion');
    if (!d) return undefined;
    const ctx = smdContext(get);
    const prio = new Set(d.priority ?? []);
    const entry = (e, kind, micState) => {
      const p = ctx.people.get(e.participantId);
      const seatId = e.seatId ?? p?.seatId ?? null;
      return {
        seatId: seatId == null ? `participant-${e.participantId}` : String(seatId),
        seatName: seatId == null ? '' : ctx.seatName(seatId),
        name: smdName(p) || (seatId == null ? `Participant ${e.participantId}` : ctx.seatName(seatId)),
        micState,
        priority: prio.has(seatId),
        kind: prio.has(seatId) ? 'priority' : kind,
        timer: null,
      };
    };
    // Chairman priority: the seat is speaking even if the active list does not list it (priority overrides).
    const listed = new Set((d.active ?? []).map(e => e.seatId));
    const prioOnly = [...prio].filter(id => !listed.has(id)).map(id => ({ seatId: id, participantId: ctx.seats.get(id)?.participantId ?? null }));
    return {
      speakers: [...prioOnly.map(e => entry(e, 'priority', 'on')), ...(d.active ?? []).map(e => entry(e, 'speaker', 'on')), ...(d.activeResponses ?? []).map(e => entry(e, 'responder', 'on'))],
      requests: [...(d.requests ?? []).map((e, i) => ({ ...entry(e, 'request', 'off'), first: i === 0 })), ...(d.responses ?? []).map(e => ({ ...entry(e, 'responseRequest', 'off'), first: false }))],
      referenceTime: null,
    };
  },

  voting(get) {
    const v = get('smdVoting');
    if (!v) return undefined;
    const cur = v.current;
    const answers = cur?.answers ?? [];
    const label = id => answers.find(a => a.id === id)?.text ?? `Answer ${id}`;
    const results = (cur?.results?.answers ?? []).map(r => ({ answer: label(r.answerId), count: r.casts ?? 0 }));
    const approved = cur?.results?.approved;
    return {
      state: v.state === 'done' && approved !== undefined ? (approved ? 'accepted' : 'rejected') : v.state,
      subject: cur?.subject || cur?.name || '',
      description: cur?.subject && cur?.name ? cur.name : '',
      reference: '',
      answers: answers.map(a => a.text),
      results: results.length || !answers.length ? results : answers.map(a => ({ answer: a.text, count: 0 })),
    };
  },

  power() {
    return undefined; // not in the stream
  },

  participants(get) {
    const all = get('smdParticipants');
    if (!all) return undefined;
    const ctx = smdContext(get);
    const meetingIds = get('smdMeeting')?.meeting?.participantIds;
    const list = meetingIds?.length ? meetingIds.map(id => ctx.people.get(id)).filter(Boolean) : all;
    return list.map(p => ({
      id: String(p.id),
      name: smdName(p) || `Participant ${p.id}`,
      sortName: `${p.lastName ?? ''} ${p.firstName ?? ''}`.trim().toLowerCase() || String(p.id),
      group: p.group ?? null,
      seat: p.seatId != null ? ctx.seatName(p.seatId) : null,
      assignedSeatId: p.seatId != null ? String(p.seatId) : null,
      seatedSeatId: null,
      userName: null,
      screenLine: null,
      present: p.present ?? null,
      canVote: p.votingAuthorisation ?? null,
      nfc: null,
    }));
  },
};

/** Domain topic → { mapper name, source topics per system } */
export const DOMAIN_TOPICS = {
  'domain.seats': { fn: 'seats', wired: ['seats'], wireless: ['wirelessSeats', 'wirelessParticipants'],
    dcn: ['dcnSeatAssignments', 'dcnMicStatus', 'dcnSpeakers', 'dcnRequests', 'dcnRespond', 'dcnDelegates', 'dcnRegisteredDelegates', 'dcnBridge', 'smdInterpretation'],
    'dcn-smd': ['smdSeats', 'smdParticipants', 'smdInterpretation'] },
  'domain.meeting': { fn: 'meeting', wired: ['meetings', 'meetingInfo'], wireless: [], dcn: ['dcnMeetings', 'dcnActiveMeeting', 'dcnActiveSession', 'dcnSessions'], 'dcn-smd': [] },
  'domain.interpreterDesks': { fn: 'interpreterDesks', wired: [], wireless: [], dcn: ['smdInterpretation', 'smdSeats'], 'dcn-smd': ['smdInterpretation', 'smdSeats'] },
  'domain.discussion': { fn: 'discussion', wired: ['discussionList', 'seats'], wireless: ['wirelessSpeakers', 'wirelessWaitingList'],
    dcn: ['dcnSpeakers', 'dcnRequests', 'dcnRespond', 'dcnRequestsToRespond', 'dcnSeatAssignments', 'dcnDelegates'],
    'dcn-smd': ['smdDiscussion', 'smdSeats', 'smdParticipants'] },
  'domain.voting': { fn: 'voting', wired: ['votingState', 'votingInfo', 'votingResults'], wireless: ['wirelessVotingState', 'wirelessVotingResults', 'wirelessVoting'],
    dcn: ['dcnVoting', 'dcnVotingScript', 'dcnVoteResults', 'dcnVotingQuorum', 'dcnBridge'], 'dcn-smd': ['smdVoting'] },
  'domain.power': { fn: 'power', wired: ['systemPowerMode'], wireless: ['wirelessSystemStatus'], dcn: [], 'dcn-smd': [] },
  'domain.participants': { fn: 'participants', wired: ['participants', 'participantSeats', 'seats'], wireless: ['wirelessParticipants', 'wirelessSeats'],
    dcn: ['dcnDelegates', 'dcnRegisteredDelegates', 'dcnSeatAssignments', 'dcnActiveMeeting', 'dcnBridge'],
    'dcn-smd': ['smdParticipants', 'smdMeeting', 'smdSeats'] },
};
