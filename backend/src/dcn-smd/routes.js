// DCN-SWSMD endpoints (WO-066). The stream is read-only; live data is in the `smd*` and `domain.*` topics.
//   GET  /api/dcn-smd/state    the reconstructed state (all sections) + stream status
//   POST /api/dcn-smd/reset    forget the reconstructed state (and the persisted copy)
import express from 'express';
import { ok } from '../lib/errors.js';
import { SECTIONS } from './state.js';

/** @param {{ sync: import('./sync.js').DcnSmdSync }} deps */
export function createDcnSmdRouter({ sync }) {
  const router = express.Router();
  router.get('/state', (_req, res) => res.json(ok({
    stream: sync.cache.get('smdStream')?.data ?? null,
    ...Object.fromEntries(SECTIONS.map(s => [s, sync.state.view(s)])),
  })));
  router.post('/reset', async (_req, res) => {
    await sync.reset();
    res.json(ok(null));
  });
  return router;
}
