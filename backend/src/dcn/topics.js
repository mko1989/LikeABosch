// DCN state topics (WO-060): which DCN-SW API call fills which cache topic, and which events refresh what.
// Raw topics are named dcn*. Payloads are the bridge's JSON (BRIDGE.md: .NET member names, enums by name), with
// parallel id/struct arrays zipped into `[{ id, ...struct }]`.

/** `[ids, structs]` → `[{ id, ...struct }]` */
const zip = (idsKey, listKey) => out => (out[idsKey] ?? []).map((id, i) => ({ id, ...(out[listKey]?.[i] ?? {}) }));

/**
 * @typedef {{ meetingId: number | null, sessionId: number | null, defaultArea: number }} TopicContext
 * @typedef {object} DcnTopic
 * @property {string} topic
 * @property {string} call                       full method key
 * @property {(ctx: TopicContext) => Record<string, unknown> | null} [args]  null = cannot fetch now (e.g. no meeting) → `inactive`
 * @property {(out: Record<string, any>) => unknown} map
 * @property {unknown} [inactive]                value stored when the API says NOT_ACTIVE (no meeting running) or args() is null
 * @property {0 | 1} stage                       1 = needs ids from stage-0 topics (fetched after them)
 */

/** @type {DcnTopic[]} */
export const DCN_TOPICS = [
  // meeting / session
  { topic: 'dcnActiveMeeting', call: 'control.MeetingApi.RetrieveActiveMeetingId', map: o => ({ meetingId: o.meetingId }), inactive: { meetingId: null }, stage: 0 },
  { topic: 'dcnActiveSession', call: 'control.MeetingApi.RetrieveActiveSessionId', map: o => ({ sessionId: o.sessionId }), inactive: { sessionId: null }, stage: 0 },
  { topic: 'dcnActiveMeetingDelegates', call: 'control.MeetingApi.RetrieveDelegatesForActiveMeeting', map: o => (o.delegates ?? []).map(d => d.DelegateId), inactive: [], stage: 0 },
  // system audio
  { topic: 'dcnMasterVolume', call: 'control.DcnSystemApi.GetMasterVolume', map: o => ({ volume: o.masterVolume }), stage: 0 },
  { topic: 'dcnMasterMute', call: 'control.DcnSystemApi.GetMasterMute', map: o => ({ mute: o.masterMute }), stage: 0 },
  // discussion
  { topic: 'dcnSpeakers', call: 'control.DiscussionApi.RetrieveSpeakersList', map: o => o.participants ?? [], inactive: [], stage: 0 },
  { topic: 'dcnRequests', call: 'control.DiscussionApi.RetrieveRequestToSpeakList', map: o => o.participants ?? [], inactive: [], stage: 0 },
  { topic: 'dcnRespond', call: 'control.DiscussionApi.RetrieveRespondList', map: o => o.participants ?? [], inactive: [], stage: 0 },
  { topic: 'dcnRequestsToRespond', call: 'control.DiscussionApi.RetrieveRequestToRespondList', map: o => o.participants ?? [], inactive: [], stage: 0 },
  { topic: 'dcnMicStatus', call: 'control.DiscussionApi.RetrieveMicrophoneStatus', map: o => o.seatMicStatus ?? [], inactive: [], stage: 0 },
  { topic: 'dcnNotebookers', call: 'control.DiscussionApi.RetrieveNotebookersList', map: o => o.notebookers ?? [], inactive: [], stage: 0 },
  { topic: 'dcnDiscussionSettings', call: 'control.DiscussionApi.RetrieveDiscussionSettings', map: o => o.discussionInfo ?? null, stage: 0 },
  { topic: 'dcnPrios', call: 'control.DiscussionApi.GetNumberOfActivePrios', map: o => ({ keyPrio: o.keyPrio, virtualPrio: o.virtualPrio }), inactive: { keyPrio: 0, virtualPrio: 0 }, stage: 0 },
  { topic: 'dcnGroupTimers', call: 'control.DiscussionApi.RetrieveGroupTimers', map: o => o.sessionGroupTimer ?? [], inactive: [], stage: 0 },
  // voting (operational)
  { topic: 'dcnActiveVoting', call: 'control.VoteApi.RetrieveActiveVotingId', map: o => ({ votingId: o.votingId }), inactive: { votingId: null }, stage: 0 },
  { topic: 'dcnSessionVotings', call: 'control.VoteApi.RetrieveVotingsForActiveSession', map: o => o.votingIds ?? [], inactive: [], stage: 0 },
  // configuration
  { topic: 'dcnMeetings', call: 'config.MeetingApi.RetrieveMeetings', map: zip('meetingIds', 'meetings'), stage: 0 },
  { topic: 'dcnDelegates', call: 'config.DelegateApi.RetrieveDelegates', map: zip('delegateIds', 'delegates'), stage: 0 },
  { topic: 'dcnVoteTemplates', call: 'config.VoteApi.RetrieveVoteTemplates', map: zip('voteTemplatedIds', 'voteTemplates'), stage: 0 },
  { topic: 'dcnInterpretationLanguages', call: 'config.LanguageApi.RetrieveInterpretationLanguages', map: zip('interpretationLanguageIds', 'languages'), stage: 0 },
  { topic: 'dcnChannels', call: 'config.SystemApi.RetrieveChannelDefinition', map: o => o.channelDefinition ?? [], stage: 0 },
  // configuration of the active meeting / session
  { topic: 'dcnSessions', call: 'config.MeetingApi.RetrieveMeetingSessions', args: c => (c.meetingId ? { meetingId: c.meetingId } : null), map: zip('sessionIds', 'sessions'), inactive: [], stage: 1 },
  { topic: 'dcnRegisteredDelegates', call: 'config.DelegateApi.RetrieveRegisteredDelegatesForMeeting', args: c => (c.meetingId ? { meetingId: c.meetingId } : null), map: zip('delegateIds', 'participation'), inactive: [], stage: 1 },
  { topic: 'dcnSeatAssignments', call: 'config.DelegateApi.RetrieveSeatAssignmentForArea', args: c => (c.meetingId ? { meetingId: c.meetingId, areaId: c.defaultArea } : null), map: o => o.assignments ?? [], inactive: [], stage: 1 },
  { topic: 'dcnVotingScript', call: 'config.VoteApi.RetrieveVotingScript', args: c => (c.sessionId ? { sessionId: c.sessionId } : null), map: zip('voteIds', 'votes'), inactive: [], stage: 1 },
];

/**
 * Event (`<api>.<event>`) → topics to refetch. `*resync` = everything (meeting/session changes).
 * Events not listed only update the event-derived topics in events.js (or are ignored).
 * @type {Record<string, string[]>}
 */
export const DCN_EVENT_TOPICS = {
  'control.DcnSystemApi.masterVolumeChange': ['dcnMasterVolume'],
  'control.DcnSystemApi.masterMuteChange': ['dcnMasterMute'],
  'control.DiscussionApi.MicOn': ['dcnSpeakers', 'dcnRequests', 'dcnMicStatus', 'dcnNotebookers'],
  'control.DiscussionApi.MicOff': ['dcnSpeakers', 'dcnMicStatus', 'dcnNotebookers'],
  'control.DiscussionApi.SpeakersListUpdated': ['dcnSpeakers', 'dcnMicStatus'],
  'control.DiscussionApi.RequestToSpeakListUpdated': ['dcnRequests', 'dcnMicStatus'],
  'control.DiscussionApi.RespondListUpdated': ['dcnRespond', 'dcnMicStatus'],
  'control.DiscussionApi.RequestToRespondListUpdated': ['dcnRequestsToRespond'],
  'control.DiscussionApi.NotebookersListUpdated': ['dcnNotebookers'],
  'control.DiscussionApi.DiscussionSettingsUpdate': ['dcnDiscussionSettings'],
  'control.DiscussionApi.ChairmanPriorityListUpdated': ['dcnPrios'],
  'control.DiscussionApi.GroupSpeechTimeUpdated': ['dcnGroupTimers'],
  'control.MeetingApi.MeetingStart': ['*resync'],
  'control.MeetingApi.MeetingStop': ['*resync'],
  'control.MeetingApi.SessionStart': ['*resync'],
  'control.MeetingApi.SessionStop': ['*resync'],
  'control.VoteApi.VotingSelect': ['dcnActiveVoting'],
  'control.VoteApi.VotingStart': ['dcnActiveVoting'],
  'control.VoteApi.VotingStop': ['dcnActiveVoting'],
  'config.DelegateApi.DelegateStore': ['dcnDelegates'],
  'config.DelegateApi.DelegateUpdate': ['dcnDelegates'],
  'config.DelegateApi.DelegateDeletion': ['dcnDelegates', 'dcnRegisteredDelegates', 'dcnSeatAssignments'],
  'config.DelegateApi.DelegateRegistration': ['dcnRegisteredDelegates', 'dcnSeatAssignments', 'dcnActiveMeetingDelegates'],
  'config.DelegateApi.DelegateRegistrationUpdate': ['dcnRegisteredDelegates', 'dcnSeatAssignments', 'dcnActiveMeetingDelegates'],
  'config.DelegateApi.DelegateUnregistration': ['dcnRegisteredDelegates', 'dcnSeatAssignments', 'dcnActiveMeetingDelegates'],
  'config.DelegateApi.RequestStore': ['dcnRequests'],
  'config.DelegateApi.RequestUpdate': ['dcnRequests'],
  'config.DelegateApi.RequestDeletion': ['dcnRequests'],
  'config.MeetingApi.MeetingStore': ['dcnMeetings'],
  'config.MeetingApi.MeetingUpdate': ['dcnMeetings'],
  'config.MeetingApi.MeetingDeletion': ['dcnMeetings'],
  'config.MeetingApi.SessionStore': ['dcnSessions'],
  'config.MeetingApi.SessionUpdate': ['dcnSessions'],
  'config.MeetingApi.SessionDeletion': ['dcnSessions'],
  'config.MeetingApi.SortPositionChanged': ['dcnSessions'],
  'config.VoteApi.VoteStore': ['dcnVotingScript', 'dcnSessionVotings'],
  'config.VoteApi.VoteUpdate': ['dcnVotingScript'],
  'config.VoteApi.VoteDeletion': ['dcnVotingScript', 'dcnSessionVotings'],
  'config.VoteApi.VoteTemplateStore': ['dcnVoteTemplates'],
  'config.VoteApi.VoteTemplateUpdate': ['dcnVoteTemplates'],
  'config.VoteApi.VoteTemplateDeletion': ['dcnVoteTemplates'],
  'config.LanguageApi.LanguageStore': ['dcnInterpretationLanguages'],
  'config.LanguageApi.LanguageUpdate': ['dcnInterpretationLanguages'],
  'config.LanguageApi.LanguageDeletion': ['dcnInterpretationLanguages'],
  'config.SystemApi.ChannelDefinitionUpdate': ['dcnChannels'],
  'config.SeatDataApi.SeatUpdate': ['dcnSeatAssignments', 'dcnNotebookers'],
};

/**
 * Voting state from events (DCN has no "get voting state" call). Vocabulary of domain.voting (DEC-010).
 * Also applied after our own successful calls, in case DCN-SW does not echo events to the API client that caused them.
 */
export const DCN_VOTING_EVENTS = {
  VotingSelect: { state: 'ready' },
  VotingStart: { state: 'opened', outcome: null },
  VotingHold: { state: 'onHold' },
  VotingContinue: { state: 'opened' },
  VotingStop: { state: 'done' },
  VotingAccepted: { outcome: 'accepted' },
  VotingRejected: { outcome: 'rejected' },
};
export const DCN_VOTING_CALLS = {
  'control.VoteApi.SelectVotingById': 'VotingSelect',
  'control.VoteApi.StartVotingById': 'VotingStart',
  'control.VoteApi.StartAdhocVoting': 'VotingStart',
  'control.VoteApi.HoldVoting': 'VotingHold',
  'control.VoteApi.ContinueVoting': 'VotingContinue',
  'control.VoteApi.StopVoting': 'VotingStop',
};

/** Events whose args are kept as a topic (data that has no Retrieve call). */
export const DCN_EVENT_DATA_TOPICS = {
  'control.VoteApi.VoteResults': 'dcnVoteResults',
  'control.VoteApi.VotingQuorumUpdated': 'dcnVotingQuorum',
  'control.VoteApi.VotingTimer': 'dcnVotingTimer',
  'control.DiscussionApi.ParticipantTimeLeftUpdated': 'dcnSpeakerTimeLeft',
};
