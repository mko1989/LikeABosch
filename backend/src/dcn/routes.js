// DCN passthrough (WO-060, DEC-004/017): one endpoint per DCN-SW API method.
//   GET  /api/dcn/ops                          list of methods (discovery)
//   GET  /api/dcn/bridge                       bridge info, status (initialized/available/allowed) and constants
//   POST /api/dcn/ops/:api/:method             body = in parameters by name, e.g. POST /api/dcn/ops/control.DiscussionApi/SpeakNow {participantId:0, seatId:12}
//   GET  /api/dcn/ops/:api/:method             Retrieve*/Get* only; in parameters as query (int[] comma separated)
// Success: data = the out parameters. API_ERROR other than NONE → 502 UPSTREAM_ERROR (NO_AUTHORIZATION → 401 UPSTREAM_AUTH) with `apiError`.
import express from 'express';
import { AppError, ok } from '../lib/errors.js';

const isRead = name => /^(Retrieve|Get)/.test(name);

/**
 * @param {object} deps
 * @param {ReturnType<import('./spec.js').loadDcnSpec>} deps.spec
 * @param {() => import('./client.js').DcnClient | null} deps.getClient
 * @param {(key: string, args: Record<string, unknown>) => void} [deps.onSuccess]
 */
export function createDcnRouter({ spec, getClient, onSuccess }) {
  const router = express.Router();

  router.get('/ops', (_req, res) => res.json(ok(spec.list().map(m => ({
    key: m.key, api: m.api, method: m.name, summary: m.summary,
    methods: isRead(m.name) ? ['GET', 'POST'] : ['POST'],
    in: m.inParams.map(p => ({ name: p.name, type: p.type })),
    out: m.outParams.map(p => ({ name: p.name, type: p.type })),
    errors: m.errors,
  })))));

  router.get('/bridge', (_req, res) => {
    const c = getClient();
    res.json(ok(c ? { state: c.state, bridge: c.bridgeInfo, status: c.bridgeStatus, constants: c.constants } : null));
  });

  router.get('/ops/:api/:method', async (req, res) => {
    const m = resolve(req.params);
    if (!isRead(m.name)) throw new AppError('VALIDATION', `${m.key} changes state; use POST`);
    res.json(ok(await call(m, queryToArgs(m, req.query))));
  });

  router.post('/ops/:api/:method', async (req, res) => {
    const m = resolve(req.params);
    const body = req.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body)) throw new AppError('VALIDATION', 'Request body must be a JSON object of in parameters');
    res.json(ok(await call(m, body)));
  });

  function resolve({ api, method }) {
    const m = spec.get(`${api}.${method}`);
    if (!m) throw new AppError('NOT_FOUND', `Unknown DCN-SW API method '${api}.${method}'`);
    return m;
  }

  async function call(m, args) {
    const problems = spec.validateArgs(m, args);
    if (problems.length) throw new AppError('VALIDATION', `Invalid parameters for ${m.key}`, { details: problems });
    const client = getClient();
    if (!client || client.state !== 'loggedIn') throw new AppError('NOT_CONNECTED', 'Not connected to a DCN system');
    const out = await client.request(m.key, args);
    onSuccess?.(m.key, args);
    return out;
  }

  return router;
}

function queryToArgs(m, query) {
  const args = {};
  for (const [key, raw] of Object.entries(query)) {
    const p = m.inParams.find(x => x.name === key);
    if (!p) throw new AppError('VALIDATION', `Invalid parameters for ${m.key}`, { details: [`${key}: unknown parameter`] });
    const values = [raw].flat().flatMap(v => String(v).split(',')).filter(v => v !== '');
    const one = v => {
      const base = p.type.replace(/\[\]$/, '');
      if (['int', 'long', 'short', 'byte'].includes(base)) {
        if (!/^-?\d+$/.test(v)) throw new AppError('VALIDATION', `Parameter '${key}' must be an integer`);
        return Number(v);
      }
      if (base === 'bool') {
        if (v !== 'true' && v !== 'false') throw new AppError('VALIDATION', `Parameter '${key}' must be true or false`);
        return v === 'true';
      }
      if (base === 'string') return v;
      if (/^-?\d+$/.test(v)) return Number(v); // enum by number
      return v; // enum by name; structs are rejected by validation
    };
    args[key] = p.type.endsWith('[]') ? values.map(one) : one(values.at(-1) ?? '');
  }
  return args;
}
