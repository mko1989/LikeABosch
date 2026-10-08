// Director API (WO-039): GET /api/director (state) · POST /api/director/shot { seatId } (null/absent = overview)
// Settings (enabled, strategy, timings) are part of the room: PUT /api/room/director.
import express from 'express';
import { ok, AppError } from '../lib/errors.js';

/** @param {{ director: import('./director.js').Director }} deps */
export function createDirectorRouter({ director }) {
  const router = express.Router();
  router.get('/', (_req, res) => res.json(ok(director.state())));
  router.post('/shot', async (req, res) => {
    try {
      res.json(ok(await director.takeShot(req.body?.seatId ?? null)));
    } catch (err) {
      throw new AppError('VALIDATION', err.message);
    }
  });
  return router;
}
