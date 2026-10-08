// Real 6.50 semantics (WO-032): without an active user meeting the built-in "Default" meeting (opened, not listed in
// GetMeetings) is active; CloseMeeting deactivates the user meeting; ActivateMeeting opens directly if autoOpenOnActivate.
const DEFAULT_MEETING = {
  agendaList: [], autoOpenOnActivate: true, autoStartAgendaOnOpen: false, defaultDiscussionId: 'default-discussion',
  description: '', documentationRef: '', identificationMethod: 'Fixed', isDefault: true, meetingEndDate: '', meetingId: 'default-meeting',
  meetingStartDate: '', state: 'opened', title: 'Default', verificationMethod: 'None',
};
const activeMeeting = ctx => ctx.state.meetings.find(m => m.meetingId === ctx.state.activeMeetingId);
const meetingOrActive = (ctx, meetingId) => (meetingId
  ? ctx.state.meetings.find(m => m.meetingId === meetingId) ?? ctx.fail(`Meeting '${meetingId}' does not exist`)
  : activeMeeting(ctx) ?? DEFAULT_MEETING);

function changed(ctx) {
  // The real server fires MeetingInfoChanged (never MeetingListChanged) for meeting transitions.
  ctx.fire('meetingInfoChanged', 'agendaTopicsChanged', 'participantsChanged', 'votingScriptChanged');
}

export default {
  GetMeetings: ({ state }) => ({ meetings: state.meetings }),
  GetMeetingInfo: (ctx, { meetingId }) => ({ meetingInfo: meetingOrActive(ctx, meetingId) }),
  GetAgendaTopics: (ctx, { meetingId }) => ({ agendaTopics: meetingOrActive(ctx, meetingId).agendaList }),
  GetParticipants: (ctx, { meetingId }) => {
    meetingOrActive(ctx, meetingId);
    return { participants: ctx.state.participants };
  },
  GetVotings: (ctx, { meetingId }) => {
    const m = meetingOrActive(ctx, meetingId);
    return { votingList: ctx.state.votings.filter(v => v.meetingId === m.meetingId) };
  },

  ActivateMeeting: (ctx, { meetingId }) => {
    const m = ctx.state.meetings.find(x => x.meetingId === meetingId) ?? ctx.fail(`Meeting '${meetingId}' does not exist`);
    if (ctx.state.activeMeetingId && ctx.state.activeMeetingId !== meetingId) ctx.fail('Another meeting is already active');
    m.state = m.autoOpenOnActivate ? 'opened' : 'activated';
    ctx.state.activeMeetingId = meetingId;
    changed(ctx);
    return {};
  },
  DeactivateMeeting: ctx => {
    const m = activeMeeting(ctx);
    if (!m) { ctx.fire('meetingInfoChanged'); return {}; } // Default meeting: accepted, no change
    m.state = 'deactivated';
    m.agendaList.forEach(t => { t.state = 'closed'; });
    ctx.state.activeMeetingId = null;
    ctx.state.discussion.length = 0;
    changed(ctx);
    ctx.fire('discussionListChanged');
    return {};
  },
  OpenMeeting: ctx => {
    const m = activeMeeting(ctx);
    if (!m || m.state === 'opened') return {}; // Default meeting / already open: no effect (real server)
    m.state = 'opened';
    changed(ctx);
    return {};
  },
  CloseMeeting: ctx => {
    const m = activeMeeting(ctx);
    if (!m || m.state !== 'opened') ctx.fail('Unable to perform the operation: CloseMeeting');
    // Closing deactivates the meeting; the Default meeting becomes active (and a notes file is written).
    m.state = 'deactivated';
    m.agendaList.forEach(t => { t.state = 'closed'; });
    ctx.state.activeMeetingId = null;
    ctx.state.discussion.length = 0;
    changed(ctx);
    ctx.fire('discussionListChanged', 'notesFileListChanged');
    return {};
  },
  OpenAgenda: (ctx, { agendaTopicId }) => {
    const m = activeMeeting(ctx) ?? ctx.fail('No active meeting');
    if (m.state !== 'opened') ctx.fail('Meeting is not open');
    const topic = m.agendaList.find(t => t.agendaTopicId === agendaTopicId) ?? ctx.fail(`Agenda topic '${agendaTopicId}' does not exist`);
    m.agendaList.forEach(t => { t.state = t === topic ? 'opened' : 'closed'; });
    ctx.fire('agendaTopicsChanged', 'meetingInfoChanged');
    return {};
  },
  CloseAgenda: ctx => {
    const m = activeMeeting(ctx) ?? ctx.fail('No active meeting');
    if (!m.agendaList.some(t => t.state === 'opened')) ctx.fail('No agenda topic is open');
    m.agendaList.forEach(t => { t.state = 'closed'; });
    ctx.fire('agendaTopicsChanged', 'meetingInfoChanged');
    return {};
  },
};
