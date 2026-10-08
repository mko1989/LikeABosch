// Configuration from environment variables (.env, or passed by the Electron launcher, DEC-008).
// Runtime overrides from the settings API live in data/settings.json (WO-013) and never include the password.

/**
 * @typedef {'wired' | 'wireless' | 'dcn' | 'dcn-smd'} SystemType  dcn = DCN NG via the dcn-bridge (DEC-017); dcn-smd = DCN Streaming Meeting Data (DEC-018)
 * @typedef {object} DicentisConfig
 * @property {SystemType} system
 * @property {string} host        DICENTIS server / WAP / dcn-bridge host
 * @property {number} port
 * @property {string} user
 * @property {string} password
 * @property {boolean} tlsInsecure  accept self-signed certificates (wired)
 * @property {boolean} autoConnect
 * @property {string} dcnServer   dcn: DCN-SW server connection string used by the bridge (IApi.Initialize)
 * @property {string} bridgeToken dcn: shared secret of the dcn-bridge (never written to disk, like the password)
 * @property {boolean} smdStream  dcn: also read the DCN-SW meeting data stream (DEC-020)
 * @property {string} smdHost     dcn: host of that stream, '' = the bridge host
 * @property {number} smdPort     dcn: port of that stream
 * @property {boolean} dcnmBridge  wired: also connect to the dicentis-bridge for the full DCNM API (DEC-021)
 * @property {string} dcnmHost     wired: dicentis-bridge host (default 127.0.0.1: the launcher starts it, DEC-022)
 * @property {number} dcnmPort     wired: dicentis-bridge port
 * @property {string} dcnmDevice   wired: device name the bridge connects as ('' = don't connect as a device)
 * @property {string} dcnmServer   wired: DICENTIS server for the API's OpenAsync ('' = the API's own discovery)
 * @typedef {keyof DicentisConfig} DicentisField
 * @typedef {object} Config
 * @property {number} port          web server port
 * @property {string} bindHost
 * @property {string} logLevel
 * @property {string} dataDir       DATA_DIR, else the shared per-user folder (DEC-016)
 * @property {boolean} dataDirIsDefault  true when DATA_DIR was not set (enables the one-time import of legacy data)
 * @property {DicentisConfig} dicentis
 * @property {DicentisField[]} pinned  DICENTIS fields explicitly set via environment (read-only for the settings API)
 * @property {{ type: SystemType, seats: number } | null} launcherSimulation  LIKEABOSCH_SIMULATE=<type>:<seats> from the
 *           launcher (WO-098): simulate that system at start instead of the configured one
 */

import { defaultDataDir } from './lib/paths.js';

export const DEFAULT_PORTS = { wired: 31416, wireless: 80, dcn: 9480, 'dcn-smd': 20000 };
export const DEFAULT_DCNM_PORT = 9481;
export const SYSTEMS = /** @type {const} */ (['wired', 'wireless', 'dcn', 'dcn-smd']);
export const DEFAULT_DCN_SERVER = 'tcp://localhost:9461';

/** @type {Record<string, string>} DICENTIS field → environment variable */
export const DICENTIS_ENV = {
  system: 'DICENTIS_SYSTEM',
  host: 'DICENTIS_HOST',
  port: 'DICENTIS_PORT',
  user: 'DICENTIS_USER',
  password: 'DICENTIS_PASSWORD',
  tlsInsecure: 'DICENTIS_TLS_INSECURE',
  autoConnect: 'DICENTIS_AUTOCONNECT',
  dcnServer: 'DICENTIS_DCN_SERVER',
  bridgeToken: 'DICENTIS_BRIDGE_TOKEN',
  smdStream: 'DICENTIS_SMD_STREAM',
  smdHost: 'DICENTIS_SMD_HOST',
  smdPort: 'DICENTIS_SMD_PORT',
  dcnmBridge: 'DICENTIS_DCNM_BRIDGE',
  dcnmHost: 'DICENTIS_DCNM_HOST',
  dcnmPort: 'DICENTIS_DCNM_PORT',
  dcnmDevice: 'DICENTIS_DCNM_DEVICE',
  dcnmServer: 'DICENTIS_DCNM_SERVER',
};

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new Error(`Invalid integer in configuration: ${value}`);
  return n;
}

/**
 * LIKEABOSCH_SIMULATE=<type>:<seats> (WO-098). Invalid values are ignored (the real system is used).
 * @param {string | undefined} value
 */
function launcherSimulation(value) {
  const m = /^([a-z-]+):(\d{1,3})$/.exec(value ?? '');
  if (!m || !SYSTEMS.includes(/** @type {any} */ (m[1]))) return null;
  const seats = Number(m[2]);
  return seats >= 1 && seats <= 500 ? { type: /** @type {SystemType} */ (m[1]), seats } : null;
}

/**
 * Build the configuration from an environment object.
 * @param {Record<string, string | undefined>} [env]
 * @returns {Config}
 */
export function loadConfig(env = process.env) {
  const system = SYSTEMS.includes(/** @type {any} */ (env.DICENTIS_SYSTEM)) ? /** @type {SystemType} */ (env.DICENTIS_SYSTEM) : 'wired';
  return {
    port: int(env.PORT, 3000),
    bindHost: env.BIND_HOST || '127.0.0.1',
    logLevel: env.LOG_LEVEL || 'info',
    dataDir: env.DATA_DIR || defaultDataDir(),
    dataDirIsDefault: !env.DATA_DIR,
    dicentis: {
      system,
      host: env.DICENTIS_HOST || '',
      port: int(env.DICENTIS_PORT, DEFAULT_PORTS[system]),
      user: env.DICENTIS_USER || '',
      password: env.DICENTIS_PASSWORD || '',
      tlsInsecure: bool(env.DICENTIS_TLS_INSECURE, true),
      autoConnect: bool(env.DICENTIS_AUTOCONNECT, true),
      dcnServer: env.DICENTIS_DCN_SERVER || DEFAULT_DCN_SERVER,
      bridgeToken: env.DICENTIS_BRIDGE_TOKEN || '',
      smdStream: bool(env.DICENTIS_SMD_STREAM, true),
      smdHost: env.DICENTIS_SMD_HOST || '',
      smdPort: int(env.DICENTIS_SMD_PORT, DEFAULT_PORTS['dcn-smd']),
      dcnmBridge: bool(env.DICENTIS_DCNM_BRIDGE, false),
      dcnmHost: env.DICENTIS_DCNM_HOST || '127.0.0.1',
      dcnmPort: int(env.DICENTIS_DCNM_PORT, DEFAULT_DCNM_PORT),
      dcnmDevice: env.DICENTIS_DCNM_DEVICE ?? 'LikeABosch',
      dcnmServer: env.DICENTIS_DCNM_SERVER || '',
    },
    pinned: /** @type {DicentisField[]} */ (Object.keys(DICENTIS_ENV).filter(f => (env[DICENTIS_ENV[f]] ?? '') !== '')),
    launcherSimulation: launcherSimulation(env.LIKEABOSCH_SIMULATE),
  };
}

/**
 * Copy of the config that is safe to log or return over HTTP (no password).
 * @param {Config} config
 */
export function redactConfig(config) {
  const d = config.dicentis;
  return { ...config, dicentis: { ...d, password: d.password ? '***' : '', bridgeToken: d.bridgeToken ? '***' : '' } };
}
