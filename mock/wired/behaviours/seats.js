import { tick } from '../state.js';

const findSeat = (ctx, seatId) => ctx.state.seats.find(s => s.seatId === seatId) ?? ctx.fail(`Seat '${seatId}' does not exist`);
const entry = (ctx, seatId) => ctx.state.discussion.find(e => e.seatId === seatId);
const speakers = state => state.discussion.filter(e => e.speakerType === 'isSpeaker' || e.speakerType === 'isPrioritySpeaker');

function newEntry(ctx, seat, speakerType) {
  const on = speakerType !== 'isRequest';
  return {
    activeImage: false,
    activeVideo: false, // removed in DICENTIS 7.0
    adjustSpeechTime: false,
    adjustSpeechTimeDuration: 0,
    isFirst: false,
    isLastMinuteActivated: false,
    microphoneState: on ? 'on' : 'off',
    participantId: seat.seatedParticipantId,
    personInfoId: seat.seatedParticipantId ? seat.seatedParticipantId.replace('participant', 'person') : '',
    remainingSpeechDuration: 300000,
    screenLine: seat.screenLine,
    seatId: seat.seatId,
    showSpeechTimer: true,
    speakerType,
    speechStartTime: on ? tick(ctx.state) : 0,
    totalSpeechTime: 0,
  };
}

function setMic(ctx, { seatId, seatIds = [], participantIds = [] }, from, to, problem) {
  const targets = [seatId, ...seatIds, ...participantIds.map(p => ctx.state.discussion.find(e => e.participantId === p)?.seatId ?? p)].filter(Boolean);
  if (!targets.length) ctx.fail('seatId or seatIds is required');
  for (const id of targets) {
    const e = entry(ctx, id);
    if (!e || e.microphoneState !== from) ctx.fail(`Seat '${id}' ${problem}`);
  }
  targets.forEach(id => { entry(ctx, id).microphoneState = to; });
  ctx.fire('discussionListChanged');
  return {};
}

/** Promote the first request when a speaker slot is free. */
function promote(ctx) {
  const { state } = ctx;
  const next = state.discussion.find(e => e.speakerType === 'isRequest');
  if (next && speakers(state).length < state.maxSpeakers) {
    Object.assign(next, { speakerType: 'isSpeaker', microphoneState: 'on', speechStartTime: tick(state) });
  }
}

function sortDiscussion(state) {
  const rank = { isPrioritySpeaker: 0, isSpeaker: 1, isResponder: 2, isImportant: 3, isRequest: 4, isResponseRequest: 5 };
  state.discussion.sort((a, b) => rank[a.speakerType] - rank[b.speakerType]);
  state.discussion.forEach((e, i) => { e.isFirst = e.speakerType === 'isRequest' && i === state.discussion.findIndex(x => x.speakerType === 'isRequest'); });
}

/** A delegate presses the request-to-speak button: queued as a request, promoted if a slot is free. */
export function requestToSpeak(ctx, seatId) {
  const seat = findSeat(ctx, seatId);
  if (entry(ctx, seatId)) return;
  ctx.state.discussion.push(newEntry(ctx, seat, 'isRequest'));
  promote(ctx);
  sortDiscussion(ctx.state);
  ctx.fire('discussionListChanged');
}

/** Add a seat as speaker (or request when full). Shared by AddSeatToSpeakers and GrantSpeech. */
export function addToSpeakers(ctx, seatId, { allowExisting = false } = {}) {
  const seat = findSeat(ctx, seatId);
  const existing = entry(ctx, seatId);
  if (existing && existing.speakerType !== 'isRequest') {
    if (allowExisting) return;
    ctx.fail(`Seat '${seatId}' is already a speaker`);
  }
  const full = speakers(ctx.state).length >= ctx.state.maxSpeakers;
  if (existing) {
    if (full) ctx.fail('Maximum number of speakers reached');
    Object.assign(existing, { speakerType: 'isSpeaker', microphoneState: 'on', speechStartTime: tick(ctx.state) });
  } else {
    ctx.state.discussion.push(newEntry(ctx, seat, full ? 'isRequest' : 'isSpeaker'));
  }
  sortDiscussion(ctx.state);
  ctx.fire('discussionListChanged');
}

/** Remove a seat from the discussion list. `quiet`: no error if it isn't there (RemoveSpeech). */
export function removeFromDiscussion(ctx, seatId, { quiet = false } = {}) {
  findSeat(ctx, seatId);
  const idx = ctx.state.discussion.findIndex(e => e.seatId === seatId);
  if (idx < 0) {
    if (quiet) return;
    ctx.fail(`Seat '${seatId}' is not in the discussion list`);
  }
  ctx.state.discussion.splice(idx, 1);
  promote(ctx);
  sortDiscussion(ctx.state);
  ctx.fire('discussionListChanged');
}

export default {
  GetSeats: ({ state }) => ({ seats: state.seats }),
  GetParticipantSeats: ({ state }) => ({
    participantSeats: state.seats.filter(s => s.assignedParticipantId || s.seatedParticipantId).map(s => ({
      assignedSeatId: s.assignedParticipantId ? s.seatId : '',
      participantId: s.assignedParticipantId || s.seatedParticipantId,
      seatedSeatId: s.seatedParticipantId ? s.seatId : '',
    })),
  }),
  GetDiscussionList: ({ state }) => ({ discussionList: state.discussion, referenceTime: tick(state) }),

  AddSeatToSpeakers: (ctx, { seatId }) => { addToSpeakers(ctx, seatId); return {}; },
  RemoveSeatFromDiscussionList: (ctx, { seatId }) => { removeFromDiscussion(ctx, seatId); return {}; },
  // {seatId} (PDF) or the multi-seat form {seatIds, participantIds} (6.50 vendor client, 7.0 CHM).
  ActivateMicrophone: (ctx, params) => setMic(ctx, params, 'mute', 'on', 'is not a muted speaker'),
  DeactivateMicrophone: (ctx, params) => setMic(ctx, params, 'on', 'mute', 'is not an active speaker'),
  GetEnableSeatIllumination: ({ state }) => ({ enable: state.seatIlluminationEnabled }),
};
