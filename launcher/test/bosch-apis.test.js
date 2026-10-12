// WO-120 / DEC-037: the launcher finds installed Bosch APIs and starts their bridges on its own (Windows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import { detectBoschApis } from '../lib/bosch-apis.js';
import { neededBridges } from '../lib/bridges.js';
import { DEFAULT_SETTINGS, backendEnv } from '../lib/settings-store.js';

const PF = 'C:\\Program Files';
const PF86 = 'C:\\Program Files (x86)';
const env = { ProgramFiles: PF, 'ProgramFiles(x86)': PF86 };
/** A fake Windows file system: a set of files; folders are derived from them. */
function fakeFs(files) {
  const all = new Set(files.map(f => f.toLowerCase()));
  const dirs = new Set();
  for (const f of files) { let d = win32.dirname(f); while (d && !dirs.has(d)) { dirs.add(d); const up = win32.dirname(d); if (up === d) break; d = up; } }
  return {
    exists: p => all.has(p.toLowerCase()) || [...dirs].some(d => d.toLowerCase() === p.toLowerCase()),
    dirs: p => [...dirs].filter(d => win32.dirname(d).toLowerCase() === p.toLowerCase() && d.toLowerCase() !== p.toLowerCase()),
  };
}
const detect = (files, extra = {}) => detectBoschApis({ platform: 'win32', env, fs: fakeFs(files), join: win32.join, ...extra });

test('detect: standard folders of DICENTIS and DCN-SW', () => {
  const found = detect([`${PF}\\Bosch\\DICENTIS\\Bosch.Dcnm.Interfaces.Api.dll`, `${PF86}\\Bosch\\Digital Congress Network\\DCN-SW\\Bosch.Dcn.Ecpc.Client.Api.Logic.dll`]);
  assert.deepEqual(found, { dicentis: { dllDir: `${PF}\\Bosch\\DICENTIS` }, dcn: { dllDir: `${PF86}\\Bosch\\Digital Congress Network\\DCN-SW` } });
});

test('detect: other versions found by the search below Program Files\\Bosch; nothing installed; not Windows', () => {
  assert.deepEqual(detect([`${PF}\\Bosch\\DICENTIS 7.0\\Server\\Bosch.Dcnm.Interfaces.Api.dll`]).dicentis, { dllDir: `${PF}\\Bosch\\DICENTIS 7.0\\Server` });
  assert.equal(detect([`${PF}\\Bosch\\a\\b\\c\\d\\e\\Bosch.Dcnm.Interfaces.Api.dll`]).dicentis, null, 'deeper than 4 levels');
  assert.deepEqual(detect([`${PF}\\Other\\x.dll`]), { dicentis: null, dcn: null });
  assert.deepEqual(detectBoschApis({ platform: 'darwin' }), { dicentis: null, dcn: null });
});

test('detect: a configured folder wins; a wrong configured folder means not found', () => {
  const files = [`D:\\DCNM\\Bosch.Dcnm.Interfaces.Api.dll`, `${PF}\\Bosch\\DICENTIS\\Bosch.Dcnm.Interfaces.Api.dll`];
  assert.deepEqual(detect(files, { configured: { dicentis: 'D:\\DCNM' } }).dicentis, { dllDir: 'D:\\DCNM' });
  assert.equal(detect(files, { configured: { dicentis: 'D:\\Nope' } }).dicentis, null);
});

const s = { ...DEFAULT_SETTINGS };
const found = { dicentis: { dllDir: 'C:\\D' }, dcn: { dllDir: 'C:\\N' } };
const names = list => list.map(b => `${b.name}${b.auto ? ' auto' : ''}:${b.port}:${b.dllDir}`);

test('neededBridges: installed software starts its bridge (auto), with the found DLL folder', () => {
  assert.deepEqual(names(neededBridges({ ...s, system: 'wireless' }, { platform: 'win32', found })), ['dcn-bridge auto:9480:C:\\N', 'dicentis-bridge auto:9481:C:\\D']);
  assert.deepEqual(neededBridges({ ...s, system: 'wired' }, { platform: 'darwin', found }), [], 'Windows only');
  assert.deepEqual(neededBridges({ ...s, autoBridges: false }, { platform: 'win32', found }), [], 'autoBridges off');
  assert.deepEqual(neededBridges({ ...s, manageBridges: false }, { platform: 'win32', found }), [], 'manageBridges off');
});

test('neededBridges: configured bridges are not "auto", keep their port; a remote bridge host is respected', () => {
  assert.deepEqual(names(neededBridges({ ...s, system: 'dcn', host: 'localhost', port: 9500 }, { platform: 'win32', found })), ['dcn-bridge:9500:C:\\N', 'dicentis-bridge auto:9481:C:\\D']);
  assert.deepEqual(names(neededBridges({ ...s, system: 'dcn', host: 'dcn-pc' }, { platform: 'win32', found, local: h => h === '' })), ['dicentis-bridge auto:9481:C:\\D'], 'dcn bridge elsewhere');
  assert.deepEqual(names(neededBridges({ ...s, system: 'wired', dcnmBridge: true, dcnmHost: 'bridge-pc' }, { platform: 'win32', found: { dicentis: found.dicentis }, local: h => h === '' })), [], 'dicentis bridge elsewhere');
  assert.deepEqual(names(neededBridges({ ...s, system: 'wired', dcnmBridge: true, dcnmDllDir: 'E:\\X' }, { platform: 'win32', found: { dicentis: found.dicentis } })), ['dicentis-bridge:9481:E:\\X']);
});

test('backendEnv: an auto-started dicentis-bridge is used by a wired connection', () => {
  const e = backendEnv({ ...s, system: 'wired' }, 'pw', undefined, '', { dcnmAuto: true });
  assert.equal(e.DICENTIS_DCNM_BRIDGE, 'true');
  assert.equal(e.DICENTIS_DCNM_HOST, '127.0.0.1');
  assert.equal(backendEnv({ ...s, system: 'wired' }, 'pw').DICENTIS_DCNM_BRIDGE, undefined);
  assert.equal(backendEnv({ ...s, system: 'wireless' }, 'pw', undefined, '', { dcnmAuto: true }).DICENTIS_DCNM_BRIDGE, undefined);
  assert.equal(backendEnv({ ...s, system: 'wired', dcnmBridge: true, dcnmHost: '10.0.0.5' }, 'pw', undefined, '', { dcnmAuto: true }).DICENTIS_DCNM_HOST, '10.0.0.5');
});
