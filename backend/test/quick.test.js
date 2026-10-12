// Quick actions (WO-117, DEC-035): the /api/quick HTTP API for Companion-style control surfaces,
// against the wired mock and the wireless mock.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startBackend } from './helpers/start.js';
import { createMockWiredServer } from '../../mock/wired/server.js';
import { createMockWirelessServer } from '../../mock/wireless/server.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Poll GET /api/quick until the predicate holds on the compact state (state updates are asynchronous). */
async function waitQuick(backend, predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${backend.url}/api/quick`);
    last = (await res.json()).data;
    if (predicate(last)) return last;
    await sleep(50);
  }
  throw new Error(`timeout waiting for /api/quick condition; last state: ${JSON.stringify(last)}`);
}

const seatOf = (st, id) => st.seats.find(s => s.id === id);

describe('quick actions on the wired mock', () => {
  let mock;
  let backend;
  const api = async (method, path, body) => {
    const res = await fetch(`${backend.url}/api${path}`, {
      method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  before(async () => {
    mock = await createMockWiredServer();
    backend = await startBackend({
      DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(mock.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin',
      DICENTIS_AUTOCONNECT: 'true',
    });
    const { manager, bridge } = backend.services;
    if (manager.client?.state !== 'loggedIn') await once(manager.client, 'loggedIn');
    await bridge.idle();
    const r = await api('POST', '/quick/discussion/clear');
    assert.equal(r.status, 200);
    await waitQuick(backend, st => st.speakers.length === 0 && st.requests.length === 0);
  });
  after(async () => {
    await backend.close();
    await mock.close();
  });

  test('GET /api/quick: connected, seats with mic state, all mics off initially', async () => {
    const st = (await api('GET', '/quick')).body.data;
    assert.equal(st.connected, true);
    assert.equal(st.system, 'wired');
    assert.ok(st.seats.length > 0);
    for (const s of st.seats) {
      assert.ok('number' in s && 'id' in s && 'name' in s && 'mic' in s, `seat fields: ${JSON.stringify(s)}`);
      assert.equal(s.mic, 'off', `${s.id} mic`);
    }
  });

  test('mic on by seat id: seat-3 becomes a speaker and the latest speaker', async () => {
    const r = await api('POST', '/quick/seats/seat-3/mic/on');
    assert.equal(r.status, 200);
    const st = await waitQuick(backend, s => s.speakers.includes('seat-3') && seatOf(s, 'seat-3').mic === 'on');
    assert.equal(st.latestSpeaker.id, 'seat-3');
  });

  test('seat reference by name: "Seat 4" toggles seat-4 on', async () => {
    assert.equal((await api('POST', '/quick/seats/Seat%204/mic/toggle')).status, 200);
    await waitQuick(backend, s => seatOf(s, 'seat-4').mic === 'on');
  });

  test('seat reference by position: 5 turns the 5th seat (seat-5) on', async () => {
    assert.equal((await api('POST', '/quick/seats/5/mic/on')).status, 200);
    await waitQuick(backend, s => seatOf(s, 'seat-5').mic === 'on');
  });

  test('toggle again turns seat-4 off', async () => {
    assert.equal((await api('POST', '/quick/seats/seat-4/mic/toggle')).status, 200);
    await waitQuick(backend, s => seatOf(s, 'seat-4').mic === 'off');
  });

  test('unknown seat is 404; unknown action is 404', async () => {
    const seat = await api('POST', '/quick/seats/no-such-seat/mic/on');
    assert.equal(seat.status, 404);
    assert.equal(seat.body.ok, false);
    assert.equal(seat.body.error.code, 'NOT_FOUND');
    const action = await api('POST', '/quick/seats/seat-1/mic/blink');
    assert.equal(action.status, 404);
    assert.equal(action.body.error.code, 'NOT_FOUND');
  });

  test('requests are not supported on wired: 400', async () => {
    const r = await api('POST', '/quick/seats/seat-2/request/on');
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
  });

  test('discussion/clear empties speakers and requests', async () => {
    assert.equal((await api('POST', '/quick/discussion/clear')).status, 200);
    const st = await waitQuick(backend, s => s.speakers.length === 0 && s.requests.length === 0);
    assert.ok(st.seats.every(s => s.mic === 'off'));
  });
});

describe('quick actions on the wireless mock', () => {
  let mock;
  let backend;
  const api = async (method, path, body) => {
    const res = await fetch(`${backend.url}/api${path}`, {
      method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  before(async () => {
    mock = await createMockWirelessServer({ longPollMs: 1000 });
    backend = await startBackend({
      DICENTIS_SYSTEM: 'wireless', DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(mock.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin',
      DICENTIS_AUTOCONNECT: 'true',
    });
    if (backend.services.manager.client?.state !== 'loggedIn') await once(backend.services.manager.client, 'loggedIn');
    await backend.services.poller.idle();
    await api('POST', '/quick/discussion/clear');
    await waitQuick(backend, st => st.speakers.length === 0 && st.requests.length === 0);
  });
  after(async () => {
    await backend.close();
    await mock.close();
  });

  test('mic on and off by id "3"', async () => {
    assert.equal((await api('POST', '/quick/seats/3/mic/on')).status, 200);
    await waitQuick(backend, s => seatOf(s, '3').mic === 'on');
    assert.equal((await api('POST', '/quick/seats/3/mic/off')).status, 200);
    await waitQuick(backend, s => seatOf(s, '3').mic === 'off');
  });

  test('request toggle on seat 7, then next makes it a speaker', async () => {
    assert.equal((await api('POST', '/quick/seats/7/request/toggle')).status, 200);
    const st = await waitQuick(backend, s => seatOf(s, '7').mic === 'request');
    assert.equal(st.firstRequest.id, '7');
    assert.equal((await api('POST', '/quick/next')).status, 200);
    await waitQuick(backend, s => seatOf(s, '7').mic === 'on');
  });

  test('priority on and off by name "Chairman"', async () => {
    assert.equal((await api('POST', '/quick/seats/Chairman/priority/on')).status, 200);
    await waitQuick(backend, s => seatOf(s, '1').priority === true);
    assert.equal((await api('POST', '/quick/seats/Chairman/priority/off')).status, 200);
    await waitQuick(backend, s => seatOf(s, '1').priority === false);
  });

  test('mics/off switches every speaker off and leaves requests; requests/clear removes them', async () => {
    await api('POST', '/quick/discussion/clear');
    await waitQuick(backend, s => s.speakers.length === 0 && s.requests.length === 0);
    await api('POST', '/quick/seats/4/mic/on');
    await api('POST', '/quick/seats/5/mic/on');
    await waitQuick(backend, s => s.speakers.includes('4') && s.speakers.includes('5'));
    mock.requestToSpeak(9);
    await waitQuick(backend, s => s.requests.includes('9'));

    assert.equal((await api('POST', '/quick/mics/off')).status, 200);
    const st = await waitQuick(backend, s => s.speakers.length === 0);
    assert.deepEqual(st.requests, ['9']);

    assert.equal((await api('POST', '/quick/requests/clear')).status, 200);
    await waitQuick(backend, s => s.requests.length === 0);
  });

  test('GET /api/quick/events streams a state event', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(`${backend.url}/api/quick/events`, { signal: controller.signal });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/event-stream/);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (!text.includes('event: state')) {
        const { value, done } = await reader.read();
        assert.ok(!done, 'stream ended before a state event');
        text += decoder.decode(value, { stream: true });
      }
      const data = text.slice(text.indexOf('data: ') + 'data: '.length).split('\n')[0];
      assert.equal(JSON.parse(data).connected, true);
      await reader.cancel().catch(() => {});
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  });
});
