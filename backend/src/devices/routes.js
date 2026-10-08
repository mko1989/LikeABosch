// Device API (WO-038):
//   GET    /api/devices/cameras                     list (no passwords; passwordSet + status)
//   POST   /api/devices/cameras                     add { name, driver, host, port, transport, framing, address, username, password, switcherInput }
//   PUT    /api/devices/cameras/:id                 update (partial); connection fields reconnect
//   DELETE /api/devices/cameras/:id
//   POST   /api/devices/cameras/:id/recall          { preset }
//   POST   /api/devices/cameras/:id/store           { preset?, name? }  → { preset } (ONVIF may assign a token)
//   POST   /api/devices/cameras/:id/move            { pan, tilt, zoom }  each -1…1
//   POST   /api/devices/cameras/:id/stop
//   GET    /api/devices/cameras/:id/presets         ONVIF preset list (null for other drivers)
//   POST   /api/devices/cameras/:id/test            reconnect if needed + ping
//   GET    /api/devices/switcher/discover?timeoutMs=  ATEM switchers found on the LAN via mDNS (WO-090)
//   GET    /api/devices/switcher | PUT (config or null) | PATCH (partial, e.g. { automation }, DEC-015) | POST /api/devices/switcher/cut { input } | POST …/preview { input }
import express from 'express';
import { AppError, ok } from '../lib/errors.js';
import { discoverAtem } from './discovery/mdns.js';

const axis = v => (v === undefined ? 0 : typeof v === 'number' && v >= -1 && v <= 1 ? v : NaN);

/** @param {{ devices: import('./manager.js').DeviceManager }} deps */
export function createDevicesRouter({ devices }) {
  const router = express.Router();
  router.get('/cameras', (_req, res) => res.json(ok(devices.publicCameras())));
  router.post('/cameras', async (req, res) => res.json(ok(await devices.addCamera(req.body))));
  router.put('/cameras/:id', async (req, res) => res.json(ok(await devices.updateCamera(req.params.id, req.body))));
  router.delete('/cameras/:id', async (req, res) => { await devices.removeCamera(req.params.id); res.json(ok(null)); });

  router.post('/cameras/:id/recall', async (req, res) => {
    const preset = req.body?.preset;
    if (preset === undefined || preset === null || preset === '') throw new AppError('VALIDATION', 'preset is required');
    res.json(ok(await devices.recall(req.params.id, preset)));
  });
  router.post('/cameras/:id/store', async (req, res) => {
    const preset = await devices.store(req.params.id, req.body?.preset, req.body?.name);
    res.json(ok({ preset }));
  });
  router.post('/cameras/:id/move', async (req, res) => {
    const v = { pan: axis(req.body?.pan), tilt: axis(req.body?.tilt), zoom: axis(req.body?.zoom) };
    if (Object.values(v).some(Number.isNaN)) throw new AppError('VALIDATION', 'pan, tilt and zoom must be numbers between -1 and 1');
    await devices.move(req.params.id, v);
    res.json(ok(null));
  });
  router.post('/cameras/:id/stop', async (req, res) => { await devices.stop(req.params.id); res.json(ok(null)); });
  router.get('/cameras/:id/presets', async (req, res) => res.json(ok(await devices.presets(req.params.id))));
  router.post('/cameras/:id/test', async (req, res) => res.json(ok(await devices.test(req.params.id))));

  router.get('/switcher/discover', async (req, res) => {
    const timeoutMs = req.query.timeoutMs === undefined ? 3000 : Number(req.query.timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) throw new AppError('VALIDATION', 'timeoutMs must be 100–10000');
    res.json(ok(await discoverAtem({ timeoutMs })));
  });
  router.get('/switcher', (_req, res) => res.json(ok(devices.publicSwitcher())));
  router.put('/switcher', async (req, res) => res.json(ok(await devices.setSwitcher(req.body?.driver ? req.body : null))));
  router.patch('/switcher', async (req, res) => res.json(ok(await devices.updateSwitcher(req.body))));
  router.post('/switcher/cut', async (req, res) => { await devices.cut(req.body?.input); res.json(ok(null)); });
  router.post('/switcher/preview', async (req, res) => { await devices.preview(req.body?.input); res.json(ok(null)); });
  return router;
}
