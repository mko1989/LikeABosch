// Voting lifecycle: closed → ready (Activate*) → opened ⇄ onHold → done (Close) | canceled (Abort);
// done → accepted | rejected.
const active = ctx => ctx.state.votings.find(v => v.votingId === ctx.state.activeVotingId);

function transition(ctx, allowedFrom, to, { clearVotes = false } = {}) {
  const v = active(ctx) ?? ctx.fail('No active voting');
  if (!allowedFrom.includes(v.state)) ctx.fail(`Voting is '${v.state}', expected ${allowedFrom.join(' or ')}`);
  v.state = to;
  if (clearVotes) ctx.state.votes.clear();
  ctx.fire('votingStateChanged', 'votingInfoChanged', 'votingScriptChanged');
  if (clearVotes) ctx.fire('votingResultChanged', 'individualVotingResultsChanged');
  return {};
}

function activate(ctx, voting) {
  const current = active(ctx);
  if (current && ['opened', 'onHold'].includes(current.state)) ctx.fail('Another voting is in progress');
  voting.state = 'ready';
  ctx.state.activeVotingId = voting.votingId;
  ctx.state.votes.clear();
  ctx.fire('votingStateChanged', 'votingInfoChanged', 'votingScriptChanged', 'votingResultChanged', 'individualVotingResultsChanged');
}

let adHocCounter = 0;

export default {
  GetVotingState: ctx => ({ votingState: active(ctx)?.state ?? 'closed' }),
  GetVotingInfo: ctx => ({ votingInfo: active(ctx) ?? null }),
  GetVotingResults: ctx => {
    const v = active(ctx);
    if (!v) return { votingResults: [] };
    const counts = new Map(v.votingAnswers.map(a => [a, 0]));
    for (const answer of ctx.state.votes.values()) counts.set(answer, (counts.get(answer) ?? 0) + 1);
    return { votingResults: [...counts].map(([answer, count]) => ({ answer, count })) };
  },
  GetSeatVotingResults: ctx => ({
    votingResults: [...ctx.state.votes].map(([seatId, votingAnswer]) => ({ seatId, votingAnswer })),
  }),
  GetIndividualVotingResults: ctx => ({
    votingResults: [...ctx.state.votes].map(([seatId, votingAnswer]) => ({
      participantId: ctx.state.seats.find(s => s.seatId === seatId)?.seatedParticipantId ?? '',
      votingAnswer,
    })),
  }),

  ActivateVoting: (ctx, { votingId }) => {
    const v = ctx.state.votings.find(x => x.votingId === votingId) ?? ctx.fail(`Voting '${votingId}' does not exist`);
    if (v.meetingId !== ctx.state.activeMeetingId) ctx.fail('Voting does not belong to the active meeting');
    activate(ctx, v);
    return {};
  },
  ActivateAdHocVoting: (ctx, { subject = 'Ad-hoc voting', description = '', number = '' }) => {
    if (!ctx.state.activeMeetingId) ctx.fail('No active meeting');
    adHocCounter += 1;
    const template = ctx.state.votings[0];
    const v = {
      ...structuredClone(template),
      votingId: `adhoc-${adHocCounter}`,
      meetingId: ctx.state.activeMeetingId,
      subject,
      description,
      referenceNumber: number,
    };
    ctx.state.votings.push(v);
    activate(ctx, v);
    return {};
  },
  OpenVoting: ctx => transition(ctx, ['ready'], 'opened', { clearVotes: true }),
  HoldVoting: ctx => transition(ctx, ['opened'], 'onHold'),
  ResumeVoting: ctx => transition(ctx, ['onHold'], 'opened'),
  CloseVoting: ctx => transition(ctx, ['opened', 'onHold'], 'done'),
  AbortVoting: ctx => transition(ctx, ['opened', 'onHold'], 'canceled'),
  AcceptVoting: ctx => transition(ctx, ['done'], 'accepted'),
  RejectVoting: ctx => transition(ctx, ['done'], 'rejected'),
};
