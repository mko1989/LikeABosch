// DICENTIS 6.50 operations not in the PDF (WO-031). Behaviour modelled on the real server (WO-032 e2e run).
import { requestToSpeak, addToSpeakers, removeFromDiscussion } from './seats.js';

const sensitivity = state => (state.micSensitivity ??= new Map());
const ids = (ctx, params) => {
  const list = params.seatIds ?? [];
  if (!Array.isArray(list) || !list.length) ctx.fail('seatIds is required');
  return list;
};

export default {
  GetApiState: () => ({ online: true }),
  GetDiscussionOptions: () => ({ discussionMode: 1, maxRequests: 10, maxResponses: 10 }),
  GetSpeechTimerOptions: () => ({ speechTimerOptions: { showSpeechTimer: true, speechTimerDurationInSeconds: 300, canAdjustSpeechTimer: true } }),
  GetRemainingVoteTime: () => ({ remainingVoteTime: 0 }), // shape from the 7.0 CHM (no timed voting in the mock)
  GetSupportedHeadphones: () => ({
    supportedHeadphones: [
      { id: 0, headphoneDescription: 'Headphone with no hearing protection' },
      { id: 1, headphoneDescription: 'Bosch LBB3443' },
      { id: 2, headphoneDescription: 'Bosch HDP-LWN' },
    ],
  }),

  GetMicrophoneSensitivityDescription: () => ({
    micSensitivityDescription: { minimumMicrophoneSensitivity: -6, maximumMicrophoneSensitivity: 6, microphoneSensitivityStepSize: 0.5 },
  }),
  // Real 6.50: seatIds [] = every seat; seatIds missing = "Value cannot be null. Parameter name: source" (WO-044 probe).
  GetMicrophoneSensitivity: (ctx, params) => ({
    seatMicrophoneSensitivities: (params.seatIds ?? ctx.fail('Value cannot be null.\nParameter name: source')).concat(params.seatIds.length ? [] : ctx.state.seats.map(s => s.seatId)).map(id => {
      const seat = ctx.state.seats.find(s => s.seatId === id) ?? ctx.fail(`Seat '${id}' does not exist`);
      return { seatId: id, seatName: seat.seatName, sensitivityValue: sensitivity(ctx.state).get(id) ?? 0 };
    }),
  }),
  UpdateMicrophoneSensitivity: (ctx, { seatMicrophoneSensitivity = [] }) => {
    for (const { seatId, sensitivityValue } of seatMicrophoneSensitivity) {
      if (!ctx.state.seats.some(s => s.seatId === seatId)) return { status: false };
      if (typeof sensitivityValue !== 'number' || sensitivityValue < -6 || sensitivityValue > 6 || (sensitivityValue * 2) % 1) return { status: false };
      sensitivity(ctx.state).set(seatId, sensitivityValue);
    }
    ctx.fire('seatMicrophoneSensitivityUpdated');
    return { status: true };
  },
  ResetMicrophoneSensitivity: (ctx, params) => {
    ids(ctx, params).forEach(id => sensitivity(ctx.state).delete(id));
    ctx.fire('seatMicrophoneSensitivityUpdated');
    return { status: true };
  },

  // Speech control by id lists. With discussionMode 1 a request becomes a speaker right away if a slot is free.
  RequestSpeech: (ctx, params) => { ids(ctx, params).forEach(id => requestToSpeak(ctx, id)); return {}; },
  GrantSpeech: (ctx, params) => { ids(ctx, params).forEach(id => addToSpeakers(ctx, id, { allowExisting: true })); return {}; },
  RemoveSpeech: (ctx, params) => { ids(ctx, params).forEach(id => removeFromDiscussion(ctx, id, { quiet: true })); return {}; },
  RequestResponse: (ctx, params) => { ids(ctx, params); return {}; }, // no response mode configured → no effect (as on the real server)
  GrantResponse: (ctx, params) => { ids(ctx, params); return {}; },
  RemoveResponse: ctx => ctx.fail('Unable to perform the operation: RemoveResponse'),

  ...Object.fromEntries([['IncreaseSpeechTime', 60_000], ['DecreaseSpeechTime', -60_000], ['ResetSpeechTime', 0]].map(([name, delta]) => [name, (ctx, { seatId }) => {
    const entry = ctx.state.discussion.find(e => e.seatId === seatId);
    if (!entry) ctx.fail(`Unable to perform the operation: ${name}`);
    entry.remainingSpeechDuration = delta === 0 ? 300_000 : Math.max(0, entry.remainingSpeechDuration + delta);
    ctx.fire('discussionListChanged');
    return { success: true };
  }])),
};
