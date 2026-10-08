import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WiredClient } from '../src/wired/client.js';
import { createLogger } from '../src/lib/logger.js';
import { createMockWiredServer } from '../../mock/wired/server.js';

let mock;
before(async () => { mock = await createMockWiredServer(); });
after(() => mock.close());

const log = createLogger({ level: 'silent' });
const client = (overrides = {}) => new WiredClient({
  host: '127.0.0.1', port: mock.port, user: 'admin', password: 'admin', log,
  reconnect: { enabled: false }, ...overrides,
});

test('connects, logs in and performs requests', async () => {
  const c = client();
  const states = [];
  c.on('state', s => states.push(s));
  await c.connect();
  assert.equal(c.state, 'loggedIn');
  assert.deepEqual(states, ['connecting', 'connected', 'loggedIn']);
  const { seats } = await c.request('GetSeats');
  assert.equal(seats.length, 20);
  await c.close();
  assert.equal(c.state, 'disconnected');
});

test('wrong password → UPSTREAM_AUTH, no reconnect', async () => {
  const c = client({ password: 'nope', reconnect: { enabled: true, minDelayMs: 10 } });
  await assert.rejects(c.connect(), { code: 'UPSTREAM_AUTH' });
  assert.equal(c.state, 'disconnected');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(c.state, 'disconnected');
});

test('unreachable server → NOT_CONNECTED', async () => {
  const c = client({ port: 1, connectTimeoutMs: 500 });
  await assert.rejects(c.connect(), { code: 'NOT_CONNECTED' });
  assert.equal(c.state, 'disconnected');
});

test('server error message → UPSTREAM_ERROR with upstream text', async () => {
  const c = client();
  await c.connect();
  await assert.rejects(c.request('ActivateMicrophone', { seatId: 'seat-99' }), err => {
    assert.equal(err.code, 'UPSTREAM_ERROR');
    assert.match(err.extra.upstream, /seat-99/);
    return true;
  });
  await c.close();
});

test('request before connect → NOT_CONNECTED', async () => {
  await assert.rejects(client().request('GetSeats'), { code: 'NOT_CONNECTED' });
});

test('events are emitted and interleave with responses', async () => {
  const c = client();
  await c.connect();
  await c.request('RegisterEvents', { events: ['masterVolumeChanged'] });
  const gotEvent = once(c, 'event');
  const response = c.request('SetMasterVolume', { volume: 12 });
  assert.deepEqual((await gotEvent)[0], ['MasterVolumeChanged']);
  assert.deepEqual(await response, {});
  assert.equal((await c.request('GetMasterVolume')).volume, 12);
  await c.close();
});

test('timeout → UPSTREAM_TIMEOUT', async () => {
  const c = client();
  await c.connect();
  // Bypass: send to a socket whose server never answers this messageId by pausing the mock socket.
  const ws = c.ws;
  const originalSend = ws.send.bind(ws);
  ws.send = () => {}; // swallow outgoing message
  await assert.rejects(c.request('GetSeats', {}, { timeoutMs: 50 }), { code: 'UPSTREAM_TIMEOUT' });
  ws.send = originalSend;
  await c.close();
});

test('connection loss rejects pending requests, reconnects and logs in again', async () => {
  const c = client({ reconnect: { enabled: true, minDelayMs: 20, maxDelayMs: 50 } });
  await c.connect();
  let loggedIn = 0;
  c.on('loggedIn', () => { loggedIn += 1; });
  const ws = c.ws;
  ws.send = () => {}; // keep this request pending
  const pending = c.request('GetSeats', {}, { timeoutMs: 5_000 });
  mock.dropConnections();
  await assert.rejects(pending, { code: 'NOT_CONNECTED' });
  await once(c, 'loggedIn');
  assert.equal(loggedIn, 1);
  assert.equal(c.state, 'loggedIn');
  assert.equal((await c.request('GetRoomName')).roomName, 'Mock Council Chamber');
  await c.close();
});

test('close() stops reconnecting', async () => {
  const c = client({ reconnect: { enabled: true, minDelayMs: 20 } });
  await c.connect();
  await c.close();
  await new Promise(r => setTimeout(r, 60));
  assert.equal(c.state, 'disconnected');
});
