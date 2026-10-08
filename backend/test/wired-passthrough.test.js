import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBackend, startConnectedBackend } from './helpers/start.js';
import { createMockWiredServer } from '../../mock/wired/server.js';
import { MANAGED_OPERATIONS } from '../src/wired/routes.js';

let mock;
let backend;

before(async () => {
  mock = await createMockWiredServer();
  backend = await startConnectedBackend(mock);
});
after(async () => {
  await backend.close();
  await mock.close();
});

const api = async (method, path, body) => {
  const res = await fetch(`${backend.url}/api/wired${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('GET /ops lists the 113 in-scope operations (92 PDF + 18 DICENTIS 6.50 + 3 from the 7.0 CHM)', async () => {
  const { status, body } = await api('GET', '/ops');
  assert.equal(status, 200);
  assert.equal(body.data.length, 113);
  assert.equal(body.data.find(o => o.operation === 'ReadNotesFile').since, '6.7');
  assert.equal(body.data.find(o => o.operation === 'GetSeats').since, null);
  assert.ok(!body.data.some(o => o.operation === 'GetNamecardStatus'), 'excluded operations are not listed');
  const seats = body.data.find(o => o.operation === 'GetSeats');
  assert.deepEqual(seats.methods, ['GET', 'POST']);
  assert.ok(body.data.find(o => o.operation === 'Login').managed);
});

test('GET and POST pass through to the server (case-insensitive name)', async () => {
  const get = await api('GET', '/ops/getseats');
  assert.equal(get.status, 200);
  assert.equal(get.body.data.seats.length, 20);
  const post = await api('POST', '/ops/SetMasterVolume', { volume: 7 });
  assert.deepEqual(post, { status: 200, body: { ok: true, data: {} } });
  assert.equal((await api('GET', '/ops/GetMasterVolume')).body.data.volume, 7);
});

test('GET query parameters are typed from the spec', async () => {
  const r = await api('GET', '/ops/GetAgendaTopics?meetingId=meeting-2');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.agendaTopics[0].meetingId, 'meeting-2');
  assert.equal((await api('GET', '/ops/GetAgendaTopics?bogus=1')).status, 400);
});

test('validation: unknown field, wrong type, wrong enum → 400 before reaching the server', async () => {
  const unknown = await api('POST', '/ops/GetSeats', { foo: 1 });
  assert.equal(unknown.status, 400);
  assert.deepEqual(unknown.body.error.details, ['parameters.foo: unknown parameter']);
  assert.equal((await api('POST', '/ops/SetMasterVolume', { volume: 'loud' })).status, 400);
  const badEnum = await api('POST', '/ops/SetSystemPowerMode', { powerMode: 'maybe' });
  assert.equal(badEnum.status, 400);
  assert.match(badEnum.body.error.details[0], /one of poweredOn/);
  assert.equal((await api('POST', '/ops/GetSeats', [1])).status, 400);
});

test('state-changing operations reject GET', async () => {
  assert.equal((await api('GET', '/ops/SetMasterVolume?volume=3')).status, 400);
});

test('upstream errors → 502 UPSTREAM_ERROR with the server message', async () => {
  const r = await api('POST', '/ops/ActivateMicrophone', { seatId: 'seat-99' });
  assert.equal(r.status, 502);
  assert.equal(r.body.error.code, 'UPSTREAM_ERROR');
  assert.match(r.body.error.upstream, /seat-99/);
});

test('managed, excluded and unknown operations', async () => {
  assert.equal((await api('POST', '/ops/Login', {})).body.error.code, 'MANAGED_BY_BACKEND');
  assert.equal((await api('POST', '/ops/RegisterEvents', { events: [] })).status, 403);
  const excluded = await api('POST', '/ops/GenerateJwtToken', {});
  assert.equal(excluded.status, 404);
  assert.match(excluded.body.error.message, /not supported/);
  assert.equal((await api('POST', '/ops/NoSuchOp', {})).status, 404);
});

test('every in-scope operation is reachable (no 404/500)', async () => {
  const { body } = await api('GET', '/ops');
  const callable = body.data.filter(o => !MANAGED_OPERATIONS.has(o.operation.toLowerCase()));
  // Run read operations before state-changing ones so the session stays usable.
  callable.sort((a, b) => Number(!a.operation.startsWith('Get')) - Number(!b.operation.startsWith('Get')));
  for (const op of callable) {
    const r = await api('POST', `/ops/${op.operation}`, {});
    assert.ok([200, 502].includes(r.status), `${op.operation} → ${r.status} ${JSON.stringify(r.body)}`);
  }
});

test('topics without a change event are refreshed after the backend\'s own call (images)', async () => {
  const { cache, bridge } = backend.services;
  const before = cache.get('images').data.images.length;
  const r = await api('POST', '/ops/SaveImage', { name: 'new-bg.png', imageData: 'iVBORw0KGgo=' });
  assert.equal(r.status, 200);
  await bridge.idle();
  assert.equal(cache.get('images').data.images.length, before + 1);
});

test('not connected → 503', async () => {
  const other = await startBackend();
  try {
    const res = await fetch(`${other.url}/api/wired/ops/GetSeats`);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'NOT_CONNECTED');
  } finally {
    await other.close();
  }
});

test('event registration: optional (newer) events are not in the main RegisterEvents call (WO-044)', async () => {
  const { loadSpec } = await import('../src/wired/spec.js');
  const spec = loadSpec();
  const documented = String(spec.get('RegisterEvents').request.events[0]).slice(5).split('|');
  const optional = spec.eventMap.events.filter(e => e.optional).map(e => e.event);
  assert.equal(documented.length, 39, '7.0 CHM list');
  assert.ok(optional.includes('seatMicrophoneSensitivityUpdated') && optional.includes('meetingListChanged'));
  assert.ok(optional.every(e => documented.includes(e)), 'every optional event is documented');
  assert.ok(!spec.registrableEvents.some(e => optional.includes(e)), 'main call excludes optional events');
  assert.equal(spec.registrableEvents.length + optional.length, documented.length);
});
