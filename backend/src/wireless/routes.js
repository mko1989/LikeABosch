// Wireless passthrough (WO-015, DEC-004): mirrors the swagger paths under /api/wireless with the same methods.
//   GET /api/wireless/ops     list of operations (discovery)
//   <METHOD> /api/wireless/<swagger path>   e.g. POST /api/wireless/speakers  [3, 4]
//   Also the curated undocumented WAP web UI paths (undocumented.json, DEC-024), e.g. PUT /api/wireless/discuss.
//   POST /api/wireless/upgrades/file?name=<file name>   raw file body → multipart "firmware" to the WAP (DEC-024)
import express from 'express';
import { AppError, ok } from '../lib/errors.js';
import { validateSchema } from './spec.js';

const MANAGED = new Set(['POST /login', 'POST /logout']);

/**
 * @param {object} deps
 * @param {ReturnType<import('./spec.js').loadWirelessSpec>} deps.spec
 * @param {() => import('./client.js').WirelessClient | null} deps.getClient
 * @param {(op: import('./spec.js').WirelessOperation) => void} [deps.onSuccess]
 */
export function createWirelessRouter({ spec, getClient, onSuccess }) {
  const router = express.Router();

  router.get('/ops', (_req, res) => res.json(ok(spec.operations.map(op => ({
    id: op.id, method: op.method, path: op.path, summary: op.summary, description: op.description,
    managed: MANAGED.has(op.id), body: op.bodySchema, query: op.queryParams.map(q => q.name), undocumented: Boolean(op.undocumented),
  })))));

  // Firmware or seat display image (PNG) upload, the way the WAP's web UI does it (FileUploader, field "firmware").
  router.post('/upgrades/file', express.raw({ type: () => true, limit: '64mb' }), async (req, res) => {
    const name = String(req.query.name ?? '').trim();
    if (!name || /[\\/]/.test(name)) throw new AppError('VALIDATION', 'name (the file name, e.g. logo.png) is required');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new AppError('VALIDATION', 'Send the file as the request body');
    const client = getClient();
    if (!client || client.state !== 'loggedIn') throw new AppError('NOT_CONNECTED', 'Not connected to a DICENTIS Wireless system');
    const form = new FormData();
    form.append('firmware', new Blob([req.body]), name);
    await client.request('POST', '/upgrades/file', { body: form, timeoutMs: 300_000 });
    onSuccess?.({ id: 'POST /upgrades/file', method: 'POST', path: '/upgrades/file' });
    res.json(ok({ name, size: req.body.length }));
  });

  router.use(async (req, res) => {
    const found = spec.match(req.method, req.path);
    if (!found) throw new AppError('NOT_FOUND', `No wireless operation ${req.method} ${req.path}`);
    const { op } = found;
    if (MANAGED.has(op.id)) throw new AppError('MANAGED_BY_BACKEND', `${op.id} is managed by the backend; use /api/connection`);
    for (const [name, value] of Object.entries(found.params)) {
      if (!/^-?\d+$/.test(value)) throw new AppError('VALIDATION', `Path parameter ${name} must be an integer`);
    }
    const unknownQuery = Object.keys(req.query).filter(q => !op.queryParams.some(p => p.name === q));
    if (unknownQuery.length) throw new AppError('VALIDATION', `Unknown query parameter(s): ${unknownQuery.join(', ')}`);
    if (req.query.isPolling) throw new AppError('VALIDATION', 'isPolling is reserved for the backend poller; read live data from /api/state');
    if (op.bodySchema) {
      if (op.bodyRequired && req.body === undefined) throw new AppError('VALIDATION', `${op.id} requires a JSON body`);
      const problems = validateSchema(op.bodySchema, req.body);
      if (problems.length) throw new AppError('VALIDATION', `Invalid body for ${op.id}`, { details: problems });
    }
    const client = getClient();
    if (!client || client.state !== 'loggedIn') throw new AppError('NOT_CONNECTED', 'Not connected to a DICENTIS Wireless system');
    // Express 5 leaves req.body undefined when no body was sent.
    const data = await client.request(op.method, req.path, op.bodySchema && req.body !== undefined ? { body: req.body } : {});
    if (op.method !== 'GET') onSuccess?.(op);
    res.json(ok(data));
  });

  return router;
}
