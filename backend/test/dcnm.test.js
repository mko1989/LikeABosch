// DCNM API through the dicentis-bridge (WO-079, DEC-021): client against the mock bridge, and the backend with the
// wired mock (Conference Protocol) plus the dicentis-bridge mock as second connection.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DcnmClient } from '../src/dcnm/client.js';
import { loadDcnmSpec } from '../src/dcnm/spec.js';
import { createMockDcnmBridge } from '../../mock/dcnm/server.js';
import { createMockWiredServer } from '../../mock/wired/server.js';
import { startBackend } from './helpers/start.js';

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nextEvent = (c, name) => new Promise(resolve => {
  const on = e => { if (e.event === name) { c.off('event', on); resolve(e); } };
  c.on('event', on);
});
const waitFor = async (fn, timeoutMs = 3000) => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout');
    await sleep(25);
  }
};

describe('DCNM spec (Node side)', () => {
  const spec = loadDcnmSpec();
  test('interfaces keyed like the bridge, inherited members, sweep, call validation', () => {
    assert.equal(spec.interfaces.size, 39);
    assert.equal(spec.get('ControlSpeaker').interface, 'IControlSpeaker');
    assert.equal(spec.get('RoomAudioControl').interface, 'IRoomAudioControl');
    assert.ok(spec.overloads('Device', 'OpenAsync').length === 2, 'Device inherits IApi.OpenAsync (2 overloads)');
    assert.equal(spec.overloads('ControlSpeaker', 'SetSpeechTimeAsync').length, 2);
    const sweep = spec.sweep().map(([a, m]) => `${a}.${m}`);
    assert.ok(sweep.includes('ControlSpeaker.RequestSpeakersListAsync'));
    assert.ok(!sweep.includes('RoomAudioControl.RequestVUMeterReadingsAsync'), 'no VU meter stream in the sweep');
    assert.deepEqual(spec.validateCall('ControlSpeaker', 'GrantSpeechAsync', { participantId: 'x' }), []);
    assert.match(spec.validateCall('ControlSpeaker', 'GrantSpeechAsync', { seat: 1 })[0], /no overload takes \(seat\)/);
    assert.match(spec.validateCall('ControlSpeaker', 'Nope', {})[0], /no such method/);
    assert.deepEqual(spec.validateCall('Undocumented', 'Anything', { a: 1 }), [], 'unknown interfaces pass through');
  });
});

describe('DcnmClient against the mock bridge', () => {
  let mock;
  before(async () => { mock = await createMockDcnmBridge(); });
  after(() => mock.close());
  const client = extra => new DcnmClient({ host: '127.0.0.1', port: mock.port, user: 'admin', password: 'admin', heartbeatMs: 0, reconnect: { enabled: false }, log: quiet, ...extra });

  test('connect sequence: open → authenticate → connect as device; hello info; calls and events', async () => {
    const c = client();
    await c.connect();
    assert.equal(c.state, 'loggedIn');
    assert.equal(c.bridgeInfo.name, 'dicentis-bridge');
    assert.equal(c.interfaces.RoomAudioControl.source, 'implemented by SystemAudioControlApi');
    assert.deepEqual(c.connection, { open: true, authenticated: true, device: 'Connected', enabled: true, apiState: 'Online' });
    assert.deepEqual(mock.state.calls.slice(0, 3).map(x => `${x.api}.${x.method}`), ['Base.OpenAsync', 'Base.AuthenticateUserAsync', 'Device.ConnectAsDeviceAsync']);
    assert.equal(mock.state.calls[2].args.uniqueId, 'LikeABosch');
    const ev = nextEvent(c, 'SpeakersListChanged');
    assert.equal(await c.call('ControlSpeaker', 'GrantSpeechAsync', { participantId: '0f8fad5b-d9cb-469f-a165-70867728950e' }), true);
    const e = await ev;
    assert.equal(e.args.Parameter[0].SpeakerId, '0f8fad5b-d9cb-469f-a165-70867728950e');
    await c.close();
  });

  test('wrong credentials → UPSTREAM_AUTH, no reconnect; bridge errors map to VALIDATION / UPSTREAM_*', async () => {
    await assert.rejects(client({ password: 'wrong' }).connect(), { code: 'UPSTREAM_AUTH' });
    const c = client();
    await c.connect();
    await assert.rejects(c.call('ControlSpeaker', 'GrantSpeechAsync', { seat: 1 }), { code: 'VALIDATION' });
    await assert.rejects(c.call('Nope', 'X'), { code: 'VALIDATION' });
    await assert.rejects(c.call('ControlSpeaker', 'SetSpeechTimeAsync', { participantId: 'x', speechDuration: -2, discussionType: 'Speaker' }), { code: 'UPSTREAM_ERROR' });
    await assert.rejects(c.call('ControlSpeaker', 'SetSpeechTimeAsync', { participantId: 'x', speechDuration: -1, discussionType: 'Speaker' }), { code: 'UPSTREAM_TIMEOUT' });
    await c.close();
  });

  test('a status older than one already seen is ignored (concurrent bridge answers)', async () => {
    const c = client();
    await c.connect();
    mock.pushRaw({ type: 'status', status: { seq: 0, connection: { open: false, authenticated: false, device: 'Disconnected', enabled: false, apiState: 'Offline' }, interfaces: {} } });
    await sleep(100);
    assert.equal(c.state, 'loggedIn');
    assert.equal(c.connection.open, true);
    await c.close();
  });

  test('DICENTIS goes away and comes back: connected → re-open → loggedIn', async () => {
    const c = client({ reconnect: { enabled: true, minDelayMs: 20, maxDelayMs: 50 } });
    await c.connect();
    const lost = once(c, 'state');
    mock.setOpen(false);
    assert.equal((await lost)[0], 'connected');
    await waitFor(() => c.state === 'loggedIn');
    await c.close();
  });
});

describe('backend: Conference Protocol + dicentis-bridge (DEC-021)', () => {
  let wired;
  let dcnm;
  let backend;
  const api = async (method, path, body) => {
    const res = await fetch(`${backend.url}/api${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const topic = name => backend.services.cache.get(name)?.data;

  before(async () => {
    wired = await createMockWiredServer();
    dcnm = await createMockDcnmBridge();
    backend = await startBackend({
      DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(wired.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin', DICENTIS_AUTOCONNECT: 'true',
      DICENTIS_DCNM_BRIDGE: 'true', DICENTIS_DCNM_HOST: '127.0.0.1', DICENTIS_DCNM_PORT: String(dcnm.port),
    });
    const { manager } = backend.services;
    if (manager.client?.state !== 'loggedIn') await once(manager.client, 'loggedIn');
    await waitFor(() => manager.dcnmClient?.state === 'loggedIn');
    await backend.services.dcnmMirror.idle();
  });
  after(async () => { await backend.close(); await wired.close(); await dcnm.close(); });

  test('connection status reports the bridge; the sweep fills the event mirror', async () => {
    const s = (await api('GET', '/connection')).body.data;
    assert.equal(s.system, 'wired');
    assert.equal(s.state, 'loggedIn');
    assert.equal(s.dcnm.state, 'loggedIn');
    assert.equal(s.dcnm.device, 'Connected');
    assert.equal(s.dcnm.bridge.apiVersion, '7.0.43431.0');
    const sweep = topic('dcnmSweep');
    assert.ok(sweep.requested >= 30, `sweep requested ${sweep.requested}`);
    assert.deepEqual(sweep.failed, []);
    await waitFor(() => Array.isArray(topic('dcnm.ControlSpeaker.SpeakersListChanged')));
    assert.ok(topic('dcnmStatus').interfaces.ControlSpeaker.CanControlSpeaker);
    const info = (await api('GET', '/dcnm')).body.data;
    assert.equal(info.state, 'loggedIn');
    assert.equal((await api('GET', '/dcnm/ops')).body.data.find(i => i.api === 'RoomAudioControl').found, 'implemented by SystemAudioControlApi');
  });

  test('passthrough: call → event → topic; validation; properties', async () => {
    const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const r = await api('POST', '/dcnm/ops/ControlSpeaker/GrantSpeechAsync', { participantId: id });
    assert.deepEqual(r.body, { ok: true, data: true });
    await waitFor(() => topic('dcnm.ControlSpeaker.SpeakersListChanged')?.some(s => s.SpeakerId === id));
    assert.equal((await api('POST', '/dcnm/ops/ControlSpeaker/GrantSpeechAsync', { seat: 3 })).status, 400);
    assert.equal((await api('POST', '/dcnm/ops/ControlSpeaker/Nope', {})).status, 400);
    assert.equal((await api('POST', '/dcnm/ops/Nope/X', {})).status, 404);
    assert.equal((await api('POST', '/dcnm/ops/ControlSpeaker/GrantSpeechAsync', [1])).status, 400);
    // data classes as arguments (the real bridge builds them through their constructors)
    const reg = await api('POST', '/dcnm/ops/PrepareParticipant2/RegisterParticipantsAsync', { participants: [{ Id: id, MeetingId: id, AssignedAt: id, VipType: 'None', UserId: id, CanDiscuss: true, CanManageMeeting: false, CanVote: true, CanUsePriority: false, VoteWeight: 1, HasSpecialPermission: false }] });
    assert.equal(reg.status, 200);
    await waitFor(() => topic('dcnm.PrepareParticipant2.ParticipantsRegistered')?.length === 1);
    assert.equal((await api('GET', '/dcnm/props/ControlSpeaker')).body.data.CanControlSpeaker, true);
    assert.equal((await api('GET', '/dcnm/props/Base/IsOpen')).body.data, true);
    assert.equal((await api('PUT', '/dcnm/props/Base/IsOpen', { value: false })).status, 400, 'read-only');
  });

  test('plugins: handles and delegate callbacks answered over HTTP', async () => {
    const reg = await api('POST', '/dcnm/ops/Plugins/RegisterPluginAsync', { plugin: { Name: 'likeabosch' } });
    assert.equal(reg.body.data.$handle, '#1');
    const cb = await waitFor(() => topic('dcnmCallback'));
    assert.equal(cb.parameter, 'handler');
    assert.equal(cb.expectsResult, true);
    assert.equal((await api('POST', `/dcnm/callbacks/${cb.callback}`, { result: '{"pong":true}' })).status, 200);
    assert.equal(dcnm.pendingCallbacks.get(cb.callback), '{"pong":true}');
    assert.equal((await api('POST', '/dcnm/ops/%231/SendPluginEventAsync', { eventName: 'x', parameters: '{}' })).status, 200, 'call on a handle');
    assert.equal((await api('DELETE', '/dcnm/handles/%231')).status, 200);
    assert.equal((await api('DELETE', '/dcnm/handles/%231')).status, 400, 'released');
  });

  test('the dicentis-bridge failing never touches the Conference Protocol connection', async () => {
    const { manager } = backend.services;
    dcnm.kick();
    await waitFor(() => manager.dcnmClient.state === 'reconnecting');
    assert.equal(manager.client.state, 'loggedIn');
    assert.equal((await api('POST', '/dcnm/ops/ControlSpeaker/RequestSpeakersListAsync', {})).status, 503);
    await waitFor(() => manager.dcnmClient.state === 'loggedIn', 8000);
    assert.equal((await api('POST', '/dcnm/ops/ControlSpeaker/RequestSpeakersListAsync', {})).body.data, true);
  });
});
