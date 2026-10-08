import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBackend } from './helpers/start.js';
import { loadConfig, redactConfig } from '../src/config.js';

let backend;
before(async () => { backend = await startBackend(); });
after(() => backend.close());

test('GET /api/health returns the ok envelope', async () => {
  const res = await fetch(`${backend.url}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, data: { status: 'up', system: 'wired' } });
});

test('unknown /api route returns NOT_FOUND envelope', async () => {
  const res = await fetch(`${backend.url}/api/nope`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'NOT_FOUND');
});

test('invalid JSON body returns VALIDATION envelope', async () => {
  const res = await fetch(`${backend.url}/api/health`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'VALIDATION');
});

test('static web UI is served at /', async () => {
  const res = await fetch(`${backend.url}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /LikeABosch/);
});

test('config defaults and password redaction', () => {
  const c = loadConfig({ DICENTIS_PASSWORD: 'secret' });
  assert.equal(c.dicentis.port, 31416);
  assert.equal(c.dicentis.tlsInsecure, true);
  assert.equal(c.bindHost, '127.0.0.1');
  assert.equal(loadConfig({ DICENTIS_SYSTEM: 'wireless' }).dicentis.port, 80);
  assert.equal(redactConfig(c).dicentis.password, '***');
  assert.throws(() => loadConfig({ PORT: 'abc' }));
});

test('thrown errors become INTERNAL (500) and AppErrors keep their code', async () => {
  const express = (await import('express')).default;
  const { AppError, errorHandler } = await import('../src/lib/errors.js');
  const { createLogger } = await import('../src/lib/logger.js');
  const app = express();
  app.get('/boom', () => { throw new Error('secret detail'); });
  app.get('/app', async () => { throw new AppError('UPSTREAM_TIMEOUT', 'too slow'); });
  app.use(errorHandler(createLogger({ level: 'silent' })));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r1 = await fetch(`${base}/boom`);
    assert.equal(r1.status, 500);
    assert.deepEqual(await r1.json(), { ok: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
    const r2 = await fetch(`${base}/app`);
    assert.equal(r2.status, 504);
    assert.equal((await r2.json()).error.code, 'UPSTREAM_TIMEOUT');
  } finally {
    server.close();
  }
});
