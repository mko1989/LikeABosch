// Stateful, pure emulation of a few DICENTIS DCNM API areas for the mock dicentis-bridge (WO-079, DEC-006).
// No I/O, no timers. Enum values travel as their NAME strings (see docs/protocol/dcnm-api/types.json); data classes
// are plain objects with PascalCase property names. Parameter names are the documented C# names from api.json
// (the `args` object of handleCall is keyed by them, e.g. { languageInfo: {...} }).
import { randomUUID } from 'node:crypto';

export const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

/**
 * @typedef {object} DcnmWorld
 * @property {string} meetingId
 * @property {object} meeting DcnmMeetingStatusInfo-like
 * @property {object} area DcnmAreaConfigurationInfo
 * @property {object[]} seats DcnmSeatConfigurationInfo[]
 * @property {object[]} languages DcnmLanguageInfo[]
 * @property {object[]} meetingLanguages DcnmMeetingLanguageInfo[] (sorted by OrderNumber, numbered 1..n)
 * @property {object[]} desks DcnmMeetingDeskInfo[] (one per interpreter seat)
 * @property {object} interpretationSettings DcnmInterpretationSettingsInfo
 * @property {{ gains: object[], equalizers: object[], selections: object[], routingState: boolean, muted: boolean, vuOn: boolean, vuLevels: Record<string, number> }} audio
 * @property {object[]} systemGains DcnmGainSetting[]
 * @property {boolean} presentation
 * @property {Array<(kind: string, detail: object) => void>} listeners
 */

/** Enum member names (in value order), copied from docs/protocol/dcnm-api/types.json. */
const ENUMS = {
  DcnmAreaType: ['MeetingArea', 'BoothArea'],
  DcnmSeatType: ['ParticipantSeat', 'InterpreterSeat'],
  DcnmDanteOutOption: ['Disabled', 'DanteOutEnabledWhenMicOn', 'DanteOutEnabledAlways'],
  DcnmSpecialOperationType: ['None', 'ButtonOperated', 'PttOperated'],
  DcnmLicenseStateType: ['LicenseAbsent', 'LicenseApplied', 'ImpliedDisconnected', 'ImpliedConnected'],
  DcnmLanguageSourceType: ['Dicentis', 'DcnNgOmi', 'Dante'],
  DcnmMeetingState: ['Activated', 'Deactivated', 'Opened', 'Closed'],
  DcnmIDeskButtonFunctionType: ['None', 'StopWatchSwitch', 'VideoSwitch', 'LanguageOverview', 'SpeakSlow', 'HeadphoneSelection'],
  DcnmHeadphoneTypes: [
    'NoProtection', 'Bosch_LBB3443', 'Bosch_HDP_LWN', 'Bosch_HDP_HQ', 'Sennheiser_PX100_II', 'Sennheiser_PX200_II',
    'Koss_Porta_Pro_Classic', 'Bang_Olufsen_Form_2i', 'Bang_Olufsen_Play_3i', 'Harman_Kardon_Soho', 'Apple_MB770',
    'Apple_MD827ZM_B', 'Sennheiser_HME_46_DCN', 'Bosch_HDP_IHDS', 'Bosch_HDP_IHDS_no_pads', 'Bosch_HDP_IHDP',
    'Bosch_HDP_IHDP_no_pads', 'AKG_HSC15', 'Shure_IH6500', 'Sennheiser_HD300', 'Sennheiser_HD2_10', 'Bang_Olufsen_A8',
    'Creative_Aurvana_Air', 'AKG_K15', 'Pioneer_HDJ_CX', 'Sennheiser_HD2_30i', 'Roseselsa_Distant_Mountain',
    'Poly_Blackwire_5220_Stereo', 'Panasonic_RP_HS46E_W',
  ],
  DcnmInterpretationModeType: ['Interlock', 'Override', 'Merge', 'InterlockAOverrideB', 'InterlockBOverrideA'],
  DcnmAudioGainSettingType: [
    'Master', 'Loudspeaker', 'SoundReinforcement', 'AnalogIn0', 'AnalogOut0', 'AnalogIn1', 'AnalogOut1',
    'DanteDigitalIn0', 'DanteDigitalOut0', 'DanteDigitalIn1', 'DanteDigitalOut1', 'AnalogHeadroom', 'DanteHeadroom',
    'OmneoHeadroom', 'OmneoDigitalIn0', 'OmneoDigitalOut0', 'OmneoDigitalIn1', 'OmneoDigitalOut1',
  ],
  DcnmAudioEqualizerType: ['Loudspeaker', 'SoundReinforcement'],
  DcnmAudioEqualizerFilterType: ['LowShelving', 'Notch', 'HighShelving'],
  DcnmAudioSelectionSettingType: [
    'LoudspeakerActiveWhenSpeaking', 'HeadphoneAttenuationWhenSpeaking', 'MinimumHeadphoneAttenuationWhenSpeakingValue',
    'MaximumHeadphoneAttenuationWhenSpeakingValue', 'HeadphoneAttenuationWhenSpeakingValue', 'AcousticFeedbackSuppression',
    'AudioIn1Mode', 'AudioRoutingMode', 'TestToneType', 'DanteAudioIn1Mode', 'DanteAudioRoutingMode', 'ChimesOnHeadphones',
    'OmneoAudioIn1Mode', 'OmneoAudioRoutingMode',
  ],
  DcnmGainSettingType: ['Master', 'LoudspeakerFactor', 'SoundReinforcementFactor', 'AnalogIn0', 'AnalogOut0', 'AnalogIn1', 'AnalogOut1'],
  DcnmLevelSensorType: [
    'Loudspeaker', 'Microphone', 'SoundReinforcement', 'AnalogIn0', 'AnalogIn1', 'AnalogOut0', 'AnalogOut1',
    'DanteIn0', 'DanteIn1', 'DanteOut0', 'DanteOut1', 'OmneoIn0', 'OmneoIn1', 'OmneoOut0', 'OmneoOut1',
  ],
};

/** Default languages (Abbreviation, ShortAbbreviation, EnLabel, OrgLabel) used when no `languages` option is given. */
const DEFAULT_LANGUAGES = [
  { Abbreviation: 'EN', ShortAbbreviation: 'en', EnLabel: 'English', OrgLabel: 'English' },
  { Abbreviation: 'FR', ShortAbbreviation: 'fr', EnLabel: 'French', OrgLabel: 'Français' },
  { Abbreviation: 'DE', ShortAbbreviation: 'de', EnLabel: 'German', OrgLabel: 'Deutsch' },
  { Abbreviation: 'ES', ShortAbbreviation: 'es', EnLabel: 'Spanish', OrgLabel: 'Español' },
  { Abbreviation: 'IT', ShortAbbreviation: 'it', EnLabel: 'Italian', OrgLabel: 'Italiano' },
  { Abbreviation: 'NL', ShortAbbreviation: 'nl', EnLabel: 'Dutch', OrgLabel: 'Nederlands' },
  { Abbreviation: 'PT', ShortAbbreviation: 'pt', EnLabel: 'Portuguese', OrgLabel: 'Português' },
  { Abbreviation: 'PL', ShortAbbreviation: 'pl', EnLabel: 'Polish', OrgLabel: 'Polski' },
  { Abbreviation: 'RU', ShortAbbreviation: 'ru', EnLabel: 'Russian', OrgLabel: 'Русский' },
  { Abbreviation: 'AR', ShortAbbreviation: 'ar', EnLabel: 'Arabic', OrgLabel: 'العربية' },
  { Abbreviation: 'ZH', ShortAbbreviation: 'zh', EnLabel: 'Chinese', OrgLabel: '中文' },
  { Abbreviation: 'JA', ShortAbbreviation: 'ja', EnLabel: 'Japanese', OrgLabel: '日本語' },
];

const EQ_BANDS = [
  { FilterType: 'LowShelving', Frequency: 100 },
  { FilterType: 'Notch', Frequency: 500 },
  { FilterType: 'Notch', Frequency: 1000 },
  { FilterType: 'Notch', Frequency: 4000 },
  { FilterType: 'HighShelving', Frequency: 10000 },
];

/** Gain settings that exist in the emulated room: [type, value, min, max]. */
const ROOM_GAINS = [
  ['Master', 0, -60, 0],
  ['Loudspeaker', 0, -20, 10],
  ['SoundReinforcement', 0, -20, 10],
  ['AnalogIn0', 0, -20, 20],
  ['AnalogIn1', 0, -20, 20],
  ['DanteDigitalIn0', 0, -20, 20],
  ['DanteDigitalIn1', 0, -20, 20],
  ['AnalogOut0', 0, -20, 10],
  ['AnalogOut1', 0, -20, 10],
  ['DanteDigitalOut0', 0, -20, 10],
  ['DanteDigitalOut1', 0, -20, 10],
];

const GAIN_STEP = 0.5;
const DESK_LANGUAGE_KEYS = [
  'LanguageIdOfOutputA', 'OutBLanguageId', 'OutCLanguageId',
  'PreselectALanguageId', 'PreselectBLanguageId', 'PreselectCLanguageId', 'PreselectDLanguageId',
  'PreselectELanguageId', 'PreselectFLanguageId', 'PreselectGLanguageId',
];
const SEAT_FIELD_KINDS = {
  Name: 'string', Headroom: 'int', CanDiscuss: 'bool', CanManageMeeting: 'bool', CanUsePriority: 'bool',
  HasSpecialPermission: 'bool', HasLanguageDistributionLicense: 'bool', HasVotingLicense: 'bool',
  HasIdentificationLicense: 'bool', HasLanguageDistributionLicense2: 'DcnmLicenseStateType',
  HasVotingLicense2: 'DcnmLicenseStateType', HasIdentificationLicense2: 'DcnmLicenseStateType',
  DanteOut: 'DcnmDanteOutOption', VisType: 'DcnmSpecialOperationType', CameraId: 'guid', PrepositionId: 'int',
  Attributes: 'array',
};
const MEETING_LANGUAGE_FIELD_KINDS = {
  LanguageSourceType: 'DcnmLanguageSourceType', OutputToDante: 'bool', Stream2Enable: 'bool',
  Stream2OutputToDante: 'bool', Stream2FloorFill: 'bool',
};
const INTERPRETATION_FIELD_KINDS = {
  WithinBoothInterpretationMode: 'DcnmInterpretationModeType', BetweenBoothInterpretationMode: 'DcnmInterpretationModeType',
  WithinBoothEngagedIndication: 'bool', FlashingMicrophoneOnEngaged: 'bool', SpeakSlowly: 'bool',
  SpeakSlowRequestReleaseTime: 'int', MinimumSpeakSlowRequest: 'int', SpeakSlowSignallingReleaseTime: 'int',
  EnableConfigurationFromDesk: 'bool',
};

const bad = message => { const e = new Error(message); e.code = 'BAD_ARGS'; return e; };

function requireObject(v, what) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(`${what} must be an object`);
  return v;
}

function requireArray(v, what) {
  if (!Array.isArray(v)) throw bad(`${what} must be a list`);
  return v;
}

/** Validate one value against a kind: a primitive kind name or a DcnmXxx enum name. Returns the value. */
function checkKind(kind, v, what) {
  let ok;
  switch (kind) {
    case 'string': ok = typeof v === 'string'; break;
    case 'bool': ok = typeof v === 'boolean'; break;
    case 'int': ok = Number.isInteger(v); break;
    case 'guid': ok = typeof v === 'string'; break;
    case 'array': ok = Array.isArray(v); break;
    default: ok = ENUMS[kind]?.includes(v) === true;
  }
  if (!ok) throw bad(`${what} must be ${kind === 'guid' ? 'a Guid string' : kind.startsWith('Dcnm') ? `a ${kind} member name` : kind}`);
  return v;
}

function checkNumber(v, min, max, what) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`${what} must be a finite number`);
  if ((min !== undefined && v < min) || (max !== undefined && v > max)) throw bad(`${what} ${v} outside [${min}, ${max}]`);
  return v;
}

function checkInteger(v, min, max, what) {
  if (!Number.isInteger(v)) throw bad(`${what} must be an integer`);
  return checkNumber(v, min, max, what);
}

function find(list, predicate, what) {
  const found = list.find(predicate);
  if (!found) throw bad(`unknown ${what}`);
  return found;
}

function requireMeeting(world, meetingId) {
  if (meetingId !== world.meetingId) throw bad(`unknown meeting ${meetingId}`);
}

const copy = v => structuredClone(v);
const roundToStep = (v, step) => Math.round(v / step) * step + 0; // + 0 avoids -0

function notify(world, kind, detail = {}) {
  for (const fn of [...world.listeners]) fn(kind, detail);
}

function audioSettingsPayload(world) {
  return copy({
    AudioEqualizerSettingsList: world.audio.equalizers,
    AudioGainSettingList: world.audio.gains,
    AudioSelectionSettingList: world.audio.selections,
  });
}

function defaultMeetingLanguage(meetingId, languageId) {
  return {
    MeetingId: meetingId, LanguageId: languageId, OrderNumber: 0, LanguageSourceType: 'Dicentis',
    OutputToDante: false, Stream2Enable: false, Stream2Headroom: 0, MinimumStream2Headroom: -20,
    MaximumStream2Headroom: 0, Stream2OutputToDante: false, Stream2FloorFill: false,
  };
}

/** Validated optional fields of a DcnmMeetingLanguageInfo, merged over defaults by the caller. */
function meetingLanguagePatch(info, min, max) {
  const patch = {};
  for (const [key, kind] of Object.entries(MEETING_LANGUAGE_FIELD_KINDS)) {
    if (info[key] !== undefined) patch[key] = checkKind(kind, info[key], key);
  }
  if (info.Stream2Headroom !== undefined) patch.Stream2Headroom = checkNumber(info.Stream2Headroom, min, max, 'Stream2Headroom');
  return patch;
}

/** Replace the meeting language list with `list` (in the given order), numbered 1..n. */
function setMeetingLanguages(world, list) {
  list.forEach((m, i) => { m.OrderNumber = i + 1; });
  world.meetingLanguages.splice(0, world.meetingLanguages.length, ...list);
}

function removeMeetingLanguages(world, removed) {
  const removedIds = new Set(removed.map(m => m.LanguageId));
  setMeetingLanguages(world, world.meetingLanguages.filter(m => !removedIds.has(m.LanguageId)));
  for (const desk of world.desks) {
    for (const key of DESK_LANGUAGE_KEYS) if (removedIds.has(desk[key])) desk[key] = EMPTY_GUID;
    for (const key of ['OutputLanguageSetB', 'OutputLanguageSetC']) desk[key] = desk[key].filter(id => !removedIds.has(id));
  }
}

function buildMeetingLanguage(world, info, pending) {
  requireObject(info, 'meetingLanguageInfo');
  requireMeeting(world, info.MeetingId);
  checkKind('guid', info.LanguageId, 'LanguageId');
  if (!world.languages.some(l => l.LanguageId === info.LanguageId)) throw bad(`unknown language ${info.LanguageId}`);
  if (pending.includes(info.LanguageId) || world.meetingLanguages.some(m => m.LanguageId === info.LanguageId)) {
    throw bad(`language ${info.LanguageId} is already in the meeting`);
  }
  pending.push(info.LanguageId);
  return { ...defaultMeetingLanguage(world.meetingId, info.LanguageId), ...meetingLanguagePatch(info, -20, 0) };
}

function appendMeetingLanguages(world, built) {
  const base = world.meetingLanguages.length;
  built.forEach((m, i) => { m.OrderNumber = base + i + 1; });
  world.meetingLanguages.push(...built);
}

function checkLanguageRef(world, id, what) {
  checkKind('guid', id, what);
  if (id !== EMPTY_GUID && !world.meetingLanguages.some(m => m.LanguageId === id)) {
    throw bad(`${what}: ${id} is neither EMPTY_GUID nor a meeting language`);
  }
  return id;
}

function setPresentation(world, ev, active) {
  world.presentation = active;
  ev('PresentationStateChanged', active);
  notify(world, 'presentation', { active });
  return true;
}

const HANDLERS = {
  // --- RoomAudioControl (IRoomAudioControl) ---
  'RoomAudioControl.RequestAudioSettingsAsync': (w, _a, ev) => {
    ev('AudioSettingsChanged', audioSettingsPayload(w));
    return true;
  },
  'RoomAudioControl.AdjustAudioGainSettingsAsync': (w, a, ev) => {
    const s = requireObject(a.audioGainSetting, 'audioGainSetting');
    const gain = find(w.audio.gains, g => g.GainSettingType === s.GainSettingType, `gain setting ${s.GainSettingType}`);
    checkNumber(s.Value, gain.MinimumGain, gain.MaximumGain, 'Value');
    if (s.IsMuted !== undefined) checkKind('bool', s.IsMuted, 'IsMuted');
    if (s.IsPlayingTestTone !== undefined) checkKind('bool', s.IsPlayingTestTone, 'IsPlayingTestTone');
    gain.Value = roundToStep(s.Value, gain.StepSize);
    if (s.IsMuted !== undefined) gain.IsMuted = s.IsMuted;
    if (s.IsPlayingTestTone !== undefined) gain.IsPlayingTestTone = s.IsPlayingTestTone;
    ev('AudioSettingsChanged', audioSettingsPayload(w));
    notify(w, 'audio', { what: 'gain', type: gain.GainSettingType });
    return true;
  },
  'RoomAudioControl.AdjustAudioEqualizerSettingsAsync': (w, a, ev) => {
    const s = requireObject(a.equalizerSettings, 'equalizerSettings');
    checkKind('DcnmAudioEqualizerType', s.EqualizerType, 'EqualizerType');
    checkInteger(s.FilterNumber, 0, 4, 'FilterNumber');
    const band = find(w.audio.equalizers, e => e.EqualizerType === s.EqualizerType && e.FilterNumber === s.FilterNumber,
      `equalizer band ${s.EqualizerType}/${s.FilterNumber}`);
    const patch = {};
    if (s.FilterEnabled !== undefined) patch.FilterEnabled = checkKind('bool', s.FilterEnabled, 'FilterEnabled');
    if (s.FilterType !== undefined) patch.FilterType = checkKind('DcnmAudioEqualizerFilterType', s.FilterType, 'FilterType');
    if (s.Gain !== undefined) patch.Gain = checkNumber(s.Gain, -12, 12, 'Gain');
    if (s.Frequency !== undefined) patch.Frequency = checkInteger(s.Frequency, 20, 20000, 'Frequency');
    if (s.QFactor !== undefined) patch.QFactor = checkNumber(s.QFactor, 0.1, 10, 'QFactor');
    Object.assign(band, patch);
    ev('AudioSettingsChanged', audioSettingsPayload(w));
    notify(w, 'audio', { what: 'equalizer', equalizerType: band.EqualizerType, filterNumber: band.FilterNumber });
    return true;
  },
  'RoomAudioControl.AdjustAudioSelectionSettingsAsync': (w, a, ev) => {
    const s = requireObject(a.audioSelectionSetting, 'audioSelectionSetting');
    const sel = find(w.audio.selections, x => x.SelectionSettingType === s.SelectionSettingType,
      `audio selection setting ${s.SelectionSettingType}`);
    checkInteger(s.Value, undefined, undefined, 'Value');
    sel.Value = s.Value;
    ev('AudioSettingsChanged', audioSettingsPayload(w));
    notify(w, 'audio', { what: 'selection', type: sel.SelectionSettingType });
    return true;
  },
  'RoomAudioControl.RequestVUMeterReadingsAsync': (w) => {
    w.audio.vuOn = true;
    notify(w, 'audio', { what: 'vuOn', vuOn: true });
    return true;
  },
  'RoomAudioControl.CancelVUMeterReadingsAsync': (w) => {
    w.audio.vuOn = false;
    notify(w, 'audio', { what: 'vuOn', vuOn: false });
    return true;
  },
  'RoomAudioControl.RequestRoomAudioRoutingStateAsync': (w, _a, ev) => {
    ev('RoomAudioRoutingStateChanged', w.audio.routingState);
    return true;
  },

  // --- SystemAudioControlApi ---
  'SystemAudioControlApi.RequestGainsAsync': (w, _a, ev) => {
    ev('GainSettingsChanged', copy(w.systemGains));
    return true;
  },
  'SystemAudioControlApi.AdjustGainAsync': (w, a, ev) => {
    const s = requireObject(a.gainSetting, 'gainSetting');
    const gain = find(w.systemGains, g => g.GainSettingType === s.GainSettingType, `system gain ${s.GainSettingType}`);
    gain.GainSettingValue = checkInteger(s.GainSettingValue, undefined, undefined, 'GainSettingValue');
    ev('GainSettingsChanged', copy(w.systemGains));
    notify(w, 'audio', { what: 'systemGain', type: gain.GainSettingType });
    return true;
  },
  'SystemAudioControlApi.RequestMuteAsync': (w, _a, ev) => {
    ev('MuteStateChanged', w.audio.muted);
    return true;
  },

  // --- ConfigSite / ConfigArea ---
  'ConfigSite.GetAreasAsync': (w, a) => {
    const areas = [copy(w.area)];
    return a.areaControllerId === undefined ? areas : areas.filter(x => x.AreaControllerId === a.areaControllerId);
  },
  'ConfigArea.GetSeatsAsync': (w, a) => {
    checkKind('guid', a.areaId, 'areaId');
    return copy(w.seats.filter(s => s.AreaId === a.areaId));
  },
  'ConfigArea.UpdateSeatsAsync': (w, a, ev) => {
    const infos = requireArray(a.seatInfos, 'seatInfos');
    const updates = infos.map(info => {
      requireObject(info, 'seatInfo');
      const seat = find(w.seats, s => s.Id === info.Id, `seat ${info.Id}`);
      const patch = {};
      for (const [key, kind] of Object.entries(SEAT_FIELD_KINDS)) {
        if (info[key] !== undefined) patch[key] = checkKind(kind, info[key], key);
      }
      return { seat, patch };
    });
    for (const { seat, patch } of updates) Object.assign(seat, patch);
    ev('SeatsUpdated', copy(updates.map(u => u.seat)));
    notify(w, 'seats', { updated: updates.length });
    return true;
  },

  // --- ConfigLanguage ---
  'ConfigLanguage.GetLanguagesAsync': (w) => copy(w.languages),
  'ConfigLanguage.CreateLanguageAsync': (w, a, ev) => {
    const info = requireObject(a.languageInfo, 'languageInfo');
    checkKind('string', info.Abbreviation, 'Abbreviation');
    checkKind('string', info.EnLabel, 'EnLabel');
    if (!info.Abbreviation.trim() || !info.EnLabel.trim()) throw bad('Abbreviation and EnLabel are required');
    const key = info.Abbreviation.toLowerCase();
    if (w.languages.some(l => l.Abbreviation.toLowerCase() === key)) throw bad(`Abbreviation ${info.Abbreviation} already exists`);
    const language = {
      LanguageId: randomUUID(),
      Abbreviation: info.Abbreviation,
      ShortAbbreviation: typeof info.ShortAbbreviation === 'string' ? info.ShortAbbreviation : '',
      EnLabel: info.EnLabel,
      OrgLabel: typeof info.OrgLabel === 'string' ? info.OrgLabel : info.EnLabel,
      UserDefined: true,
      OrderId: w.languages.reduce((max, l) => Math.max(max, l.OrderId), 0) + 1,
    };
    w.languages.push(language);
    ev('LanguageCreated', copy(language));
    notify(w, 'languages', { action: 'created', languageId: language.LanguageId });
    return language.LanguageId;
  },
  'ConfigLanguage.UpdateLanguageAsync': (w, a, ev) => {
    const info = requireObject(a.languageInfo, 'languageInfo');
    const language = find(w.languages, l => l.LanguageId === info.LanguageId, `language ${info.LanguageId}`);
    if (!language.UserDefined) throw bad(`language ${language.Abbreviation} is not user defined and cannot be changed`);
    const patch = {};
    for (const key of ['Abbreviation', 'ShortAbbreviation', 'EnLabel', 'OrgLabel']) {
      if (info[key] !== undefined) patch[key] = checkKind('string', info[key], key);
    }
    if (patch.Abbreviation !== undefined) {
      const key = patch.Abbreviation.toLowerCase();
      if (w.languages.some(l => l !== language && l.Abbreviation.toLowerCase() === key)) throw bad(`Abbreviation ${patch.Abbreviation} already exists`);
    }
    Object.assign(language, patch);
    ev('LanguageUpdated', copy(language));
    notify(w, 'languages', { action: 'updated', languageId: language.LanguageId });
    return true;
  },
  'ConfigLanguage.DeleteLanguageAsync': (w, a, ev) => {
    const language = find(w.languages, l => l.LanguageId === a.languageId, `language ${a.languageId}`);
    if (!language.UserDefined) throw bad(`language ${language.Abbreviation} is not user defined and cannot be deleted`);
    if (w.meetingLanguages.some(m => m.LanguageId === language.LanguageId)) throw bad(`language ${language.Abbreviation} is used in a meeting`);
    w.languages.splice(w.languages.indexOf(language), 1);
    ev('LanguageDeleted', language.LanguageId);
    notify(w, 'languages', { action: 'deleted', languageId: language.LanguageId });
    return true;
  },

  // --- ConfigInterpretation ---
  'ConfigInterpretation.GetMeetingLanguagesAsync': (w, a) =>
    copy(w.meetingLanguages.filter(m => m.MeetingId === a.meetingId).sort((x, y) => x.OrderNumber - y.OrderNumber)),
  'ConfigInterpretation.CreateMeetingLanguageAsync': (w, a, ev) => {
    const pending = [];
    const built = buildMeetingLanguage(w, a.meetingLanguageInfo, pending);
    appendMeetingLanguages(w, [built]);
    ev('MeetingLanguageCreated', copy(built));
    notify(w, 'meetingLanguages', { action: 'created', languageId: built.LanguageId });
    return true;
  },
  'ConfigInterpretation.CreateMeetingLanguagesAsync': (w, a, ev) => {
    const infos = requireArray(a.meetingLanguageInfos, 'meetingLanguageInfos');
    const pending = [];
    const built = infos.map(info => buildMeetingLanguage(w, info, pending));
    if (built.length) {
      appendMeetingLanguages(w, built);
      ev('MeetingLanguagesCreated', copy(built));
      notify(w, 'meetingLanguages', { action: 'created', languageIds: pending });
    }
    return true;
  },
  'ConfigInterpretation.DeleteMeetingLanguageAsync': (w, a, ev) => {
    requireMeeting(w, a.meetingId);
    const removed = find(w.meetingLanguages, m => m.OrderNumber === a.orderId, `meeting language orderId ${a.orderId}`);
    removeMeetingLanguages(w, [removed]);
    ev('MeetingLanguageDeleted', copy(removed));
    notify(w, 'meetingLanguages', { action: 'deleted', languageId: removed.LanguageId });
    return true;
  },
  'ConfigInterpretation.DeleteMeetingLanguagesAsync': (w, a, ev) => {
    requireMeeting(w, a.meetingId);
    const orderIds = requireArray(a.orderIds, 'orderIds');
    if (new Set(orderIds).size !== orderIds.length) throw bad('orderIds must be unique');
    const removed = orderIds.map(id => find(w.meetingLanguages, m => m.OrderNumber === id, `meeting language orderId ${id}`));
    removeMeetingLanguages(w, removed);
    ev('MeetingLanguagesDeleted', copy(removed));
    notify(w, 'meetingLanguages', { action: 'deleted', languageIds: removed.map(m => m.LanguageId) });
    return true;
  },
  'ConfigInterpretation.UpdateMeetingLanguageAsync': (w, a, ev) => {
    const info = requireObject(a.meetingLanguageInfo, 'meetingLanguageInfo');
    requireMeeting(w, info.MeetingId);
    const entry = find(w.meetingLanguages, m => m.MeetingId === info.MeetingId && m.LanguageId === info.LanguageId,
      `meeting language ${info.LanguageId}`);
    const patch = meetingLanguagePatch(info, entry.MinimumStream2Headroom, entry.MaximumStream2Headroom);
    Object.assign(entry, patch);
    ev('MeetingLanguageUpdated', copy(entry));
    notify(w, 'meetingLanguages', { action: 'updated', languageId: entry.LanguageId });
    return true;
  },
  'ConfigInterpretation.ChangeMeetingLanguagesOrderAsync': (w, a, ev) => {
    requireMeeting(w, a.meetingId);
    const ids = requireArray(a.meetingLanguageIds, 'meetingLanguageIds');
    const current = w.meetingLanguages.map(m => m.OrderNumber);
    const isPermutation = ids.length === current.length && new Set(ids).size === ids.length && ids.every(id => current.includes(id));
    if (!isPermutation) throw bad('meetingLanguageIds must be a permutation of the current order numbers');
    const reordered = ids.map(id => w.meetingLanguages.find(m => m.OrderNumber === id));
    setMeetingLanguages(w, reordered);
    ev('MeetingLanguageOrderChanged');
    notify(w, 'meetingLanguages', { action: 'reordered' });
    return true;
  },
  'ConfigInterpretation.RetrieveMeetingDesksAsync': (w, a) => copy(w.desks.filter(d => d.MeetingId === a.meetingId)),
  'ConfigInterpretation.RetrieveMeetingDeskAsync': (w, a) =>
    copy(find(w.desks, d => d.MeetingId === a.meetingId && d.SeatId === a.seatId, `desk for seat ${a.seatId}`)),
  'ConfigInterpretation.UpdateMeetingDeskInfoAsync': (w, a, ev) => {
    const info = requireObject(a.meetingDeskInfo, 'meetingDeskInfo');
    requireMeeting(w, info.MeetingId);
    const desk = find(w.desks, d => d.SeatId === info.SeatId, `desk for seat ${info.SeatId}`);
    const patch = {};
    for (const key of DESK_LANGUAGE_KEYS) {
      if (info[key] !== undefined) patch[key] = checkLanguageRef(w, info[key], key);
    }
    for (const key of ['OutputLanguageSetB', 'OutputLanguageSetC']) {
      if (info[key] !== undefined) patch[key] = requireArray(info[key], key).map(id => checkLanguageRef(w, id, key));
    }
    if (info.AudioVideoDelay !== undefined) patch.AudioVideoDelay = checkKind('int', info.AudioVideoDelay, 'AudioVideoDelay');
    if (info.Headphone !== undefined) patch.Headphone = checkKind('DcnmHeadphoneTypes', info.Headphone, 'Headphone');
    if (info.AutomaticMicrophoneSelection !== undefined) {
      patch.AutomaticMicrophoneSelection = checkKind('bool', info.AutomaticMicrophoneSelection, 'AutomaticMicrophoneSelection');
    }
    for (const letter of ['E', 'F', 'G']) {
      const setKey = `${letter}ButtonFunctionSet`;
      if (info[setKey] !== undefined) {
        patch[setKey] = requireArray(info[setKey], setKey).map(f => checkKind('DcnmIDeskButtonFunctionType', f, setKey));
      }
      const fnKey = `Preselect${letter}ButtonFunction`;
      if (info[fnKey] !== undefined) patch[fnKey] = checkKind('DcnmIDeskButtonFunctionType', info[fnKey], fnKey);
    }
    Object.assign(desk, patch);
    ev('MeetingDeskInfoChanged', copy(desk));
    notify(w, 'desks', { seatId: desk.SeatId });
    return true;
  },
  'ConfigInterpretation.GetInterpretationSettingsAsync': (w, a) => {
    requireMeeting(w, a.meetingId);
    return copy(w.interpretationSettings);
  },
  'ConfigInterpretation.UpdateInterpretationSettingsAsync': (w, a, ev) => {
    const info = requireObject(a.interpretationSettingsInfo, 'interpretationSettingsInfo');
    requireMeeting(w, info.MeetingId);
    const patch = {};
    for (const [key, kind] of Object.entries(INTERPRETATION_FIELD_KINDS)) {
      if (info[key] !== undefined) patch[key] = checkKind(kind, info[key], key);
    }
    if (info.SelectedHeadphones !== undefined) {
      patch.SelectedHeadphones = requireArray(info.SelectedHeadphones, 'SelectedHeadphones')
        .map(h => checkKind('DcnmHeadphoneTypes', h, 'SelectedHeadphones'));
    }
    Object.assign(w.interpretationSettings, patch);
    ev('InterpretationSettingsUpdated', copy(w.interpretationSettings));
    notify(w, 'desks', { what: 'interpretationSettings' });
    return true;
  },
  'ConfigInterpretation.GetAvailableDanteLicensesAsync': () => 8,

  // --- ControlMeeting ---
  'ControlMeeting.RequestActiveMeetingStatusAsync': (w, _a, ev) => {
    ev('ActiveMeetingStatusChanged', copy(w.meeting));
    return true;
  },
  'ControlMeeting.RequestMeetingsListAsync': (w, _a, ev) => {
    ev('MeetingsListChanged', [copy(w.meeting)]);
    return true;
  },

  // --- ControlPresentationApi ---
  'ControlPresentationApi.RequestPresentationStateAsync': (w, _a, ev) => {
    ev('PresentationStateChanged', w.presentation);
    return true;
  },
  'ControlPresentationApi.ActivatePresentationAsync': (w, _a, ev) => setPresentation(w, ev, true),
  'ControlPresentationApi.DeactivatePresentationAsync': (w, _a, ev) => setPresentation(w, ev, false),
};

/**
 * Create a DCNM world. Seats are numbered 1..n: participant seats first, then interpreter seats.
 * @param {{ seats?: {id?: string, name?: string}[], interpreterSeats?: {id?: string, name?: string}[], meetingId?: string,
 *   meetingTitle?: string, languages?: object[], meetingLanguageIds?: string[], presentation?: boolean }} [options]
 * @returns {DcnmWorld}
 */
export function createDcnmWorld({ seats = [], interpreterSeats = [], meetingId = randomUUID(), meetingTitle = 'Meeting', languages, meetingLanguageIds, presentation = false } = {}) {
  const area = { Id: randomUUID(), Name: 'Main area', AreaNumber: 1, AreaType: ENUMS.DcnmAreaType[0], AreaControllerId: EMPTY_GUID };

  const seatList = [
    ...seats.map(s => ({ seat: s, type: 'ParticipantSeat' })),
    ...interpreterSeats.map(s => ({ seat: s, type: 'InterpreterSeat' })),
  ].map(({ seat, type }, i) => ({
    Id: seat.id ?? randomUUID(),
    Name: seat.name ?? `Seat ${i + 1}`,
    AreaId: area.Id,
    SeatType: type,
    SeatNumber: i + 1,
    DanteOut: 'Disabled',
    Headroom: 0,
    CanDiscuss: true,
    CanManageMeeting: false,
    CanUsePriority: false,
    HasSpecialPermission: false,
    HasLanguageDistributionLicense: false,
    HasVotingLicense: false,
    HasIdentificationLicense: false,
    HasLanguageDistributionLicense2: 'LicenseAbsent',
    HasVotingLicense2: 'LicenseAbsent',
    HasIdentificationLicense2: 'LicenseAbsent',
    VisType: 'None',
    CameraId: EMPTY_GUID,
    PrepositionId: 0,
    Attributes: [],
  }));

  const languageList = (languages ?? DEFAULT_LANGUAGES).map((l, i) => ({
    LanguageId: l.LanguageId ?? randomUUID(),
    Abbreviation: l.Abbreviation,
    ShortAbbreviation: l.ShortAbbreviation ?? '',
    EnLabel: l.EnLabel,
    OrgLabel: l.OrgLabel ?? l.EnLabel,
    UserDefined: false,
    OrderId: i + 1,
  }));

  const initialIds = meetingLanguageIds ?? languageList.slice(0, 4).map(l => l.LanguageId);
  const meetingLanguages = initialIds.map((languageId, i) => {
    if (!languageList.some(l => l.LanguageId === languageId)) throw new Error(`createDcnmWorld: unknown language ${languageId}`);
    return { ...defaultMeetingLanguage(meetingId, languageId), OrderNumber: i + 1 };
  });
  const ids = meetingLanguages.map(m => m.LanguageId);

  const desks = seatList.filter(s => s.SeatType === 'InterpreterSeat').map((seat, i) => {
    const n = ids.length;
    const pick = k => (n ? ids[(i + k) % n] : EMPTY_GUID);
    return {
      MeetingId: meetingId,
      SeatId: seat.Id,
      LanguageIdOfOutputA: pick(0),
      OutBLanguageId: pick(1),
      OutCLanguageId: pick(2),
      OutputLanguageSetB: [...ids],
      OutputLanguageSetC: [...ids],
      PreselectALanguageId: EMPTY_GUID,
      PreselectBLanguageId: EMPTY_GUID,
      PreselectCLanguageId: EMPTY_GUID,
      PreselectDLanguageId: EMPTY_GUID,
      PreselectELanguageId: EMPTY_GUID,
      PreselectFLanguageId: EMPTY_GUID,
      PreselectGLanguageId: EMPTY_GUID,
      EButtonFunctionSet: [],
      FButtonFunctionSet: [],
      GButtonFunctionSet: [],
      PreselectEButtonFunction: ENUMS.DcnmIDeskButtonFunctionType[0],
      PreselectFButtonFunction: ENUMS.DcnmIDeskButtonFunctionType[0],
      PreselectGButtonFunction: ENUMS.DcnmIDeskButtonFunctionType[0],
      Headphone: 'NoProtection',
      AutomaticMicrophoneSelection: false,
      AudioVideoDelay: 0,
    };
  });

  const now = new Date().toISOString();
  const gains = ROOM_GAINS.map(([GainSettingType, Value, MinimumGain, MaximumGain]) => ({
    GainSettingType, Value, MinimumGain, MaximumGain, StepSize: GAIN_STEP, IsMuted: false, IsPlayingTestTone: false,
  }));
  const equalizers = ['Loudspeaker', 'SoundReinforcement'].flatMap(EqualizerType => EQ_BANDS.map((band, FilterNumber) => ({
    EqualizerType, FilterNumber, FilterType: band.FilterType, FilterEnabled: true, Gain: 0, Frequency: band.Frequency, QFactor: 1,
  })));
  const selections = ENUMS.DcnmAudioSelectionSettingType.map(SelectionSettingType => ({
    SelectionSettingType,
    Value: SelectionSettingType === 'HeadphoneAttenuationWhenSpeakingValue' ? 6
      : SelectionSettingType === 'MaximumHeadphoneAttenuationWhenSpeakingValue' ? 12 : 0,
  }));
  const vuLevels = Object.fromEntries(ENUMS.DcnmLevelSensorType.map(name => [name, -40]));
  Object.assign(vuLevels, { Loudspeaker: -23, SoundReinforcement: -30, Microphone: -45 });

  return {
    meetingId,
    meeting: {
      MeetingId: meetingId, Title: meetingTitle, Description: '', DocumentationRef: '', State: 'Opened', IsDefault: false,
      AutoOpenOnActivate: false, AutoStartAgendaOnOpen: false, DefaultDiscussionId: EMPTY_GUID,
      MeetingStartDate: now, MeetingEndDate: now, AgendaList: [],
    },
    area,
    seats: seatList,
    languages: languageList,
    meetingLanguages,
    desks,
    interpretationSettings: {
      MeetingId: meetingId, WithinBoothInterpretationMode: 'Interlock', BetweenBoothInterpretationMode: 'Interlock',
      WithinBoothEngagedIndication: false, FlashingMicrophoneOnEngaged: false, SpeakSlowly: false,
      SpeakSlowRequestReleaseTime: 30, MinimumSpeakSlowRequest: 1, SpeakSlowSignallingReleaseTime: 5,
      EnableConfigurationFromDesk: false, SelectedHeadphones: [],
    },
    audio: { gains, equalizers, selections, routingState: false, muted: false, vuOn: false, vuLevels },
    systemGains: ENUMS.DcnmGainSettingType.map(GainSettingType => ({ GainSettingType, GainSettingValue: 0 })),
    presentation: Boolean(presentation),
    listeners: [],
  };
}

/**
 * Handle one API call against the world.
 * @param {DcnmWorld} world
 * @param {string} api e.g. 'RoomAudioControl', 'ConfigLanguage'
 * @param {string} method e.g. 'CreateLanguageAsync'
 * @param {Record<string, unknown>} [args] keyed by the documented C# parameter names
 * @param {(api: string, eventName: string, parameter?: unknown) => void} [emit]
 * @returns {{ result: unknown } | undefined} undefined when (api, method) is not emulated here
 * @throws {Error} with .code = 'BAD_ARGS' on invalid input
 */
export function handleCall(world, api, method, args, emit) {
  const key = `${api}.${method}`;
  if (!Object.hasOwn(HANDLERS, key)) return undefined;
  const ev = (name, parameter) => { if (typeof emit === 'function') emit(api, name, parameter); };
  return { result: HANDLERS[key](world, args ?? {}, ev) };
}

/**
 * One set of VU readings (random walk around plausible dBFS values). Changes world state.
 * @param {DcnmWorld} world
 * @returns {{ ReadingsDictionary: Record<string, number> }} one key per DcnmLevelSensorType member
 */
export function vuReadings(world) {
  const dictionary = {};
  for (const name of ENUMS.DcnmLevelSensorType) {
    const next = Math.min(0, Math.max(-60, world.audio.vuLevels[name] + (Math.random() - 0.5) * 2));
    world.audio.vuLevels[name] = next;
    dictionary[name] = Math.round(next * 10) / 10 + 0;
  }
  return { ReadingsDictionary: dictionary };
}

/**
 * Register a change listener.
 * @param {DcnmWorld} world
 * @param {(kind: 'languages' | 'meetingLanguages' | 'desks' | 'presentation' | 'seats' | 'audio', detail: object) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onChange(world, fn) {
  world.listeners.push(fn);
  return () => {
    const i = world.listeners.indexOf(fn);
    if (i >= 0) world.listeners.splice(i, 1);
  };
}
