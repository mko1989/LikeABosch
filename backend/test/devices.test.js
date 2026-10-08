import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startBackend } from './helpers/start.js';

let backend;
before(async () => { backend = await startBackend(); });
after(() => backend.close());

const call = async (method, path, body) => {
  const res = await fetch(`${backend.url}/api/devices${path}`, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('camera CRUD with the mock driver; passwords never returned; file is private', async () => {
  const add = await call('POST', '/cameras', { name: 'Chair cam', driver: 'mock', password: 'secret', switcherInput: 1 });
  assert.equal(add.status, 200);
  const cam = add.body.data;
  assert.equal(cam.id, 'cam-1');
  assert.equal(cam.passwordSet, true);
  assert.equal('password' in cam, false);
  assert.equal(cam.status.connected, true);
  const saved = JSON.parse(readFileSync(join(backend.services.projects.currentDir, 'devices.json'), 'utf8'));
  assert.equal(saved.cameras[0].password, 'secret', 'stored for automation after restart');
  assert.equal(statSync(join(backend.services.projects.currentDir, 'devices.json')).mode & 0o777, 0o600);
  const upd = await call('PUT', '/cameras/cam-1', { name: 'Chair camera' });
  assert.equal(upd.body.data.name, 'Chair camera');
  const bad = await call('POST', '/cameras', { name: '', driver: 'nope', bogus: 1 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.details.length, 3);
  assert.equal((await call('POST', '/cameras', { name: 'x', driver: 'visca' })).body.error.details[0], 'host: required');
});

test('camera control: recall, store, move, stop; topic devices.cameras updates', async () => {
  const current = () => backend.services.cache.get('devices.cameras').data.cameras[0].currentPreset;
  assert.equal((await call('POST', '/cameras/cam-1/recall', { preset: 3 })).status, 200);
  assert.deepEqual(current(), { preset: 3, modified: false }, 'current preset after recall (WO-054)');
  assert.equal((await call('POST', '/cameras/cam-1/move', { pan: 0.2 })).status, 200);
  assert.deepEqual(current(), { preset: 3, modified: true }, 'adjusted after a jog');
  assert.deepEqual((await call('POST', '/cameras/cam-1/store', { preset: 3 })).body.data, { preset: 3 });
  assert.deepEqual(current(), { preset: 3, modified: false }, 'overwritten');
  assert.deepEqual((await call('POST', '/cameras/cam-1/store', { preset: 4 })).body.data, { preset: 4 });
  assert.deepEqual(current(), { preset: 4, modified: false });
  assert.equal((await call('POST', '/cameras/cam-1/move', { pan: 0.5, tilt: -0.2 })).status, 200);
  assert.equal((await call('POST', '/cameras/cam-1/move', { pan: 3 })).status, 400);
  assert.equal((await call('POST', '/cameras/cam-1/stop')).status, 200);
  assert.equal((await call('POST', '/cameras/cam-1/recall', {})).status, 400);
  assert.equal((await call('POST', '/cameras/nope/recall', { preset: 1 })).status, 404);
  const topic = backend.services.cache.get('devices.cameras').data.cameras[0];
  assert.equal(topic.status.preset, 3);
  assert.equal(topic.currentPreset.preset, 4);
});

test('switcher: set mock, cut, status topic; remove', async () => {
  assert.equal((await call('POST', '/switcher/cut', { input: 2 })).status, 503);
  const sw = await call('PUT', '/switcher', { driver: 'mock', me: 0 });
  assert.equal(sw.body.data.status.connected, true);
  assert.equal((await call('POST', '/switcher/cut', { input: 3 })).status, 200);
  assert.equal(backend.services.cache.get('devices.switcher').data.switcher.status.program, 3);
  assert.equal((await call('POST', '/switcher/preview', { input: 5 })).status, 200);
  assert.equal(backend.services.cache.get('devices.switcher').data.switcher.status.preview, 5, 'preview published (WO-053)');
  assert.equal((await call('PUT', '/switcher', { driver: 'atem' })).status, 400, 'atem needs a host');
  assert.equal((await call('PUT', '/switcher', {})).body.data, null);
  assert.equal(backend.services.cache.get('devices.switcher').data.switcher, null);
});

test('unreachable camera is retried in the background and reported', async () => {
  const r = await call('POST', '/cameras', { name: 'Gone', driver: 'panasonic', host: '127.0.0.1', port: 1 });
  assert.equal(r.body.data.status.connected, false);
  assert.ok(r.body.data.status.lastError);
  assert.equal((await call('POST', `/cameras/${r.body.data.id}/recall`, { preset: 1 })).status, 503);
  await call('DELETE', `/cameras/${r.body.data.id}`);
});
