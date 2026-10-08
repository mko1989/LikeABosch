import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../../src/server.js';
import { loadConfig } from '../../src/config.js';

/**
 * Start the backend on a random port with quiet logging and a throwaway data dir.
 * @param {Record<string, string>} [env] extra environment overrides
 */
export async function startBackend(env = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'likeabosch-test-'));
  const config = loadConfig({ PORT: '0', LOG_LEVEL: 'silent', DICENTIS_AUTOCONNECT: 'false', DATA_DIR: dataDir, ...env });
  const backend = await start(config);
  return {
    ...backend,
    dataDir,
    close: async () => {
      await backend.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Start a backend that auto-connects to the given wired mock and wait until the initial sync is done.
 * @param {{ port: number }} mock
 */
export async function startConnectedBackend(mock) {
  const backend = await startBackend({
    DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(mock.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin',
    DICENTIS_AUTOCONNECT: 'true',
  });
  const { manager, bridge } = backend.services;
  if (manager.client?.state !== 'loggedIn') await once(manager.client, 'loggedIn');
  await bridge.idle();
  return backend;
}
