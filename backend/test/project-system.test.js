// DEC-025 / WO-093: projects follow the connected DICENTIS system.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockWiredServer } from '../../mock/wired/server.js';
import { startConnectedBackend } from './helpers/start.js';
import { systemKey } from '../src/projects/system-link.js';

const until = async (fn, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 25))) if (await fn()) return true;
  return fn();
};

test('connecting links the unlinked project; another system gets its own project; coming back reopens the first', async () => {
  const mock = await createMockWiredServer();
  const backend = await startConnectedBackend(mock);
  const { projects } = backend.services;
  const call = async (method, path, body) => {
    const res = await fetch(`${backend.url}/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) });
    return (await res.json());
  };
  try {
    const wiredKey = systemKey({ system: 'wired', host: '127.0.0.1', port: mock.port });
    // 1. first connect: the existing (unlinked) project is adopted, named after the room the server reports
    assert.ok(await until(() => projects.describe().current.system?.key === wiredKey), JSON.stringify(projects.describe().current));
    const first = projects.describe().current;
    assert.equal(first.system.label, 'Mock Council Chamber');
    assert.equal(projects.describe().lastOpen.reason, 'system-adopt');
    await call('PUT', '/room/seats/seat-1', { x: 1, y: 2 });

    // 2. another system: a new empty project named after it
    const wap = { key: 'wireless:10.0.0.9:80', label: 'mock-wap.local', type: 'wireless', host: '10.0.0.9', port: 80 };
    assert.equal((await projects.useSystem(wap)).action, 'created');
    let d = projects.describe();
    assert.equal(d.current.name, 'mock-wap.local');
    assert.equal(d.current.system.key, wap.key);
    assert.equal(d.lastOpen.reason, 'system-new');
    assert.deepEqual((await call('GET', '/room')).data.seats, {}, 'empty layout');
    // a project created while connected (and a copy) belongs to that system
    await call('POST', '/projects', { name: 'Second WAP layout' });
    assert.equal(projects.describe().current.system.key, wap.key);
    await call('POST', '/projects', { name: 'Copy', copyCurrent: true });
    assert.equal(projects.describe().current.system.key, wap.key);

    // 3. back to the wired system: its project opens again (not a new one)
    assert.equal((await projects.useSystem({ key: wiredKey, label: 'Mock Council Chamber', type: 'wired', host: '127.0.0.1', port: mock.port })).action, 'opened');
    d = projects.describe();
    assert.equal(d.current.id, first.id);
    assert.deepEqual(Object.keys((await call('GET', '/room')).data.seats), ['seat-1']);
    assert.equal(d.lastOpen.reason, 'system');
    // same system again (reconnect): nothing changes
    assert.equal((await projects.useSystem({ key: wiredKey, label: 'Mock Council Chamber', type: 'wired', host: '127.0.0.1', port: mock.port })).action, 'kept');

    // 4. manual link: a WAP project re-linked to the connected (wired) system; unlink
    const other = d.projects.find(p => p.name === 'Second WAP layout');
    let r = await call('PATCH', `/projects/${other.id}`, { system: 'connected' });
    assert.equal(r.data.projects.find(p => p.id === other.id).system.key, wiredKey);
    r = await call('PATCH', `/projects/${other.id}`, { system: null });
    assert.equal(r.data.projects.find(p => p.id === other.id).system, undefined);
    assert.equal((await call('PATCH', `/projects/${other.id}`, { system: 'elsewhere' })).error.code, 'VALIDATION');
    assert.equal(r.data.connected.label, 'Mock Council Chamber');
  } finally {
    await backend.close();
    await mock.close();
  }
});
