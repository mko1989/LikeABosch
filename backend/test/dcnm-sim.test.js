// WO-101 (DEC-029 §4): the mock dicentis-bridge linked to the Conference Protocol mock, as a simulated wired system uses
// it: DCNM changes show up in the wired mock's state (one DICENTIS database), presentation works both ways.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DcnmClient } from '../src/dcnm/client.js';
import { createMockWiredServer } from '../../mock/wired/server.js';
import { createLinkedDcnmBridge } from '../../mock/dcnm/wired-link.js';

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, timeoutMs = 3000) => {
  for (const end = Date.now() + timeoutMs; ; await sleep(20)) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout');
  }
};

let wired, dcnm, client;
const events = [];
const fired = [];
before(async () => {
  wired = await createMockWiredServer({ seatCount: 6 });
  const fire = wired.fire;
  wired.fire = (...e) => { fired.push(...e); return fire(...e); };
  dcnm = await createLinkedDcnmBridge(wired, { vuIntervalMs: 30 });
  client = new DcnmClient({ host: '127.0.0.1', port: dcnm.port, user: 'admin', password: 'admin', device: 'LikeABosch', heartbeatMs: 0, reconnect: { enabled: false }, log: quiet });
  client.on('event', e => events.push(e));
  await client.connect();
});
after(async () => { await client.close(); await dcnm.close(); await wired.close(); });
const call = (api, method, args = {}) => client.call(api, method, args);

test('seats, meeting and languages come from the wired mock', async () => {
  const [area] = await call('ConfigSite', 'GetAreasAsync');
  const seats = await call('ConfigArea', 'GetSeatsAsync', { areaId: area.Id });
  assert.deepEqual(seats.filter(s => s.SeatType === 'ParticipantSeat').map(s => s.Id), ['seat-1', 'seat-2', 'seat-3', 'seat-4', 'seat-5', 'seat-6']);
  assert.ok(seats.some(s => s.Id === 'seat-booth1-desk1' && s.SeatType === 'InterpreterSeat'));
  const meetingLangs = await call('ConfigInterpretation', 'GetMeetingLanguagesAsync', { meetingId: wired.state.activeMeetingId });
  assert.deepEqual(meetingLangs.map(l => l.LanguageId), ['lang-001', 'lang-002', 'lang-003', 'lang-004']);
  const langs = await call('ConfigLanguage', 'GetLanguagesAsync');
  assert.ok(langs.length >= 12 && langs.find(l => l.Abbreviation === 'EN').LanguageId === 'lang-001');
  const desk = await call('ConfigInterpretation', 'RetrieveMeetingDeskAsync', { meetingId: wired.state.activeMeetingId, seatId: 'seat-booth1-desk1' });
  assert.equal(desk.LanguageIdOfOutputA, 'lang-001');
});

test('a new language added to the meeting appears in the Conference Protocol languages; desks follow', async () => {
  const meetingId = wired.state.activeMeetingId;
  const id = await call('ConfigLanguage', 'CreateLanguageAsync', { languageInfo: { Abbreviation: 'SV', ShortAbbreviation: 'sv', EnLabel: 'Swedish', OrgLabel: 'Svenska' } });
  assert.ok(typeof id === 'string' && id.length > 0);
  fired.length = 0;
  await call('ConfigInterpretation', 'CreateMeetingLanguageAsync', { meetingLanguageInfo: { MeetingId: meetingId, LanguageId: id } });
  const wl = wired.state.interpretation.languages;
  assert.deepEqual(wl.map(l => l.abbreviation), ['FLR', 'EN', 'NL', 'FR', 'DE', 'SV']);
  assert.equal(wl.at(-1).index, 5);
  assert.ok(fired.includes('interpretationLanguagesChanged'));
  // assign it as output B of a desk
  await call('ConfigInterpretation', 'UpdateMeetingDeskInfoAsync', { meetingDeskInfo: { MeetingId: meetingId, SeatId: 'seat-booth1-desk1', OutBLanguageId: id, OutputLanguageSetB: ['lang-002', id] } });
  const d = wired.state.interpretation.seats.find(x => x.seatId === 'seat-booth1-desk1');
  assert.equal(d.bLanguageId, id);
  assert.deepEqual(d.bLanguageList, ['lang-002', id]);
  // reorder: SV first
  const order = (await call('ConfigInterpretation', 'GetMeetingLanguagesAsync', { meetingId })).map(l => l.OrderNumber);
  await call('ConfigInterpretation', 'ChangeMeetingLanguagesOrderAsync', { meetingId, meetingLanguageIds: [order.at(-1), ...order.slice(0, -1)] });
  assert.equal(wired.state.interpretation.languages[1].abbreviation, 'SV');
  // removing it from the meeting clears the desk
  const sv = (await call('ConfigInterpretation', 'GetMeetingLanguagesAsync', { meetingId })).find(l => l.LanguageId === id);
  await call('ConfigInterpretation', 'DeleteMeetingLanguageAsync', { meetingId, orderId: sv.OrderNumber });
  assert.ok(!wired.state.interpretation.languages.some(l => l.languageId === id));
  assert.equal(wired.state.interpretation.seats.find(x => x.seatId === 'seat-booth1-desk1').bLanguageId, '');
});

test('room audio round trip and VU readings while requested', async () => {
  events.length = 0;
  await call('RoomAudioControl', 'AdjustAudioGainSettingsAsync', { audioGainSetting: { GainSettingType: 'Loudspeaker', Value: -6.3 } });
  const ev = await waitFor(() => events.findLast(e => e.event === 'AudioSettingsChanged'));
  assert.equal(ev.args.Parameter.AudioGainSettingList.find(g => g.GainSettingType === 'Loudspeaker').Value, -6.5);
  await assert.rejects(call('RoomAudioControl', 'AdjustAudioGainSettingsAsync', { audioGainSetting: { GainSettingType: 'Loudspeaker', Value: 99 } }), /outside/);
  await call('RoomAudioControl', 'RequestVUMeterReadingsAsync');
  await waitFor(() => events.filter(e => e.event === 'VUMeterReadingsChanged').length >= 2);
  await call('RoomAudioControl', 'CancelVUMeterReadingsAsync');
  await sleep(80);
  const n = events.filter(e => e.event === 'VUMeterReadingsChanged').length;
  await sleep(120);
  assert.equal(events.filter(e => e.event === 'VUMeterReadingsChanged').length, n, 'no readings after cancel');
});

test('presentation: DCNM → Conference Protocol and back', async () => {
  fired.length = 0;
  await call('ControlPresentationApi', 'ActivatePresentationAsync');
  assert.equal(wired.state.isPresentationEnabled, true);
  assert.ok(fired.includes('presentationStateChanged'));
  events.length = 0;
  wired.state.isPresentationEnabled = false; // what the Conference Protocol DeactivatePresentation does
  // (events are pushed a few ms late: wait for the one carrying false)
  await waitFor(() => events.find(e => e.event === 'PresentationStateChanged' && e.args.Parameter === false));
  await waitFor(() => client.bridgeStatus?.interfaces?.ControlPresentationApi?.IsPresentationActive === false);
});
