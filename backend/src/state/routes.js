// Live state endpoints (WO-012):
//   GET /api/events         SSE stream: `connection` + `snapshot` first, then `topic`, `notification`, `connection` events
//   GET /api/state          current snapshot { topics, unavailable }
//   GET /api/state/:topic   one cached topic
import express from 'express';
import { AppError, ok } from '../lib/errors.js';

/**
 * @param {object} deps
 * @param {import('./cache.js').StateCache} deps.cache
 * @param {ReturnType<import('../lib/sse.js').createSseHub>} deps.hub
 * @param {() => unknown} [deps.getConnectionStatus]  sent as the first `connection` event to new SSE clients
 */
export function createStateRouter({ cache, hub, getConnectionStatus }) {
  const router = express.Router();

  router.get('/events', (req, res) => {
    const initial = [{ event: 'snapshot', data: cache.snapshot() }];
    if (getConnectionStatus) initial.unshift({ event: 'connection', data: getConnectionStatus() });
    hub.add(req, res, initial);
  });

  router.get('/state', (_req, res) => res.json(ok(cache.snapshot())));

  router.get('/state/:topic', (req, res) => {
    const entry = cache.get(req.params.topic);
    if (!entry) {
      const reason = cache.unavailable.get(req.params.topic);
      throw new AppError('NOT_FOUND', reason ? `Topic '${req.params.topic}' unavailable: ${reason}` : `No data for topic '${req.params.topic}'`);
    }
    res.json(ok(entry));
  });

  return router;
}
