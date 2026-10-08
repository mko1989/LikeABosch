import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBackend } from './helpers/start.js';
import { defaultDataDir } from '../src/lib/paths.js';
import { loadConfig } from '../src/config.js';
import { ProjectManager } from '../src/projects/manager.js';
import { RoomStore } from '../src/room/store.js';
import { DeviceManager } from '../src/devices/manager.js';
import { StateCache } from '../src/state/cache.js';
import { createLogger } from '../src/lib/logger.js';
import { backendEnv, DEFAULT_SETTINGS } from '../../launcher/lib/settings-store.js';

let backend;
before(async () => { backend = await startBackend(); });
after(() => backend.close());

const call = async (method, path, body, headers) => {
  const res = await fetch(`${backend.url}/api${path}`, {
    method,
    headers: headers ?? (body === undefined ? {} : { 'content-type': 'application/json' }),
    body: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};
const projects = async () => (await call('GET', '/projects')).body.data;

test('one shared data folder: default per platform; launcher passes no DATA_DIR (DEC-016)', () => {
  assert.equal(defaultDataDir({ platform: 'darwin', home: '/Users/x' }), '/Users/x/Library/Application Support/LikeABosch');
  assert.equal(defaultDataDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, home: 'C:\\Users\\x' }).endsWith('LikeABosch'), true);
  assert.equal(defaultDataDir({ platform: 'linux', env: {}, home: '/home/x' }), '/home/x/.config/LikeABosch');
  const cfg = loadConfig({});
  assert.equal(cfg.dataDir, defaultDataDir());
  assert.equal(cfg.dataDirIsDefault, true);
  assert.equal(loadConfig({ DATA_DIR: '/tmp/x' }).dataDirIsDefault, false);
  assert.equal('DATA_DIR' in backendEnv(DEFAULT_SETTINGS, ''), false, 'launcher: same folder as a direct start');
});

test('fresh folder: one untitled project; auto-save updates it; save as / new / open / rename / delete', async () => {
  const p0 = await projects();
  assert.equal(p0.projects.length, 1);
  assert.equal(p0.current.name, 'Untitled project');
  const first = p0.current.id;
  await call('PUT', '/room/seats/seat-1', { x: 10, y: 20 });
  await new Promise(r => setTimeout(r, 50));
  assert.ok((await projects()).current.updatedAt >= p0.current.updatedAt, 'auto-saved');

  const copy = (await call('POST', '/projects', { name: 'Show B', copyCurrent: true })).body.data;
  assert.equal(copy.current.name, 'Show B');
  assert.deepEqual((await call('GET', '/room')).body.data.seats['seat-1'], { x: 10, y: 20, rotation: 0 }, 'save as copies the room');
  await call('PUT', '/room/seats/seat-2', { x: 1, y: 1 });

  const empty = (await call('POST', '/projects', { name: 'Show B' })).body.data;
  assert.equal(empty.current.name, 'Show B (2)', 'names are unique');
  assert.deepEqual((await call('GET', '/room')).body.data.seats, {});

  await call('POST', `/projects/${first}/open`);
  const r = (await call('GET', '/room')).body.data;
  assert.ok(r.seats['seat-1'] && !r.seats['seat-2'], 'the original is unchanged by edits in the copy');

  assert.equal((await call('PATCH', `/projects/${first}`, { name: 'Council chamber' })).body.data.current.name, 'Council chamber');
  assert.equal((await call('PATCH', `/projects/${first}`, { name: '  ' })).status, 400);
  assert.equal((await call('DELETE', `/projects/${first}`)).status, 409, 'cannot delete the open project');
  const del = (await call('DELETE', `/projects/${empty.current.id}`)).body.data;
  assert.equal(del.projects.some(p => p.id === empty.current.id), false);
  assert.equal((await call('POST', '/projects/nope/open')).status, 404);
  assert.equal(backend.services.cache.get('project').data.current.name, 'Council chamber', 'published as topic');
});

test('opening a project swaps the cameras/switcher too', async () => {
  await call('POST', '/devices/cameras', { name: 'Cam in A', driver: 'mock' });
  const a = (await projects()).current.id;
  await call('POST', '/projects', { name: 'No cameras' });
  assert.deepEqual((await call('GET', '/devices/cameras')).body.data, []);
  await call('POST', `/projects/${a}/open`);
  const cams = (await call('GET', '/devices/cameras')).body.data;
  assert.equal(cams[0].name, 'Cam in A');
  assert.equal(cams[0].status.connected, true, 'reconnected');
});

test('download → load round trip: room, shots, floor plan, cameras incl. password', async () => {
  await call('POST', '/projects', { name: 'Trip' });
  const cam = (await call('POST', '/devices/cameras', { name: 'PTZ', driver: 'mock', password: 'secret', switcherInput: 2 })).body.data;
  await call('PUT', '/room/seats/seat-5', { x: 300, y: 400, rotation: 90 });
  await call('PUT', '/room/shots/seat-5', { cameraId: cam.id, preset: 12 });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  await call('PUT', '/room/background', png, { 'content-type': 'image/png' });
  const { id } = (await projects()).current;

  const dl = await call('GET', `/projects/${id}/download`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="trip\.likeabosch\.json"/);
  const doc = dl.body;
  assert.equal(doc.format, 'likeabosch-project');
  assert.equal(doc.devices.cameras[0].password, 'secret', 'passwords included (user decision)');
  assert.equal(Buffer.from(doc.background.data, 'base64').equals(png), true);

  const imp = await call('POST', '/projects/import', JSON.stringify(doc), { 'content-type': 'application/octet-stream' });
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  assert.equal(imp.body.data.current.name, 'Trip (2)');
  const room = (await call('GET', '/room')).body.data;
  assert.deepEqual(room.seats['seat-5'], { x: 300, y: 400, rotation: 90 });
  assert.deepEqual(room.shots['seat-5'], { cameraId: cam.id, preset: 12 }, 'camera ids kept');
  assert.equal((await call('GET', '/room/background')).body.equals(png), true);
  const cams = (await call('GET', '/devices/cameras')).body.data;
  assert.equal(cams[0].id, cam.id);
  assert.equal(cams[0].passwordSet, true);

  assert.equal((await call('POST', '/projects/import', 'not json', { 'content-type': 'application/octet-stream' })).status, 400);
  assert.equal((await call('POST', '/projects/import', JSON.stringify({ format: 'other' }), { 'content-type': 'application/octet-stream' })).status, 400);
  const dirty = { ...doc, name: 'Dirty', room: { ...doc.room, seats: { ok: { x: 1, y: 2 }, bad: { x: 'a' } } }, devices: { cameras: [{ id: 'cam-9', name: 'X', driver: 'nope' }, { id: 'cam-8', name: 'Y', driver: 'mock', bogus: 1 }] } };
  await call('POST', '/projects/import', JSON.stringify(dirty), { 'content-type': 'application/octet-stream' });
  assert.deepEqual(Object.keys((await call('GET', '/room')).body.data.seats), ['ok'], 'invalid entries dropped');
  assert.deepEqual((await call('GET', '/devices/cameras')).body.data.map(c => c.id), ['cam-8']);
});

test('clear parts of the open project (WO-091) and delete saved shots (WO-092)', async () => {
  await call('POST', '/projects', { name: 'Clear me' });
  const cam1 = (await call('POST', '/devices/cameras', { name: 'A', driver: 'mock' })).body.data;
  const cam2 = (await call('POST', '/devices/cameras', { name: 'B', driver: 'mock' })).body.data;
  await call('PUT', '/devices/switcher', { driver: 'mock' });
  const seed = async () => {
    await call('PUT', '/room/seats/s1', { x: 10, y: 20 });
    await call('PUT', '/room/canvas', { width: 900, height: 700 });
    await call('PATCH', '/room/shots', { s1: { cameraId: cam1.id, preset: 1 }, s2: { cameraId: cam2.id, preset: 2 }, s3: { cameraId: cam2.id, preset: 3 } });
    await call('PUT', '/room/overview', { cameraId: cam2.id, preset: 0 });
  };
  await seed();
  // WO-092: one camera's shots (and the overview it uses), then all
  let room = (await call('DELETE', `/room/shots?cameraId=${cam2.id}`)).body.data;
  assert.deepEqual(Object.keys(room.shots), ['s1']);
  assert.equal(room.overview, null);
  room = (await call('DELETE', '/room/shots')).body.data;
  assert.deepEqual(room.shots, {});
  // WO-091: clear chosen parts only
  await seed();
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  await call('PUT', '/room/background', png, { 'content-type': 'image/png' });
  assert.equal((await call('POST', '/projects/current/clear', {})).status, 400, 'nothing chosen');
  assert.equal((await call('POST', '/projects/current/clear', { everything: true })).status, 400);
  assert.equal((await call('POST', '/projects/current/clear', { shots: true })).status, 200);
  room = (await call('GET', '/room')).body.data;
  assert.deepEqual([room.shots, room.overview, Object.keys(room.seats)], [{}, null, ['s1']], 'layout kept');
  await call('POST', '/projects/current/clear', { layout: true, background: true, devices: true });
  room = (await call('GET', '/room')).body.data;
  assert.deepEqual([room.seats, room.canvas.width, room.background], [{}, 1600, null]);
  assert.deepEqual((await call('GET', '/devices/cameras')).body.data, []);
  assert.equal((await call('GET', '/devices/switcher')).body.data, null);
});

test('old layout in the data folder is moved into a project (DATA_DIR=./data case)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'likeabosch-old-'));
  writeFileSync(join(dir, 'room.json'), JSON.stringify({ seats: { 'seat-7': { x: 7, y: 7, rotation: 0 } } }));
  writeFileSync(join(dir, 'devices.json'), JSON.stringify({ cameras: [], switcher: null }));
  const b = await startBackend({ DATA_DIR: dir });
  try {
    const p = (await (await fetch(`${b.url}/api/projects`)).json()).data;
    assert.equal(p.current.name, 'My project');
    assert.deepEqual((await (await fetch(`${b.url}/api/room`)).json()).data.seats['seat-7'], { x: 7, y: 7, rotation: 0 });
    assert.equal(existsSync(join(dir, 'room.json')), false, 'moved into projects/');
  } finally { await b.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('new default folder: legacy repo + launcher data copied in as projects, sources untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'likeabosch-legacy-'));
  const repo = join(root, 'repo-data'); const launcher = join(root, 'launcher-data'); const data = join(root, 'new');
  for (const d of [repo, launcher, data]) mkdirSync(d, { recursive: true });
  writeFileSync(join(repo, 'room.json'), JSON.stringify({ seats: { r: { x: 1, y: 1 } } }));
  writeFileSync(join(repo, 'settings.json'), JSON.stringify({ host: '10.0.0.1' }));
  writeFileSync(join(launcher, 'devices.json'), JSON.stringify({ cameras: [{ id: 'cam-1', name: 'L', driver: 'mock' }], switcher: null }));
  const log = createLogger({ level: 'silent', name: 't' });
  const cache = new StateCache();
  const room = new RoomStore({ dataDir: data, cache, log });
  const devices = new DeviceManager({ dataDir: data, cache, log });
  const pm = new ProjectManager({ dataDir: data, room, devices, cache, log, legacyDirs: [
    { dir: repo, name: 'Imported: server data', copySettings: true },
    { dir: launcher, name: 'Imported: launcher data', copySettings: false },
    { dir: join(root, 'missing'), name: 'Nope', copySettings: false },
  ] });
  try {
    await pm.start();
    assert.deepEqual(pm.describe().projects.map(p => p.name).sort(), ['Imported: launcher data', 'Imported: server data']);
    assert.equal(JSON.parse(readFileSync(join(data, 'settings.json'), 'utf8')).host, '10.0.0.1', 'connection settings copied');
    assert.ok(existsSync(join(repo, 'room.json')) && existsSync(join(launcher, 'devices.json')), 'sources kept');
  } finally { await devices.close(); rmSync(root, { recursive: true, force: true }); }
});
