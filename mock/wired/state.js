// Seed data for the wired mock server. Plain objects; behaviours mutate them.

const FIRST = ['Anna', 'Bart', 'Chloe', 'Dirk', 'Eva', 'Femke', 'Gerrit', 'Hanna', 'Ivo', 'Julia', 'Kees', 'Lotte', 'Maarten', 'Noor', 'Olaf', 'Pim'];
const LAST = ['de Vries', 'Jansen', 'Bakker', 'Visser', 'Smit', 'Meijer', 'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Leeuwen', 'Dekker', 'Brouwer'];

export const ALL_PERMISSIONS = [
  'canManageMeeting', 'canEditSynoptic', 'canSelect', 'canAddDevicesToSeats', 'canViewSynoptic', 'canViewVoting',
  'canEnableSeatIllumination', 'canSwitchSystemPowerOn', 'canSwitchSystemPowerOff', 'canViewRequestItems',
  'canViewFirstRequestOnSeat', 'canDeactivateMicrophone', 'hasSpecialPermission', 'canControlInterpretation',
  'canViewInterpretation', 'canControlMasterVolume', 'canPrepareMeetingAndAgenda', 'canControlVoting',
  'canViewMeetingNotes', 'canViewVotingNotes', 'canViewRemoteParticipants', 'hasParticipantBasedLicense',
  // also held by the admin account of the real 6.50 server (WO-044 probe)
  'canControlMicrophoneSensitivity', 'canControlPresentation', 'hasPrepareMeetingLicense',
];

/**
 * @param {object} [options]
 * @param {number} [options.seatCount]
 */
export function createState({ seatCount = 20 } = {}) {
  const seats = Array.from({ length: seatCount }, (_, i) => ({
    assignedParticipantId: i < 16 ? `participant-${i + 1}` : '',
    attributes: i === 0 ? ['Chairman'] : [],
    canPrio: i === 0,
    canVote: true,
    devices: [{
      capabilities: ['hasNone'],
      deviceState: 'operational',
      id: `device-${i + 1}`,
      isFoundAtSeat: true,
      isSelected: false,
      name: `DCNM-DE ${i + 1}`,
      serialNumber: `SN${String(100000 + i)}`,
      subDeviceInstance: 0,
      typeOf: 'discussionDeviceExtended',
      version: '5.0.0',
    }],
    foundDevices: [`device-${i + 1}`],
    hasVotingLicense: true,
    screenLine: i < 16 ? `${FIRST[i]} ${LAST[i]}` : `Seat ${i + 1}`,
    seatedParticipantId: i < 12 ? `participant-${i + 1}` : '',
    seatId: `seat-${i + 1}`,
    seatName: i === 0 ? 'Chairman' : `Seat ${i + 1}`,
    seatType: 'local',
    status: 'connected',
    visType: 'none',
  }));

  const participants = Array.from({ length: 16 }, (_, i) => ({
    canPrio: i === 0,
    canVote: true,
    country: 'NL',
    email: `${FIRST[i].toLowerCase()}@example.org`,
    firstName: FIRST[i],
    group: i % 2 ? 'Party B' : 'Party A',
    isAuthenticated: i < 12,
    lastName: LAST[i],
    middleName: '',
    participantId: `participant-${i + 1}`,
    participantType: 'local',
    personId: `person-${i + 1}`,
    pictureUpdatedNumber: 0,
    region: '',
    screenLine: `${FIRST[i]} ${LAST[i]}`, // since 6.3
    title: i === 0 ? 'Chair' : '',
    userName: FIRST[i].toLowerCase(), // since 6.3
    visType: 'none',
    voteWeight: 1,
  }));

  const agenda = (meetingId, subjects) => subjects.map((subject, i) => ({
    agendaTopicId: `${meetingId}-topic-${i + 1}`,
    description: `${subject} (description)`,
    discussionId: `${meetingId}-discussion-${i + 1}`,
    meetingId,
    state: 'closed',
    subject,
  }));

  const meeting = (meetingId, title, subjects, state, autoOpenOnActivate = false) => ({
    agendaList: agenda(meetingId, subjects),
    autoOpenOnActivate,
    autoStartAgendaOnOpen: false,
    defaultDiscussionId: `${meetingId}-discussion-0`,
    description: `${title} meeting`,
    documentationRef: '',
    identificationMethod: 'fixed',
    isDefault: meetingId === 'meeting-1',
    meetingEndDate: '2026-10-02T17:00:00',
    meetingId,
    meetingStartDate: '2026-10-02T09:00:00',
    state,
    title,
    verificationMethod: 'none',
  });

  const voting = (meetingId, n, subject) => ({
    description: `${subject} (motion text)`,
    documentationLink: '',
    majorityVariables: [],
    meetingId,
    referenceNumber: `${meetingId.slice(-1)}.${n}`,
    state: 'closed',
    subject,
    usePresentButton: false,
    useVoteWeight: false,
    voteMajorityInfo: {
      isEnabled: false,
      majorityCondition: 'greaterThan',
      majorityDenominatorExpression: '',
      majorityNumeratorExpression: '',
      majorityThresholdExpression: '',
    },
    votingAnswers: ['yes', 'no', 'abstain'],
    votingId: `${meetingId}-voting-${n}`,
    votingTimeDuration: 0,
    votingTimerType: 'noVotingTimer',
  });

  return {
    startedAt: Date.now(),
    roomName: 'Mock Council Chamber',
    roomContactEmail: 'av-support@example.org',
    seats,
    participants,
    meetings: [
      meeting('meeting-1', 'City Council', ['Opening', 'Budget 2027', 'Any other business'], 'opened'),
      meeting('meeting-2', 'Budget Committee', ['Opening', 'Review'], 'deactivated', true),
    ],
    activeMeetingId: 'meeting-1',
    votings: [
      voting('meeting-1', 1, 'Approve minutes'),
      voting('meeting-1', 2, 'Adopt budget 2027'),
      voting('meeting-2', 1, 'Approve review'),
    ],
    /** @type {string | null} */
    activeVotingId: null,
    /** seatId → answer for the active voting */
    votes: new Map(),
    /** discussion list entries in order: speakers first, then requests */
    discussion: [],
    maxSpeakers: 4,
    powerMode: 'poweredOn',
    masterVolume: 10,
    masterVolumeRange: { maximumVolume: 20, minimumVolume: 0 }, // real server: dB, e.g. -24..0 with decimals
    isPresentationEnabled: false,
    seatIlluminationEnabled: false,
    illuminatedSeatId: '',
    /** @type {Record<string, string[]>} user → permissions */
    userPermissions: {},
  };
}

/** Milliseconds since mock start, used as the server "tick" (referenceTime, speechStartTime). */
export const tick = state => Date.now() - state.startedAt;
