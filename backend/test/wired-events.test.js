import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WiredClient } from '../src/wired/client.js';
import { WiredEventBridge } from '../src/wired/events.js';
import { StateCache } from '../src/state/cache.js';
import { loadSpec } from '../src/wired/spec.js';
import { createLogger } from '../src/lib/logger.js';
import { startConnectedBackend } from './helpers/start.js';
import { createMockWiredServer } from '../../mock/wired/server.js';

const log = createLogger({ level: 'silent' });
const spec = loadSpec();
let mock;
before(async () => { mock = await createMockWiredServer(); });
after(() => mock.close());

/** Client + cache + bridge wired together, logged in and fully synced. */
async function setup({ user = 'admin' } = {}) {
  const client = new WiredClient({
    host: '127.0.0.1', port: mock.port, user, password: 'admin', log, reconnect: { enabled: true, minDelayMs: 20, maxDelayMs: 50 },
  });
  const cache = new StateCache();
  const bridge = new WiredEventBridge({ spec, cache, log, coalesceMs: 10 });
  bridge.attach(client);
  await client.connect();
  await bridge.idle();
  return { client, cache, bridge, close: async () => { bridge.detach(); await client.close(); } };
}

/** Resolve when the cache emits a change for `topic` matching `predicate`. */
const nextChange = (cache, topic, predicate = () => true) => new Promise(resolve => {
  const onChange = (t, entry) => {
    if (t === topic && predicate(entry?.data)) { cache.off('change', onChange); resolve(entry?.data); }
  };
  cache.on('change', onChange);
});

test('after login all permitted topics are cached', async () => {
  const s = await setup();
  for (const t of ['permissions', 'seats', 'discussionList', 'meetingInfo', 'meetings', 'agendaTopics', 'participants',
    'votings', 'votingState', 'systemPowerMode', 'masterVolume', 'roomName', 'images']) {
    assert.ok(s.cache.get(t), `topic ${t} cached`);
  }
  assert.equal(s.cache.get('seats').data.seats.length, 20);
  assert.equal(s.cache.get('participantAccessDenied'), null, 'notification topics are not cached');
  await s.close();
});

test('events refresh topics and stay armed for subsequent changes', async () => {
  const s = await setup();
  let change = nextChange(s.cache, 'discussionList', d => d.discussionList.some(e => e.seatId === 'seat-7'));
  mock.requestToSpeak('seat-7');
  await change;
  change = nextChange(s.cache, 'discussionList', d => d.discussionList.some(e => e.seatId === 'seat-8'));
  mock.requestToSpeak('seat-8');
  await change; // second change arrives → the refresh re-armed the event
  for (const seatId of ['seat-7', 'seat-8']) await s.client.request('RemoveSeatFromDiscussionList', { seatId });
  await s.close();
});

test('meetingInfoChanged also refreshes agenda (alsoRefreshTopics)', async () => {
  const s = await setup();
  const change = nextChange(s.cache, 'agendaTopics', d => d.agendaTopics.some(t => t.state === 'opened'));
  await s.client.request('OpenAgenda', { agendaTopicId: 'meeting-1-topic-2' });
  await change;
  await s.client.request('CloseAgenda');
  await s.close();
});

test('a failed refresh re-arms its event (next change still arrives)', async () => {
  const s = await setup();
  mock.failOperation('GetRoomName', 'temporarily broken');
  const gone = nextChange(s.cache, 'roomName', d => d === undefined);
  mock.fire('roomNameChanged');
  await gone;
  await s.bridge.idle(); // the explicit re-arm (RegisterEvents) must have reached the server
  assert.match(s.cache.unavailable.get('roomName'), /temporarily broken/);
  mock.failOperation('GetRoomName', null);
  const back = nextChange(s.cache, 'roomName', d => d?.roomName === 'Mock Council Chamber');
  mock.fire('roomNameChanged'); // only delivered if the bridge re-armed the event after the failed refresh
  await back;
  await s.close();
});

test('meeting semantics like the real server: close → Default meeting; activate auto-opens', async () => {
  const s = await setup();
  let info = nextChange(s.cache, 'meetingInfo', d => d?.meetingInfo?.title === 'Default');
  await s.client.request('CloseMeeting');
  await info;
  await s.bridge.idle(); // meetings is refreshed via alsoRefreshTopics in the same flush
  assert.equal(s.cache.get('meetings').data.meetings.find(m => m.meetingId === 'meeting-1').state, 'deactivated');
  info = nextChange(s.cache, 'meetingInfo', d => d?.meetingInfo?.meetingId === 'meeting-2' && d.meetingInfo.state === 'opened');
  await s.client.request('ActivateMeeting', { meetingId: 'meeting-2' }); // autoOpenOnActivate
  await info;
  await s.client.request('DeactivateMeeting');
  await s.client.request('ActivateMeeting', { meetingId: 'meeting-1' });
  await s.client.request('OpenMeeting');
  await s.close();
});

test('detach with a refresh pending does not block the next client (regression)', async () => {
  const s = await setup();
  s.bridge.coalesceMs = 200;
  await s.client.request('SetMasterVolume', { volume: 4 }); // event → refresh timer pending
  await new Promise(r => setTimeout(r, 20));
  assert.ok(s.bridge.timer, 'refresh is pending');
  s.bridge.detach();
  await s.client.close();
  const client2 = new WiredClient({ host: '127.0.0.1', port: mock.port, user: 'admin', password: 'admin', log, reconnect: { enabled: false } });
  s.bridge.coalesceMs = 10;
  s.bridge.attach(client2);
  await client2.connect();
  const within = (p, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out: ${what}`)), 3000))]);
  await within(s.bridge.idle(), 'bridge idle');
  const change = nextChange(s.cache, 'masterVolume', d => d.volume === 9);
  await client2.request('SetMasterVolume', { volume: 9 });
  await within(change, 'masterVolume update after re-attach');
  s.bridge.detach();
  await client2.close();
});

test('missing permissions make topics unavailable without errors; permissionsChanged re-evaluates', async () => {
  mock.state.userPermissions.admin = ['canViewSynoptic'];
  const s = await setup();
  assert.match(s.cache.unavailable.get('votingState'), /missing permission: canViewVoting/);
  assert.equal(s.cache.get('votingState'), null);
  assert.ok(s.cache.get('seats'));

  delete mock.state.userPermissions.admin; // back to all permissions
  const change = nextChange(s.cache, 'votingState');
  mock.fire('permissionsChanged');
  await change;
  assert.equal(s.cache.unavailable.has('votingState'), false);
  await s.close();
});

test('notification topics are emitted only on their event, not at login, and not cached', async () => {
  const early = [];
  const client = new WiredClient({ host: '127.0.0.1', port: mock.port, user: 'admin', password: 'admin', log, reconnect: { enabled: false } });
  const bridge = new WiredEventBridge({ spec, cache: new StateCache(), log, coalesceMs: 10 });
  bridge.on('notification', n => early.push(n));
  bridge.attach(client);
  await client.connect();
  await bridge.idle();
  assert.deepEqual(early, [], 'no notification replayed at login');
  bridge.detach();
  await client.close();

  const s = await setup();
  const notified = once(s.bridge, 'notification');
  mock.fire('participantAccessDenied');
  const [n] = await notified;
  assert.equal(n.topic, 'participantAccessDenied');
  await s.close();
});

test('after a reconnect events are registered again', async () => {
  const s = await setup();
  const relogged = once(s.client, 'loggedIn');
  mock.dropConnections();
  await relogged;
  await s.bridge.idle();
  const change = nextChange(s.cache, 'masterVolume', d => d.volume === 3);
  await s.client.request('SetMasterVolume', { volume: 3 });
  await change;
  await s.close();
});

// ---- HTTP + SSE through the backend ----

/** Minimal SSE reader over fetch. Returns an async `next(event, predicate)`. */
async function openSse(url) {
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  const messages = [];
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event) messages.push({ event, data: JSON.parse(data) });
        }
      }
    } catch { /* aborted */ }
  })();
  return {
    async next(event, predicate = () => true) {
      for (;;) {
        const i = messages.findIndex(m => m.event === event && predicate(m.data));
        if (i >= 0) return messages.splice(i, 1)[0].data;
        await new Promise(r => setTimeout(r, 10));
      }
    },
    close: async () => { controller.abort(); await pump; },
  };
}

test('SSE: snapshot on connect, then topic updates; /api/state endpoints', async () => {
  const backend = await startConnectedBackend(mock);
  try {
    const sse = await openSse(`${backend.url}/api/events`);
    const snapshot = await sse.next('snapshot');
    assert.equal(snapshot.topics.seats.data.seats.length, 20);

    await fetch(`${backend.url}/api/wired/ops/SetMasterVolume`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ volume: 15 }),
    });
    const update = await sse.next('topic', d => d.topic === 'masterVolume' && d.data.volume === 15);
    assert.ok(update.updatedAt);

    const one = await (await fetch(`${backend.url}/api/state/masterVolume`)).json();
    assert.equal(one.data.data.volume, 15);
    assert.equal((await fetch(`${backend.url}/api/state/nope`)).status, 404);
    assert.ok((await (await fetch(`${backend.url}/api/state`)).json()).data.topics.roomName);
    await sse.close();
  } finally {
    await backend.close();
  }
});
