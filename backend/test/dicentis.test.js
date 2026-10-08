// DEC-029: DICENTIS-only features over the DCNM API, against a simulated wired system with the full API (WO-101):
// audio & Dante (WO-081) and languages (WO-102).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBackend } from './helpers/start.js';

const until = async (fn, ms = 6000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 30))) { const v = await fn(); if (v) return v; }
  return fn();
};
let backend, cache;
const call = async (method, path, body) => {
  const res = await fetch(`${backend.url}/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const post = (path, body) => call('POST', `/dicentis${path}`, body);
const topic = name => cache.get(name)?.data;

before(async () => {
  backend = await startBackend();
  cache = backend.services.cache;
  await call('PUT', '/connection/settings', { simulators: [{ id: 'sim-d', name: 'Hall', type: 'wired', seats: 8 }], simulate: 'sim-d' });
  await call('POST', '/connection/connect', {});
  assert.ok(await until(() => topic('dicentis.status')?.state === 'loggedIn'), 'dicentis-bridge up');
  await backend.services.dicentis.idle();
  assert.ok(await until(() => topic('dicentis.desks')), 'meeting data loaded');
});
after(() => backend.close());

test('status, capabilities and topics fill after login', async () => {
  assert.deepEqual(topic('dicentis.status').features, { audio: true, languages: true });
  assert.deepEqual(topic('domain.capabilities').dicentis, { audio: true, languages: true });
  const audio = topic('dicentis.audio');
  assert.ok(audio.gains.some(g => g.type === 'Master') && audio.equalizers.Loudspeaker.length === 5 && audio.selections.length > 5);
  assert.equal(topic('dicentis.seatAudio').filter(s => s.kind === 'participant').length, 8);
  assert.ok(topic('dicentis.languages').length >= 12);
  assert.deepEqual(topic('dicentis.meetingLanguages').languages.map(l => l.id), ['lang-001', 'lang-002', 'lang-003', 'lang-004']);
  assert.equal(topic('dicentis.desks').length, 4);
});

test('audio: gain, equaliser, selection, seat Dante out round trips; validation', async () => {
  assert.equal((await post('/audio/gain', { type: 'Loudspeaker', value: -4, muted: true })).status, 200);
  assert.ok(await until(() => { const g = topic('dicentis.audio').gains.find(x => x.type === 'Loudspeaker'); return g.value === -4 && g.muted; }));
  assert.equal((await post('/audio/gain', { type: 'Loudspeaker', value: 40 })).status, 400);
  assert.equal((await post('/audio/gain', { type: 'Nope', value: 0 })).status, 400);
  assert.equal((await post('/audio/equalizer', { equalizer: 'Loudspeaker', band: 2, gain: 3.5, frequency: 1200 })).status, 200);
  assert.ok(await until(() => topic('dicentis.audio').equalizers.Loudspeaker[2].gain === 3.5));
  assert.equal((await post('/audio/equalizer', { equalizer: 'Loudspeaker', band: 2, gain: 30 })).status, 400);
  assert.equal((await post('/audio/selection', { type: 'LoudspeakerActiveWhenSpeaking', value: 1 })).status, 200);
  assert.ok(await until(() => topic('dicentis.audio').selections.find(s => s.type === 'LoudspeakerActiveWhenSpeaking').value === 1));
  assert.equal((await post('/audio/seat-dante', { seatIds: ['seat-2', 'seat-3'], danteOut: 'DanteOutEnabledAlways' })).status, 200);
  assert.deepEqual(topic('dicentis.seatAudio').filter(s => s.danteOut === 'DanteOutEnabledAlways').map(s => s.id), ['seat-2', 'seat-3']);
  assert.equal((await post('/audio/seat-dante', { seatIds: ['seat-2'], danteOut: 'Loud' })).status, 400);
  assert.equal((await post('/audio/nope', {})).status, 404);
});

test('audio: level meters only while leased', async () => {
  assert.equal(topic('dicentis.vu'), undefined);
  await post('/audio/vu', { on: true });
  assert.ok(await until(() => topic('dicentis.vu')?.readings?.Loudspeaker !== undefined));
  await post('/audio/vu', { on: false });
  assert.equal(cache.get('dicentis.vu'), null);
  assert.equal(cache.unavailable.get('dicentis.vu'), 'Level meters off');
});

test('languages: create, add to the meeting, order, assign to a desk, remove, delete', async () => {
  assert.equal((await post('/languages/create', { abbreviation: '', label: 'X' })).status, 400);
  const id = (await post('/languages/create', { abbreviation: 'SV', label: 'Swedish', native: 'Svenska' })).body.data.id;
  assert.ok(topic('dicentis.languages').some(l => l.id === id && l.userDefined));
  assert.equal((await post('/meeting-languages/add', { languageId: id, danteOut: true })).status, 200);
  assert.ok(topic('dicentis.meetingLanguages').languages.some(l => l.id === id && l.danteOut));
  // the Conference Protocol sees it too (linked simulation)
  assert.ok(await until(() => topic('interpretationLanguages')?.languages?.some(l => l.languageId === id)), 'wired interpretationLanguages');
  assert.equal((await post('/meeting-languages/add', { languageId: id })).status, 400, 'twice');
  const ids = topic('dicentis.meetingLanguages').languages.map(l => l.id);
  assert.equal((await post('/meeting-languages/order', { languageIds: [id, ...ids.filter(x => x !== id)] })).status, 200);
  assert.equal(topic('dicentis.meetingLanguages').languages[0].id, id);
  assert.equal((await post('/meeting-languages/order', { languageIds: [id] })).status, 400);
  assert.equal((await post('/meeting-languages/update', { languageId: id, stream2: { enabled: true, headroom: -6 } })).status, 200);
  assert.deepEqual(topic('dicentis.meetingLanguages').languages[0].stream2.enabled, true);
  assert.equal((await post('/desks/update', { seatId: 'seat-booth1-desk1', outB: id })).status, 200);
  const desk = topic('dicentis.desks').find(d => d.seatId === 'seat-booth1-desk1');
  assert.equal(desk.outB, id);
  assert.ok(desk.setB.includes(id), 'B output added to the selectable set');
  assert.ok(await until(() => topic('interpreterSeats')?.seats?.find(s => s.seatId === 'seat-booth1-desk1')?.bLanguageId === id), 'wired interpreterSeats');
  assert.equal((await post('/desks/update', { seatId: 'seat-booth1-desk1', outA: 'lang-nope' })).status, 400);
  assert.equal((await post('/languages/delete', { id })).status, 400, 'still in the meeting');
  assert.equal((await post('/meeting-languages/remove', { languageId: id })).status, 200);
  assert.equal(topic('dicentis.desks').find(d => d.seatId === 'seat-booth1-desk1').outB, null);
  assert.equal((await post('/languages/delete', { id })).status, 200);
  assert.ok(!topic('dicentis.languages').some(l => l.id === id));
  assert.equal((await post('/languages/delete', { id: 'lang-001' })).status, 400, 'built-in');
});

test('topics become unavailable when the bridge goes away', async () => {
  await call('POST', '/connection/disconnect', {});
  assert.ok(await until(() => (topic('dicentis.status')?.state ?? 'off') === 'off'), 'status off or cleared with the other system topics');
  assert.equal(topic('dicentis.audio'), undefined);
  assert.deepEqual(topic('domain.capabilities')?.dicentis ?? { audio: false, languages: false }, { audio: false, languages: false });
  assert.equal((await post('/audio/gain', { type: 'Master', value: 0 })).status, 503);
});
