// WO-106 / DEC-034: adding, editing, seating and removing participants on a wired DICENTIS through the DCNM API, in a
// simulated wired system with the full API (Conference Protocol mock + linked mock dicentis-bridge, WO-101). The result
// is read back the way the UI sees it: the Conference Protocol's participant topics → domain.participants.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startBackend } from './helpers/start.js';
import { splitName, userNameFor, personUpdate } from '../src/dicentis/participants.js';

const until = async (fn, ms = 6000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 30))) { const v = await fn(); if (v) return v; }
  return fn();
};
let backend, cache;
const call = async (method, path, body, raw) => {
  const res = await fetch(`${backend.url}/api${path}`, {
    method, headers: raw ? { 'content-type': 'application/octet-stream' } : body ? { 'content-type': 'application/json' } : {},
    body: raw ?? (body && JSON.stringify(body)),
  });
  return { status: res.status, body: await res.json() };
};
const people = () => cache.get('domain.participants')?.data ?? [];
const person = name => people().find(p => p.name === name);

before(async () => {
  backend = await startBackend();
  cache = backend.services.cache;
  await call('PUT', '/connection/settings', { simulators: [{ id: 'sim-p', name: 'Hall', type: 'wired', seats: 20 }], simulate: 'sim-p' });
  await call('POST', '/connection/connect', {});
  assert.ok(await until(() => cache.get('dicentis.status')?.data?.state === 'loggedIn'), 'dicentis-bridge up');
  await backend.services.dicentis.idle();
  assert.ok(await until(() => cache.get('domain.capabilities')?.data?.actions?.editParticipants), 'editing enabled');
});
after(() => backend.close());

test('helpers: name split, user names, person update', () => {
  assert.deepEqual(splitName('Karin de Vries'), { FirstName: 'Karin', LastName: 'de Vries' });
  assert.deepEqual(splitName('  Madonna '), { FirstName: '', LastName: 'Madonna' });
  assert.throws(() => splitName(' '), { code: 'VALIDATION' });
  assert.equal(userNameFor('Zoë Ångström', []), 'zoe.angstrom');
  assert.equal(userNameFor('Anna Kowalska', ['anna.kowalska', 'Anna.Kowalska2']), 'anna.kowalska3');
  const u = { Title: 'Dr', FirstName: 'Anna', MiddleName: '', LastName: 'Bos', Group: 'A', Email: 'a@b' };
  assert.deepEqual(personUpdate(u, { name: 'Dr Anna Bos' }), u, 'same name: unchanged');
  assert.deepEqual(personUpdate(u, { name: 'Anna Visser', group: 'B' }), { ...u, Title: '', FirstName: 'Anna', LastName: 'Visser', Group: 'B' });
});

test('capabilities: editing on with the full API, off without it', () => {
  const caps = cache.get('domain.capabilities').data;
  assert.equal(caps.features.participantsEdit, true);
  assert.equal(caps.dicentis.participants, true);
});

test('add a participant with a seat and a group; it shows up through the Conference Protocol', async () => {
  const before = people().length;
  const r = await call('POST', '/domain/participants', { name: 'Ben Carter', seatId: 'seat-18', group: 'City Council' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.data.id, /^[0-9a-f-]{36}$/);
  const p = await until(() => person('Ben Carter'));
  assert.ok(p, 'participant listed');
  assert.equal(p.id, r.body.data.id);
  assert.equal(p.group, 'City Council');
  assert.equal(p.assignedSeatId, 'seat-18');
  assert.equal(people().length, before + 1);
  assert.equal(p.userName, 'ben.carter');
});

test('edit name and group, move to another seat (taking it from its holder), clear the seat', async () => {
  const ben = person('Ben Carter');
  const holder = people().find(p => p.assignedSeatId === 'seat-3');
  assert.ok(holder, 'seat-3 has a participant in the simulation');
  assert.equal((await call('PUT', `/domain/participants/${ben.id}`, { name: 'Benjamin Carter', group: 'Mayor', seatId: 'seat-3' })).status, 200);
  assert.ok(await until(() => person('Benjamin Carter')?.assignedSeatId === 'seat-3'));
  assert.equal(person('Benjamin Carter').group, 'Mayor');
  assert.equal(people().find(p => p.id === holder.id).assignedSeatId, null, 'the old holder lost the seat');
  assert.equal((await call('PUT', `/domain/participants/${ben.id}`, { seatId: null })).status, 200);
  assert.ok(await until(() => person('Benjamin Carter')?.assignedSeatId === null));
});

test('room inspector action: give a seat to a participant, then free it', async () => {
  const ben = person('Benjamin Carter');
  assert.equal((await call('PUT', '/domain/seats/seat-19/participant', { participantId: ben.id })).status, 200);
  assert.ok(await until(() => person('Benjamin Carter')?.assignedSeatId === 'seat-19'));
  const seat = await until(() => cache.get('domain.seats').data.find(s => s.id === 'seat-19' && s.person === 'Benjamin Carter'));
  assert.ok(seat, 'the seat shows the name on the plan');
  assert.equal((await call('PUT', '/domain/seats/seat-19/participant', { participantId: null })).status, 200);
  assert.ok(await until(() => person('Benjamin Carter')?.assignedSeatId === null));
});

test('validation: unknown seat, unknown participant, NFC, empty name', async () => {
  assert.equal((await call('POST', '/domain/participants', { name: 'X Y', seatId: 'seat-999' })).status, 400);
  assert.equal((await call('PUT', '/domain/participants/nobody', { name: 'Z' })).status, 400);
  assert.equal((await call('POST', '/domain/participants', { name: 'X Y', nfc: '04:11:22:33' })).status, 400);
  assert.equal((await call('POST', '/domain/participants', { name: '  ' })).status, 400);
});

test('delete removes the participant from the meeting', async () => {
  const ben = person('Benjamin Carter');
  assert.equal((await call('DELETE', `/domain/participants/${ben.id}`)).status, 200);
  assert.ok(await until(() => !person('Benjamin Carter')));
});

test('Excel import of the 45-person test file (Name + Affiliation): preview, apply, groups set', async () => {
  const file = readFileSync(new URL('./fixtures/participants-45.xlsx', import.meta.url));
  const preview = await call('POST', '/domain/participants/import', undefined, file);
  assert.equal(preview.status, 200);
  const { plan } = preview.body.data;
  assert.equal(plan.errors.length, 0, JSON.stringify(plan.errors));
  assert.equal(plan.columns.group, true);
  assert.equal(plan.creates.length, 45);
  const applied = await call('POST', '/domain/participants/import?apply=1', undefined, file);
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.data.result.done, 45);
  assert.ok(await until(() => person('Thomas Wright')?.group === 'Vice-Chairperson'));
  assert.equal(person('Stefan Müller').group, 'German Delegation');
});

test('participant user group: from the bridge constant, else from the meeting\'s participants', async () => {
  const client = backend.services.manager.dcnmClient;
  const saved = client.constants;
  client.constants = {}; // an older bridge without Guid constants
  try {
    const r = await call('POST', '/domain/participants', { name: 'Group Fallback' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(await until(() => person('Group Fallback')));
  } finally { client.constants = saved; }
});

test('without the full API: a clear "not supported" message', async () => {
  const d = backend.services.dicentis;
  const orig = d.features.bind(d);
  d.features = () => ({ ...orig(), participants: false });
  try {
    const r = await call('POST', '/domain/participants', { name: 'No Bridge' });
    assert.equal(r.status, 400);
    assert.match(r.body.error.message, /dicentis-bridge/);
  } finally { d.features = orig; }
});
