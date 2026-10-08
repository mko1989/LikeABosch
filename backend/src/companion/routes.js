// Companion API (WO-099, DEC-027):
//   GET    /api/companion            { config, status, log } (also live as topic `devices.companion`)
//   PUT    /api/companion            { host, port, enabled, rows, cols } (partial when one is configured) · DELETE removes it
//   POST   /api/companion/test       reachability ({ host, port } in the body tests those instead of the saved ones)
//   POST   /api/companion/press      { page, row, column, action }: one button by hand (picker "Test")
// Triggers per seat / desk: PUT/DELETE /api/room/triggers/:kind/:id (room API).
import express from 'express';
import { ok, AppError } from '../lib/errors.js';
import { validAction } from './client.js';

/** @param {{ companion: import('./service.js').CompanionService, devices: import('../devices/manager.js').DeviceManager }} deps */
export function createCompanionRouter({ companion, devices }) {
  const router = express.Router();
  router.get('/', (_req, res) => res.json(ok(companion.state())));
  router.put('/', async (req, res) => { await devices.setCompanion(req.body ?? {}); res.json(ok(companion.state())); });
  router.delete('/', async (_req, res) => { await devices.setCompanion(null); res.json(ok(companion.state())); });
  router.post('/test', async (req, res) => {
    const host = req.body?.host;
    const target = host ? { host: String(host).trim(), port: Number.isInteger(req.body.port) ? req.body.port : null } : companion.config;
    if (!target?.host) throw new AppError('VALIDATION', 'No Companion host configured');
    try {
      res.json(ok(await companion.test(target)));
    } catch (err) {
      throw new AppError('UPSTREAM_ERROR', err.message);
    }
  });
  router.post('/press', async (req, res) => {
    if (!validAction(req.body)) throw new AppError('VALIDATION', 'Body must be { page 1–999, row, column −99…99, action press|down|up }');
    try {
      await companion.press(req.body);
    } catch (err) {
      throw new AppError('UPSTREAM_ERROR', err.message);
    }
    res.json(ok(companion.state()));
  });
  return router;
}
