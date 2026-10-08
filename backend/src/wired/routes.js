// Wired passthrough: one HTTP endpoint per Conference Protocol operation (WO-011, DEC-004).
//   GET  /api/wired/ops                 list of operations (discovery)
//   POST /api/wired/ops/:operation      body = request parameters
//   GET  /api/wired/ops/:operation      Get*/List* only; flat query parameters
import express from 'express';
import { AppError, ok } from '../lib/errors.js';
import { validateValue } from './spec.js';

/** Managed by the backend's connection layer (WO-012/013); calling them directly would break it. */
export const MANAGED_OPERATIONS = new Set(['login', 'logout', 'registerevents', 'unregisterevents']);

const isReadOperation = name => /^(Get|List)/.test(name);

/**
 * @param {object} deps
 * @param {ReturnType<import('./spec.js').loadSpec>} deps.spec
 * @param {() => import('./client.js').WiredClient | null} deps.getClient
 * @param {(operation: string) => void} [deps.onSuccess]  e.g. refresh topics that have no change event
 */
export function createWiredRouter({ spec, getClient, onSuccess }) {
  const router = express.Router();

  router.get('/ops', (_req, res) => {
    res.json(ok(spec.list().map(op => ({
      operation: op.operation,
      category: op.category,
      summary: op.summary,
      permissions: op.permissions,
      licenses: op.licenses,
      since: op.since ?? null, // DICENTIS version that introduced it, if newer than the tested 6.50 (WO-044)
      methods: isReadOperation(op.operation) ? ['GET', 'POST'] : ['POST'],
      managed: MANAGED_OPERATIONS.has(op.operation.toLowerCase()),
      request: op.request,
      response: op.response,
    }))));
  });

  router.get('/ops/:operation', async (req, res) => {
    const op = resolve(req.params.operation);
    if (!isReadOperation(op.operation)) {
      throw new AppError('VALIDATION', `${op.operation} changes state; use POST`);
    }
    res.json(ok(await call(op, queryToParams(op, req.query))));
  });

  router.post('/ops/:operation', async (req, res) => {
    const op = resolve(req.params.operation);
    const body = req.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body)) {
      throw new AppError('VALIDATION', 'Request body must be a JSON object of operation parameters');
    }
    res.json(ok(await call(op, body)));
  });

  /** @param {string} name */
  function resolve(name) {
    const op = spec.get(name);
    if (!op) throw new AppError('NOT_FOUND', `Unknown operation '${name}'`);
    if (op.excluded) throw new AppError('NOT_FOUND', `Operation '${op.operation}' is not supported: ${op.excluded}`);
    if (MANAGED_OPERATIONS.has(op.operation.toLowerCase())) {
      throw new AppError('MANAGED_BY_BACKEND', `${op.operation} is managed by the backend; use /api/connection`);
    }
    return op;
  }

  async function call(op, params) {
    const problems = validateValue(op.request, params);
    if (problems.length) {
      throw new AppError('VALIDATION', `Invalid parameters for ${op.operation}`, {
        details: problems.map(p => (p.problem === 'unknown-field'
          ? `${p.path}: unknown parameter`
          : `${p.path}: expected ${p.expected}`)),
      });
    }
    const client = getClient();
    if (!client || client.state !== 'loggedIn') {
      throw new AppError('NOT_CONNECTED', 'Not connected to a DICENTIS server');
    }
    const result = await client.request(op.operation, params);
    onSuccess?.(op.operation);
    return result;
  }

  return router;
}

/**
 * Convert query strings to typed parameters using the operation's request notation.
 * Only top-level primitives, enums and arrays of those are supported via GET.
 */
function queryToParams(op, query) {
  /** @type {Record<string, unknown>} */
  const params = {};
  for (const [key, raw] of Object.entries(query)) {
    if (!(key in op.request)) {
      throw new AppError('VALIDATION', `Invalid parameters for ${op.operation}`, { details: [`parameters.${key}: unknown parameter`] });
    }
    const notation = op.request[key];
    if (Array.isArray(notation)) {
      params[key] = [raw].flat().flatMap(v => String(v).split(',')).filter(Boolean).map(v => coerce(notation[0], v, key));
    } else if (typeof notation === 'string') {
      params[key] = coerce(notation, Array.isArray(raw) ? raw.at(-1) : raw, key);
    } else {
      throw new AppError('VALIDATION', `Parameter '${key}' is an object; use POST with a JSON body`);
    }
  }
  return params;
}

function coerce(notation, value, key) {
  const v = String(value);
  switch (notation) {
    case 'int': case 'long': {
      if (!/^-?\d+$/.test(v)) throw new AppError('VALIDATION', `Parameter '${key}' must be an integer`);
      return Number(v);
    }
    case 'double': {
      const n = Number(v);
      if (Number.isNaN(n)) throw new AppError('VALIDATION', `Parameter '${key}' must be a number`);
      return n;
    }
    case 'bool': {
      if (v !== 'true' && v !== 'false') throw new AppError('VALIDATION', `Parameter '${key}' must be true or false`);
      return v === 'true';
    }
    default: return v; // string, enum (validated later), any
  }
}
