// CCS 1000 D (WO-111, DEC-032): the wireless adapter with the CCSD-CU's spec, topics, mappers and capabilities,
// against the wireless mock's ccs1000 variant.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startBackend } from './helpers/start.js';
import { createMockWirelessServer } from '../../mock/wireless/server.js';
import { CCS_SPEC_FILE, loadWirelessSpec } from '../src/wireless/spec.js';
import { CCS_TOPICS } from '../src/wireless/topics.js';
import { capabilities } from '../src/domain/mappers.js';
import { startSimulator } from '../src/simulation/simulator.js';

let mock;
let backend;
before(async () => {
  mock = await createMockWirelessServer({ longPollMs: 1000, variant: 'ccs1000', seatCount: 12 });
  backend = await startBackend({
    DICENTIS_SYSTEM: 'ccs1000', DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(mock.port),
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

const waitTopic = (topic, predicate, timeoutMs = 4000) => new Promise((resolve, reject) => {
  const { cache } = backend.services;
  const check = () => { const d = cache.get(topic)?.data; if (d !== undefined && predicate(d)) { cache.off('change', check); clearTimeout(t); resolve(d); } };
  const t = setTimeout(() => { cache.off('change', check); reject(new Error(`timeout waiting for ${topic}`)); }, timeoutMs);
  cache.on('change', check);
  check();
});

test('spec: v1.8, the WAP paths without participants / voting, plus microphone sensitivity', () => {
  const spec = loadWirelessSpec(CCS_SPEC_FILE);
  assert.equal(spec.info.version, '1.8');
  assert.equal(spec.operations.length, 22);
  assert.ok(spec.match('PUT', '/seats/microphonesensitivity/3'));
  assert.ok(spec.match('POST', '/seats/resetmicrophonesensitivities'));
  assert.equal(spec.match('GET', '/participants'), null);
  assert.equal(spec.match('GET', '/voting'), null);
  assert.ok(spec.operations.every(op => !op.undocumented), 'no WAP web UI endpoints');
});

test('connects with the CCS topic list only; the wireless-only topics are never requested', () => {
  const { cache, manager, poller } = backend.services;
  assert.equal(manager.status().system, 'ccs1000');
  assert.ok(manager.ccs1000Client);
  assert.equal(manager.wirelessClient, null, 'the /api/wireless passthrough does not serve a CCSD-CU');
  assert.deepEqual(poller.topicNames, CCS_TOPICS.map(t => t.topic));
  for (const t of CCS_TOPICS) assert.ok(cache.get(t.topic), `${t.topic} cached`);
  for (const t of ['wirelessParticipants', 'wirelessVoting', 'wirelessDiscuss']) assert.ok(!cache.get(t), `${t} not fetched`);
  assert.equal(cache.get('wirelessSystemInfo').data['System Type'], 'CCS 1000 D Digital Discussion System');
});

test('capabilities: discussion, standby, mic sensitivity; no voting, participants or power off', () => {
  const caps = backend.services.cache.get('domain.capabilities').data;
  assert.equal(caps.system, 'ccs1000');
  assert.equal(caps.features.micSensitivity, true);
  assert.equal(caps.features.powerStandby, true);
  assert.equal(caps.features.participantsEdit, false);
  assert.equal(caps.features.wapConfig, false);
  assert.equal(caps.actions.controlVoting, false);
  assert.equal(caps.actions.powerOff, false);
  assert.equal(caps.actions.editParticipants, false);
  assert.equal(caps.actions.powerStandby, true);
  assert.equal(capabilities('wireless').features.micSensitivity, false);
});

test('domain seats: no battery diagnostics, microphone mode', async () => {
  mock.state.seats[1].mode = 3;
  await backend.services.poller.refreshAll();
  const seats = await waitTopic('domain.seats', d => d.length === 12);
  assert.equal(seats[0].canPrio, true);
  assert.equal(seats[0].diagnostics, null);
  assert.equal(seats[0].micMode, 'normal');
  assert.equal(seats[1].micMode, 'ptt');
});

test('discussion through the domain actions (wireless implementation, CCS client)', async () => {
  assert.equal((await api('POST', '/domain/discussion/speakers', { seatId: '3' })).status, 200);
  await waitTopic('domain.discussion', d => d.speakers.some(s => s.seatId === '3'), 500);
  assert.equal((await api('POST', '/domain/discussion/requests', { seatId: '4' })).status, 200);
  await waitTopic('domain.discussion', d => d.requests.some(s => s.seatId === '4'), 500);
  assert.equal((await api('POST', '/domain/discussion/priority/1')).status, 200);
  await waitTopic('domain.discussion', d => d.speakers.some(s => s.seatId === '1' && s.priority), 500);
  assert.equal((await api('DELETE', '/domain/discussion')).status, 200);
  await waitTopic('domain.discussion', d => !d.requests.length && d.speakers.every(s => s.priority), 500);
});

test('not supported on a CCS 1000 D: participants, voting, power off (clear message, nothing sent)', async () => {
  for (const [method, path, body] of [['POST', '/domain/participants', { name: 'X' }], ['POST', '/domain/voting/open'], ['PUT', '/domain/voting/parameters', { subject: 's' }], ['PUT', '/domain/power', { state: 'off' }]]) {
    const r = await api(method, path, body);
    assert.equal(r.status, 400, `${method} ${path}`);
    assert.match(r.body.error.message, /CCS 1000 D/);
  }
});

test('power standby and on', async () => {
  assert.equal((await api('PUT', '/domain/power', { state: 'standby' })).status, 200);
  await waitTopic('domain.power', d => d.state === 'standby', 500);
  assert.equal((await api('PUT', '/domain/power', { state: 'on' })).status, 200);
  await waitTopic('domain.power', d => d.state === 'on', 500);
});

test('passthrough /api/ccs1000: microphone sensitivity get / set / validation / reset; /api/wireless refuses', async () => {
  assert.equal((await api('GET', '/ccs1000/ops')).body.data.length, 22);
  assert.deepEqual((await api('GET', '/ccs1000/seats/microphonesensitivity/5')).body.data, { sensitivity: 6 });
  assert.equal((await api('PUT', '/ccs1000/seats/microphonesensitivity/5', { sensitivity: 12 })).status, 200);
  assert.equal(mock.state.sensitivity.get(5), 12);
  assert.equal((await api('PUT', '/ccs1000/seats/microphonesensitivity/5', { sensitivity: 'loud' })).status, 400);
  const out = await api('PUT', '/ccs1000/seats/microphonesensitivity/5', { sensitivity: 16 });
  assert.equal(out.status, 502);
  assert.match(out.body.error.upstream, /sensitivity/);
  assert.equal((await api('POST', '/ccs1000/seats/resetmicrophonesensitivities')).status, 200);
  assert.equal(mock.state.sensitivity.get(5), 6);
  assert.equal((await api('GET', '/ccs1000/participants')).status, 404);
  const wl = await api('GET', '/wireless/seats');
  assert.equal(wl.status, 503);
  assert.match(wl.body.error.message, /DICENTIS Wireless/);
});

test('simulated CCS 1000 D: the mock variant with the profile name as host name', async () => {
  const sim = await startSimulator({ id: 'sim-ccs', name: 'Council CCS', type: 'ccs1000', seats: 8 });
  try {
    assert.equal(sim.settings.system, 'ccs1000');
    const login = await fetch(`http://127.0.0.1:${sim.settings.port}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin' }) });
    const { sid } = await login.json();
    const info = await (await fetch(`http://127.0.0.1:${sim.settings.port}/api/system-info`, { headers: { 'bosch-sid': sid } })).json();
    assert.equal(info.Hostname, 'Council CCS');
    assert.deepEqual(info.Versions.Api, ['1.8']);
  } finally { await sim.close(); }
});
