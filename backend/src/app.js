// Express app factory. Routes are mounted here; server.js only does process concerns.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { ok, apiNotFound, errorHandler } from './lib/errors.js';
import { createWiredRouter } from './wired/routes.js';
import { createStateRouter } from './state/routes.js';
import { createConnectionRouter } from './connection/routes.js';
import { createWirelessRouter } from './wireless/routes.js';
import { createDomainRouter } from './domain/routes.js';
import { createDcnRouter } from './dcn/routes.js';
import { createDcnSmdRouter } from './dcn-smd/routes.js';
import { createDcnmRouter } from './dcnm/routes.js';
import { createDicentisRouter } from './dicentis/routes.js';
import { createDevicesRouter } from './devices/routes.js';
import { createRoomRouter } from './room/routes.js';
import { createProjectsRouter } from './projects/routes.js';
import { createDirectorRouter } from './director/routes.js';
import { createCompanionRouter } from './companion/routes.js';

const WEB_DIR = fileURLToPath(new URL('../../web/', import.meta.url));

/**
 * @param {object} deps
 * @param {import('./config.js').Config} deps.config
 * @param {ReturnType<import('./lib/logger.js').createLogger>} deps.log
 * @param {object} deps.services
 * @param {ReturnType<import('./wired/spec.js').loadSpec>} deps.services.spec
 * @param {import('./connection/manager.js').ConnectionManager} deps.services.manager
 * @param {import('./wired/events.js').WiredEventBridge} [deps.services.bridge]
 * @param {import('./wireless/poller.js').WirelessPoller} [deps.services.poller]
 * @param {ReturnType<import('./wireless/spec.js').loadWirelessSpec>} deps.services.wirelessSpec
 * @param {ReturnType<import('./dcn/spec.js').loadDcnSpec>} [deps.services.dcnSpec]
 * @param {import('./dcn/events.js').DcnEventBridge} [deps.services.dcnEvents]
 * @param {ReturnType<import('./dcnm/spec.js').loadDcnmSpec>} [deps.services.dcnmSpec]
 * @param {import('./state/cache.js').StateCache} deps.services.cache
 * @param {ReturnType<import('./lib/sse.js').createSseHub>} deps.services.hub
 */
export function createApp({ config, log, services }) {
  const app = express();
  app.locals.services = services;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));

  const api = express.Router();
  api.get('/health', (_req, res) => res.json(ok({ status: 'up', system: config.dicentis.system })));
  const { spec, wirelessSpec, dcnSpec, dcnEvents, dcnSmd, dcnmSpec, dicentis, cache, hub, manager, bridge, poller, devices, room, projects } = services;
  api.use('/connection', createConnectionRouter({ manager }));
  api.use('/wired', createWiredRouter({ spec, getClient: () => manager.wiredClient, onSuccess: op => bridge?.operationSucceeded(op) }));
  // Wireless has no events: refresh all topics right after a write so the UI updates without waiting for the poll.
  api.use('/wireless', createWirelessRouter({ spec: wirelessSpec, getClient: () => manager.wirelessClient, onSuccess: () => poller?.refreshAll() }));
  if (dcnSpec) api.use('/dcn', createDcnRouter({ spec: dcnSpec, getClient: () => manager.dcnClient, onSuccess: (key, args) => dcnEvents?.operationSucceeded(key, args) }));
  if (dcnSmd) api.use('/dcn-smd', createDcnSmdRouter({ sync: dcnSmd }));
  if (dcnmSpec) api.use('/dcnm', createDcnmRouter({ spec: dcnmSpec, getClient: () => manager.dcnmClient }));
  if (dicentis) api.use('/dicentis', createDicentisRouter({ features: dicentis })); // DEC-029
  api.use(createStateRouter({ cache, hub, getConnectionStatus: () => manager.status() }));
  api.use('/domain', createDomainRouter({ manager, cache, poller, dcnEvents }));
  if (devices) api.use('/devices', createDevicesRouter({ devices }));
  if (room) api.use('/room', createRoomRouter({ room }));
  if (projects) api.use('/projects', createProjectsRouter({ projects }));
  // The director is created after the stores have loaded (server.js), so resolve it per request.
  api.use('/director', (req, res, next) => {
    const director = app.locals.services.director;
    if (!director) return next();
    return createDirectorRouter({ director })(req, res, next);
  });
  api.use('/companion', (req, res, next) => {
    const companion = app.locals.services.companion;
    if (!companion) return next();
    return createCompanionRouter({ companion, devices })(req, res, next);
  });

  api.use(apiNotFound);
  app.use('/api', api);
  app.use((_req, res, next) => {
    // The UI is plain ES modules + CSS from this origin (DEC-009); nothing inline, nothing external. Exception: frames of
    // other web pages on the LAN (the Companion button picker shows Companion's own web buttons, DEC-027).
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; frame-src 'self' http: https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.static(WEB_DIR));
  app.use(errorHandler(log));
  return app;
}
