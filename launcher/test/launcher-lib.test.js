import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSettingsStore, backendEnv, DEFAULT_SETTINGS } from '../lib/settings-store.js';
import { ServerProcess } from '../lib/server-process.js';

const fakeEncryptor = (available = true) => ({
  isAvailable: () => available,
  encrypt: text => Buffer.from(`enc:${Buffer.from(text).toString('base64')}`),
  decrypt: buf => Buffer.from(buf.toString().slice(4), 'base64').toString(),
});

test('settings store: defaults, save/load, password encrypted at rest, never in plaintext', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-'));
  try {
    const store = createSettingsStore({ dir, encryptor: fakeEncryptor() });
    assert.deepEqual((await store.describe()).settings, DEFAULT_SETTINGS);
    assert.deepEqual(await store.save({ host: 'dicentis.local', user: 'operator', webPort: 3100 }, 's3cret!'), { errors: [] });
    const d = await store.describe();
    assert.equal(d.settings.host, 'dicentis.local');
    assert.equal(d.passwordSet, true);
    assert.equal(await store.loadPassword(), 's3cret!');
    for (const f of readdirSync(dir)) assert.equal(readFileSync(join(dir, f), 'utf8').includes('s3cret!'), false, `${f} has plaintext password`);
    await store.save({}, '');
    assert.equal((await store.describe()).passwordSet, false);
    assert.deepEqual((await store.save({ webPort: 0, bogus: 1 })).errors, ['webPort: invalid value', 'bogus: invalid value']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('settings store: no secure storage → password not persisted, clear error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-'));
  try {
    const store = createSettingsStore({ dir, encryptor: fakeEncryptor(false) });
    const r = await store.save({ host: 'x' }, 'pw');
    assert.match(r.errors[0], /secure storage is not available/);
    assert.equal((await store.describe()).passwordSet, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backendEnv passes only non-empty connection fields (they become pinned in the web UI)', () => {
  const env = backendEnv({ ...DEFAULT_SETTINGS, host: 'h', user: '' }, '', '/data');
  assert.equal(env.DICENTIS_HOST, 'h');
  assert.equal('DICENTIS_USER' in env, false);
  assert.equal('DICENTIS_PASSWORD' in env, false);
  assert.equal('DICENTIS_PORT' in env, false);
  assert.equal(env.BIND_HOST, '127.0.0.1');
  assert.equal(backendEnv({ ...DEFAULT_SETTINGS, lanAccess: true }, 'pw', '/d').BIND_HOST, '0.0.0.0');
});

test('DCN (WO-063): bridge token encrypted at rest, dcnServer validated, both passed to the backend', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-'));
  try {
    const store = createSettingsStore({ dir, encryptor: fakeEncryptor() });
    assert.deepEqual(await store.save({ system: 'dcn', host: 'dcn-pc', dcnServer: 'tcp://localhost:9461' }, 'pw', 'bridge-s3cret'), { errors: [] });
    const d = await store.describe();
    assert.equal(d.settings.system, 'dcn');
    assert.equal(d.bridgeTokenSet, true);
    assert.equal(await store.loadBridgeToken(), 'bridge-s3cret');
    for (const f of readdirSync(dir)) assert.equal(readFileSync(join(dir, f), 'utf8').includes('bridge-s3cret'), false, `${f} has plaintext token`);
    assert.deepEqual((await store.save({ dcnServer: 'http://x' })).errors, ['dcnServer: invalid value']);
    assert.deepEqual((await store.save({ system: 'dcn-smd' })).errors, []); // meeting data stream (DEC-018)
    assert.equal(backendEnv({ ...DEFAULT_SETTINGS, system: 'dcn-smd', host: 'dcn-pc' }, '', '/d').DICENTIS_SYSTEM, 'dcn-smd');
    await store.save({ system: 'dcn' });
    const env = backendEnv(d.settings, 'pw', '/d', 'bridge-s3cret');
    assert.equal(env.DICENTIS_SYSTEM, 'dcn');
    assert.equal(env.DICENTIS_DCN_SERVER, 'tcp://localhost:9461');
    assert.equal(env.DICENTIS_BRIDGE_TOKEN, 'bridge-s3cret');
    assert.equal(env.DICENTIS_SMD_STREAM, 'true'); // meeting data stream next to the bridge (DEC-020), default on
    assert.equal('DICENTIS_SMD_HOST' in env || 'DICENTIS_SMD_PORT' in env, false); // empty = backend defaults
    const smd = backendEnv({ ...d.settings, smdStream: false, smdHost: 'smd-pc', smdPort: 20001 }, 'pw', '/d');
    assert.deepEqual([smd.DICENTIS_SMD_STREAM, smd.DICENTIS_SMD_HOST, smd.DICENTIS_SMD_PORT], ['false', 'smd-pc', '20001']);
    assert.equal('DICENTIS_SMD_STREAM' in backendEnv({ ...d.settings, system: 'wired' }, 'pw', '/d'), false);
    assert.deepEqual((await store.save({ smdPort: 0 })).errors, ['smdPort: invalid value']);
    assert.equal('DICENTIS_BRIDGE_TOKEN' in backendEnv({ ...d.settings, system: 'wired' }, 'pw', '/d', 'bridge-s3cret'), false);
    await store.save({}, undefined, '');
    assert.equal((await store.describe()).bridgeTokenSet, false);
    assert.equal(await store.loadPassword(), 'pw'); // clearing the token keeps the password
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const entry = join(repoRoot, 'backend/src/server.js');

test('server process: start → running (health ok) → stop → stopped, no orphan', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'launcher-data-'));
  const server = new ServerProcess({ execPath: process.execPath, entry, cwd: repoRoot });
  const states = [];
  server.on('state', s => states.push(s.state));
  try {
    await server.start({ ...backendEnv(DEFAULT_SETTINGS, '', dataDir), PORT: '39871', DICENTIS_AUTOCONNECT: 'false' });
    assert.equal(server.state, 'running');
    assert.equal((await server.api('/api/health')).status, 'up');
    assert.ok(server.logLines.some(l => l.includes('Listening on')));
    const pid = server.child.pid;
    await server.stop();
    assert.deepEqual(states, ['starting', 'running', 'stopping', 'stopped']);
    assert.throws(() => process.kill(pid, 0), 'process is gone');
  } finally {
    await server.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('server process: port in use → crashed with a clear message', async () => {
  const { createServer } = await import('node:http');
  const blocker = createServer().listen(39872, '127.0.0.1');
  await new Promise(r => blocker.once('listening', r));
  const dataDir = mkdtempSync(join(tmpdir(), 'launcher-data-'));
  const server = new ServerProcess({ execPath: process.execPath, entry, cwd: repoRoot });
  try {
    await assert.rejects(server.start({ ...backendEnv(DEFAULT_SETTINGS, '', dataDir), PORT: '39872' }), /already in use/);
    assert.equal(server.state, 'crashed');
  } finally {
    blocker.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('server process + wired mock: backend started with launcher env logs in to DICENTIS', async () => {
  const { createMockWiredServer } = await import('../../mock/wired/server.js');
  const mock = await createMockWiredServer();
  const dataDir = mkdtempSync(join(tmpdir(), 'launcher-data-'));
  const server = new ServerProcess({ execPath: process.execPath, entry, cwd: repoRoot });
  try {
    const settings = { ...DEFAULT_SETTINGS, host: '127.0.0.1', port: mock.port, user: 'admin', webPort: 39873 };
    await server.start(backendEnv(settings, 'admin', dataDir));
    let status;
    for (let i = 0; i < 40 && status?.state !== 'loggedIn'; i++) {
      status = await server.api('/api/connection');
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(status.state, 'loggedIn');
    assert.equal(status.user, 'admin');
    const settingsView = await server.api('/api/connection/settings');
    assert.deepEqual(settingsView.pinned.sort(), ['autoConnect', 'host', 'password', 'port', 'system', 'tlsInsecure', 'user']);
  } finally {
    await server.stop();
    await mock.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
