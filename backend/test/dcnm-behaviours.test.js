// Unit tests for the pure DCNM behaviour emulation used by the mock dicentis-bridge (mock/dcnm/behaviours.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_GUID, createDcnmWorld, handleCall, onChange, vuReadings } from '../../mock/dcnm/behaviours.js';

const LEVEL_SENSORS = [
  'Loudspeaker', 'Microphone', 'SoundReinforcement', 'AnalogIn0', 'AnalogIn1', 'AnalogOut0', 'AnalogOut1',
  'DanteIn0', 'DanteIn1', 'DanteOut0', 'DanteOut1', 'OmneoIn0', 'OmneoIn1', 'OmneoOut0', 'OmneoOut1',
];

function harness(options = {}) {
  const world = createDcnmWorld({
    seats: [{ id: 'seat-p1', name: 'Alice' }, { id: 'seat-p2', name: 'Bob' }],
    interpreterSeats: [{ id: 'seat-i1', name: 'Interpreter 1' }, { id: 'seat-i2', name: 'Interpreter 2' }],
    ...options,
  });
  const events = [];
  const emit = (api, name, parameter) => events.push({ api, name, parameter });
  const call = (api, method, args) => handleCall(world, api, method, args, emit);
  const expectBadArgs = fn => assert.throws(fn, err => err.code === 'BAD_ARGS');
  return { world, events, call, expectBadArgs };
}

test('world defaults: languages, meeting languages, seats and desks', () => {
  const { world } = harness();
  assert.equal(world.languages.length, 12);
  assert.equal(world.languages[0].Abbreviation, 'EN');
  assert.equal(world.languages[0].EnLabel, 'English');
  assert.ok(world.languages.every(l => l.UserDefined === false));
  assert.deepEqual(world.languages.map(l => l.OrderId), world.languages.map((_, i) => i + 1));

  assert.equal(world.meetingLanguages.length, 4);
  assert.deepEqual(world.meetingLanguages.map(m => m.OrderNumber), [1, 2, 3, 4]);
  assert.ok(world.meetingLanguages.every(m => m.LanguageSourceType === 'Dicentis' && m.MeetingId === world.meetingId));
  assert.deepEqual(world.meetingLanguages.map(m => m.LanguageId), world.languages.slice(0, 4).map(l => l.LanguageId));

  assert.equal(world.area.AreaType, 'MeetingArea');
  assert.deepEqual(world.seats.map(s => s.SeatNumber), [1, 2, 3, 4]);
  assert.deepEqual(world.seats.map(s => s.SeatType), ['ParticipantSeat', 'ParticipantSeat', 'InterpreterSeat', 'InterpreterSeat']);
  assert.ok(world.seats.every(s => s.AreaId === world.area.Id && s.DanteOut === 'Disabled' && s.VisType === 'None'));

  // One desk per interpreter seat; output A/B/C take consecutive meeting languages.
  assert.equal(world.desks.length, 2);
  const ids = world.meetingLanguages.map(m => m.LanguageId);
  assert.equal(world.desks[0].SeatId, 'seat-i1');
  assert.equal(world.desks[0].LanguageIdOfOutputA, ids[0]);
  assert.equal(world.desks[0].OutBLanguageId, ids[1]);
  assert.equal(world.desks[0].OutCLanguageId, ids[2]);
  assert.equal(world.desks[1].LanguageIdOfOutputA, ids[1]);
  assert.deepEqual(world.desks[1].OutputLanguageSetB, ids);
  assert.equal(world.desks[1].Headphone, 'NoProtection');
  assert.equal(world.desks[1].PreselectEButtonFunction, 'None');
});

test('world with explicit languages and no interpreter seats', () => {
  const world = createDcnmWorld({
    languages: [{ LanguageId: 'l-1', Abbreviation: 'XX', ShortAbbreviation: 'xx', EnLabel: 'Xish', OrgLabel: 'Xish' }],
    meetingLanguageIds: ['l-1'],
  });
  assert.equal(world.languages[0].OrderId, 1);
  assert.deepEqual(world.meetingLanguages.map(m => m.LanguageId), ['l-1']);
  assert.deepEqual(world.desks, []);
});

test('gain adjust rounds to the step, updates state and emits AudioSettingsChanged', () => {
  const { world, events, call, expectBadArgs } = harness();
  const kinds = [];
  onChange(world, kind => kinds.push(kind));

  assert.deepEqual(call('RoomAudioControl', 'AdjustAudioGainSettingsAsync', {
    audioGainSetting: { GainSettingType: 'Loudspeaker', Value: 3.3 },
  }), { result: true });
  const gain = world.audio.gains.find(g => g.GainSettingType === 'Loudspeaker');
  assert.equal(gain.Value, 3.5);
  assert.equal(events.length, 1);
  assert.equal(events[0].api, 'RoomAudioControl');
  assert.equal(events[0].name, 'AudioSettingsChanged');
  assert.deepEqual(Object.keys(events[0].parameter).sort(),
    ['AudioEqualizerSettingsList', 'AudioGainSettingList', 'AudioSelectionSettingList']);
  assert.equal(events[0].parameter.AudioGainSettingList.find(g => g.GainSettingType === 'Loudspeaker').Value, 3.5);
  assert.ok(kinds.includes('audio'));

  // Out of [MinimumGain, MaximumGain] (Loudspeaker: -20..10) is rejected and nothing changes.
  expectBadArgs(() => call('RoomAudioControl', 'AdjustAudioGainSettingsAsync', {
    audioGainSetting: { GainSettingType: 'Loudspeaker', Value: 11 },
  }));
  assert.equal(gain.Value, 3.5);
  assert.equal(events.length, 1);

  // Unknown gain type.
  expectBadArgs(() => call('RoomAudioControl', 'AdjustAudioGainSettingsAsync', {
    audioGainSetting: { GainSettingType: 'OmneoDigitalIn0', Value: 0 },
  }));
  // Non-numeric value.
  expectBadArgs(() => call('RoomAudioControl', 'AdjustAudioGainSettingsAsync', {
    audioGainSetting: { GainSettingType: 'Master', Value: 'loud' },
  }));
});

test('equalizer band update validates ranges and emits', () => {
  const { world, events, call, expectBadArgs } = harness();
  call('RoomAudioControl', 'AdjustAudioEqualizerSettingsAsync', {
    equalizerSettings: { EqualizerType: 'Loudspeaker', FilterNumber: 2, Gain: 6, Frequency: 1200, QFactor: 2.5 },
  });
  const band = world.audio.equalizers.find(e => e.EqualizerType === 'Loudspeaker' && e.FilterNumber === 2);
  assert.equal(band.Gain, 6);
  assert.equal(band.Frequency, 1200);
  assert.equal(band.QFactor, 2.5);
  assert.equal(band.FilterType, 'Notch');
  assert.equal(events.at(-1).name, 'AudioSettingsChanged');

  expectBadArgs(() => call('RoomAudioControl', 'AdjustAudioEqualizerSettingsAsync', {
    equalizerSettings: { EqualizerType: 'Loudspeaker', FilterNumber: 2, Gain: 13 },
  }));
  expectBadArgs(() => call('RoomAudioControl', 'AdjustAudioEqualizerSettingsAsync', {
    equalizerSettings: { EqualizerType: 'Loudspeaker', FilterNumber: 2, QFactor: 0.05 },
  }));
  expectBadArgs(() => call('RoomAudioControl', 'AdjustAudioEqualizerSettingsAsync', {
    equalizerSettings: { EqualizerType: 'Loudspeaker', FilterNumber: 2, Frequency: 19 },
  }));
  expectBadArgs(() => call('RoomAudioControl', 'AdjustAudioEqualizerSettingsAsync', {
    equalizerSettings: { EqualizerType: 'Loudspeaker', FilterNumber: 7, Gain: 1 },
  }));
});

test('audio selection, routing state, mute and VU meter state', () => {
  const { world, events, call, expectBadArgs } = harness();
  call('RoomAudioControl', 'AdjustAudioSelectionSettingsAsync', {
    audioSelectionSetting: { SelectionSettingType: 'HeadphoneAttenuationWhenSpeakingValue', Value: 9 },
  });
  assert.equal(world.audio.selections.find(s => s.SelectionSettingType === 'HeadphoneAttenuationWhenSpeakingValue').Value, 9);
  expectBadArgs(() => call('RoomAudioControl', 'AdjustAudioSelectionSettingsAsync', {
    audioSelectionSetting: { SelectionSettingType: 'NoSuchSetting', Value: 1 },
  }));

  call('RoomAudioControl', 'RequestRoomAudioRoutingStateAsync');
  call('SystemAudioControlApi', 'RequestMuteAsync');
  assert.deepEqual(events.slice(-2).map(e => [e.name, e.parameter]), [
    ['RoomAudioRoutingStateChanged', false],
    ['MuteStateChanged', false],
  ]);

  call('RoomAudioControl', 'RequestVUMeterReadingsAsync');
  assert.equal(world.audio.vuOn, true);
  call('RoomAudioControl', 'CancelVUMeterReadingsAsync');
  assert.equal(world.audio.vuOn, false);
});

test('system gain adjust updates the value and emits GainSettingsChanged', () => {
  const { world, events, call } = harness();
  call('SystemAudioControlApi', 'AdjustGainAsync', { gainSetting: { GainSettingType: 'LoudspeakerFactor', GainSettingValue: 4 } });
  assert.equal(world.systemGains.find(g => g.GainSettingType === 'LoudspeakerFactor').GainSettingValue, 4);
  assert.equal(events.at(-1).name, 'GainSettingsChanged');
  assert.equal(events.at(-1).parameter.length, 7);
});

test('language create / update / delete rules', () => {
  const { world, events, call, expectBadArgs } = harness();
  const id = call('ConfigLanguage', 'CreateLanguageAsync', {
    languageInfo: { Abbreviation: 'SV', ShortAbbreviation: 'sv', EnLabel: 'Swedish', OrgLabel: 'Svenska' },
  }).result;
  assert.equal(typeof id, 'string');
  const created = world.languages.find(l => l.LanguageId === id);
  assert.equal(created.UserDefined, true);
  assert.equal(created.OrderId, 13);
  assert.equal(events.at(-1).name, 'LanguageCreated');
  assert.equal(events.at(-1).parameter.LanguageId, id);

  // Abbreviation is unique case-insensitively; EnLabel and Abbreviation are required.
  expectBadArgs(() => call('ConfigLanguage', 'CreateLanguageAsync', { languageInfo: { Abbreviation: 'en', EnLabel: 'x' } }));
  expectBadArgs(() => call('ConfigLanguage', 'CreateLanguageAsync', { languageInfo: { Abbreviation: 'XX' } }));

  // Only user-defined languages may change.
  expectBadArgs(() => call('ConfigLanguage', 'UpdateLanguageAsync', {
    languageInfo: { LanguageId: world.languages[0].LanguageId, EnLabel: 'Renamed' },
  }));
  call('ConfigLanguage', 'UpdateLanguageAsync', { languageInfo: { LanguageId: id, EnLabel: 'Swedish (Sweden)' } });
  assert.equal(created.EnLabel, 'Swedish (Sweden)');
  assert.equal(events.at(-1).name, 'LanguageUpdated');

  // Delete: predefined languages and languages used in a meeting are refused.
  expectBadArgs(() => call('ConfigLanguage', 'DeleteLanguageAsync', { languageId: world.languages[0].LanguageId }));
  assert.deepEqual(call('ConfigLanguage', 'DeleteLanguageAsync', { languageId: id }), { result: true });
  assert.equal(world.languages.some(l => l.LanguageId === id), false);
  assert.equal(events.at(-1).name, 'LanguageDeleted');
  assert.equal(events.at(-1).parameter, id);

  const inMeeting = world.meetingLanguages[0].LanguageId;
  const userDefinedInMeeting = call('ConfigLanguage', 'CreateLanguageAsync', { languageInfo: { Abbreviation: 'NO', EnLabel: 'Norwegian' } }).result;
  call('ConfigInterpretation', 'CreateMeetingLanguageAsync', {
    meetingLanguageInfo: { MeetingId: world.meetingId, LanguageId: userDefinedInMeeting },
  });
  expectBadArgs(() => call('ConfigLanguage', 'DeleteLanguageAsync', { languageId: userDefinedInMeeting }));
  expectBadArgs(() => call('ConfigLanguage', 'DeleteLanguageAsync', { languageId: inMeeting }));
});

test('meeting languages: add, duplicate rejection, delete with desk cleanup, reorder', () => {
  const { world, events, call, expectBadArgs } = harness();
  const [en, fr, de, es] = world.meetingLanguages.map(m => m.LanguageId);
  const it = world.languages[4].LanguageId;

  // Add Italian at the end.
  call('ConfigInterpretation', 'CreateMeetingLanguageAsync', { meetingLanguageInfo: { MeetingId: world.meetingId, LanguageId: it } });
  assert.equal(world.meetingLanguages.at(-1).LanguageId, it);
  assert.equal(world.meetingLanguages.at(-1).OrderNumber, 5);
  assert.equal(events.at(-1).name, 'MeetingLanguageCreated');
  expectBadArgs(() => call('ConfigInterpretation', 'CreateMeetingLanguageAsync', { meetingLanguageInfo: { MeetingId: world.meetingId, LanguageId: it } }));
  expectBadArgs(() => call('ConfigInterpretation', 'CreateMeetingLanguageAsync', { meetingLanguageInfo: { MeetingId: world.meetingId, LanguageId: 'nope' } }));

  // Delete order 2 (French): renumbered, desks cleared, sets cleaned.
  call('ConfigInterpretation', 'DeleteMeetingLanguageAsync', { meetingId: world.meetingId, orderId: 2 });
  assert.deepEqual(world.meetingLanguages.map(m => [m.LanguageId, m.OrderNumber]), [[en, 1], [de, 2], [es, 3], [it, 4]]);
  assert.equal(events.at(-1).name, 'MeetingLanguageDeleted');
  assert.equal(events.at(-1).parameter.LanguageId, fr);
  const [desk1, desk2] = world.desks;
  assert.equal(desk1.LanguageIdOfOutputA, en);
  assert.equal(desk1.OutBLanguageId, EMPTY_GUID);
  assert.equal(desk1.OutCLanguageId, de);
  assert.equal(desk2.LanguageIdOfOutputA, EMPTY_GUID);
  assert.ok(!desk2.OutputLanguageSetB.includes(fr));
  // Desk sets were fixed at creation (Italian was added later), so only the removed language is dropped.
  assert.deepEqual(desk2.OutputLanguageSetC, [en, de, es]);

  // Reorder: list of current OrderNumbers in the new order (Italian first).
  call('ConfigInterpretation', 'ChangeMeetingLanguagesOrderAsync', { meetingId: world.meetingId, meetingLanguageIds: [4, 1, 2, 3] });
  assert.deepEqual(world.meetingLanguages.map(m => m.LanguageId), [it, en, de, es]);
  assert.deepEqual(world.meetingLanguages.map(m => m.OrderNumber), [1, 2, 3, 4]);
  assert.equal(events.at(-1).name, 'MeetingLanguageOrderChanged');
  assert.equal(events.at(-1).parameter, undefined);
  expectBadArgs(() => call('ConfigInterpretation', 'ChangeMeetingLanguagesOrderAsync', { meetingId: world.meetingId, meetingLanguageIds: [1, 1, 2, 3] }));
  expectBadArgs(() => call('ConfigInterpretation', 'ChangeMeetingLanguagesOrderAsync', { meetingId: world.meetingId, meetingLanguageIds: [1, 2, 3] }));
});

test('bulk meeting language create and delete are all-or-nothing', () => {
  const { world, events, call, expectBadArgs } = harness();
  const nordic = world.languages.slice(6, 8).map(l => l.LanguageId);
  const before = world.meetingLanguages.length;
  expectBadArgs(() => call('ConfigInterpretation', 'CreateMeetingLanguagesAsync', {
    meetingLanguageInfos: [
      { MeetingId: world.meetingId, LanguageId: nordic[0] },
      { MeetingId: world.meetingId, LanguageId: world.meetingLanguages[0].LanguageId },
    ],
  }));
  assert.equal(world.meetingLanguages.length, before);

  call('ConfigInterpretation', 'CreateMeetingLanguagesAsync', {
    meetingLanguageInfos: nordic.map(LanguageId => ({ MeetingId: world.meetingId, LanguageId })),
  });
  assert.equal(world.meetingLanguages.length, before + 2);
  assert.equal(events.at(-1).name, 'MeetingLanguagesCreated');
  assert.equal(events.at(-1).parameter.length, 2);

  call('ConfigInterpretation', 'DeleteMeetingLanguagesAsync', { meetingId: world.meetingId, orderIds: [5, 6] });
  assert.equal(world.meetingLanguages.length, before);
  assert.equal(events.at(-1).name, 'MeetingLanguagesDeleted');
  assert.deepEqual(world.meetingLanguages.map(m => m.OrderNumber), [1, 2, 3, 4]);
});

test('meeting language update validates Stream2Headroom range and merges fields', () => {
  const { world, events, call, expectBadArgs } = harness();
  const entry = world.meetingLanguages[1];
  call('ConfigInterpretation', 'UpdateMeetingLanguageAsync', {
    meetingLanguageInfo: { MeetingId: world.meetingId, LanguageId: entry.LanguageId, OutputToDante: true, Stream2Enable: true, Stream2Headroom: -6 },
  });
  assert.equal(entry.OutputToDante, true);
  assert.equal(entry.Stream2Headroom, -6);
  assert.equal(events.at(-1).name, 'MeetingLanguageUpdated');
  expectBadArgs(() => call('ConfigInterpretation', 'UpdateMeetingLanguageAsync', {
    meetingLanguageInfo: { MeetingId: world.meetingId, LanguageId: entry.LanguageId, Stream2Headroom: 3 },
  }));
});

test('desk update validates language references and enums, then emits the full desk', () => {
  const { world, events, call, expectBadArgs } = harness();
  const [en, , de] = world.meetingLanguages.map(m => m.LanguageId);
  const notInMeeting = world.languages[10].LanguageId;

  expectBadArgs(() => call('ConfigInterpretation', 'UpdateMeetingDeskInfoAsync', {
    meetingDeskInfo: { MeetingId: world.meetingId, SeatId: 'seat-i1', PreselectALanguageId: notInMeeting },
  }));
  expectBadArgs(() => call('ConfigInterpretation', 'UpdateMeetingDeskInfoAsync', {
    meetingDeskInfo: { MeetingId: world.meetingId, SeatId: 'seat-i1', Headphone: 'NoSuchHeadphone' },
  }));
  expectBadArgs(() => call('ConfigInterpretation', 'UpdateMeetingDeskInfoAsync', {
    meetingDeskInfo: { MeetingId: world.meetingId, SeatId: 'unknown-seat', AudioVideoDelay: 1 },
  }));

  call('ConfigInterpretation', 'UpdateMeetingDeskInfoAsync', {
    meetingDeskInfo: {
      MeetingId: world.meetingId, SeatId: 'seat-i1', PreselectALanguageId: en, LanguageIdOfOutputA: EMPTY_GUID,
      OutBLanguageId: de, Headphone: 'Bosch_HDP_IHDS', EButtonFunctionSet: ['SpeakSlow'], PreselectEButtonFunction: 'VideoSwitch',
    },
  });
  const desk = world.desks[0];
  assert.equal(desk.PreselectALanguageId, en);
  assert.equal(desk.LanguageIdOfOutputA, EMPTY_GUID);
  assert.equal(desk.OutBLanguageId, de);
  assert.equal(desk.Headphone, 'Bosch_HDP_IHDS');
  assert.deepEqual(desk.EButtonFunctionSet, ['SpeakSlow']);
  assert.equal(desk.PreselectEButtonFunction, 'VideoSwitch');
  const last = events.at(-1);
  assert.equal(last.name, 'MeetingDeskInfoChanged');
  assert.equal(last.parameter.SeatId, 'seat-i1');
  assert.equal(last.parameter.Headphone, 'Bosch_HDP_IHDS');
});

test('seat update merges DanteOut and emits SeatsUpdated; bad input rejected', () => {
  const { world, events, call, expectBadArgs } = harness();
  call('ConfigArea', 'UpdateSeatsAsync', { seatInfos: [{ Id: 'seat-p1', DanteOut: 'DanteOutEnabledAlways' }] });
  assert.equal(world.seats.find(s => s.Id === 'seat-p1').DanteOut, 'DanteOutEnabledAlways');
  assert.equal(events.at(-1).name, 'SeatsUpdated');
  assert.equal(events.at(-1).parameter[0].Id, 'seat-p1');
  assert.equal(events.at(-1).parameter[0].DanteOut, 'DanteOutEnabledAlways');

  expectBadArgs(() => call('ConfigArea', 'UpdateSeatsAsync', { seatInfos: [{ Id: 'seat-p2', DanteOut: 'Sometimes' }] }));
  expectBadArgs(() => call('ConfigArea', 'UpdateSeatsAsync', { seatInfos: [{ Id: 'no-such-seat', CanDiscuss: false }] }));
  assert.equal(world.seats.find(s => s.Id === 'seat-p2').DanteOut, 'Disabled');

  const seats = call('ConfigArea', 'GetSeatsAsync', { areaId: world.area.Id }).result;
  assert.equal(seats.length, 4);
  assert.deepEqual(call('ConfigArea', 'GetSeatsAsync', { areaId: EMPTY_GUID }), { result: [] });
});

test('presentation toggle emits and notifies listeners', () => {
  const { world, events, call } = harness();
  const changes = [];
  onChange(world, (kind, detail) => changes.push([kind, detail]));

  assert.deepEqual(call('ControlPresentationApi', 'RequestPresentationStateAsync'), { result: true });
  assert.equal(events.at(-1).parameter, false);

  assert.deepEqual(call('ControlPresentationApi', 'ActivatePresentationAsync'), { result: true });
  assert.equal(world.presentation, true);
  assert.deepEqual(events.at(-1), { api: 'ControlPresentationApi', name: 'PresentationStateChanged', parameter: true });
  assert.deepEqual(changes, [['presentation', { active: true }]]);

  call('ControlPresentationApi', 'DeactivatePresentationAsync');
  assert.equal(world.presentation, false);
  assert.equal(events.at(-1).parameter, false);
  assert.equal(changes.at(-1)[0], 'presentation');
});

test('onChange returns an unsubscribe function', () => {
  const { world, call } = harness();
  const seen = [];
  const off = onChange(world, kind => seen.push(kind));
  call('ControlPresentationApi', 'ActivatePresentationAsync');
  off();
  call('ControlPresentationApi', 'DeactivatePresentationAsync');
  assert.deepEqual(seen, ['presentation']);
});

test('control meeting status and dante licences', () => {
  const { world, events, call } = harness();
  call('ControlMeeting', 'RequestActiveMeetingStatusAsync');
  assert.equal(events.at(-1).name, 'ActiveMeetingStatusChanged');
  assert.equal(events.at(-1).parameter.MeetingId, world.meetingId);
  call('ControlMeeting', 'RequestMeetingsListAsync');
  assert.equal(events.at(-1).name, 'MeetingsListChanged');
  assert.equal(events.at(-1).parameter.length, 1);
  assert.deepEqual(call('ConfigInterpretation', 'GetAvailableDanteLicensesAsync', { meetingId: world.meetingId }), { result: 8 });
});

test('vuReadings returns one dBFS value per level sensor and moves the state', () => {
  const { world } = harness();
  const { ReadingsDictionary } = vuReadings(world);
  assert.deepEqual(Object.keys(ReadingsDictionary), LEVEL_SENSORS);
  for (const value of Object.values(ReadingsDictionary)) {
    assert.equal(typeof value, 'number');
    assert.ok(value >= -60 && value <= 0, `reading ${value} out of range`);
  }
  for (let i = 0; i < 20; i++) {
    const reading = vuReadings(world).ReadingsDictionary;
    assert.ok(Object.values(reading).every(v => v >= -60 && v <= 0));
  }
});

test('handleCall returns undefined for methods that are not emulated', () => {
  const { world, events } = harness();
  const emit = (api, name, parameter) => events.push({ api, name, parameter });
  assert.equal(handleCall(world, 'ConfigSite', 'NoSuchMethodAsync', {}, emit), undefined);
  assert.equal(handleCall(world, 'SomeOtherApi', 'RequestGainsAsync', {}, emit), undefined);
  assert.equal(handleCall(world, 'RoomAudioControl', 'constructor', {}, emit), undefined);
  assert.equal(events.length, 0);
});
