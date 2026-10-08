// Launcher settings: non-secret fields as JSON, password and DCN bridge token encrypted via an injected encryptor
// (Electron safeStorage in production, a fake in tests). DEC-008, DEC-017, DEC-021, DEC-022.
import { readFile, writeFile, rm, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_SETTINGS = {
  system: 'wired',
  host: '',
  port: null,          // null = system default (31416 wired / 80 wireless / 9480 dcn bridge / 20000 dcn-smd)
  user: '',
  dcnServer: '',       // dcn: DCN-SW server as seen from the bridge; '' = backend default tcp://localhost:9461
  smdStream: true,     // dcn: also read the meeting data stream for live data (DEC-020)
  smdHost: '',         // dcn: host of the stream; '' = the bridge host
  smdPort: null,       // dcn: port of the stream; null = 20000
  dcnmBridge: false,   // wired: also use the full DICENTIS API through the dicentis-bridge (DEC-021)
  dcnmHost: '',        // wired: dicentis-bridge host; '' = this PC (the launcher starts it on Windows, DEC-022)
  dcnmPort: null,      // wired: dicentis-bridge port; null = 9481
  dcnmDevice: 'LikeABosch', // wired: device name the bridge connects as ('' = not as a device)
  dcnmServer: '',      // wired: DICENTIS server for the API's OpenAsync; '' = the API finds it
  manageBridges: true, // Windows: start the bridge the settings need on this PC (DEC-022)
  dcnBridgeDllDir: '', // dcn-bridge --dll-dir; '' = its own search (DCN-SW folder)
  dcnmDllDir: '',      // dicentis-bridge --dll-dir; '' = its own search (Program Files\Bosch\DICENTIS)
  dcnBridgeExe: '',    // path of dcn-bridge.exe; '' = bundled / build output
  dcnmExe: '',         // path of dicentis-bridge.exe; '' = bundled / build output
  simulate: '',        // WO-098: '' = the real system below, else a system type to simulate (no hardware, DEC-026)
  simulateSeats: 20,   // seats of that simulated system
  tlsInsecure: true,
  autoConnect: true,
  webPort: 3000,
  lanAccess: false,    // false = UI only on this machine (BIND_HOST 127.0.0.1)
};

const VALIDATORS = {
  system: v => ['wired', 'wireless', 'dcn', 'dcn-smd'].includes(v),
  host: v => typeof v === 'string' && v.length <= 253,
  port: v => v === null || (Number.isInteger(v) && v > 0 && v < 65536),
  user: v => typeof v === 'string',
  dcnServer: v => v === '' || (typeof v === 'string' && /^tcp:\/\/[^\s:/]+:\d+\/?$/.test(v)),
  smdStream: v => typeof v === 'boolean',
  smdHost: v => typeof v === 'string' && v.length <= 253,
  smdPort: v => v === null || (Number.isInteger(v) && v > 0 && v < 65536),
  dcnmBridge: v => typeof v === 'boolean',
  dcnmHost: v => typeof v === 'string' && v.length <= 253,
  dcnmPort: v => v === null || (Number.isInteger(v) && v > 0 && v < 65536),
  dcnmDevice: v => typeof v === 'string' && v.length <= 100,
  dcnmServer: v => typeof v === 'string' && v.length <= 253,
  manageBridges: v => typeof v === 'boolean',
  dcnBridgeDllDir: v => typeof v === 'string' && v.length <= 1024,
  dcnmDllDir: v => typeof v === 'string' && v.length <= 1024,
  dcnBridgeExe: v => typeof v === 'string' && v.length <= 1024,
  dcnmExe: v => typeof v === 'string' && v.length <= 1024,
  simulate: v => ['', 'wired', 'wireless', 'dcn', 'dcn-smd'].includes(v),
  simulateSeats: v => Number.isInteger(v) && v >= 1 && v <= 500,
  tlsInsecure: v => typeof v === 'boolean',
  autoConnect: v => typeof v === 'boolean',
  webPort: v => Number.isInteger(v) && v > 0 && v < 65536,
  lanAccess: v => typeof v === 'boolean',
};

/**
 * @typedef {{ isAvailable(): boolean, encrypt(text: string): Buffer, decrypt(buf: Buffer): string }} Encryptor
 * @param {{ dir: string, encryptor: Encryptor }} options
 */
export function createSettingsStore({ dir, encryptor }) {
  const settingsFile = join(dir, 'launcher-settings.json');
  const passwordFile = join(dir, 'dicentis-password.bin');
  const tokenFile = join(dir, 'dcn-bridge-token.bin');

  async function load() {
    let saved = {};
    try { saved = JSON.parse(await readFile(settingsFile, 'utf8')); } catch { /* first run */ }
    const settings = { ...DEFAULT_SETTINGS };
    for (const [k, v] of Object.entries(saved)) if (k in VALIDATORS && VALIDATORS[k](v)) settings[k] = v;
    return settings;
  }

  async function loadSecret(file) {
    if (!encryptor.isAvailable()) return '';
    try { return encryptor.decrypt(await readFile(file)); } catch { return ''; }
  }
  const loadPassword = () => loadSecret(passwordFile);
  const loadBridgeToken = () => loadSecret(tokenFile);

  /** undefined = keep, '' = clear, else store encrypted. Returns an error message or null. */
  async function saveSecret(file, value, name) {
    if (value === '') await rm(file, { force: true });
    else if (value !== undefined) {
      if (!encryptor.isAvailable()) return `${name}: secure storage is not available on this system; it will not be remembered`;
      await writeFile(file, encryptor.encrypt(value));
    }
    return null;
  }

  return {
    load,
    loadPassword,
    loadBridgeToken,
    /** For the renderer: settings + secret status, never the secrets themselves. */
    async describe() {
      return {
        settings: await load(),
        passwordSet: Boolean(await loadPassword()),
        bridgeTokenSet: Boolean(await loadBridgeToken()),
        encryptionAvailable: encryptor.isAvailable(),
      };
    },
    /**
     * @param {Partial<typeof DEFAULT_SETTINGS>} patch
     * @param {string | undefined} password  undefined = keep, '' = clear
     * @param {string | undefined} [bridgeToken]  dcn bridge token, same semantics
     * @returns {Promise<{ errors: string[] }>}
     */
    async save(patch, password, bridgeToken) {
      const errors = Object.entries(patch ?? {})
        .filter(([k, v]) => !(k in VALIDATORS) || !VALIDATORS[k](v))
        .map(([k]) => `${k}: invalid value`);
      if (password !== undefined && typeof password !== 'string') errors.push('password: invalid value');
      if (bridgeToken !== undefined && typeof bridgeToken !== 'string') errors.push('bridgeToken: invalid value');
      if (errors.length) return { errors };
      await mkdir(dir, { recursive: true });
      const next = { ...(await load()), ...patch };
      await writeFile(`${settingsFile}.tmp`, JSON.stringify(next, null, 2));
      await rename(`${settingsFile}.tmp`, settingsFile);
      const secretErrors = [await saveSecret(passwordFile, password, 'password'), await saveSecret(tokenFile, bridgeToken, 'bridge token')].filter(Boolean);
      return { errors: secretErrors };
    },
  };
}

/**
 * Environment for the backend child process. Only non-empty connection fields are passed, so they become
 * "pinned" in the web UI; empty fields stay editable there (WO-013).
 * @param {typeof DEFAULT_SETTINGS} settings
 * @param {string} password
 * @param {string} [dataDir]  only for tests: without it the backend uses the shared per-user folder (DEC-016)
 * @param {string} [bridgeToken]  dcn bridge token
 */
export function backendEnv(settings, password, dataDir, bridgeToken = '') {
  const env = {
    PORT: String(settings.webPort),
    BIND_HOST: settings.lanAccess ? '0.0.0.0' : '127.0.0.1',
    ...(dataDir ? { DATA_DIR: dataDir } : {}),
    LOG_LEVEL: 'info',
    DICENTIS_SYSTEM: settings.system,
    DICENTIS_TLS_INSECURE: String(settings.tlsInsecure),
    DICENTIS_AUTOCONNECT: String(settings.autoConnect),
  };
  if (settings.simulate) env.LIKEABOSCH_SIMULATE = `${settings.simulate}:${settings.simulateSeats ?? 20}`; // WO-098
  if (settings.host) env.DICENTIS_HOST = settings.host;
  if (settings.port) env.DICENTIS_PORT = String(settings.port);
  if (settings.user) env.DICENTIS_USER = settings.user;
  if (password) env.DICENTIS_PASSWORD = password;
  if (settings.system === 'wired' && settings.dcnmBridge) {
    env.DICENTIS_DCNM_BRIDGE = 'true';
    env.DICENTIS_DCNM_HOST = settings.dcnmHost || '127.0.0.1';
    if (settings.dcnmPort) env.DICENTIS_DCNM_PORT = String(settings.dcnmPort);
    env.DICENTIS_DCNM_DEVICE = settings.dcnmDevice ?? '';
    if (settings.dcnmServer) env.DICENTIS_DCNM_SERVER = settings.dcnmServer;
    if (bridgeToken) env.DICENTIS_BRIDGE_TOKEN = bridgeToken;
  }
  if (settings.system === 'dcn') {
    if (settings.dcnServer) env.DICENTIS_DCN_SERVER = settings.dcnServer;
    if (bridgeToken) env.DICENTIS_BRIDGE_TOKEN = bridgeToken;
    env.DICENTIS_SMD_STREAM = String(settings.smdStream);
    if (settings.smdHost) env.DICENTIS_SMD_HOST = settings.smdHost;
    if (settings.smdPort) env.DICENTIS_SMD_PORT = String(settings.smdPort);
  }
  return env;
}
