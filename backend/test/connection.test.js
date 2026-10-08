import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startBackend } from './helpers/start.js';
import { createMockWiredServer } from '../../mock/wired/server.js';
import { loadConfig } from '../src/config.js';

let mock;
before(async () => { mock = await createMockWiredServer(); });
after(() => mock.close());

const call = async (backend, method, path, body) => {
  const res = await fetch(`${backend.url}/api/connection${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('settings round-trip via API; password never returned or written to disk', async () => {
  const backend = await startBackend();
  try {
    const put = await call(backend, 'PUT', '/settings', { host: '127.0.0.1', port: mock.port, user: 'admin', password: 'admin' });
    assert.equal(put.status, 200);
    assert.equal(put.body.data.passwordSet, true);
    assert.equal('password' in put.body.data, false);
    const get = await call(backend, 'GET', '/settings');
    assert.equal(get.body.data.host, '127.0.0.1');
    const saved = JSON.parse(readFileSync(join(backend.dataDir, 'settings.json'), 'utf8'));
    assert.equal(saved.user, 'admin');
    assert.equal('password' in saved, false);

    const bad = await call(backend, 'PUT', '/settings', { port: 'x', foo: 1 });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.error.details, ['port: invalid value', 'foo: unknown setting']);
  } finally {
    await backend.close();
  }
});

test('connect / disconnect; status reflects state and permissions; cache cleared on disconnect', async () => {
  const backend = await startBackend();
  try {
    await call(backend, 'PUT', '/settings', { host: '127.0.0.1', port: mock.port, user: 'admin', password: 'admin' });
    assert.equal((await call(backend, 'GET', '')).body.data.state, 'disconnected');
    const connected = await call(backend, 'POST', '/connect');
    assert.equal(connected.status, 200);
    assert.equal(connected.body.data.state, 'loggedIn');
    await backend.services.bridge.idle();
    const status = (await call(backend, 'GET', '')).body.data;
    assert.ok(status.permissions.includes('canManageMeeting'));
    assert.ok(status.connectedSince);
    assert.equal((await fetch(`${backend.url}/api/wired/ops/GetRoomName`)).status, 200);

    const disc = await call(backend, 'POST', '/disconnect');
    assert.equal(disc.body.data.state, 'disconnected');
    // Only capabilities and LikeABosch's own topics (room, devices, director) survive a disconnect (regression: WO-046).
    assert.deepEqual([...backend.services.cache.topics.keys()].sort(), ['devices.cameras', 'devices.companion', 'devices.switcher', 'director', 'domain.capabilities', 'project', 'room']);
    assert.equal((await fetch(`${backend.url}/api/wired/ops/GetRoomName`)).status, 503);
  } finally {
    await backend.close();
  }
});

test('wrong password → 401 UPSTREAM_AUTH and status carries the error', async () => {
  const backend = await startBackend();
  try {
    await call(backend, 'PUT', '/settings', { host: '127.0.0.1', port: mock.port, user: 'admin', password: 'wrong' });
    const r = await call(backend, 'POST', '/connect');
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, 'UPSTREAM_AUTH');
    const status = (await call(backend, 'GET', '')).body.data;
    assert.equal(status.state, 'disconnected');
    assert.equal(status.lastError.code, 'UPSTREAM_AUTH');
  } finally {
    await backend.close();
  }
});

test('missing host → 400; switching system resets the default port', async () => {
  const backend = await startBackend();
  try {
    assert.equal((await call(backend, 'POST', '/connect')).status, 400);
    await call(backend, 'PUT', '/settings', { system: 'wireless', host: 'wap', user: 'u' });
    assert.equal((await call(backend, 'GET', '/settings')).body.data.port, 80, 'port follows system default');
  } finally {
    await backend.close();
  }
});

test('environment-pinned fields are read-only; saved settings are reloaded on restart', async () => {
  const env = { DICENTIS_HOST: '127.0.0.1', DICENTIS_PASSWORD: 'admin' };
  const backend = await startBackend(env);
  try {
    const s = (await call(backend, 'GET', '/settings')).body.data;
    assert.deepEqual(s.pinned.sort(), ['autoConnect', 'host', 'password']);
    const r = await call(backend, 'PUT', '/settings', { host: 'other' });
    assert.equal(r.status, 400);
    assert.match(r.body.error.details[0], /set by the environment/);
    await call(backend, 'PUT', '/settings', { user: 'admin', port: mock.port });

    // Restart with the same data dir: saved user/port come back, pinned host stays from env.
    const { start } = await import('../src/server.js');
    const again = await start(loadConfig({ ...env, PORT: '0', LOG_LEVEL: 'silent', DICENTIS_AUTOCONNECT: 'false', DATA_DIR: backend.dataDir }));
    try {
      const s2 = (await (await fetch(`${again.url}/api/connection/settings`)).json()).data;
      assert.equal(s2.user, 'admin');
      assert.equal(s2.port, mock.port);
      assert.equal(s2.host, '127.0.0.1');
      assert.equal(s2.passwordSet, true);
    } finally {
      await again.close();
    }
  } finally {
    await backend.close();
  }
  assert.equal(existsSync(join(backend.dataDir, 'settings.json')), false, 'temp dir cleaned');
});

test('SSE sends connection status first and on changes', async () => {
  const backend = await startBackend();
  try {
    await call(backend, 'PUT', '/settings', { host: '127.0.0.1', port: mock.port, user: 'admin', password: 'admin' });
    const controller = new AbortController();
    const res = await fetch(`${backend.url}/api/events`, { signal: controller.signal });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let text = '';
    const waitFor = async re => { while (!re.test(text)) text += (await reader.read()).value; };
    await waitFor(/event: connection\ndata: \{[^\n]*"state":"disconnected"/);
    await call(backend, 'POST', '/connect');
    await waitFor(/event: connection\ndata: \{[^\n]*"state":"loggedIn"/);
    controller.abort();
  } finally {
    await backend.close();
  }
});

test('saved port of another system is not kept when the launcher pins a new system (WO-069)', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { ConnectionManager } = await import('../src/connection/manager.js');
  const dataDir = mkdtempSync(join(tmpdir(), 'likeabosch-port-'));
  const deps = { cache: { get: () => undefined }, log: { info() {}, warn() {} } };
  const manager = env => new ConnectionManager({ ...deps, config: loadConfig({ DATA_DIR: dataDir, ...env }) });
  try {
    // Launcher with wired: system pinned, the web UI saves the (unpinned) port.
    const wired = manager({ DICENTIS_SYSTEM: 'wired' });
    await wired.load();
    await wired.updateSettings({ host: '10.0.0.5', port: 31416 });
    assert.equal(JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).portSystem, 'wired');

    // Launcher switched to DCN: the bridge default, not the DICENTIS port.
    const dcn = manager({ DICENTIS_SYSTEM: 'dcn' });
    await dcn.load();
    assert.equal(dcn.settings.port, 9480);
    assert.equal(dcn.settings.host, '10.0.0.5');

    // Back to wired: a custom port saved for wired is kept.
    await wired.updateSettings({ port: 4443 });
    const again = manager({ DICENTIS_SYSTEM: 'wired' });
    await again.load();
    assert.equal(again.settings.port, 4443);

    // A file from before portSystem existed: another system's default port is dropped, a custom one kept.
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ host: 'h', port: 31416 }));
    const legacy = manager({ DICENTIS_SYSTEM: 'dcn-smd' });
    await legacy.load();
    assert.equal(legacy.settings.port, 20000);
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ host: 'h', port: 5555 }));
    const custom = manager({ DICENTIS_SYSTEM: 'dcn' });
    await custom.load();
    assert.equal(custom.settings.port, 5555);

    // A port pinned by the environment always wins.
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ port: 31416, portSystem: 'wired' }));
    const pinned = manager({ DICENTIS_SYSTEM: 'dcn', DICENTIS_PORT: '9999' });
    await pinned.load();
    assert.equal(pinned.settings.port, 9999);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
