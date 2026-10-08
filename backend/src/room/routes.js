// Room layout API (WO-034):
//   GET /api/room                                    whole layout (also live as topic `room`)
//   PUT /api/room/canvas {width,height,x?,y?} · PUT/DELETE /api/room/seats/:seatId {x,y,rotation}
//   PUT/DELETE /api/room/cameras/:cameraId {x,y,rotation} · PUT/DELETE /api/room/desks/:deskId {x,y,rotation} (WO-048)
//   PATCH /api/room/placements {seats?,cameras?,desks?: {id: {x,y,rotation}|null}}: many in one save, null = unplace (WO-055)
//   PUT/DELETE /api/room/shots/:seatId {cameraId,preset} · PATCH /api/room/shots {seatId: {cameraId,preset}|null} (WO-056)
//   DELETE /api/room/shots[?cameraId=]: delete all saved shots, or one camera's (WO-092)
//   POST /api/room/remap {map: {oldSeatId: newSeatId | null}}: move placements/shots/names to other seat ids (WO-096)
//   PUT /api/room/overview {cameraId,preset}|null · PUT /api/room/director {enabled,strategy,delayMs,minShotMs}
//   PUT /api/room/operate {cogSendsPreview} (WO-053)
//   PUT/DELETE /api/room/triggers/:kind/:id {on: [action], off: [action]}: Companion buttons of a seat / desk (WO-099)
//   PUT /api/room/background (raw image body, PNG/JPEG/WebP ≤ 5 MB) · GET (image) · DELETE
import express from 'express';
import { ok, AppError } from '../lib/errors.js';
import { BACKGROUND_TYPES } from './store.js';

/** @param {{ room: import('./store.js').RoomStore }} deps */
export function createRoomRouter({ room }) {
  const router = express.Router();
  const send = async (res, p) => res.json(ok(await p));

  router.get('/', (_req, res) => res.json(ok(room.get())));
  router.put('/canvas', (req, res) => send(res, room.setCanvas(req.body)));
  router.put('/seats/:seatId', (req, res) => send(res, room.placeSeat(req.params.seatId, req.body)));
  router.delete('/seats/:seatId', (req, res) => send(res, room.unplaceSeat(req.params.seatId)));
  router.put('/cameras/:cameraId', (req, res) => send(res, room.placeCamera(req.params.cameraId, req.body)));
  router.delete('/cameras/:cameraId', (req, res) => send(res, room.unplaceCamera(req.params.cameraId)));
  router.put('/desks/:deskId', (req, res) => send(res, room.placeDesk(req.params.deskId, req.body)));
  router.delete('/desks/:deskId', (req, res) => send(res, room.unplaceDesk(req.params.deskId)));
  router.patch('/placements', (req, res) => send(res, room.placeMany(req.body)));
  router.patch('/shots', (req, res) => send(res, room.setShots(req.body)));
  router.put('/shots/:seatId', (req, res) => send(res, room.setShot(req.params.seatId, req.body)));
  router.delete('/shots/:seatId', (req, res) => send(res, room.clearShot(req.params.seatId)));
  // WO-092: delete all saved shots, or ?cameraId= those of one camera (+ the overview shot when it uses it).
  router.delete('/shots', (req, res) => send(res, room.clearShots(req.query.cameraId === undefined ? {} : { cameraId: String(req.query.cameraId) })));
  router.post('/remap', (req, res) => send(res, room.remapSeats(req.body?.map)));
  router.put('/overview', (req, res) => send(res, room.setOverview(req.body?.cameraId ? req.body : null)));
  router.put('/director', (req, res) => send(res, room.setDirector(req.body)));
  router.put('/operate', (req, res) => send(res, room.setOperate(req.body)));
  router.put('/triggers/:kind/:id', (req, res) => send(res, room.setTrigger(req.params.kind, req.params.id, req.body)));
  router.delete('/triggers/:kind/:id', (req, res) => send(res, room.setTrigger(req.params.kind, req.params.id, null)));

  router.put('/background', express.raw({ type: Object.keys(BACKGROUND_TYPES), limit: '5mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError('VALIDATION', 'Send the image as the raw request body with Content-Type image/png, image/jpeg or image/webp');
    return send(res, room.setBackground(req.body, req.get('content-type')));
  });
  router.get('/background', (req, res) => {
    const file = room.backgroundPath();
    if (!file) throw new AppError('NOT_FOUND', 'No floor plan uploaded');
    res.set('cache-control', 'no-cache').type(room.get().background.type).sendFile(file);
  });
  router.delete('/background', (req, res) => send(res, room.clearBackground()));
  return router;
}
