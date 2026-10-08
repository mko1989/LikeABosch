// DCN adapter (WO-060): spec/topic tables, DcnClient against the mock bridge, backend passthrough, events → cache.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startBackend } from './helpers/start.js';
import { createMockDcnBridge } from '../../mock/dcn/server.js';
import { DcnClient } from '../src/dcn/client.js';
import { loadDcnSpec } from '../src/dcn/spec.js';
import { DCN_EVENT_DATA_TOPICS, DCN_EVENT_TOPICS, DCN_TOPICS, DCN_VOTING_CALLS } from '../src/dcn/topics.js';

const spec = loadDcnSpec();
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };
const clientFor = (mock, extra = {}) => new DcnClient({
  host: '127.0.0.1', port: mock.port, token: mock.token, user: 'admin', password: 'admin', heartbeatMs: 0,
  reconnect: { minDelayMs: 20, maxDelayMs: 50 }, log: quiet, ...extra,
});

/** A valid argument value for a .NET type (for "every method is reachable"). */
function sample(type) {
  if (type.endsWith('[]')) return [sample(type.slice(0, -2))];
  if (['int', 'long', 'short', 'byte'].includes(type)) return 1;
  if (type === 'bool') return false;
  if (type === 'string') return 'x';
  const t = spec.types[type];
  if (t?.kind === 'enum') return t.values[1]?.name ?? t.values[0].name;
  return {};
}

describe('spec and topic tables', () => {
  test('every topic, event mapping and voting call refers to the spec', () => {
    const ctx = { meetingId: 1, sessionId: 11, defaultArea: 1 };
    for (const t of DCN_TOPICS) {
      const m = spec.get(t.call);
      assert.ok(m, `${t.topic}: ${t.call} exists`);
      const args = t.args ? t.args(ctx) : {};
      assert.deepEqual(spec.validateArgs(m, args), [], `${t.topic}: args valid`);
    }
    const events = new Set(spec.events.map(e => `${e.api}.${e.name}`));
    for (const k of [...Object.keys(DCN_EVENT_TOPICS), ...Object.keys(DCN_EVENT_DATA_TOPICS)]) assert.ok(events.has(k), `event ${k} exists`);
    for (const t of Object.values(DCN_EVENT_TOPICS).flat()) assert.ok(t === '*resync' || DCN_TOPICS.some(x => x.topic === t), `topic ${t} defined`);
    for (const k of Object.keys(DCN_VOTING_CALLS)) assert.ok(spec.get(k), `${k} exists`);
  });

  test('argument validation', () => {
    const m = spec.get('control.DiscussionApi.SpeakNow');
    assert.deepEqual(spec.validateArgs(m, { participantId: 0, seatId: 3 }), []);
    assert.equal(spec.validateArgs(m, { seatId: 3 }).length, 1); // participantId missing
    assert.match(spec.validateArgs(m, { participantId: 0, seatId: 3, foo: 1 }).join(), /foo: unknown/);
    assert.match(spec.validateArgs(m, { participantId: 0.5, seatId: 3 }).join(), /expected int/);
    const s = spec.get('control.DiscussionApi.SetDiscussionSettings');
    assert.deepEqual(spec.validateArgs(s, { discussionInfo: { NumberOfOpenMicrophones: 3 } }), []);
    assert.match(spec.validateArgs(s, { discussionInfo: { Nope: 1 } }).join(), /unknown member/);
    const a = spec.get('control.VoteApi.StartAdhocVoting');
    assert.deepEqual(spec.validateArgs(a, { votingSettings: { AnswerSet: 'ParliamentaryYesNo', Subject: 's' } }), []);
    assert.match(spec.validateArgs(a, { votingSettings: { AnswerSet: 'Maybe' } }).join(), /expected one of/);
  });
});

describe('DcnClient against the mock bridge', () => {
  let mock;
  before(async () => { mock = await createMockDcnBridge({ token: 'mock-token' }); });
  after(async () => { await mock.close(); });

  test('connects, calls, maps API_ERROR', async () => {
    const c = clientFor(mock);
    await c.connect();
    assert.equal(c.state, 'loggedIn');
    assert.equal(c.constants['SEAT_ASSIGNMENT.DEFAULT_AREA'], 1);
    assert.deepEqual(await c.request('control.DcnSystemApi.GetMasterVolume'), { masterVolume: 15 });
    const raw = await c.call('control.DcnSystemApi', 'SetMasterVolume', { masterVolume: 999 });
    assert.equal(raw.returns, 'OUT_OF_RANGE');
    await assert.rejects(c.request('control.DcnSystemApi.SetMasterVolume', { masterVolume: 999 }), e => e.code === 'UPSTREAM_ERROR' && e.extra.apiError === 'OUT_OF_RANGE');
    await assert.rejects(c.request('control.DiscussionApi.Nope'), e => e.code === 'VALIDATION');
    await c.close();
    assert.equal(c.state, 'disconnected');
    await assert.rejects(c.request('control.DcnSystemApi.GetMasterVolume'), e => e.code === 'NOT_CONNECTED');
  });

  test('wrong token and wrong DCN-SW credentials are auth errors without reconnect', async () => {
    const bad = clientFor(mock, { token: 'nope' });
    await assert.rejects(bad.connect(), e => e.code === 'UPSTREAM_AUTH' && e.extra.reason === 'badToken');
    assert.equal(bad.state, 'disconnected');
    const wrong = clientFor(mock, { password: 'wrong' });
    await assert.rejects(wrong.connect(), e => e.code === 'UPSTREAM_AUTH' && e.extra.apiError === 'NO_AUTHORIZATION');
    assert.equal(wrong.state, 'disconnected');
  });

  test('a bridge without a token accepts a client without a token (DEC-019)', async () => {
    const open = await createMockDcnBridge();
    try {
      const c = clientFor(open, { token: '' });
      await c.connect();
      assert.equal(c.state, 'loggedIn');
      await c.close();
    } finally {
      await open.close();
    }
  });

  test('unreachable bridge → NOT_CONNECTED and reconnect attempts', async () => {
    const c = clientFor({ port: 1, token: 'x' });
    await assert.rejects(c.connect(), e => e.code === 'NOT_CONNECTED');
    assert.equal(c.state, 'reconnecting');
    await c.close();
  });

  test('reconnects after the bridge connection drops; follows DCN-SW availability', async () => {
    const c = clientFor(mock);
    await c.connect();
    const again = once(c, 'loggedIn');
    mock.dropClient();
    await again;
    assert.equal(c.state, 'loggedIn');
    const down = once(c, 'state');
    mock.setAvailable(false);
    assert.equal((await down)[0], 'connected');
    const up = once(c, 'loggedIn');
    mock.setAvailable(true);
    await up;
    await c.close();
  });

  test('a second client replaces the first', async () => {
    const a = clientFor(mock);
    await a.connect();
    const gone = new Promise(resolve => a.on('state', s => s === 'disconnected' && resolve()));
    const b = clientFor(mock);
    await b.connect();
    await gone;
    assert.equal(a.lastError.extra.reason, 'replaced');
    await b.close();
  });
});

describe('backend with system dcn', () => {
  let mock;
  let backend;
  const api = async (method, path, body) => {
    const res = await fetch(`${backend.url}/api${path}`, {
      method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const waitTopic = (topic, predicate, timeoutMs = 3000) => new Promise((resolve, reject) => {
    const { cache } = backend.services;
    const check = () => { const d = cache.get(topic)?.data; if (d !== undefined && predicate(d)) { cache.off('change', check); clearTimeout(t); resolve(d); } };
    const t = setTimeout(() => { cache.off('change', check); reject(new Error(`timeout waiting for ${topic}: ${JSON.stringify(cache.get(topic)?.data)}`)); }, timeoutMs);
    cache.on('change', check);
    check();
  });

  before(async () => {
    mock = await createMockDcnBridge(); // no token on either side (DEC-019)
    backend = await startBackend();
    // Configure through the settings API, like the UI does.
    const put = await api('PUT', '/connection/settings', { system: 'dcn', host: '127.0.0.1', port: mock.port, user: 'admin', password: 'admin' });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const res = await api('POST', '/connection/connect');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await backend.services.dcnEvents.idle();
  });
  after(async () => { await backend?.close(); await mock?.close(); });

  test('settings: dcn defaults, secrets never returned or saved', async () => {
    const s = (await api('GET', '/connection/settings')).body.data;
    assert.equal(s.system, 'dcn');
    assert.equal(s.dcnServer, 'tcp://localhost:9461');
    assert.equal(s.bridgeTokenSet, false);
    assert.equal(s.bridgeToken, undefined);
    assert.equal(s.password, undefined);
    const saved = readFileSync(join(backend.dataDir, 'settings.json'), 'utf8');
    assert.doesNotMatch(saved, /mock-token|"password"|bridgeToken/);
    assert.equal((await api('PUT', '/connection/settings', { dcnServer: 'http://x' })).status, 400);
    const status = (await api('GET', '/connection')).body.data;
    assert.equal(status.state, 'loggedIn');
    assert.ok(status.permissions.includes('DiscussionApi.IsDiscussStandardControllAllowed'));
  });

  test('initial sync fills the dcn topics', () => {
    const { cache } = backend.services;
    for (const t of DCN_TOPICS) assert.ok(cache.get(t.topic), `${t.topic} cached (${cache.unavailable.get(t.topic)})`);
    assert.equal(cache.get('dcnSeatAssignments').data.length, 20); // uses DEFAULT_AREA from hello.constants (mock: 1)
    assert.deepEqual(cache.get('dcnActiveMeeting').data, { meetingId: 1 });
    assert.equal(cache.get('dcnVoting').data.state, 'closed');
    assert.equal(cache.get('dcnBridge').data.bridge.name, 'dcn-bridge-mock');
  });

  test('every DCN-SW API method is reachable through the passthrough', async () => {
    const list = (await api('GET', '/dcn/ops')).body.data;
    assert.equal(list.length, 109); // 104 from the CHM + 5 found in the DLLs (WO-068)
    const results = {};
    for (const m of list) {
      const args = Object.fromEntries(m.in.map(p => [p.name, sample(p.type)]));
      const res = await api('POST', `/dcn/ops/${m.api}/${m.method}`, args);
      assert.ok([200, 502].includes(res.status), `${m.key}: ${res.status} ${JSON.stringify(res.body)}`);
      results[res.status] = (results[res.status] ?? 0) + 1;
    }
    assert.ok(results[200] > 60, JSON.stringify(results));
    // The sample arguments also stopped the meeting etc.: back to the initial state.
    mock.reset();
    await backend.services.dcnEvents.resync();
  });

  test('passthrough: GET for reads, validation, error mapping', async () => {
    assert.deepEqual((await api('GET', '/dcn/ops/control.DcnSystemApi/GetMasterVolume')).body.data, { masterVolume: backend.services.cache.get('dcnMasterVolume').data.volume });
    const byId = await api('GET', '/dcn/ops/config.DelegateApi/RetrieveDelegatesById?delegateIds=101,102');
    assert.equal(byId.body.data.delegates.length, 2);
    assert.equal((await api('GET', '/dcn/ops/control.DiscussionApi/SpeakNow?seatId=1&participantId=0')).status, 400); // writes need POST
    assert.equal((await api('POST', '/dcn/ops/control.DiscussionApi/SpeakNow', { seatId: 1 })).status, 400);
    assert.equal((await api('POST', '/dcn/ops/control.Nope/SpeakNow', {})).status, 404);
    const err = await api('POST', '/dcn/ops/control.DiscussionApi/SpeakNow', { participantId: 0, seatId: 999 });
    assert.equal(err.status, 502);
    assert.equal(err.body.error.apiError, 'INVALID_PARAMETER');
    mock.setAllowed('control', 'DiscussionApi.IsDiscussStandardViewAllowed', false);
    const denied = await api('GET', '/dcn/ops/control.DiscussionApi/RetrieveSpeakersList');
    assert.equal(denied.status, 401);
    assert.equal(denied.body.error.apiError, 'NO_AUTHORIZATION');
    await waitTopic('dcnBridge', d => d.status.control.allowed['DiscussionApi.IsDiscussStandardViewAllowed'] === false);
    mock.setAllowed('control', 'DiscussionApi.IsDiscussStandardViewAllowed', true);
    await waitTopic('dcnBridge', d => d.status.control.allowed['DiscussionApi.IsDiscussStandardViewAllowed'] === true);
    await backend.services.dcnEvents.idle();
  });

  test('events from the system update topics without polling', async () => {
    mock.sim.requestToSpeak(5);
    await waitTopic('dcnRequests', d => d.some(p => p.SeatId === 5));
    await waitTopic('dcnMicStatus', d => d.some(s => s.SeatId === 5 && s.MicStatus === 'FIRST_REQUEST'));
    mock.sim.pressMic(7);
    await waitTopic('dcnSpeakers', d => d.some(p => p.SeatId === 7 && p.ParticipantId === 107));
    await api('POST', '/dcn/ops/control.DiscussionApi/Shift', { participantId: 0, seatId: 5 });
    await waitTopic('dcnSpeakers', d => d.some(p => p.SeatId === 5));
    await waitTopic('dcnRequests', d => d.length === 0);
    await api('POST', '/dcn/ops/control.DcnSystemApi/SetMasterVolume', { masterVolume: 20 });
    await waitTopic('dcnMasterVolume', d => d.volume === 20);
  });

  test('voting: state from events, results from the VoteResults event', async () => {
    assert.equal((await api('POST', '/dcn/ops/control.VoteApi/StartVotingById', { votingId: 1001 })).status, 200);
    await waitTopic('dcnVoting', d => d.state === 'opened');
    await waitTopic('dcnActiveVoting', d => d.votingId === 1001);
    mock.sim.castVote(2, 'Yes');
    mock.sim.castVote(3, 'Yes');
    mock.sim.castVote(4, 'No');
    await waitTopic('dcnVotingQuorum', d => d.TotalResults.NotVotedCount === d.TotalResults.PresentCount - 3);
    await api('POST', '/dcn/ops/control.VoteApi/HoldVoting', {});
    await waitTopic('dcnVoting', d => d.state === 'onHold');
    await api('POST', '/dcn/ops/control.VoteApi/ContinueVoting', {});
    await waitTopic('dcnVoting', d => d.state === 'opened');
    await api('POST', '/dcn/ops/control.VoteApi/StopVoting', {});
    const results = await waitTopic('dcnVoteResults', d => d.ConfigId === 1001);
    assert.deepEqual(results.TotalResults.Answers[0], { AnswerId: 1, CastCount: 2 }); // Yes
    await waitTopic('dcnVoting', d => d.state === 'done' && d.outcome === 'accepted');
    await waitTopic('dcnActiveVoting', d => d.votingId === null);
  });

  test('meeting stop/start resyncs everything', async () => {
    await api('POST', '/dcn/ops/control.MeetingApi/StopMeetingById', { meetingId: 1 });
    await waitTopic('dcnActiveMeeting', d => d.meetingId === null);
    await waitTopic('dcnSeatAssignments', d => d.length === 0);
    await waitTopic('dcnSpeakers', d => d.length === 0);
    assert.equal((await api('POST', '/dcn/ops/control.DiscussionApi/SpeakNow', { participantId: 0, seatId: 2 })).body.error.apiError, 'NOT_ACTIVE');
    await api('POST', '/dcn/ops/control.MeetingApi/StartMeetingById', { meetingId: 1 });
    await api('POST', '/dcn/ops/control.MeetingApi/StartSessionById', { sessionId: 11 });
    await waitTopic('dcnActiveSession', d => d.sessionId === 11);
    await waitTopic('dcnSeatAssignments', d => d.length === 20);
    await waitTopic('dcnVotingScript', d => d.length === 2);
  });

  test('config change events refresh configuration topics', async () => {
    const res = await api('POST', '/dcn/ops/config.DelegateApi/StoreDelegates', { delegates: [{ FirstName: 'Kai', LastName: 'Berg' }] });
    assert.equal(res.status, 200);
    const [id] = res.body.data.delegateIds;
    await waitTopic('dcnDelegates', d => d.some(x => x.id === id && x.LastName === 'Berg'));
    await api('POST', '/dcn/ops/config.MeetingApi/UpdateMeetingTitle', { meetingId: 2, newMeetingTitle: 'Budget' });
    await waitTopic('dcnMeetings', d => d.some(m => m.id === 2 && m.Title === 'Budget'));
  });

  test('bridge connection loss: reconnect and resync', async () => {
    const { manager, dcnEvents } = backend.services;
    const again = once(manager.client, 'loggedIn');
    mock.dropClient();
    await again;
    await dcnEvents.idle();
    assert.equal((await api('GET', '/connection')).body.data.state, 'loggedIn');
    assert.equal(mock.stats.connects >= 2, true);
  });

  test('disconnect terminates and clears the dcn topics', async () => {
    await api('POST', '/connection/disconnect');
    assert.equal(backend.services.cache.get('dcnSpeakers'), null);
    assert.equal((await api('GET', '/dcn/ops/control.DcnSystemApi/GetMasterVolume')).status, 503);
  });
});
