// Connection management endpoints (WO-013):
//   GET  /api/connection              status { system, host, port, user, state, connectedSince, lastError, permissions }
//   GET  /api/connection/settings     settings without password (+ passwordSet, pinned)
//   PUT  /api/connection/settings     partial update; pinned (env) fields are rejected
//   POST /api/connection/connect      (re)connect with current settings; body { override: true } takes over a wireless session
//   POST /api/connection/disconnect
import express from 'express';
import { ok } from '../lib/errors.js';

/** @param {{ manager: import('./manager.js').ConnectionManager }} deps */
export function createConnectionRouter({ manager }) {
  const router = express.Router();
  router.get('/', (_req, res) => res.json(ok(manager.status())));
  router.get('/settings', (_req, res) => res.json(ok(manager.publicSettings())));
  router.put('/settings', async (req, res) => res.json(ok(await manager.updateSettings(req.body))));
  router.post('/connect', async (req, res) => res.json(ok(await manager.connect({ override: req.body?.override === true }))));
  router.post('/disconnect', async (_req, res) => res.json(ok(await manager.disconnect())));
  return router;
}
