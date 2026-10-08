// WO-095 / DEC-026: simulated systems inside the backend, each with its own project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startBackend } from './helpers/start.js';

const until = async (fn, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (await fn()) return true;
  return fn();
};

test('simulate a wired and a wireless system: connect, seats, capabilities, projects per simulated system', async () => {
  const backend = await startBackend();
  const call = async (method, path, body) => {
    const res = await fetch(`${backend.url}/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const { cache, projects } = backend.services;
  try {
    const simulators = [
      { id: 'sim-hall', name: 'Town hall', type: 'wired', seats: 40 },
      { id: 'sim-wap', name: 'Board room', type: 'wireless', seats: 8 },
    ];
    assert.equal((await call('PUT', '/connection/settings', { simulators: [{ id: 'X', name: '', type: 'nope', seats: 0 }] })).status, 400);
    assert.equal((await call('PUT', '/connection/settings', { simulators, simulate: 'sim-hall' })).status, 200);
    const st = (await call('POST', '/connection/connect', {})).body.data;
    assert.equal(st.system, 'wired');
    assert.deepEqual(st.simulated, { id: 'sim-hall', name: 'Town hall', seats: 40 });
    assert.ok(await until(() => cache.get('domain.seats')?.data?.length === 40), 'wired simulation with 40 seats');
    assert.equal(cache.get('domain.capabilities').data.system, 'wired');
    // WO-101: a wired simulation includes the full DICENTIS API (linked mock dicentis-bridge)
    assert.ok(await until(async () => (await call('GET', '/connection')).body.data.dcnm?.state === 'loggedIn'), 'simulated dicentis-bridge logged in');
    assert.ok(projects.describe().current.system?.key === 'sim:sim-hall' || await until(() => projects.describe().current.system?.key === 'sim:sim-hall'));
    assert.equal(projects.describe().current.system.label, 'Town hall (simulated)');
    await call('PUT', '/room/seats/seat-40', { x: 5, y: 5 });

    // another simulated system: wireless, its own (new) project
    await call('PUT', '/connection/settings', { simulate: 'sim-wap' });
    const st2 = (await call('POST', '/connection/connect', {})).body.data;
    assert.equal(st2.system, 'wireless');
    assert.ok(await until(() => cache.get('domain.seats')?.data?.length === 8), 'wireless simulation with 8 seats');
    assert.equal(cache.get('domain.capabilities').data.features.wapConfig, true);
    assert.ok(await until(() => projects.describe().current.name === 'Board room (simulated)'));
    assert.deepEqual((await call('GET', '/room')).body.data.seats, {});
    // a domain action works against the simulated WAP
    assert.equal((await call('POST', '/domain/participants', { name: 'Sim Person', seatId: '8' })).status, 200);

    // back to the town hall: its project again
    await call('PUT', '/connection/settings', { simulate: 'sim-hall' });
    await call('POST', '/connection/connect', {});
    assert.ok(await until(() => projects.describe().current.system?.key === 'sim:sim-hall'));
    assert.deepEqual(Object.keys((await call('GET', '/room')).body.data.seats), ['seat-40']);

    // WO-096: the project remembered the simulated system's names of its placed seats; remap moves placement + shot
    assert.ok(await until(async () => (await call('GET', '/room')).body.data.seatNames?.['seat-40'] === 'Seat 40'));
    await call('PUT', '/room/shots/seat-40', { cameraId: 'cam-1', preset: 4 });
    assert.equal((await call('POST', '/room/remap', { map: { 'seat-40': 'seat-2', 'seat-9': 'seat-2' } })).status, 400, 'two seats → one');
    const remapped = (await call('POST', '/room/remap', { map: { 'seat-40': 'seat-2' } })).body.data;
    assert.deepEqual([Object.keys(remapped.seats), remapped.shots['seat-2'], remapped.seatNames['seat-2']], [['seat-2'], { cameraId: 'cam-1', preset: 4 }, 'Seat 40']);
    const dl = (await call('GET', `/projects/${projects.describe().current.id}/download`)).body;
    assert.equal(dl.room.seatNames['seat-2'], 'Seat 40', 'names travel in the project file');

    // leaving simulation: disconnect stops the simulator; the configured (real) system is used again on connect
    await call('POST', '/connection/disconnect', {});
    await call('PUT', '/connection/settings', { simulate: '' });
    assert.equal((await call('GET', '/connection')).body.data.simulated, null);
  } finally {
    await backend.close();
  }
});

test('WO-098: the launcher simulation (LIKEABOSCH_SIMULATE) creates its profile, connects, and is switched off again without it', async () => {
  const { start } = await import('../src/server.js');
  const { loadConfig } = await import('../src/config.js');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dataDir = mkdtempSync(join(tmpdir(), 'likeabosch-test-'));
  const boot = env => start(loadConfig({ PORT: '0', LOG_LEVEL: 'silent', DICENTIS_AUTOCONNECT: 'false', DATA_DIR: dataDir, ...env }));
  try {
    assert.equal(loadConfig({ LIKEABOSCH_SIMULATE: 'nope:3' }).launcherSimulation, null);
    assert.equal(loadConfig({ LIKEABOSCH_SIMULATE: 'wired:0' }).launcherSimulation, null);
    assert.deepEqual(loadConfig({ LIKEABOSCH_SIMULATE: 'wireless:12' }).launcherSimulation, { type: 'wireless', seats: 12 });

    // with the option: connects although auto-connect is off and nothing else is configured
    let b = await boot({ LIKEABOSCH_SIMULATE: 'wired:12' });
    try {
      const { manager, cache, projects } = b.services;
      assert.ok(await until(() => manager.client?.state === 'loggedIn'), 'connected to the simulation');
      assert.deepEqual(manager.status().simulated, { id: 'launcher-wired', name: 'DICENTIS demo', seats: 12 });
      assert.ok(await until(() => cache.get('domain.seats')?.data?.length === 12));
      assert.ok(await until(() => projects.describe().current.system?.key === 'sim:launcher-wired'));
      assert.equal(manager.publicSettings().pinned.includes('simulate'), false, 'not pinned: the web UI can leave it');
    } finally { await b.close(); }

    // a renamed profile keeps its name; the seat count follows the launcher
    const settingsFile = join(dataDir, 'settings.json');
    const { readFileSync, writeFileSync } = await import('node:fs');
    const saved = JSON.parse(readFileSync(settingsFile, 'utf8'));
    saved.simulators = saved.simulators.map(p => ({ ...p, name: 'Hall A' }));
    writeFileSync(settingsFile, JSON.stringify(saved));
    b = await boot({ LIKEABOSCH_SIMULATE: 'wired:20' });
    try {
      assert.ok(await until(() => b.services.manager.client?.state === 'loggedIn'));
      assert.deepEqual(b.services.manager.status().simulated, { id: 'launcher-wired', name: 'Hall A', seats: 20 });
      assert.equal(b.services.manager.settings.simulators.length, 1);
    } finally { await b.close(); }

    // without the option: the launcher simulation is off, the profile stays
    b = await boot({});
    try {
      assert.equal(b.services.manager.settings.simulate, '');
      assert.equal(b.services.manager.client, null);
      assert.equal(b.services.manager.settings.simulators[0].id, 'launcher-wired');
    } finally { await b.close(); }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('WO-101: a wired simulation without the full API has no dicentis-bridge', async () => {
  const backend = await startBackend();
  const call = async (method, path, body) => {
    const res = await fetch(`${backend.url}/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    assert.equal((await call('PUT', '/connection/settings', { simulators: [{ id: 'sim-x', name: 'X', type: 'wired', seats: 4, fullApi: 'yes' }] })).status, 400);
    await call('PUT', '/connection/settings', { simulators: [{ id: 'sim-plain', name: 'Plain', type: 'wired', seats: 4, fullApi: false }], simulate: 'sim-plain' });
    const st = (await call('POST', '/connection/connect', {})).body.data;
    assert.equal(st.system, 'wired');
    assert.ok(await until(() => backend.services.cache.get('domain.seats')?.data?.length === 4));
    assert.equal((await call('GET', '/connection')).body.data.dcnm ?? null, null);
  } finally {
    await backend.close();
  }
});
