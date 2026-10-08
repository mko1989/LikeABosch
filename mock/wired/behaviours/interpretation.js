/**
 * Mock behaviours for interpretation operations.
 * Manages languages, booths, interpreter seats, routings, notifications, and meta-functions.
 */

/**
 * Initialize interpretation state with default data.
 * @param {object} state shared mock state
 */
export function ensure(state) {
  if (state.interpretation) return;

  // Real 6.50 (WO-048 probe): index 0 is the floor channel; SelectInterpretationFloor reports its id as the source.
  const languages = [
    { languageId: 'lang-floor', label: 'Floor', abbreviation: 'FLR', index: 0 },
    { languageId: 'lang-001', label: 'English', abbreviation: 'EN', index: 1 },
    { languageId: 'lang-002', label: 'Dutch', abbreviation: 'NL', index: 2 },
    { languageId: 'lang-003', label: 'French', abbreviation: 'FR', index: 3 },
    { languageId: 'lang-004', label: 'German', abbreviation: 'DE', index: 4 },
  ];

  const booths = [
    { boothId: 'booth-001', boothNumber: 1, autoRelay: false },
    { boothId: 'booth-002', boothNumber: 2, autoRelay: false },
  ];

  const seats = [
    {
      seatId: 'seat-booth1-desk1',
      boothId: 'booth-001',
      deskNumber: 1,
      deskType: 'dicentis',
      aLanguageId: 'lang-001',
      bLanguageId: 'lang-002',
      bLanguageList: ['lang-002', 'lang-003'],
      cLanguageId: 'lang-003',
      cLanguageList: ['lang-003', 'lang-004'],
      status: 'connected',
    },
    {
      seatId: 'seat-booth1-desk2',
      boothId: 'booth-001',
      deskNumber: 2,
      deskType: 'dicentis',
      aLanguageId: 'lang-002',
      bLanguageId: 'lang-001',
      bLanguageList: ['lang-001', 'lang-003'],
      cLanguageId: 'lang-004',
      cLanguageList: ['lang-002', 'lang-004'],
      status: 'connected',
    },
    {
      seatId: 'seat-booth2-desk1',
      boothId: 'booth-002',
      deskNumber: 1,
      deskType: 'dicentis',
      aLanguageId: 'lang-003',
      bLanguageId: 'lang-004',
      bLanguageList: ['lang-001', 'lang-004'],
      cLanguageId: 'lang-001',
      cLanguageList: ['lang-001', 'lang-002'],
      status: 'disconnected',
    },
    {
      seatId: 'seat-booth2-desk2',
      boothId: 'booth-002',
      deskNumber: 2,
      deskType: 'omneo',
      aLanguageId: 'lang-004',
      bLanguageId: 'lang-003',
      bLanguageList: ['lang-002', 'lang-003'],
      cLanguageId: 'lang-002',
      cLanguageList: ['lang-001', 'lang-003'],
      status: 'selected',
    },
  ];

  // One entry per desk (internal state); GetInterpretationRoutings only reports desks whose microphone is on, as the
  // real 6.50 server does. Source: floor language id, a language id, or '' for relay (quality 'unknown').
  const routings = seats.map((seat) => ({
    seatId: seat.seatId,
    sourceLanguageId: 'lang-floor',
    destinationLanguageId: '',
    destinationLanguageQuality: 'plus',
    microphoneState: 'off',
    autoRelayContribution: false,
  }));

  const boothNotifications = booths.map((booth) => ({
    boothId: booth.boothId,
    notifications: [],
  }));

  const metaFunctionStatus = {
    activeInterpretationMetaRequests: [],
    seatMetaData: seats.map((seat) => ({
      seatId: seat.seatId,
      seatMetaRequests: [],
    })),
  };

  state.interpretation = {
    languages,
    booths,
    seats,
    routings,
    boothNotifications,
    metaFunctionStatus,
  };
}

/**
 * Find a language by ID or fail.
 * @param {object} ctx context
 * @param {string} languageId
 * @returns {object} language object
 */
function findLanguage(ctx, languageId) {
  return (
    ctx.state.interpretation.languages.find((l) => l.languageId === languageId) ??
    ctx.fail(`Language '${languageId}' does not exist`)
  );
}

/**
 * Find a booth by ID or fail.
 * @param {object} ctx context
 * @param {string} boothId
 * @returns {object} booth object
 */
function findBooth(ctx, boothId) {
  return (
    ctx.state.interpretation.booths.find((b) => b.boothId === boothId) ??
    ctx.fail(`Booth '${boothId}' does not exist`)
  );
}

/**
 * Find a seat by ID or fail.
 * @param {object} ctx context
 * @param {string} seatId
 * @returns {object} seat object
 */
function findSeat(ctx, seatId) {
  return (
    ctx.state.interpretation.seats.find((s) => s.seatId === seatId) ??
    ctx.fail(`Seat '${seatId}' does not exist`)
  );
}

/**
 * Find a routing by seat ID or fail.
 * @param {object} ctx context
 * @param {string} seatId
 * @returns {object} routing object
 */
function findRouting(ctx, seatId) {
  return (
    ctx.state.interpretation.routings.find((r) => r.seatId === seatId) ??
    ctx.fail(`Routing for seat '${seatId}' does not exist`)
  );
}

/**
 * Find booth notifications by booth ID or fail.
 * @param {object} ctx context
 * @param {string} boothId
 * @returns {object} booth notifications object
 */
function findBoothNotifications(ctx, boothId) {
  return (
    ctx.state.interpretation.boothNotifications.find((n) => n.boothId === boothId) ??
    ctx.fail(`Booth notifications for '${boothId}' do not exist`)
  );
}

export default {
  // ============ Get Operations ============

  GetInterpretationLanguages: ({ state }) => {
    ensure(state);
    return { languages: state.interpretation.languages };
  },

  GetInterpretationRoutings: ({ state }) => {
    ensure(state);
    return { routings: state.interpretation.routings.filter(r => r.microphoneState !== 'off') };
  },

  GetInterpreterBooths: ({ state }) => {
    ensure(state);
    return { booths: state.interpretation.booths };
  },

  GetInterpreterSeats: ({ state }) => {
    ensure(state);
    return { seats: state.interpretation.seats };
  },

  GetBoothNotifications: ({ state }) => {
    ensure(state);
    return { notifications: state.interpretation.boothNotifications };
  },

  GetInterpretationMetaFunctionStatus: ({ state }) => {
    ensure(state);
    return { requestStatus: state.interpretation.metaFunctionStatus };
  },

  // ============ Set/Action Operations ============

  RaiseBoothNotification: (ctx, { boothId, notification }) => {
    ensure(ctx.state);
    findBooth(ctx, boothId);
    const boothNotif = findBoothNotifications(ctx, boothId);
    boothNotif.notifications.push(notification);
    ctx.fire('boothNotificationsChanged');
    return {};
  },

  GrantInterpretation: (ctx, { seatId, microphoneState }) => {
    ensure(ctx.state);
    const seat = findSeat(ctx, seatId);
    const routing = findRouting(ctx, seatId);
    routing.microphoneState = microphoneState;
    // The desk produces the language of the active output (WO-048): A/B/C preset language, nothing when off.
    const output = { activeOnOutputA: seat.aLanguageId, activeOnOutputB: seat.bLanguageId, activeOnOutputC: seat.cLanguageId }[microphoneState];
    if (output) routing.destinationLanguageId = output;
    ctx.fire('interpretationRoutingsChanged');
    return {};
  },

  SelectInterpretationFloor: (ctx, { seatId }) => {
    ensure(ctx.state);
    findSeat(ctx, seatId);
    const routing = findRouting(ctx, seatId);
    routing.sourceLanguageId = 'lang-floor';
    routing.destinationLanguageQuality = 'plus';
    ctx.fire('interpretationRoutingsChanged');
    return {};
  },

  SelectInterpretationInputLanguage: (ctx, { seatId, inputButton, languageId }) => {
    ensure(ctx.state);
    findSeat(ctx, seatId);
    findLanguage(ctx, languageId);
    const routing = findRouting(ctx, seatId);
    routing.sourceLanguageId = languageId;
    routing.destinationLanguageQuality = 'plus';
    ctx.fire('interpretationRoutingsChanged');
    ctx.fire('interpreterSeatsChanged'); // the input preset is desk configuration (real 6.50 fires both)
    return {};
  },

  SelectRelayInterpretation: (ctx, { seatId }) => {
    ensure(ctx.state);
    findSeat(ctx, seatId);
    const routing = findRouting(ctx, seatId);
    routing.sourceLanguageId = ''; // real 6.50: relay reports no source language
    routing.destinationLanguageQuality = 'unknown';
    ctx.fire('interpretationRoutingsChanged');
    return {};
  },

  SetInterpretationOutputPreset: (ctx, { seatId, outputButton, languageId }) => {
    ensure(ctx.state);
    const seat = findSeat(ctx, seatId);
    findLanguage(ctx, languageId);
    // Output B/C presets choose from the desk's configured lists (WO-048); A is fixed by configuration.
    const [key, list] = outputButton === 'outputPresetC' ? ['cLanguageId', seat.cLanguageList] : ['bLanguageId', seat.bLanguageList];
    if (!list.includes(languageId)) ctx.fail(`Language '${languageId}' is not available on ${outputButton}`);
    seat[key] = languageId;
    ctx.fire('interpreterSeatsChanged');
    const routing = findRouting(ctx, seatId);
    if (routing.microphoneState === (key === 'cLanguageId' ? 'activeOnOutputC' : 'activeOnOutputB')) {
      routing.destinationLanguageId = languageId;
      ctx.fire('interpretationRoutingsChanged');
    }
    return {};
  },

  IssueInterpreterMetaFunction: (ctx, { seatId, request }) => {
    ensure(ctx.state);
    findSeat(ctx, seatId);
    const metaStatus = ctx.state.interpretation.metaFunctionStatus;

    // Add to active requests if not already there
    if (!metaStatus.activeInterpretationMetaRequests.includes(request)) {
      metaStatus.activeInterpretationMetaRequests.push(request);
    }

    // Add to seat meta requests
    const seatMeta = metaStatus.seatMetaData.find((m) => m.seatId === seatId);
    if (seatMeta && !seatMeta.seatMetaRequests.includes(request)) {
      seatMeta.seatMetaRequests.push(request);
    }

    ctx.fire('interpretationMetaRequestStatusChanged');
    return {};
  },

  CancelInterpreterMetaFunction: (ctx, { seatId, request }) => {
    ensure(ctx.state);
    findSeat(ctx, seatId);
    const metaStatus = ctx.state.interpretation.metaFunctionStatus;

    // Remove from active requests
    const activeIdx = metaStatus.activeInterpretationMetaRequests.indexOf(request);
    if (activeIdx >= 0) {
      metaStatus.activeInterpretationMetaRequests.splice(activeIdx, 1);
    }

    // Remove from seat meta requests
    const seatMeta = metaStatus.seatMetaData.find((m) => m.seatId === seatId);
    if (seatMeta) {
      const seatIdx = seatMeta.seatMetaRequests.indexOf(request);
      if (seatIdx >= 0) {
        seatMeta.seatMetaRequests.splice(seatIdx, 1);
      }
    }

    ctx.fire('interpretationMetaRequestStatusChanged');
    return {};
  },
};
