import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startBackend } from './helpers/start.js';
import { createMockWirelessServer } from '../../mock/wireless/server.js';
import { WirelessClient } from '../src/wireless/client.js';

let mock;
let backend;
before(async () => {
  mock = await createMockWirelessServer({ longPollMs: 1000 });
  backend = await startBackend({
    DICENTIS_SYSTEM: 'wireless', DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(mock.port),
    DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin', DICENTIS_AUTOCONNECT: 'true',
  });
  const { manager, poller } = backend.services;
  if (manager.client?.state !== 'loggedIn') await once(manager.client, 'loggedIn');
  await poller.idle();
});
after(async () => {
  await backend.close();
  await mock.close();
});

const api = async (method, path, body) => {
  const res = await fetch(`${backend.url}/api${path}`, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

/** Wait until a cache topic satisfies a predicate. */
const waitTopic = (topic, predicate, timeoutMs = 4000) => new Promise((resolve, reject) => {
  const { cache } = backend.services;
  const check = () => { const d = cache.get(topic)?.data; if (d !== undefined && predicate(d)) { cache.off('change', check); clearTimeout(t); resolve(d); } };
  const t = setTimeout(() => { cache.off('change', check); reject(new Error(`timeout waiting for ${topic}`)); }, timeoutMs);
  cache.on('change', check);
  check();
});

test('initial sync fills the wireless topics', () => {
  const { cache } = backend.services;
  for (const t of ['wirelessSeats', 'wirelessSpeakers', 'wirelessWaitingList', 'wirelessParticipants', 'wirelessSystemStatus',
    'wirelessVoting', 'wirelessVotingState', 'wirelessVotingResults', 'wirelessIdentification', 'wirelessSystemInfo']) {
    assert.ok(cache.get(t), `${t} cached`);
  }
  assert.equal(cache.get('wirelessSeats').data.length, 20);
});

test('passthrough: list, GET, POST with body; write refreshes topics immediately', async () => {
  assert.equal((await api('GET', '/wireless/ops')).body.data.filter(o => !o.undocumented).length, 32);
  assert.equal((await api('GET', '/wireless/seats/2')).body.data.name, 'Seat 2');
  assert.equal((await api('POST', '/wireless/speakers', [3])).status, 200);
  await waitTopic('wirelessSpeakers', d => d.some(e => e.id === 3), 500); // refreshAll after the write, not the poll
  assert.equal((await api('DELETE', '/wireless/speakers/3')).status, 200);
});

test('passthrough validation and error mapping', async () => {
  assert.equal((await api('POST', '/wireless/speakers', ['x'])).status, 400);
  assert.equal((await api('GET', '/wireless/seats/abc')).status, 400);
  assert.equal((await api('GET', '/wireless/seats?isPolling=true')).status, 400);
  assert.equal((await api('GET', '/wireless/seats?foo=1')).status, 400);
  assert.equal((await api('POST', '/wireless/login', {})).status, 403);
  assert.equal((await api('GET', '/wireless/nope')).status, 404);
  const upstream = await api('DELETE', '/wireless/speakers/9');
  assert.equal(upstream.status, 502);
  assert.match(upstream.body.error.upstream, /Speaker not found in speakers list/);
});

test('poller picks up changes made on the WAP (no events)', async () => {
  mock.requestToSpeak(9);
  await waitTopic('wirelessWaitingList', d => d.some(e => e.id === 9));
  await api('DELETE', '/wireless/waiting-list');
});

test('voting results flow into the cache', async () => {
  await api('PUT', '/wireless/voting/state', { state: 1 });
  mock.castVote(4, 'yes');
  await waitTopic('wirelessVotingResults', d => d.results.some(r => r.name === 'yes' && r.value === 1));
  await api('PUT', '/wireless/voting/state', { state: 0 });
});

test('wired passthrough answers 503 while a wireless system is connected', async () => {
  const r = await api('GET', '/wired/ops/GetSeats');
  assert.equal(r.status, 503);
});

test('status reports the wireless system; connect with override takes over a session', async () => {
  const status = (await api('GET', '/connection')).body.data;
  assert.equal(status.system, 'wireless');
  assert.equal(status.state, 'loggedIn');
  // Someone else logs in as the same user → our session is gone; reconnect needs override.
  const other = new WirelessClient({ host: '127.0.0.1', port: mock.port, user: 'admin', password: 'admin', override: true, reconnect: { enabled: false } });
  await other.connect();
  const plain = await api('POST', '/connection/connect');
  assert.equal(plain.status, 401);
  assert.equal(plain.body.error.reason, 'alreadyLoggedIn');
  const taken = await api('POST', '/connection/connect', { override: true });
  assert.equal(taken.body.data.state, 'loggedIn');
  other.closing = true;
  await backend.services.poller.idle();
});
