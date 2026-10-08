// WO-099 / DEC-027: Companion buttons pressed when seats / interpreter desks are activated or deactivated.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startConnectedBackend } from './helpers/start.js';
import { createMockWiredServer } from '../../mock/wired/server.js';
import { createMockCompanion } from '../../mock/companion/server.js';
import { sendAction, ping, validAction } from '../src/companion/client.js';
import { sanitizeRoom } from '../src/room/store.js';
import { sanitizeDevices } from '../src/devices/manager.js';

const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 25)); }
  return fn();
};

describe('companion client against the mock (same answers as Companion 5.0.6)', () => {
  let comp;
  before(async () => { comp = await createMockCompanion(); });
  after(() => comp.close());

  test('press / down / up, outside the grid, unreachable, validation', async () => {
    const target = { host: '127.0.0.1', port: comp.port };
    await sendAction(target, { page: 2, row: 1, column: 3, action: 'press' });
    await sendAction(target, { page: 2, row: 1, column: 3, action: 'down' });
    await sendAction(target, { page: 2, row: 1, column: 3, action: 'up' });
    assert.deepEqual(comp.requests.map(r => r.action), ['press', 'down', 'up']);
    await assert.rejects(sendAction(target, { page: 1, row: 9, column: 0, action: 'press' }), /no button at 1\/9\/0/);
    assert.deepEqual(await ping(target), { connections: 0 });
    await assert.rejects(ping({ host: '127.0.0.1', port: 1 }), /not reachable/);
    assert.equal(validAction({ page: 0, row: 0, column: 0, action: 'press' }), false);
    assert.equal(validAction({ page: 1, row: 0, column: 0, action: 'toggle' }), false);
    assert.equal(validAction({ page: 1, row: -1, column: 2, action: 'up' }), true);
  });

  test('project files: triggers and the Companion target survive sanitising; junk is dropped', () => {
    const room = sanitizeRoom({ triggers: { seats: { 'seat-1': { on: [{ page: 1, row: 0, column: 0, action: 'press', extra: 1 }], off: [] }, bad: { on: [{ page: 'x' }] } }, desks: {}, nope: {} } });
    assert.deepEqual(room.triggers, { seats: { 'seat-1': { on: [{ page: 1, row: 0, column: 0, action: 'press' }], off: [] } }, desks: {} });
    assert.deepEqual(sanitizeDevices({ companion: { host: 'c.local', port: 8888, junk: true } }).companion, { port: 8888, enabled: true, rows: 4, cols: 8, host: 'c.local' });
    assert.equal(sanitizeDevices({ companion: { port: 1 } }).companion, null);
  });
});

describe('companion triggers end to end (wired mock + mock Companion)', () => {
  let mock;
  let comp;
  let backend;
  const api = async (method, path, body) => {
    const res = await fetch(`${backend.url}/api${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const presses = () => comp.requests.map(r => `${r.action} ${r.page}/${r.row}/${r.column}`);
  /** Mic on/off through the domain API, then wait until the backend state shows it (no coalesced changes). */
  const speaker = async (seatId, on) => {
    await (on ? api('POST', '/domain/discussion/speakers', { seatId }) : api('DELETE', `/domain/discussion/speakers/${seatId}`));
    assert.ok(await waitFor(() => (backend.services.cache.get('domain.discussion')?.data?.speakers ?? []).some(s => s.seatId === seatId && s.micState === 'on') === on), `${seatId} ${on ? 'on' : 'off'}`);
  };

  before(async () => {
    mock = await createMockWiredServer();
    comp = await createMockCompanion();
    backend = await startConnectedBackend(mock);
  });
  after(async () => { await backend.close(); await mock.close(); await comp.close(); });

  test('configuration: validation, saved per project, status topic, test, manual press', async () => {
    assert.equal((await api('PUT', '/companion', { port: 8000 })).status, 400, 'host required for a new target');
    assert.equal((await api('PUT', '/room/triggers/seats/seat-1', { on: [{ page: 1, row: 0, column: 0, action: 'smash' }] })).status, 400);
    assert.equal((await api('PUT', '/room/triggers/chairs/seat-1', { on: [] })).status, 400);
    const put = await api('PUT', '/companion', { host: '127.0.0.1', port: comp.port });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.data.config, { host: '127.0.0.1', port: comp.port, enabled: true, rows: 4, cols: 8 });
    assert.equal(backend.services.cache.get('devices.companion').data.config.port, comp.port);
    assert.equal((await api('POST', '/companion/test', {})).body.data.ok, true);
    assert.equal((await api('POST', '/companion/test', { host: '127.0.0.1', port: 1 })).status, 502);
    assert.equal((await api('POST', '/companion/press', { page: 3, row: 2, column: 1, action: 'press' })).status, 200);
    assert.equal((await api('POST', '/companion/press', { page: 3, row: 7, column: 1, action: 'press' })).status, 502, 'outside the grid');
    assert.deepEqual(presses(), ['press 3/2/1']);
    const { readFile } = await import('node:fs/promises');
    const devicesFile = JSON.parse(await readFile(backend.services.devices.file, 'utf8'));
    assert.equal(devicesFile.companion.port, comp.port, 'saved in the project devices.json');
    comp.requests.length = 0;
  });

  test('seat mic on → its "on" buttons, off → its "off" buttons; other seats and switched off = nothing', async () => {
    await api('PUT', '/room/triggers/seats/seat-3', { on: [{ page: 1, row: 0, column: 0, action: 'press' }, { page: 1, row: 0, column: 1, action: 'down' }], off: [{ page: 1, row: 0, column: 1, action: 'up' }] });
    await speaker('seat-3', true);
    assert.ok(await waitFor(() => comp.requests.length === 2), `on: ${presses()}`);
    assert.deepEqual(presses(), ['press 1/0/0', 'down 1/0/1'], 'in order');
    await speaker('seat-4', true); // no triggers
    await speaker('seat-3', false);
    assert.ok(await waitFor(() => comp.requests.length === 3));
    assert.equal(presses()[2], 'up 1/0/1');
    await speaker('seat-4', false);

    await api('PUT', '/companion', { enabled: false });
    await speaker('seat-3', true);
    await new Promise(r => setTimeout(r, 200));
    assert.equal(comp.requests.length, 3, 'switched off: nothing sent');
    const log = (await api('GET', '/companion')).body.data.log;
    assert.match(log[0].message, /seat seat-3 activated: not sent \(Companion triggers are switched off\)/);
    await speaker('seat-3', false);
    await api('PUT', '/companion', { enabled: true });
  });

  test('a mic already on when the connection starts does not fire (baseline); later changes do', async () => {
    await speaker('seat-3', true);
    assert.ok(await waitFor(() => comp.requests.length === 5));
    const { manager } = backend.services;
    await manager.disconnect();
    await manager.connect();
    await backend.services.bridge.idle();
    assert.ok(await waitFor(() => backend.services.cache.get('domain.discussion')?.data?.speakers?.some(s => s.seatId === 'seat-3')));
    await new Promise(r => setTimeout(r, 150));
    assert.equal(comp.requests.length, 5, 'reconnect with seat-3 on: no "on" again');
    await speaker('seat-3', false);
    assert.ok(await waitFor(() => comp.requests.length === 6));
    assert.equal(presses()[5], 'up 1/0/1');
  });

  test('wired interpreter desk: microphone on / off', async () => {
    const desk = 'seat-booth1-desk1';
    await api('PUT', `/room/triggers/desks/${desk}`, { on: [{ page: 5, row: 1, column: 1, action: 'press' }], off: [{ page: 5, row: 1, column: 2, action: 'press' }] });
    const before = comp.requests.length;
    assert.equal((await api('POST', '/wired/ops/GrantInterpretation', { seatId: desk, microphoneState: 'activeOnOutputA' })).status, 200);
    assert.ok(await waitFor(() => comp.requests.length === before + 1), 'desk on');
    assert.equal(presses().at(-1), 'press 5/1/1');
    await api('POST', '/wired/ops/GrantInterpretation', { seatId: desk, microphoneState: 'off' });
    assert.ok(await waitFor(() => comp.requests.length === before + 2), 'desk off');
    assert.equal(presses().at(-1), 'press 5/1/2');
  });

  test('Companion unreachable: logged as an error, nothing thrown; remap moves seat triggers; delete', async () => {
    await api('PUT', '/companion', { port: 1 });
    await speaker('seat-3', true);
    assert.ok(await waitFor(async () => (await api('GET', '/companion')).body.data.log[0]?.error === true));
    const st = (await api('GET', '/companion')).body.data;
    assert.match(st.status.lastError, /not reachable/);
    await speaker('seat-3', false);
    await api('PUT', '/companion', { port: comp.port });

    await api('POST', '/room/remap', { map: { 'seat-3': 'seat-7' } });
    const room = (await api('GET', '/room')).body.data;
    assert.ok(room.triggers.seats['seat-7'] && !room.triggers.seats['seat-3'], 'moved with Match seats');
    await api('DELETE', '/room/triggers/seats/seat-7');
    assert.equal((await api('GET', '/room')).body.data.triggers.seats['seat-7'], undefined);
    assert.equal((await api('DELETE', '/companion')).body.data.config, null);
  });
});
