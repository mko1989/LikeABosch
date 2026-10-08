// Process entry point: load config, start HTTP server, shut down cleanly.
import { pathToFileURL } from 'node:url';
import { loadConfig, redactConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { createApp } from './app.js';
import { loadSpec } from './wired/spec.js';
import { WiredEventBridge } from './wired/events.js';
import { StateCache } from './state/cache.js';
import { createSseHub } from './lib/sse.js';
import { ConnectionManager } from './connection/manager.js';
import { WirelessPoller } from './wireless/poller.js';
import { loadWirelessSpec } from './wireless/spec.js';
import { loadDcnSpec } from './dcn/spec.js';
import { DcnEventBridge } from './dcn/events.js';
import { DcnSmdSync } from './dcn-smd/sync.js';
import { loadDcnmSpec } from './dcnm/spec.js';
import { DcnmMirror } from './dcnm/mirror.js';
import { DicentisFeatures } from './dicentis/service.js';
import { DomainService } from './domain/service.js';
import { linkProjectsToSystem, recordSeatNames } from './projects/system-link.js';
import { DeviceManager } from './devices/manager.js';
import { RoomStore } from './room/store.js';
import { Director } from './director/director.js';
import { CompanionService } from './companion/service.js';
import { ProjectManager } from './projects/manager.js';
import { legacyDataDirs } from './lib/paths.js';

/**
 * Start the backend. Exported for tests and for the launcher.
 * @param {import('./config.js').Config} [config]
 * @returns {Promise<{ server: import('node:http').Server, url: string, close: () => Promise<void> }>}
 */
export async function start(config = loadConfig()) {
  const log = createLogger({ level: config.logLevel, name: 'backend' });
  const spec = loadSpec();
  const cache = new StateCache();
  const hub = createSseHub();
  cache.on('change', (topic, entry) => hub.broadcast('topic', {
    topic, ...(entry ?? { data: null, updatedAt: new Date().toISOString(), reason: cache.unavailable.get(topic) ?? null }),
  }));
  cache.on('unavailable', (topic, reason) => hub.broadcast('topic', { topic, data: null, updatedAt: new Date().toISOString(), reason }));
  const bridge = new WiredEventBridge({ spec, cache, log: log.child('wired-events') });
  bridge.on('notification', n => hub.broadcast('notification', n));

  const wirelessSpec = loadWirelessSpec();
  const poller = new WirelessPoller({ cache, log: log.child('wireless-poller') });
  const dcnSpec = loadDcnSpec();
  const dcnEvents = new DcnEventBridge({ cache, log: log.child('dcn-events') });
  const dcnSmd = new DcnSmdSync({ cache, dataDir: config.dataDir, log: log.child('dcn-smd') });
  const dcnmSpec = loadDcnmSpec();
  const dcnmMirror = new DcnmMirror({ cache, spec: dcnmSpec, log: log.child('dcnm') });
  const manager = new ConnectionManager({ config, bridge, poller, dcnEvents, dcnSmd, dcnmMirror, cache, log: log.child('connection') });
  manager.on('status', status => hub.broadcast('connection', status));
  const domain = new DomainService({ cache, manager });
  const dicentis = new DicentisFeatures({ cache, manager, log: log.child('dicentis') }); // DEC-029
  const devices = new DeviceManager({ dataDir: config.dataDir, cache, log: log.child('devices') });
  const room = new RoomStore({ dataDir: config.dataDir, cache, log: log.child('room') });
  // DEC-016: room + devices live in the open project's folder; legacy data is imported only into the default folder.
  const projects = new ProjectManager({ dataDir: config.dataDir, room, devices, cache, log: log.child('projects'), legacyDirs: config.dataDirIsDefault ? legacyDataDirs() : [] });
  cache.on('change', topic => { if (topic === 'permissions') hub.broadcast('connection', manager.status()); });

  const app = createApp({ config, log, services: { spec, wirelessSpec, dcnSpec, dcnEvents, dcnSmd, dcnmSpec, dicentis, cache, hub, manager, bridge, poller, devices, room, projects } });
  const server = app.listen(config.port, config.bindHost);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  const url = `http://${config.bindHost === '0.0.0.0' ? 'localhost' : config.bindHost}:${port}`;
  log.info(`Listening on ${url}`);
  log.debug('Config', redactConfig(config));
  await manager.start();
  await projects.start(); // opens the current project: loads room + devices
  const unlinkProjects = linkProjectsToSystem({ manager, projects, cache, log: log.child('projects') }); // DEC-025
  const stopSeatNames = recordSeatNames({ cache, room, projects, log: log.child('projects') }); // WO-096
  const director = new Director({ cache, devices, room, log: log.child('director') });
  projects.on('opened', () => director.reset());
  app.locals.services.director = director;
  const companion = new CompanionService({ cache, devices, room, log: log.child('companion') }); // WO-099
  app.locals.services.companion = companion;
  const close = async () => {
    unlinkProjects();
    stopSeatNames();
    await manager.disconnect();
    await dcnSmd.flush();
    director.close();
    companion.close();
    dicentis.close();
    await devices.close();
    hub.close();
    await new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); });
  };
  return { server, url, close, services: { spec, wirelessSpec, dcnSpec, dcnEvents, dcnSmd, dcnmSpec, dcnmMirror, dicentis, cache, hub, bridge, poller, manager, domain, devices, room, projects, director, companion } };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { close } = await start().catch(err => {
    console.error(`Failed to start: ${err.message}`);
    process.exit(1);
  });
  const shutdown = async signal => {
    console.log(`${signal} received, shutting down`);
    await close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
