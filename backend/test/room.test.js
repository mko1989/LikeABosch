import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBackend } from './helpers/start.js';
import { start } from '../src/server.js';
import { loadConfig } from '../src/config.js';

let backend;
before(async () => { backend = await startBackend(); });
after(() => backend.close());

const call = async (method, path, body, headers) => {
  const res = await fetch(`${backend.url}/api/room${path}`, {
    method,
    headers: headers ?? (body === undefined ? {} : { 'content-type': 'application/json' }),
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};

test('defaults; place seats and cameras; shots; overview; director; validation', async () => {
  const r0 = (await call('GET', '')).body.data;
  assert.deepEqual(r0.canvas, { x: 0, y: 0, width: 1600, height: 1000 });
  assert.equal(r0.director.strategy, 'safe');
  await call('PUT', '/seats/seat-1', { x: 100, y: 200 });
  await call('PUT', '/cameras/cam-1', { x: 800, y: 50, rotation: 180 });
  await call('PUT', '/shots/seat-1', { cameraId: 'cam-1', preset: 3 });
  await call('PUT', '/overview', { cameraId: 'cam-1', preset: 0 });
  const d = (await call('PUT', '/director', { enabled: true, strategy: 'live', minShotMs: 2000 })).body.data;
  assert.deepEqual(d.seats['seat-1'], { x: 100, y: 200, rotation: 0 });
  assert.deepEqual(d.shots['seat-1'], { cameraId: 'cam-1', preset: 3 });
  assert.equal(d.director.strategy, 'live');
  assert.equal(d.director.delayMs, 500, 'unchanged default kept');
  assert.equal((await call('PUT', '/seats/seat-2', { x: 'a' })).status, 400);
  assert.equal((await call('PUT', '/shots/seat-2', { cameraId: 'cam-1' })).status, 400);
  assert.equal((await call('PUT', '/director', { strategy: 'chaos' })).status, 400);
  assert.deepEqual(backend.services.cache.get('room').data.overview, { cameraId: 'cam-1', preset: 0 }, 'published as topic');
});

test('removing a camera drops its shots and the overview', async () => {
  const r = (await call('DELETE', '/cameras/cam-1')).body.data;
  assert.deepEqual(r.shots, {});
  assert.equal(r.overview, null);
});

test('floor plan upload: PNG accepted, SVG rejected, served back, cleared', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const up = await call('PUT', '/background', png, { 'content-type': 'image/png' });
  assert.equal(up.status, 200);
  assert.equal(up.body.data.background.type, 'image/png');
  const get = await call('GET', '/background');
  assert.deepEqual(get.body, png);
  assert.equal((await call('PUT', '/background', Buffer.from('<svg/>'), { 'content-type': 'image/svg+xml' })).status, 400);
  await call('DELETE', '/background');
  assert.equal((await call('GET', '/background')).status, 404);
});

test('layout survives a restart', async () => {
  await call('PUT', '/seats/seat-9', { x: 5, y: 6, rotation: 90 });
  const again = await start(loadConfig({ PORT: '0', LOG_LEVEL: 'silent', DICENTIS_AUTOCONNECT: 'false', DATA_DIR: backend.dataDir }));
  try {
    const r = await (await fetch(`${again.url}/api/room`)).json();
    assert.deepEqual(r.data.seats['seat-9'], { x: 5, y: 6, rotation: 90 });
  } finally {
    await again.close();
  }
});

test('concurrent updates are serialised (no lost writes, no temp-file race)', async () => {
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => call('PUT', `/seats/c-${i}`, { x: i, y: i })));
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results.find(r => r.status !== 200)?.body));
  const seats = (await call('GET', '')).body.data.seats;
  assert.equal(Object.keys(seats).filter(k => k.startsWith('c-')).length, 25);
});

test('canvas: resizable room outline with an origin; items may lie outside it', async () => {
  const c = (await call('PUT', '/canvas', { x: -200, y: 50, width: 2400, height: 900 })).body.data.canvas;
  assert.deepEqual(c, { x: -200, y: 50, width: 2400, height: 900 });
  const kept = (await call('PUT', '/canvas', { width: 3000, height: 1200 })).body.data.canvas;
  assert.deepEqual(kept, { x: -200, y: 50, width: 3000, height: 1200 }, 'origin kept when omitted');
  assert.equal((await call('PUT', '/canvas', { width: 50, height: 900 })).status, 400);
  assert.equal((await call('PUT', '/canvas', { x: 'left', width: 1000, height: 900 })).status, 400);
  assert.equal((await call('PUT', '/seats/seat-9', { x: 5000, y: -300 })).status, 200, 'outside the room is allowed');
});

test('interpreter desks have their own placements (WO-048)', async () => {
  const r = (await call('PUT', '/desks/seat-booth1-desk1', { x: -300, y: 120, rotation: 90 })).body.data;
  assert.deepEqual(r.desks['seat-booth1-desk1'], { x: -300, y: 120, rotation: 90 });
  assert.equal((await call('PUT', '/desks/x', { x: 'left' })).status, 400);
  assert.deepEqual((await call('DELETE', '/desks/seat-booth1-desk1')).body.data.desks, {});
});

test('operate options: camera cog sends to preview (WO-053)', async () => {
  assert.deepEqual((await call('GET', '')).body.data.operate, { cogSendsPreview: false });
  assert.equal((await call('PUT', '/operate', { cogSendsPreview: true })).body.data.operate.cogSendsPreview, true);
  assert.equal((await call('PUT', '/operate', { cogSendsPreview: 'yes' })).status, 400);
  assert.equal((await call('PUT', '/operate', { other: true })).status, 400);
});

test('bulk placements: many in one save, null unplaces, a bad entry changes nothing (WO-055)', async () => {
  await call('PUT', '/seats/g-1', { x: 1, y: 1 });
  await call('PUT', '/cameras/cam-g', { x: 0, y: 0 });
  await call('PUT', '/shots/g-2', { cameraId: 'cam-g', preset: 1 });
  const r = (await call('PATCH', '/placements', {
    seats: { 'g-1': { x: 100, y: 200, rotation: 90 }, 'g-2': { x: 300, y: 200 } },
    desks: { 'd-1': { x: -5, y: -5 } },
  })).body.data;
  assert.deepEqual(r.seats['g-1'], { x: 100, y: 200, rotation: 90 });
  assert.deepEqual(r.seats['g-2'], { x: 300, y: 200, rotation: 0 });
  assert.deepEqual(r.desks['d-1'], { x: -5, y: -5, rotation: 0 });

  const before = (await call('GET', '')).body.data;
  const bad = await call('PATCH', '/placements', { seats: { 'g-1': { x: 0, y: 0 }, 'g-2': { x: 'left', y: 0 } } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.details.some(d => d.includes('g-2')));
  assert.equal((await call('PATCH', '/placements', { tables: {} })).status, 400);
  assert.equal((await call('PATCH', '/placements', [1])).status, 400);
  assert.deepEqual((await call('GET', '')).body.data.seats, before.seats, 'nothing changed by the rejected patch');

  const removed = (await call('PATCH', '/placements', { seats: { 'g-1': null }, cameras: { 'cam-g': null } })).body.data;
  assert.equal(removed.seats['g-1'], undefined);
  assert.equal(removed.cameras['cam-g'], undefined);
  assert.equal(removed.shots['g-2'], undefined, 'shots of an unplaced camera are dropped');
});

test('bulk shots: many in one save, null clears, a bad entry changes nothing (WO-056)', async () => {
  const r = (await call('PATCH', '/shots', { 's-12': { cameraId: 'cam-2', preset: 10 }, 's-13': { cameraId: 'cam-2', preset: 11 } })).body.data;
  assert.deepEqual(r.shots['s-12'], { cameraId: 'cam-2', preset: 10 });
  assert.deepEqual(r.shots['s-13'], { cameraId: 'cam-2', preset: 11 });
  const bad = await call('PATCH', '/shots', { 's-12': null, 's-14': { cameraId: 'cam-2' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.details.some(d => d.startsWith('s-14')));
  assert.deepEqual((await call('GET', '')).body.data.shots['s-12'], { cameraId: 'cam-2', preset: 10 }, 'unchanged');
  assert.equal((await call('PATCH', '/shots', [])).status, 400);
  const cleared = (await call('PATCH', '/shots', { 's-12': null })).body.data;
  assert.equal(cleared.shots['s-12'], undefined);
  assert.ok(cleared.shots['s-13']);
});
