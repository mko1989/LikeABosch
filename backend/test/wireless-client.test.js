import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WirelessClient } from '../src/wireless/client.js';
import { loadWirelessSpec, validateSchema } from '../src/wireless/spec.js';
import { createLogger } from '../src/lib/logger.js';
import { createMockWirelessServer } from '../../mock/wireless/server.js';

const log = createLogger({ level: 'silent' });
let mock;
before(async () => { mock = await createMockWirelessServer({ longPollMs: 1500 }); });
after(() => mock.close());

const client = (o = {}) => new WirelessClient({ host: '127.0.0.1', port: mock.port, user: 'admin', password: 'admin', log, reconnect: { enabled: false }, ...o });

test('login, request, logout', async () => {
  const c = client();
  await c.connect();
  assert.equal(c.state, 'loggedIn');
  assert.equal((await c.request('GET', '/seats')).length, 20);
  assert.equal((await c.request('GET', '/seats/3')).name, 'Seat 3');
  await c.close();
  assert.equal(mock.sessionCount, 0);
});

test('wrong password → UPSTREAM_AUTH; second login → 409 unless override', async () => {
  await assert.rejects(client({ password: 'x' }).connect(), { code: 'UPSTREAM_AUTH' });
  const a = client();
  await a.connect();
  await assert.rejects(client().connect(), err => err.code === 'UPSTREAM_AUTH' && err.extra.reason === 'alreadyLoggedIn');
  const b = client({ override: true });
  await b.connect();
  assert.equal(mock.sessionCount, 1, 'override replaced the old session');
  await b.close();
  a.closing = true; // its session is gone; don't try to log out
});

test('session id: cookie or Bosch-Sid header; the swagger header `sid` is refused (real WAP, WO-075)', async () => {
  const c = client();
  await c.connect();
  const viaBoschSid = await fetch(`${mock.url}/system/status`, { headers: { 'bosch-sid': c.sid } });
  const viaCookie = await fetch(`${mock.url}/system/status`, { headers: { cookie: `sid=${c.sid}` } });
  const viaSid = await fetch(`${mock.url}/system/status`, { headers: { sid: c.sid } });
  assert.deepEqual([viaBoschSid.status, viaCookie.status, viaSid.status], [200, 200, 401]);
  assert.equal(await viaSid.text(), '', 'dead-session 401 has no body');
  assert.equal((await fetch(`${mock.url}/system/status`)).status, 401);
  await c.close();
});

test('login body carries the sid too; a taken-over session disconnects instead of fighting (409)', async () => {
  const res = await fetch(`${mock.url}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin' }) });
  const body = await res.json();
  assert.equal(typeof body.sid, 'string');
  assert.equal(body.id, body.id | 0);
  await fetch(`${mock.url}/logout`, { method: 'POST', headers: { cookie: `sid=${body.sid}` } });

  const ours = client();
  await ours.connect();
  const other = client({ override: true });
  await other.connect();
  await assert.rejects(ours.request('GET', '/system/status'), err => err.code === 'UPSTREAM_AUTH' && err.extra.reason === 'alreadyLoggedIn');
  assert.equal(ours.state, 'disconnected');
  await other.close();
});

test('expired session → transparent re-login', async () => {
  const c = client();
  await c.connect();
  let logins = 0;
  c.on('loggedIn', () => { logins += 1; });
  mock.expireSessions();
  assert.equal((await c.request('GET', '/system/status')).state, 0);
  assert.equal(logins, 1);
  await c.close();
});

test('errors map to UPSTREAM_ERROR with details; unreachable → NOT_CONNECTED', async () => {
  const c = client();
  await c.connect();
  await assert.rejects(c.request('DELETE', '/speakers/7'), err => {
    assert.equal(err.code, 'UPSTREAM_ERROR');
    assert.equal(err.extra.status, 400);
    assert.match(err.extra.upstream, /Speaker not found in speakers list/);
    return true;
  });
  await c.close();
  await assert.rejects(client({ port: 1 }).connect(), { code: 'NOT_CONNECTED' });
});

test('speaker / waiting-list / priority semantics', async () => {
  const c = client();
  await c.connect();
  await c.request('POST', '/speakers', { body: [2, 3, 4, 5] });
  await c.request('POST', '/speakers', { body: [6] }); // full (4): the oldest speaker makes room
  assert.deepEqual((await c.request('GET', '/speakers')).map(e => e.id), [3, 4, 5, 6]);
  await assert.rejects(c.request('POST', '/speakers', { body: [19] }), err => /Invalid seat id 19/.test(err.extra.upstream)); // not connected
  await assert.rejects(c.request('POST', '/speakers', { body: 2 }), err => /Invalid request body type/.test(err.extra.upstream));
  await c.request('POST', '/speakers', { body: { id: 2 } }); // an object is accepted and ignored, like the WAP
  await assert.rejects(c.request('POST', '/speakers'), err => /No waiter to shift/.test(err.extra.upstream));
  await assert.rejects(c.request('POST', '/priority', { body: [2] }), err => /not a chairman seat/.test(err.extra.upstream));
  mock.requestToSpeak(9);
  assert.deepEqual((await c.request('GET', '/waiting-list')).map(e => e.id), [9]);
  await c.request('POST', '/priority', { body: [1] });
  assert.equal((await c.request('GET', '/speakers'))[0].prioOn, true);
  await c.request('DELETE', '/speakers'); // keeps the priority call, mic off; clears waiting list
  const speakers = await c.request('GET', '/speakers');
  assert.deepEqual(speakers.map(e => [e.id, e.micOn]), [[1, false]]);
  assert.deepEqual(await c.request('GET', '/waiting-list'), []);
  await c.request('DELETE', '/priority/1');
  // POST /speakers without a body = shift the first waiter to the speakers.
  await c.request('POST', '/waiting-list', { body: [7, 8] });
  await c.request('POST', '/speakers');
  assert.deepEqual((await c.request('GET', '/speakers')).map(e => e.id), [7]);
  assert.deepEqual((await c.request('GET', '/waiting-list')).map(e => e.id), [8]);
  await c.request('DELETE', '/speakers');
  // Override / Voice / PTT have no waiting list: the WAP answers a bare 500.
  mock.setDiscuss({ mode: 1 });
  await assert.rejects(c.request('POST', '/waiting-list', { body: [7] }), err => err.extra.status === 500);
  mock.setDiscuss({ mode: 0 });
  await c.close();
});

test('participants: all fields required on create, WAP validation messages, {id} back', async () => {
  const c = client();
  await c.connect();
  const upstream = async (method, path, body) => c.request(method, path, { body }).then(() => 'ok', err => err.extra.upstream);
  assert.equal(await upstream('POST', '/participants', { name: 'X' }), "Missing field 'nfc'");
  assert.equal(await upstream('POST', '/participants', { name: 'X', nfc: '' }), "Missing field 'seatId'");
  assert.equal(await upstream('POST', '/participants', { name: 'N'.repeat(33), seatId: -1, nfc: '' }), "Value out of range for field 'name'");
  assert.equal(await upstream('POST', '/participants', { name: 'X', seatId: 999, nfc: '' }), 'Unknown seat id');
  assert.equal(await upstream('POST', '/participants', { name: 'X', seatId: 1, nfc: '' }), 'Seat already assigned');
  assert.equal(await upstream('POST', '/participants', { name: 'X', seatId: -1, nfc: 'zz' }), 'NFC id has incorrect formatting');
  assert.equal(await upstream('POST', '/participants', { name: 'X', seatId: -1, nfc: '04:A1:B2:C3:D4:10' }), 'NFC already assigned');
  const { id } = await c.request('POST', '/participants', { body: { name: 'N'.repeat(32), seatId: -1, nfc: '' } });
  await c.request('PUT', `/participants/${id}`, { body: { name: 'Renamed' } }); // partial update
  assert.deepEqual(await c.request('GET', `/participants/${id}`), { id, name: 'Renamed', seatId: -1, nfc: '' });
  assert.equal(await upstream('GET', '/participants/999'), 'Invalid participant id');
  assert.equal(await upstream('DELETE', '/participants/999'), 'Unknown participant id');
  assert.equal(await upstream('PUT', '/participants/settings', { identification_mode: 7 }), "Value out of range for field 'identification_mode'");
  await c.request('DELETE', `/participants/${id}`);
  const saved = structuredClone(mock.state.participants);
  await c.request('DELETE', '/participants');
  assert.equal(await upstream('PUT', '/participants/settings', { identification_mode: 0 }), 'Cannot set this identification mode without participants.');
  mock.state.participants = saved;
  await c.close();
});

test('standby disconnects every seat, power on brings them back', async () => {
  const c = client();
  await c.connect();
  await c.request('PUT', '/system/status', { body: { state: 1 } });
  assert.equal((await c.request('GET', '/seats')).filter(s => s.connected).length, 0);
  assert.equal((await c.request('GET', '/seats/2')).batteryStatus, null);
  await c.request('PUT', '/system/status', { body: { state: 0 } });
  assert.equal((await c.request('GET', '/seats')).filter(s => s.connected).length, 18);
  await c.close();
});

test('voting: parameters, open, votes, results', async () => {
  const c = client();
  await c.connect();
  await c.request('PUT', '/voting', { body: { mode: 3, subject: 'Motion 7' } });
  await c.request('PUT', '/voting/state', { body: { state: 1 } });
  mock.castVote(2, 'yes');
  mock.castVote(3, 'no');
  mock.castVote(4, 'yes');
  const r = await c.request('GET', '/voting/results');
  // Like the WAP: present + the round's answers + notVoted, and always an individuals array.
  assert.deepEqual(r.results.map(x => x.name), ['present', 'yes', 'no', 'notVoted']);
  assert.deepEqual(r.results.filter(x => ['yes', 'no'].includes(x.name)), [{ name: 'yes', value: 2 }, { name: 'no', value: 1 }]);
  assert.equal(r.subject, 'Motion 7');
  assert.ok(Array.isArray(r.individuals));
  // Accepted while open, but only for the next round.
  await c.request('PUT', '/voting', { body: { mode: 4, subject: 'Next' } });
  assert.equal((await c.request('GET', '/voting/results')).subject, 'Motion 7');
  assert.equal((await c.request('GET', '/voting')).subject, 'Next');
  await assert.rejects(c.request('PUT', '/voting/state', { body: { state: 1 } }), err => err.extra.upstream === 'Cannot change state from 1 to 1');
  await c.request('PUT', '/voting/state', { body: { state: 0 } });
  await assert.rejects(c.request('PUT', '/voting/state', { body: { state: 2 } }), err => err.extra.upstream === 'Cannot change state from 0 to 2');
  await assert.rejects(c.request('PUT', '/voting', { body: { individuals: true, resultsSettings: { individuals: true } } }), /deprecated/);
  await assert.rejects(c.request('PUT', '/voting', { body: { resultsSettings: { interimResultsMode: 0, individuals: false } } }), /Combination/);
  await c.request('PUT', '/voting', { body: { mode: 3, subject: '' } });
  await c.close();
});

test('one long-poll per path and session: a second one releases the first', async () => {
  const c = client();
  await c.connect();
  const t = Date.now();
  const first = c.request('GET', '/voting/state', { query: { isPolling: true }, timeoutMs: 5000 });
  setTimeout(() => c.request('GET', '/voting/state', { query: { isPolling: true }, timeoutMs: 5000 }).catch(() => {}), 200);
  await first;
  assert.ok(Date.now() - t < 1000, 'released by the second long-poll');
  await c.close();
});

test('long-poll returns early on change, otherwise after the poll window', async () => {
  const c = client();
  await c.connect();
  let t = Date.now();
  const pending = c.request('GET', '/waiting-list', { query: { isPolling: true }, timeoutMs: 5000 });
  setTimeout(() => mock.requestToSpeak(11), 100);
  assert.ok((await pending).some(e => e.id === 11));
  assert.ok(Date.now() - t < 1000, 'answered on change');
  t = Date.now();
  await c.request('GET', '/system/status', { query: { isPolling: true }, timeoutMs: 5000 });
  assert.ok(Date.now() - t >= 1400, 'held for the poll window');
  await c.request('DELETE', '/waiting-list');
  await c.close();
});

test('every mock GET response validates against the swagger schema', async () => {
  const spec = loadWirelessSpec();
  const c = client();
  await c.connect();
  await c.request('PUT', '/voting', { body: { resultsSettings: { individuals: true } } });
  const problems = [];
  for (const op of spec.operations.filter(o => o.method === 'GET')) {
    const path = op.path.replace('{seat_id}', '1').replace('{participant_id}', '1');
    const data = await c.request('GET', path);
    problems.push(...validateSchema(spec.responseSchema(op), data, op.id));
  }
  assert.deepEqual(problems, []);
  await c.close();
});

test('swagger.json is the YAML converted verbatim (sanity)', () => {
  const spec = loadWirelessSpec();
  assert.equal(spec.operations.filter(o => !o.undocumented).length, 32);
  assert.ok(spec.operations.some(o => o.undocumented && o.id === 'PUT /discuss'), 'undocumented.json loaded (DEC-024)');
  assert.equal(spec.match('GET', '/seats/status').op.id, 'GET /seats/status', 'literal path before /seats/{seat_id}');
  assert.equal(spec.info.version, '1.7');
  assert.equal(spec.match('GET', '/participants/settings').op.id, 'GET /participants/settings');
});
