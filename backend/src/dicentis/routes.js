// DICENTIS-only feature actions over the DCNM API (DEC-029). Live data: SSE topics dicentis.* (service.js).
//   POST /api/dicentis/audio/gain                 { type, value?, muted?, testTone? }
//   POST /api/dicentis/audio/equalizer            { equalizer, band, enabled?, filter?, gain?, frequency?, q? }
//   POST /api/dicentis/audio/selection            { type, value }
//   POST /api/dicentis/audio/seat-dante           { seatIds, danteOut?, headroom? }
//   POST /api/dicentis/audio/vu                   { on }  level meters for 30 s (repeat to keep them on)
//   POST /api/dicentis/languages/create           { abbreviation, label, short?, native? }
//   POST /api/dicentis/languages/update           { id, abbreviation?, label?, short?, native? }
//   POST /api/dicentis/languages/delete           { id }
//   POST /api/dicentis/meeting-languages/add      { languageId, danteOut? }
//   POST /api/dicentis/meeting-languages/remove   { languageId }
//   POST /api/dicentis/meeting-languages/order    { languageIds }
//   POST /api/dicentis/meeting-languages/update   { languageId, danteOut?, stream2? }
//   POST /api/dicentis/desks/update               { seatId, outA?, outB?, outC?, setB?, setC? }  (null = none)
import express from 'express';
import { AppError, ok } from '../lib/errors.js';

/** @param {{ features: import('./service.js').DicentisFeatures }} deps */
export function createDicentisRouter({ features }) {
  const router = express.Router();
  const ACTIONS = {
    'audio/gain': b => features.gain(b),
    'audio/equalizer': b => features.equalizer(b),
    'audio/selection': b => features.selection(b),
    'audio/seat-dante': b => features.seatDante(b),
    'audio/vu': b => features.vuLease(Boolean(b?.on)),
    'languages/create': b => features.createLanguage(b),
    'languages/update': b => features.updateLanguage(b),
    'languages/delete': b => features.deleteLanguage(b),
    'meeting-languages/add': b => features.addMeetingLanguage(b),
    'meeting-languages/remove': b => features.removeMeetingLanguage(b),
    'meeting-languages/order': b => features.orderMeetingLanguages(b),
    'meeting-languages/update': b => features.updateMeetingLanguage(b),
    'desks/update': b => features.updateDesk(b),
  };
  router.get('/', (_req, res) => res.json(ok(features.cache.get('dicentis.status')?.data ?? null)));
  router.post('/:area/:action', async (req, res) => {
    const fn = ACTIONS[`${req.params.area}/${req.params.action}`];
    if (!fn) throw new AppError('NOT_FOUND', `Unknown DICENTIS action '${req.params.area}/${req.params.action}'`);
    const body = req.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body)) throw new AppError('VALIDATION', 'Request body must be a JSON object');
    res.json(ok(await fn(body)));
  });
  return router;
}
