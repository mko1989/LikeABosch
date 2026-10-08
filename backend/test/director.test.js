import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { updateOrder, targetSeat, shotFor, plan, automaticRoom } from '../src/director/decide.js';
import { startConnectedBackend } from './helpers/start.js';
import { createMockWiredServer } from '../../mock/wired/server.js';

const sp = (seatId, micState = 'on', priority = false) => ({ seatId, micState, priority });

describe('decision core (pure)', () => {
  test('last activated wins; falls back to the previous active one; muted/off do not count', () => {
    let order = updateOrder([], [sp('A')]);
    order = updateOrder(order, [sp('A'), sp('B')]);
    assert.equal(targetSeat(order, [sp('A'), sp('B')]), 'B');
    order = updateOrder(order, [sp('A'), sp('B', 'mute')]);
    assert.deepEqual(order, ['A']);
    assert.equal(targetSeat(order, [sp('A')]), 'A');
    order = updateOrder(order, []);
    assert.equal(targetSeat(order, []), null);
  });

  test('a priority speaker overrides the last activated', () => {
    const speakers = [sp('chair', 'on', true), sp('B')];
    const order = updateOrder(updateOrder([], [speakers[0]]), speakers);
    assert.deepEqual(order, ['chair', 'B']);
    assert.equal(targetSeat(order, speakers), 'chair');
  });

  test('shotFor: seat shot, else overview, else null', () => {
    const room = { shots: { A: { cameraId: 'c1', preset: 3 } }, overview: { cameraId: 'c2', preset: 0 } };
    assert.deepEqual(shotFor('A', room), { seatId: 'A', cameraId: 'c1', preset: 3, overview: false });
    assert.equal(shotFor('B', room).overview, true);
    assert.equal(shotFor(null, room).cameraId, 'c2');
    assert.equal(shotFor(null, { shots: {} }), null);
  });

  test('plan live: recall then cut; already there: just cut; already on air: nothing', () => {
    const base = { cameraPreset: {}, overview: { cameraId: 'ov', preset: 0 }, strategy: 'live' };
    assert.deepEqual(plan({ ...base, target: { cameraId: 'c1', preset: 3 }, onAirCamera: 'ov' }).map(s => s.step), ['recall', 'cut']);
    assert.deepEqual(plan({ ...base, cameraPreset: { c1: 3 }, target: { cameraId: 'c1', preset: 3 }, onAirCamera: 'ov' }).map(s => s.step), ['cut']);
    assert.deepEqual(plan({ ...base, cameraPreset: { c1: 3 }, target: { cameraId: 'c1', preset: 3 }, onAirCamera: 'c1' }), []);
    assert.deepEqual(plan({ ...base, target: { cameraId: 'c1', preset: 5 }, onAirCamera: 'c1' }).map(s => s.step), ['recall'], 'live: move on air');
  });

  test('plan safe: the on-air camera is never moved while live', () => {
    const p = plan({ target: { cameraId: 'c1', preset: 5 }, onAirCamera: 'c1', cameraPreset: { c1: 3, ov: 0 }, overview: { cameraId: 'ov', preset: 0 }, strategy: 'safe' });
    assert.deepEqual(p.map(s => `${s.step}:${s.cameraId}`), ['cut:ov', 'recall:c1', 'wait:c1', 'cut:c1']);
    const p2 = plan({ target: { cameraId: 'c1', preset: 5 }, onAirCamera: 'c1', cameraPreset: { c1: 3 }, overview: { cameraId: 'ov', preset: 0 }, strategy: 'safe' });
    assert.deepEqual(p2.map(s => `${s.step}:${s.cameraId}`), ['recall:ov', 'wait:ov', 'cut:ov', 'recall:c1', 'wait:c1', 'cut:c1'], 'overview camera parked first');
    const p3 = plan({ target: { cameraId: 'c1', preset: 5 }, onAirCamera: 'ov', cameraPreset: {}, overview: { cameraId: 'ov', preset: 0 }, strategy: 'safe' });
    assert.deepEqual(p3.map(s => s.step), ['recall', 'wait', 'cut'], 'off air: move, wait to arrive, cut');
  });
});

describe('per-device automation (DEC-015, pure)', () => {
  test('automaticRoom drops shots and the overview on cameras taken out of the automation', () => {
    const room = { shots: { A: { cameraId: 'c1', preset: 3 }, B: { cameraId: 'c2', preset: 1 } }, overview: { cameraId: 'c2', preset: 0 }, director: { strategy: 'safe' } };
    const r = automaticRoom(room, id => id !== 'c2');
    assert.deepEqual(Object.keys(r.shots), ['A']);
    assert.equal(r.overview, null);
    assert.equal(r.director.strategy, 'safe', 'other settings kept');
    assert.equal(shotFor('A', automaticRoom(room, id => id !== 'c1')).overview, true, 'seat on a manual camera → overview');
  });

  test('plan without cuts: only move cameras; safe never moves the on-air camera', () => {
    const base = { cameraPreset: { c1: 3 }, overview: { cameraId: 'ov', preset: 0 }, cuts: false };
    assert.deepEqual(plan({ ...base, strategy: 'safe', target: { cameraId: 'c1', preset: 5 }, onAirCamera: 'ov' }), [{ step: 'recall', cameraId: 'c1', preset: 5 }]);
    assert.deepEqual(plan({ ...base, strategy: 'safe', target: { cameraId: 'c1', preset: 5 }, onAirCamera: 'c1' }), [], 'safe: on air → not moved');
    assert.deepEqual(plan({ ...base, strategy: 'live', target: { cameraId: 'c1', preset: 5 }, onAirCamera: 'c1' }).map(s => s.step), ['recall'], 'live: moved');
    assert.deepEqual(plan({ ...base, strategy: 'live', target: { cameraId: 'c1', preset: 3 }, onAirCamera: 'ov' }), [], 'already there: no cut');
  });
});

describe('director end to end (wired mock + mock cameras + mock switcher)', () => {
  let mock;
  let backend;
  const api = async (method, path, body) => {
    const res = await fetch(`${backend.url}/api${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return res.json();
  };
  const waitFor = async (fn, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 25)); }
    throw new Error('timeout');
  };

  before(async () => {
    mock = await createMockWiredServer();
    backend = await startConnectedBackend(mock);
    await api('POST', '/devices/cameras', { name: 'Overview', driver: 'mock', switcherInput: 1 });   // cam-1
    await api('POST', '/devices/cameras', { name: 'Speakers', driver: 'mock', switcherInput: 2 });   // cam-2
    await api('PUT', '/devices/switcher', { driver: 'mock' });
    await api('PUT', '/room/overview', { cameraId: 'cam-1', preset: 0 });
    await api('PUT', '/room/shots/seat-3', { cameraId: 'cam-2', preset: 3 });
    await api('PUT', '/room/shots/seat-4', { cameraId: 'cam-2', preset: 4 });
    await api('PUT', '/room/director', { enabled: true, strategy: 'safe', delayMs: 0, minShotMs: 0, settleMs: 10 });
  });
  after(async () => { await backend.close(); await mock.close(); });

  const cam = id => backend.services.devices.cameras.get(id).driver;
  const sw = () => backend.services.devices.switcher.driver;

  test('mic on → seat preset recalled and cut; second mic → safe move via overview; all off → overview', async () => {
    await api('POST', '/domain/discussion/speakers', { seatId: 'seat-3' });
    await waitFor(() => sw().program === 2 && cam('cam-2').preset === 3);

    await api('POST', '/domain/discussion/speakers', { seatId: 'seat-4' });
    await waitFor(() => cam('cam-2').preset === 4 && sw().program === 2 && sw().cuts.length >= 3);
    // safe: cam-2 was on air with preset 3 → cut to overview (1) first, then move cam-2 and cut back (2)
    assert.deepEqual(sw().cuts.slice(-2), [1, 2]);

    await api('DELETE', '/domain/discussion/speakers/seat-4');   // falls back to seat-3 (still on)
    await waitFor(() => cam('cam-2').preset === 3 && sw().program === 2);
    await api('DELETE', '/domain/discussion/speakers/seat-3');   // nobody → overview
    await waitFor(() => sw().program === 1);
    const state = (await api('GET', '/director')).data;
    assert.equal(state.target.overview, true);
    assert.ok(state.log.length >= 3);
  });

  test('manual shot and disabled automation', async () => {
    await api('PUT', '/room/director', { enabled: false });
    await api('POST', '/domain/discussion/speakers', { seatId: 'seat-3' });
    await new Promise(r => setTimeout(r, 150));
    assert.equal(sw().program, 1, 'no automatic cut when disabled');
    const r = await api('POST', '/director/shot', { seatId: 'seat-3' });
    assert.equal(r.data.cameraId, 'cam-2');
    await waitFor(() => sw().program === 2);
    assert.equal((await api('POST', '/director/shot', { seatId: 'seat-9' })).data.overview, true, 'seat without shot → overview');
    await api('DELETE', '/domain/discussion/speakers/seat-3');
  });

  test('camera automation off: its seats go to the overview; manual Take still uses it (DEC-015)', async () => {
    await api('POST', '/director/shot', {}); // start from the overview
    await waitFor(() => sw().program === 1);
    const off = await api('PUT', '/devices/cameras/cam-2', { automation: false });
    assert.equal(off.data.automation, false);
    assert.equal((await api('GET', '/devices/cameras')).data.find(c => c.id === 'cam-2').automation, false);
    await api('PUT', '/room/director', { enabled: true });
    const before = cam('cam-2').preset;
    const cuts = sw().cuts.length;
    await api('POST', '/domain/discussion/speakers', { seatId: 'seat-4' });
    await new Promise(r => setTimeout(r, 200));
    assert.equal(cam('cam-2').preset, before, 'manual camera not moved');
    assert.equal(sw().program, 1, 'stays on the overview');
    assert.ok(sw().cuts.slice(cuts).every(i => i === 1), 'no cut to the manual camera');
    await api('POST', '/director/shot', { seatId: 'seat-4' });
    await waitFor(() => sw().program === 2 && cam('cam-2').preset === 4, 2000);
    await api('DELETE', '/domain/discussion/speakers/seat-4');
    await api('PUT', '/devices/cameras/cam-2', { automation: true });
    await api('POST', '/director/shot', {});
    await waitFor(() => sw().program === 1);
  });

  test('switcher automation off: cameras still follow, no cuts; PATCH does not reconnect (DEC-015)', async () => {
    const driver = sw();
    const r = await api('PATCH', '/devices/switcher', { automation: false });
    assert.equal(r.data.automation, false);
    assert.equal(sw(), driver, 'same driver: no reconnect');
    assert.equal((await api('PATCH', '/devices/switcher', { automation: 'no' })).ok, false);
    const cuts = sw().cuts.length;
    await api('POST', '/domain/discussion/speakers', { seatId: 'seat-3' });
    await waitFor(() => cam('cam-2').preset === 3, 2000);
    await new Promise(r => setTimeout(r, 150));
    assert.equal(sw().cuts.length, cuts, 'no automatic cut');
    assert.equal(sw().program, 1);
    await api('DELETE', '/domain/discussion/speakers/seat-3');
    await api('PATCH', '/devices/switcher', { automation: true });
  });
});
