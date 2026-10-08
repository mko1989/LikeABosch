// Launcher: which bridge to start, where its exe is, and its process lifecycle (WO-080, DEC-022).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLocalHost, neededBridges, resolveExe, bridgeArgs } from '../lib/bridges.js';
import { BridgeProcess } from '../lib/bridge-process.js';
import { DEFAULT_SETTINGS, backendEnv } from '../lib/settings-store.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-bridge.mjs', import.meta.url));
const local = { name: 'CONTROL-PC', interfaces: { eth0: [{ address: '192.168.0.50' }] } };

test('isLocalHost: empty, loopback, own name and addresses', () => {
  for (const h of ['', 'localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', 'control-pc', 'CONTROL-PC.local', '192.168.0.50']) assert.equal(isLocalHost(h, local), true, h);
  for (const h of ['192.168.0.118', 'dicentis-server', 'other-pc']) assert.equal(isLocalHost(h, local), false, h);
});

test('neededBridges: Windows only, per system and host, manageBridges off, token and DLL folder passed on', () => {
  const s = { ...DEFAULT_SETTINGS };
  assert.deepEqual(neededBridges({ ...s, system: 'wired', dcnmBridge: true }, { platform: 'darwin' }), []);
  assert.deepEqual(neededBridges({ ...s, system: 'wired', dcnmBridge: false }, { platform: 'win32' }), []);
  const [d] = neededBridges({ ...s, system: 'wired', dcnmBridge: true, dcnmDllDir: 'D:\\DICENTIS' }, { platform: 'win32', bridgeToken: 't' });
  assert.deepEqual({ name: d.name, port: d.port, dllDir: d.dllDir, token: d.token }, { name: 'dicentis-bridge', port: 9481, dllDir: 'D:\\DICENTIS', token: 't' });
  assert.deepEqual(neededBridges({ ...s, system: 'wired', dcnmBridge: true, dcnmHost: '192.168.0.9' }, { platform: 'win32', local: () => false }), [], 'remote bridge');
  const [c] = neededBridges({ ...s, system: 'dcn', host: 'localhost', port: 9500 }, { platform: 'win32' });
  assert.equal(c.name, 'dcn-bridge');
  assert.equal(c.port, 9500);
  assert.deepEqual(neededBridges({ ...s, system: 'dcn', host: 'dcn-pc' }, { platform: 'win32', local: () => false }), []);
  assert.deepEqual(neededBridges({ ...s, system: 'wireless' }, { platform: 'win32' }), []);
  assert.deepEqual(neededBridges({ ...s, system: 'dcn', host: 'localhost', manageBridges: false }, { platform: 'win32' }), []);
});

test('resolveExe: configured path, packaged resources, next to the launcher, build output; bridgeArgs', () => {
  const [b] = neededBridges({ ...DEFAULT_SETTINGS, system: 'wired', dcnmBridge: true }, { platform: 'win32' });
  const where = { repoRoot: '/repo', launcherDir: '/repo/launcher', resourcesPath: '/app/resources' };
  const has = (...paths) => p => paths.includes(p);
  assert.equal(resolveExe(b, { ...where, exists: has(join('/app/resources', 'bridges', 'dicentis', 'dicentis-bridge.exe')) }), join('/app/resources', 'bridges', 'dicentis', 'dicentis-bridge.exe'));
  assert.equal(resolveExe(b, { ...where, exists: has(join('/repo', 'bridge', 'dicentis', 'bin', 'Release', 'net48', 'dicentis-bridge.exe')) }), join('/repo', 'bridge', 'dicentis', 'bin', 'Release', 'net48', 'dicentis-bridge.exe'));
  assert.equal(resolveExe(b, { ...where, exists: () => false }), null);
  assert.equal(resolveExe({ ...b, exe: 'C:\\tools\\dicentis-bridge.exe' }, { ...where, exists: has('C:\\tools\\dicentis-bridge.exe') }), 'C:\\tools\\dicentis-bridge.exe');
  assert.deepEqual(bridgeArgs({ ...b, dllDir: 'C:\\Program Files\\Bosch\\DICENTIS', token: 's' }), ['--listen', '127.0.0.1', '--port', '9481', '--dll-dir', 'C:\\Program Files\\Bosch\\DICENTIS', '--token', 's']);
  assert.deepEqual(bridgeArgs(b), ['--listen', '127.0.0.1', '--port', '9481']);
});

test('backendEnv: the dicentis-bridge settings reach the backend only for wired with the bridge on', () => {
  const env = backendEnv({ ...DEFAULT_SETTINGS, system: 'wired', dcnmBridge: true, dcnmPort: 9555, dcnmServer: 'srv' }, 'pw', undefined, 'tok');
  assert.equal(env.DICENTIS_DCNM_BRIDGE, 'true');
  assert.equal(env.DICENTIS_DCNM_HOST, '127.0.0.1');
  assert.equal(env.DICENTIS_DCNM_PORT, '9555');
  assert.equal(env.DICENTIS_DCNM_DEVICE, 'LikeABosch');
  assert.equal(env.DICENTIS_DCNM_SERVER, 'srv');
  assert.equal(env.DICENTIS_BRIDGE_TOKEN, 'tok');
  const off = backendEnv({ ...DEFAULT_SETTINGS, system: 'wired' }, 'pw');
  assert.equal(off.DICENTIS_DCNM_BRIDGE, undefined);
  assert.equal(backendEnv({ ...DEFAULT_SETTINGS, system: 'wireless', dcnmBridge: true }, 'pw').DICENTIS_DCNM_BRIDGE, undefined);
});

const fake = (mode, extraEnv = {}) => {
  Object.assign(process.env, { FAKE_BRIDGE_MODE: mode, ...extraEnv });
  return new BridgeProcess({ name: 'dicentis-bridge', command: process.execPath, args: [FAKE, '--listen', '127.0.0.1', '--port', '9481'], readyTimeoutMs: 5_000, restart: { minDelayMs: 50, maxDelayMs: 100 } });
};

test('BridgeProcess: READY → running with port and log lines; stop', async () => {
  const p = fake('ok');
  const states = [];
  p.on('state', s => states.push(s.state));
  await p.start();
  assert.equal(p.state, 'running');
  assert.equal(p.port, 9481);
  assert.match(p.logLines.join('\n'), /\[dicentis-bridge\] INFO {2}args --listen 127.0.0.1 --port 9481/);
  await p.stop();
  assert.deepEqual(states, ['starting', 'running', 'stopping', 'stopped']);
});

test('BridgeProcess: a bridge that fails at start reports crashed with the reason, no restart', async () => {
  const p = fake('fail');
  await assert.rejects(p.start(), /exited \(code 1\): ERROR DICENTIS API/);
  assert.equal(p.state, 'crashed');
  await new Promise(r => setTimeout(r, 200));
  assert.equal(p.child, null, 'not restarted');
});

test('BridgeProcess: a crash while running restarts it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-bridge-'));
  try {
    const p = fake('crash-once', { FAKE_BRIDGE_MARK: join(dir, 'mark') });
    const states = [];
    p.on('state', s => states.push(s.state));
    await p.start();
    await new Promise(resolve => { const on = s => { if (s.state === 'running' && states.includes('crashed')) { p.off('state', on); resolve(); } }; p.on('state', on); });
    assert.deepEqual(states, ['starting', 'running', 'crashed', 'starting', 'running']);
    await p.stop();
    assert.equal(p.state, 'stopped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.FAKE_BRIDGE_MARK;
  }
});

test('WO-098: backendEnv passes the launcher simulation only when one is chosen', () => {
  assert.equal(backendEnv({ ...DEFAULT_SETTINGS }, '').LIKEABOSCH_SIMULATE, undefined);
  assert.equal(backendEnv({ ...DEFAULT_SETTINGS, simulate: 'wireless', simulateSeats: 12 }, '').LIKEABOSCH_SIMULATE, 'wireless:12');
});
