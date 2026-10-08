// Protocol-level tests of the wired mock with a raw ws client (independent of backend/src/wired/client.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createMockWiredServer } from './server.js';
import { loadSpec, validateValue } from '../../backend/src/wired/spec.js';

let mock;
before(async () => { mock = await createMockWiredServer(); });
after(() => mock.close());

/** Open a raw connection that collects every message. */
async function connect() {
  const ws = new WebSocket(mock.url, 'DICENTIS_1_0', { rejectUnauthorized: false });
  const inbox = [];
  const waiters = [];
  ws.on('message', data => {
    const msg = JSON.parse(data.toString());
    inbox.push(msg);
    waiters.splice(0).forEach(w => w());
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let id = 0;
  const next = async predicate => {
    for (;;) {
      const i = inbox.findIndex(predicate);
      if (i >= 0) return inbox.splice(i, 1)[0];
      await new Promise(resolve => waiters.push(resolve));
    }
  };
  return {
    ws,
    inbox,
    async send(operation, parameters = {}) {
      const messageId = ++id;
      ws.send(JSON.stringify({ messageId, operation, parameters }));
      return next(m => m.messageId === messageId);
    },
    nextEvent: () => next(m => m.messageId === 0),
    close: () => ws.close(),
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 30));

test('requires login and rejects a wrong password', async () => {
  const c = await connect();
  assert.equal((await c.send('GetSeats')).operation, 'error');
  assert.deepEqual((await c.send('Login', { user: 'admin', password: 'wrong' })).parameters, { loggedIn: false, token: '' });
  const ok = await c.send('login', { user: 'admin', password: 'admin' }); // operation names are case-insensitive
  assert.equal(ok.operation, 'login');
  assert.equal(ok.parameters.loggedIn, true);
  assert.equal((await c.send('Login', { user: 'admin', password: 'admin' })).operation, 'error', 'second login is illegal');
  c.close();
});

test('protocol errors: unknown operation, unknown parameter, bad format', async () => {
  const c = await connect();
  await c.send('Login', { user: 'admin', password: 'admin' });
  assert.deepEqual((await c.send('DummyOperation')).parameters, { message: 'DUMMYOPERATION is an unknown operation' });
  assert.match((await c.send('GetPermissions', { events: [] })).parameters.message, /Could not find member 'events'/);
  assert.match((await c.send('SetMasterVolume', { volume: 'loud' })).parameters.message, /expected number/);
  c.ws.send(JSON.stringify({ messageId: 9, parameters: {} }));
  await settle();
  assert.deepEqual(c.inbox.pop(), { messageId: 9, operation: 'error', parameters: { message: 'Bad message format' } });
  c.close();
});

test('malformed JSON closes the socket', async () => {
  const c = await connect();
  const closed = new Promise(resolve => c.ws.once('close', resolve));
  c.ws.send('{not json');
  await closed;
});

test('events are fire-once and re-armed by fetching the data', async () => {
  const c = await connect();
  await c.send('Login', { user: 'admin', password: 'admin' });
  await c.send('RegisterEvents', { events: ['masterVolumeChanged', 'seatsChanged'] });

  mock.fire('masterVolumeChanged', 'seatsChanged');
  assert.deepEqual((await c.nextEvent()).parameters.events.sort(), ['MasterVolumeChanged', 'SeatsChanged'], 'PascalCase on the wire, like the real server');

  mock.fire('masterVolumeChanged');
  await settle();
  assert.equal(c.inbox.length, 0, 'no second event before the data is fetched');

  await c.send('GetMasterVolume'); // re-arms masterVolumeChanged only
  mock.fire('masterVolumeChanged', 'seatsChanged');
  assert.deepEqual((await c.nextEvent()).parameters.events, ['MasterVolumeChanged']);

  await c.send('RegisterEvents', { events: ['SeatsChanged'] }); // explicit re-arm; names are case-insensitive
  mock.fire('seatsChanged');
  assert.deepEqual((await c.nextEvent()).parameters.events, ['SeatsChanged']);
  c.close();
});

test('unregistered events are not delivered; unknown event names are rejected', async () => {
  const c = await connect();
  await c.send('Login', { user: 'admin', password: 'admin' });
  mock.fire('seatsChanged');
  await settle();
  assert.equal(c.inbox.length, 0);
  assert.equal((await c.send('RegisterEvents', { events: ['noSuchEvent'] })).operation, 'error');
  assert.equal((await c.send('RegisterEvents', { events: ['meetingListChanged'] })).operation, 'RegisterEvents', 'history-only events accepted');
  c.close();
});

test('discussion behaviour: speakers, requests and microphone control', async () => {
  const c = await connect();
  await c.send('Login', { user: 'admin', password: 'admin' });
  await c.send('RegisterEvents', { events: ['discussionListChanged'] });
  for (const n of [1, 2, 3, 4, 5]) await c.send('AddSeatToSpeakers', { seatId: `seat-${n}` });
  await c.nextEvent();
  let list = (await c.send('GetDiscussionList')).parameters.discussionList;
  assert.deepEqual(list.map(e => [e.seatId, e.speakerType]), [
    ['seat-1', 'isSpeaker'], ['seat-2', 'isSpeaker'], ['seat-3', 'isSpeaker'], ['seat-4', 'isSpeaker'], ['seat-5', 'isRequest'],
  ]);
  await c.send('DeactivateMicrophone', { seatId: 'seat-1' });
  await c.send('RemoveSeatFromDiscussionList', { seatId: 'seat-2' }); // frees a slot → seat-5 promoted
  list = (await c.send('GetDiscussionList')).parameters.discussionList;
  assert.equal(list.find(e => e.seatId === 'seat-1').microphoneState, 'mute');
  assert.equal(list.find(e => e.seatId === 'seat-5').speakerType, 'isSpeaker');
  assert.equal((await c.send('ActivateMicrophone', { seatId: 'seat-9' })).operation, 'error');
  for (const e of list) await c.send('RemoveSeatFromDiscussionList', { seatId: e.seatId });
  c.close();
});

test('voting lifecycle and results', async () => {
  const c = await connect();
  await c.send('Login', { user: 'admin', password: 'admin' });
  assert.equal((await c.send('OpenVoting')).operation, 'error', 'no active voting yet');
  await c.send('ActivateVoting', { votingId: 'meeting-1-voting-1' });
  assert.equal((await c.send('GetVotingState')).parameters.votingState, 'ready');
  await c.send('OpenVoting');
  mock.castVote('seat-1', 'yes');
  mock.castVote('seat-2', 'yes');
  mock.castVote('seat-3', 'no');
  const results = (await c.send('GetVotingResults')).parameters.votingResults;
  assert.deepEqual(results, [{ answer: 'yes', count: 2 }, { answer: 'no', count: 1 }, { answer: 'abstain', count: 0 }]);
  await c.send('CloseVoting');
  await c.send('AcceptVoting');
  assert.equal((await c.send('GetVotingState')).parameters.votingState, 'accepted');
  c.close();
});

test('operations without a behaviour return a spec-shaped default', async () => {
  const c = await connect();
  await c.send('Login', { user: 'admin', password: 'admin' });
  const res = await c.send('GetPluginCommands');
  assert.equal(res.operation, 'GetPluginCommands');
  assert.deepEqual(res.parameters, { pluginCommands: [] });
  assert.deepEqual((await c.send('GetMajorityResult')).parameters.majorityResult.comparisonOperator, 'greaterThan');
  c.close();
});

test('every read operation returns a spec-conformant response', async () => {
  const spec = loadSpec();
  const c = await connect();
  await c.send('Login', { user: 'admin', password: 'admin' });
  const problems = [];
  for (const op of spec.list().filter(o => /^(Get|List)/.test(o.operation))) {
    const res = await c.send(op.operation);
    if (res.operation === 'error') continue; // e.g. GetPlugin needs a plugin name
    validateValue(op.response, res.parameters).forEach(p => problems.push(`${op.operation} ${p.path}: ${p.problem} ${p.expected ?? ''}`));
  }
  assert.deepEqual(problems, []);
  c.close();
});

test('DICENTIS 7.0 CHM additions (WO-044): multi-seat mics, notes reading, image check, sensitivity, login userId', async () => {
  const c = await connect();
  const login = await c.send('Login', { user: 'admin', password: 'admin' });
  assert.equal(login.parameters.userId, 'user-admin');
  // multi-seat mute/unmute
  for (const n of [11, 12]) await c.send('AddSeatToSpeakers', { seatId: `seat-${n}` });
  await c.send('DeactivateMicrophone', { seatIds: ['seat-11', 'seat-12'] });
  let list = (await c.send('GetDiscussionList')).parameters.discussionList;
  assert.deepEqual(list.filter(e => ['seat-11', 'seat-12'].includes(e.seatId)).map(e => e.microphoneState), ['mute', 'mute']);
  assert.equal(list[0].totalSpeechTime, 0, '7.0 entry fields present');
  await c.send('ActivateMicrophone', { seatIds: ['seat-11'], participantIds: [] });
  list = (await c.send('GetDiscussionList')).parameters.discussionList;
  assert.equal(list.find(e => e.seatId === 'seat-11').microphoneState, 'on');
  assert.equal((await c.send('ActivateMicrophone', {})).operation, 'error');
  for (const n of [11, 12]) await c.send('RemoveSeatFromDiscussionList', { seatId: `seat-${n}` });
  // notes files: size, info, chunked read (base64)
  const files = (await c.send('GetNotesFileList', { searchDateRange: { startDate: '2000-01-01', endDate: '2100-12-31' } })).parameters.fileData;
  const f = files[0];
  assert.ok(f.fileSize > 0 && f.needsTransform === false);
  assert.equal((await c.send('GetTransformedNotesFilesInfo', { fileName: f.fileName })).parameters.notesFileInfo.fileSize, f.fileSize);
  const bytes = (await c.send('ReadNotesFile', { fileName: f.fileName, offset: 0, length: 5 })).parameters.FileBytes;
  assert.equal(Buffer.from(bytes, 'base64').toString(), '<?xml');
  // image validation
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  assert.equal((await c.send('ValidateImageFile', { imageData: png, imageExt: '.png' })).parameters.isValidImageFile, true);
  assert.equal((await c.send('ValidateImageFile', { imageData: png, imageExt: '.jpg' })).parameters.isValidImageFile, false);
  assert.equal((await c.send('ValidateImageFile', { imageData: Buffer.from('text').toString('base64'), imageExt: '.png' })).parameters.isValidImageFile, false);
  // microphone sensitivity: [] = every seat (real 6.50); missing seatIds = error; update fires the 7.0 event
  assert.equal((await c.send('GetMicrophoneSensitivity', { seatIds: [] })).parameters.seatMicrophoneSensitivities.length, 20);
  assert.equal((await c.send('GetMicrophoneSensitivity', {})).operation, 'error');
  await c.send('RegisterEvents', { events: ['seatMicrophoneSensitivityUpdated'] });
  await c.send('UpdateMicrophoneSensitivity', { seatMicrophoneSensitivity: [{ seatId: 'seat-1', sensitivityValue: 1.5 }] });
  assert.deepEqual((await c.nextEvent()).parameters.events, ['SeatMicrophoneSensitivityUpdated'], 'PascalCase on the wire, like the real server');
  await c.send('ResetMicrophoneSensitivity', { seatIds: ['seat-1'] });
  // unknown event: real 6.50 wording
  assert.match((await c.send('RegisterEvents', { events: ['seatsChanged', 'bogus'] })).parameters.message, /Error converting value "bogus".*events\[1\]/);
  c.close();
});

test('interpreter desks follow the real 6.50 routing semantics (WO-048)', async () => {
  const c = await connect();
  await c.send('Login', { user: 'admin', password: 'admin' });
  const routings = async () => (await c.send('GetInterpretationRoutings')).parameters.routings;
  assert.deepEqual(await routings(), [], 'no routings while every desk microphone is off');
  const floor = (await c.send('GetInterpretationLanguages')).parameters.languages.find(l => l.index === 0);
  assert.equal(floor.abbreviation, 'FLR');
  const seatId = 'seat-booth1-desk1';
  await c.send('GrantInterpretation', { seatId, microphoneState: 'activeOnOutputB' });
  let [r] = await routings();
  assert.deepEqual([r.seatId, r.sourceLanguageId, r.destinationLanguageId], [seatId, floor.languageId, 'lang-002'], 'B preset language, floor input');
  await c.send('SelectRelayInterpretation', { seatId });
  [r] = await routings();
  assert.deepEqual([r.sourceLanguageId, r.destinationLanguageQuality], ['', 'unknown']);
  await c.send('SetInterpretationOutputPreset', { seatId, outputButton: 'outputPresetB', languageId: 'lang-003' });
  assert.equal((await routings())[0].destinationLanguageId, 'lang-003', 'live output follows the new preset');
  assert.equal((await c.send('SetInterpretationOutputPreset', { seatId, outputButton: 'outputPresetB', languageId: 'lang-004' })).operation, 'error', 'not in the B list');
  await c.send('SetInterpretationOutputPreset', { seatId, outputButton: 'outputPresetB', languageId: 'lang-002' });
  await c.send('SelectInterpretationFloor', { seatId });
  await c.send('GrantInterpretation', { seatId, microphoneState: 'off' });
  assert.deepEqual(await routings(), []);
  c.close();
});
