// Wireless state topics (WO-015): each is one GET endpoint, kept fresh by the poller.
// Payload = the raw response body. Rights from the swagger descriptions (prose only).
// poll: 'long' = held long-poll loop (live data); 'interval' = plain GET every few seconds (preparation data that rarely
// changes); 'slow' = the same every 3 periods (configuration); false = fetched on login and after writes only. Few long-polls on purpose: with many requests in flight the
// WAP sometimes parks an unrelated request until the long-polls time out (~50 s, WO-075).
/** @type {{ topic: string, path: string, poll: 'long' | 'interval' | 'slow' | false, rights?: string, undocumented?: boolean }[]} */
export const WIRELESS_TOPICS = [
  { topic: 'wirelessSystemInfo', path: '/system-info', poll: false },
  { topic: 'wirelessSystemStatus', path: '/system/status', poll: 'long', rights: 'prepare_system' },
  { topic: 'wirelessSeats', path: '/seats', poll: 'long' },
  { topic: 'wirelessSpeakers', path: '/speakers', poll: 'long', rights: 'can_manage' },
  { topic: 'wirelessWaitingList', path: '/waiting-list', poll: 'long', rights: 'can_manage' },
  { topic: 'wirelessParticipants', path: '/participants', poll: 'interval', rights: 'can_prepare_meeting' },
  { topic: 'wirelessIdentification', path: '/participants/settings', poll: 'interval' },
  { topic: 'wirelessVoting', path: '/voting', poll: 'interval', rights: 'can_manage' },
  { topic: 'wirelessVotingState', path: '/voting/state', poll: 'long' },
  { topic: 'wirelessVotingResults', path: '/voting/results', poll: 'long' },
  // Undocumented WAP web UI endpoints (DEC-024, WO-076). A firmware without one answers 404 → topic unavailable.
  { topic: 'wirelessDiscuss', path: '/discuss', poll: 'slow', rights: 'can_prepare_meeting', undocumented: true },
  { topic: 'wirelessAudio', path: '/audio', poll: 'slow', rights: 'can_configure', undocumented: true },
  { topic: 'wirelessMasterVolume', path: '/audio/master', poll: 'slow', undocumented: true },
  { topic: 'wirelessEqualizer', path: '/audio/equalizer/delegate-loudspeaker', poll: false, rights: 'can_configure', undocumented: true },
  { topic: 'wirelessSeatsStatus', path: '/seats/status', poll: 'slow', rights: 'can_configure', undocumented: true },
  { topic: 'wirelessRangeTest', path: '/seats/range-test', poll: 'slow', rights: 'can_configure', undocumented: true },
  { topic: 'wirelessSystemSettings', path: '/system/settings', poll: 'slow', undocumented: true },
  { topic: 'wirelessUpgrades', path: '/upgrades', poll: 'interval', rights: 'can_configure', undocumented: true },
];
