// DICENTIS DCNM API passthrough (WO-079, DEC-021): every method, property and callback of the dicentis-bridge.
//   GET    /api/dcnm                              bridge state, info, interfaces found, connection, constants
//   GET    /api/dcnm/ops                          documented interfaces with methods, events, properties (+ found by the bridge)
//   POST   /api/dcnm/ops/:api/:method             body = arguments by name → data = the Task's result
//   GET    /api/dcnm/props/:api                   last reported scalar properties of an interface (status, no API call)
//   GET    /api/dcnm/props/:api/:property         read a property now
//   PUT    /api/dcnm/props/:api/:property         { value }
//   POST   /api/dcnm/callbacks/:id                { result }: answer a value-returning delegate callback
//   DELETE /api/dcnm/handles/:handle              release an object handle (#n)
// Live data: SSE topics dcnm.<Api>.<Event>, dcnmStatus, dcnmCallback, dcnmSweep (mirror.js).
import express from 'express';
import { AppError, ok } from '../lib/errors.js';

/**
 * @param {object} deps
 * @param {ReturnType<import('./spec.js').loadDcnmSpec>} deps.spec
 * @param {() => import('./client.js').DcnmClient | null} deps.getClient
 */
export function createDcnmRouter({ spec, getClient }) {
  const router = express.Router();

  const client = () => {
    const c = getClient();
    if (!c || c.state !== 'loggedIn') {
      throw new AppError('NOT_CONNECTED', c ? `DICENTIS API not ready (dicentis-bridge: ${c.state}${c.lastError ? `, ${c.lastError.message}` : ''})`
        : 'The DICENTIS bridge is not enabled (Settings → Connection: "DICENTIS bridge", system wired)');
    }
    return c;
  };
  const known = api => {
    const c = getClient();
    if (!spec.get(api) && !(c?.interfaces && api in c.interfaces) && !/^#\d+$/.test(api)) throw new AppError('NOT_FOUND', `Unknown DCNM interface '${api}'`);
  };

  router.get('/', (_req, res) => {
    const c = getClient();
    res.json(ok(c ? {
      state: c.state, bridge: c.bridgeInfo, interfaces: c.interfaces, connection: c.connection, constants: c.constants,
      lastError: c.lastError ? { code: c.lastError.code, message: c.lastError.message } : null,
    } : null));
  });

  router.get('/ops', (_req, res) => {
    const found = getClient()?.interfaces ?? {};
    res.json(ok(spec.list().map(i => ({ ...i, found: i.api in found ? found[i.api].source : null }))));
  });

  router.post('/ops/:api/:method', async (req, res) => {
    const { api, method } = req.params;
    known(api);
    const args = req.body ?? {};
    if (typeof args !== 'object' || Array.isArray(args)) throw new AppError('VALIDATION', 'Request body must be a JSON object of arguments by name');
    const problems = spec.validateCall(api, method, args);
    if (problems.length) throw new AppError('VALIDATION', `Invalid call ${api}.${method}`, { details: problems });
    const timeoutMs = req.query.timeoutMs ? Number(req.query.timeoutMs) : undefined;
    res.json(ok(await client().call(api, method, args, { timeoutMs })));
  });

  router.get('/props/:api', (req, res) => {
    known(req.params.api);
    const values = getClient()?.bridgeStatus?.interfaces?.[req.params.api];
    if (!values) throw new AppError('NOT_CONNECTED', `No status for ${req.params.api} (dicentis-bridge not connected or interface not found)`);
    res.json(ok(values));
  });

  router.get('/props/:api/:property', async (req, res) => {
    known(req.params.api);
    res.json(ok(await client().get(req.params.api, req.params.property)));
  });

  router.put('/props/:api/:property', async (req, res) => {
    known(req.params.api);
    if (!req.body || typeof req.body !== 'object' || !('value' in req.body)) throw new AppError('VALIDATION', 'Body must be { "value": … }');
    await client().set(req.params.api, req.params.property, req.body.value);
    res.json(ok(null));
  });

  router.post('/callbacks/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new AppError('VALIDATION', 'Callback id must be an integer');
    await client().callbackResult(id, req.body?.result ?? null);
    res.json(ok(null));
  });

  router.delete('/handles/:handle', async (req, res) => {
    await client().release(req.params.handle);
    res.json(ok(null));
  });

  return router;
}
