// Projects API (WO-057, DEC-016):
//   GET    /api/projects                     { current, projects, dataDir } (also live as topic `project`)
//   POST   /api/projects {name, copyCurrent?}  new empty project, or a copy of the open one ("Save as…"); opens it
//   PATCH  /api/projects/:id {name?, system?}  rename; system 'connected' = link to the connected DICENTIS, null = unlink (DEC-025)
//   POST   /api/projects/current/clear {layout?, shots?, background?, devices?}  clear parts of the open project (WO-091)
//   POST   /api/projects/:id/open             open (cameras/switcher reconnect)
//   DELETE /api/projects/:id                  delete (not the open one)
//   GET    /api/projects/:id/download         <name>.likeabosch.json (includes camera passwords)
//   POST   /api/projects/import               raw project file body (any content type, ≤ 12 MB) → new project, opened
import express from 'express';
import { ok, AppError } from '../lib/errors.js';

/** @param {{ projects: import('./manager.js').ProjectManager }} deps */
export function createProjectsRouter({ projects }) {
  const router = express.Router();
  const send = async (res, p) => res.json(ok(await p));
  router.get('/', (_req, res) => res.json(ok(projects.describe())));
  router.post('/', (req, res) => send(res, projects.create({ name: req.body?.name, copyCurrent: req.body?.copyCurrent === true })));
  // Sent as application/octet-stream so the global 5 MB JSON parser leaves it alone (a floor plan makes it bigger).
  router.post('/import', express.raw({ type: () => true, limit: '12mb' }), (req, res) => {
    let doc = req.body;
    if (Buffer.isBuffer(doc)) {
      try { doc = JSON.parse(doc.toString('utf8')); } catch { throw new AppError('VALIDATION', 'The file is not valid JSON'); }
    }
    return send(res, projects.importProject(doc));
  });
  router.post('/current/clear', (req, res) => send(res, projects.clear(req.body ?? {})));
  router.patch('/:id', async (req, res) => {
    const body = req.body ?? {};
    if (body.system !== undefined) await projects.link(req.params.id, body.system);
    res.json(ok(body.name !== undefined || body.system === undefined ? await projects.rename(req.params.id, body.name) : projects.describe()));
  });
  router.post('/:id/open', (req, res) => send(res, projects.open(req.params.id)));
  router.delete('/:id', (req, res) => send(res, projects.remove(req.params.id)));
  router.get('/:id/download', async (req, res) => {
    const { file, document } = await projects.exportProject(req.params.id);
    res.attachment(file).type('application/json').send(JSON.stringify(document, null, 2));
  });
  return router;
}
