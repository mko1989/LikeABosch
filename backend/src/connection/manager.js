// Connection management (WO-013): owns the DICENTIS settings and the active client.
// Settings precedence: environment (pinned, read-only) > data/settings.json (saved via API) > defaults.
// Secrets (password, dcn bridgeToken) are never written to disk (DEC-008); they come from env or the settings API (memory only).
import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../lib/errors.js';
import { DEFAULT_PORTS, SYSTEMS } from '../config.js';
import { WiredClient } from '../wired/client.js';
import { WirelessClient } from '../wireless/client.js';
import { DcnClient } from '../dcn/client.js';
import { DcnSmdClient } from '../dcn-smd/client.js';
import { DcnmClient } from '../dcnm/client.js';
import { startSimulator, validProfile } from '../simulation/simulator.js';

const FIELDS = {
  system: v => SYSTEMS.includes(v),
  host: v => typeof v === 'string',
  port: v => Number.isInteger(v) && v > 0 && v < 65536,
  user: v => typeof v === 'string',
  password: v => typeof v === 'string',
  tlsInsecure: v => typeof v === 'boolean',
  autoConnect: v => typeof v === 'boolean',
  dcnServer: v => typeof v === 'string' && /^tcp:\/\/[^\s:/]+:\d+\/?$/.test(v),
  bridgeToken: v => typeof v === 'string',
  smdStream: v => typeof v === 'boolean',
  smdHost: v => typeof v === 'string',
  smdPort: v => Number.isInteger(v) && v > 0 && v < 65536,
  dcnmBridge: v => typeof v === 'boolean',
  dcnmHost: v => typeof v === 'string' && v.length <= 253,
  dcnmPort: v => Number.isInteger(v) && v > 0 && v < 65536,
  dcnmDevice: v => typeof v === 'string' && v.length <= 100,
  dcnmServer: v => typeof v === 'string' && v.length <= 253,
  // Simulation (WO-095, DEC-026): profiles of simulated systems, and the one to connect to instead ('' = real system).
  simulators: v => Array.isArray(v) && v.length <= 50 && v.every(validProfile) && new Set(v.map(p => p.id)).size === v.length,
  simulate: v => typeof v === 'string',
};
const SECRETS = new Set(['password', 'bridgeToken']);
/** Names of the profiles the launcher's simulation option creates (WO-098); the operator may rename them. */
const LAUNCHER_SIM_NAME = { wired: 'DICENTIS demo', wireless: 'DICENTIS Wireless demo', dcn: 'DCN demo', 'dcn-smd': 'DCN meeting data demo' };

/**
 * @typedef {import('../config.js').DicentisConfig} Settings
 * Events: `status` (status) whenever connection state or settings change.
 */
export class ConnectionManager extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('../config.js').Config} deps.config
   * @param {import('../wired/events.js').WiredEventBridge} deps.bridge
   * @param {import('../wireless/poller.js').WirelessPoller} deps.poller
   * @param {import('../dcn/events.js').DcnEventBridge} [deps.dcnEvents]
   * @param {import('../dcn-smd/sync.js').DcnSmdSync} [deps.dcnSmd]
   * @param {import('../dcnm/mirror.js').DcnmMirror} [deps.dcnmMirror]
   * @param {import('../state/cache.js').StateCache} deps.cache
   * @param {ReturnType<import('../lib/logger.js').createLogger>} deps.log
   */
  constructor({ config, bridge, poller, dcnEvents, dcnSmd, dcnmMirror, cache, log }) {
    super();
    this.dcnmMirror = dcnmMirror;
    this.bridge = bridge;
    this.poller = poller;
    this.dcnEvents = dcnEvents;
    this.dcnSmd = dcnSmd;
    this.cache = cache;
    this.log = log;
    this.pinned = new Set(config.pinned);
    this.envSettings = config.dicentis;
    /** @type {Settings} */
    this.settings = { ...config.dicentis };
    this.file = join(config.dataDir, 'settings.json');
    /** @type {WiredClient | WirelessClient | DcnClient | DcnSmdClient | null} */
    this.client = null;
    /** dcn only: the meeting data stream next to the bridge (DEC-020); secondary, never fails the main connection */
    /** @type {DcnSmdClient | null} */
    this.streamClient = null;
    /** wired only: the dicentis-bridge for the full DCNM API next to the Conference Protocol (DEC-021); secondary */
    /** @type {DcnmClient | null} */
    this.dcnmClient = null;
    this.connectedSince = null;
    /** Running simulated system (DEC-026): { profile, settings, close } | null */
    this.sim = null;
    /** Simulation chosen in the launcher (WO-098): { type, seats } | null */
    this.launcherSim = config.launcherSimulation ?? null;
  }

  /** The system type in use: the simulated one while simulating, else the configured one. */
  get system() { return this.sim?.profile.type ?? this.settings.system; }

  /** The simulation profile `simulate` points at, or null. */
  get simProfile() {
    const id = this.settings.simulate;
    return id ? (this.settings.simulators ?? []).find(p => p.id === id) ?? null : null;
  }

  /** Load saved settings (non-pinned fields only). Call once at startup. */
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      for (const [k, v] of Object.entries(saved)) {
        if (k in FIELDS && !SECRETS.has(k) && !this.pinned.has(k) && FIELDS[k](v)) this.settings[k] = v;
      }
      // The launcher pins the system, so a saved port may belong to the system used before (WO-069): keep the
      // default of the current system then. Files without portSystem: another system's default port is not kept.
      const portSystem = saved.portSystem
        ?? Object.keys(DEFAULT_PORTS).find(sys => DEFAULT_PORTS[sys] === saved.port && sys !== this.settings.system);
      if (!this.pinned.has('port') && 'port' in saved && portSystem && portSystem !== this.settings.system) {
        this.settings.port = DEFAULT_PORTS[this.settings.system];
        this.log.info(`saved port ${saved.port} was for ${portSystem}; using ${this.settings.port} for ${this.settings.system}`);
      }
      this.log.info(`loaded settings from ${this.file}`);
    } catch (err) {
      if (err.code !== 'ENOENT') this.log.warn(`cannot read ${this.file}: ${err.message}`);
    }
    await this.#applyLauncherSimulation();
  }

  /**
   * WO-098: the launcher's simulation option. Creates/updates the profile `launcher-<type>` and simulates it; without the
   * option, a launcher simulation left over from an earlier start is switched off. Not pinned (DEC-026 §1).
   */
  async #applyLauncherSimulation() {
    const sims = this.settings.simulators ?? [];
    const want = this.launcherSim;
    if (!want) {
      if (!this.settings.simulate?.startsWith('launcher-')) return;
      this.settings.simulate = '';
      this.log.info('launcher simulation switched off: using the configured system');
      return this.#persist();
    }
    const id = `launcher-${want.type}`;
    const old = sims.find(p => p.id === id);
    const profile = { id, name: old?.name ?? LAUNCHER_SIM_NAME[want.type], type: want.type, seats: want.seats, ...(old?.fullApi === false ? { fullApi: false } : {}) };
    this.settings.simulators = old ? sims.map(p => (p.id === id ? profile : p)) : [...sims, profile].slice(-50);
    this.settings.simulate = id;
    this.log.info(`launcher: simulating ${want.type} with ${want.seats} seats ("${profile.name}")`);
    await this.#persist();
  }

  /** Write the non-secret, non-pinned settings to settings.json. */
  async #persist() {
    const toSave = Object.fromEntries(Object.entries(this.settings)
      .filter(([k]) => !SECRETS.has(k) && !this.pinned.has(k)));
    toSave.portSystem = this.settings.system; // the system may be pinned (not saved): see load()
    await mkdir(join(this.file, '..'), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(toSave, null, 2));
    await rename(`${this.file}.tmp`, this.file);
  }

  /** Settings as returned over HTTP: never contains the password or the bridge token. */
  publicSettings() {
    const { password, bridgeToken, ...rest } = this.settings;
    return { ...rest, passwordSet: Boolean(password), bridgeTokenSet: Boolean(bridgeToken), pinned: [...this.pinned] };
  }

  status() {
    const state = this.client?.state ?? 'disconnected';
    const eff = this.sim?.settings ?? this.settings;
    return {
      system: this.system,
      host: eff.host,
      port: eff.port,
      simulated: this.sim ? { id: this.sim.profile.id, name: this.sim.profile.name, seats: this.sim.profile.seats } : null,
      user: this.settings.user,
      state,
      connectedSince: state === 'loggedIn' ? this.connectedSince : null,
      lastError: this.client?.lastError
        ? { code: this.client.lastError.code, message: this.client.lastError.message, reason: this.client.lastError.extra?.reason ?? null }
        : null,
      permissions: this.client instanceof DcnClient
        ? Object.entries({ ...this.client.bridgeStatus.control?.allowed, ...this.client.bridgeStatus.config?.allowed }).filter(([, v]) => v).map(([k]) => k)
        : /** @type {any} */ (this.cache.get('permissions')?.data)?.permissions ?? [],
      stream: this.streamClient ? {
        host: this.streamClient.options?.host ?? null, port: this.streamClient.options?.port ?? null, state: this.streamClient.state,
        lastError: this.streamClient.lastError ? { code: this.streamClient.lastError.code, message: this.streamClient.lastError.message } : null,
      } : null,
      dcnm: this.dcnmClient ? {
        host: this.dcnmClient.options.host, port: this.dcnmClient.options.port, state: this.dcnmClient.state,
        device: this.dcnmClient.connection?.device ?? null, enabled: this.dcnmClient.connection?.enabled ?? null,
        bridge: this.dcnmClient.bridgeInfo ? { version: this.dcnmClient.bridgeInfo.version, apiVersion: this.dcnmClient.bridgeInfo.apiVersion, fake: this.dcnmClient.bridgeInfo.fake } : null,
        lastError: this.dcnmClient.lastError ? { code: this.dcnmClient.lastError.code, message: this.dcnmClient.lastError.message } : null,
      } : null,
    };
  }

  /**
   * Validate and apply a settings patch. Persists non-secret, non-pinned fields.
   * Takes effect on the next connect().
   * @param {Partial<Settings>} patch
   */
  async updateSettings(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new AppError('VALIDATION', 'Settings must be a JSON object');
    const details = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in FIELDS)) details.push(`${k}: unknown setting`);
      else if (this.pinned.has(k)) details.push(`${k}: set by the environment (launcher/.env) and cannot be changed here`);
      else if (!FIELDS[k](v)) details.push(`${k}: invalid value`);
    }
    if (details.length) throw new AppError('VALIDATION', 'Invalid settings', { details });

    const systemChanged = patch.system && patch.system !== this.settings.system;
    Object.assign(this.settings, patch);
    if (systemChanged && !('port' in patch) && !this.pinned.has('port')) this.settings.port = DEFAULT_PORTS[this.settings.system];
    await this.#persist();
    this.emit('status', this.status());
    return this.publicSettings();
  }

  /** The active client if it is a wired one (for the wired passthrough). */
  get wiredClient() { return this.client instanceof WiredClient ? this.client : null; }

  /** The active client if it is a wireless one (for the wireless passthrough). */
  get wirelessClient() { return this.client instanceof WirelessClient ? this.client : null; }

  /** The active client if it is a DCN one (for the DCN passthrough). */
  get dcnClient() { return this.client instanceof DcnClient ? this.client : null; }

  /** The active client if it reads DCN Streaming Meeting Data (read-only, DEC-018). */
  get dcnSmdClient() { return this.client instanceof DcnSmdClient ? this.client : null; }

  /**
   * (Re)connect with the current settings. Resolves with status; rejects with the connect error.
   * @param {{ override?: boolean }} [options]  wireless: take over a session of the same user (login 409)
   */
  async connect({ override = false } = {}) {
    if (this.settings.simulate && !this.simProfile) throw new AppError('VALIDATION', 'The selected simulated system does not exist any more');
    await this.disconnect();
    const profile = this.simProfile;
    if (profile) {
      const started = await startSimulator(profile);
      this.sim = { profile: { ...profile }, settings: { ...this.settings, ...started.settings }, close: started.close };
      this.log.info(`simulating ${profile.type} system "${profile.name}" (${profile.seats} seats) on 127.0.0.1:${started.settings.port}`);
    }
    const s = this.sim?.settings ?? this.settings;
    if (!s.host) throw new AppError('VALIDATION', 'Host is not configured');
    // The SWSMD stream has no login: the DCN-SW server allows clients by IP address.
    if (!s.user && s.system !== 'dcn-smd') throw new AppError('VALIDATION', 'User is not configured');

    const client = s.system === 'wireless' ? new WirelessClient({ ...s, override, log: this.log.child('wireless') })
      : s.system === 'dcn' ? new DcnClient({ ...s, token: s.bridgeToken, log: this.log.child('dcn') })
        : s.system === 'dcn-smd' ? new DcnSmdClient({ host: s.host, port: s.port, log: this.log.child('dcn-smd') })
        : new WiredClient({ ...s, log: this.log.child('wired') });
    this.client = client;
    client.on('state', state => {
      if (state === 'loggedIn') this.connectedSince = new Date().toISOString();
      this.emit('status', this.status());
    });
    if (client instanceof WirelessClient) this.poller.attach(client);
    else if (client instanceof DcnSmdClient) this.dcnSmd?.attach(client);
    else if (client instanceof DcnClient) {
      this.dcnEvents?.attach(client);
      client.on('status', () => this.emit('status', this.status())); // permissions = allowed flags
    } else this.bridge.attach(client);
    await client.connect();
    if (client instanceof DcnClient && s.smdStream) this.#openStream(s);
    if (client instanceof WiredClient && s.dcnmBridge) this.#openDcnm(s);
    return this.status();
  }

  /** wired: the dicentis-bridge for the full DCNM API (DEC-021). Errors only show in status().dcnm. */
  #openDcnm(s) {
    const dcnm = new DcnmClient({
      host: s.dcnmHost || '127.0.0.1', port: s.dcnmPort, token: s.bridgeToken, user: s.user, password: s.password,
      device: s.dcnmDevice, server: s.dcnmServer, log: this.log.child('dcnm'),
    });
    this.dcnmClient = dcnm;
    dcnm.on('state', () => this.emit('status', this.status()));
    dcnm.on('status', () => this.emit('status', this.status()));
    this.dcnmMirror?.attach(dcnm);
    dcnm.connect().catch(err => this.log.warn(`dicentis-bridge: ${err.message} (the Conference Protocol connection is not affected)`));
  }

  /** dcn: the meeting data stream for live data the bridge lacks (DEC-020). Errors only show in status().stream. */
  #openStream(s) {
    const stream = new DcnSmdClient({ host: s.smdHost || s.host, port: s.smdPort, log: this.log.child('dcn-smd') });
    this.streamClient = stream;
    stream.on('state', () => this.emit('status', this.status()));
    this.dcnSmd?.attach(stream);
    stream.connect().catch(err => this.log.warn(`meeting data stream: ${err.message} (keeps retrying; the bridge is not affected)`));
  }

  /** Close the connection and clear cached state. */
  async disconnect() {
    const client = this.client;
    const sim = this.sim;
    if (!client) {
      if (sim) { this.sim = null; await sim.close().catch(() => {}); }
      return this.status();
    }
    this.bridge.detach();
    this.poller.detach();
    this.dcnEvents?.detach();
    this.dcnSmd?.detach();
    this.client = null;
    const stream = this.streamClient;
    this.streamClient = null;
    if (stream) { await stream.close(); stream.removeAllListeners('state'); }
    const dcnm = this.dcnmClient;
    this.dcnmClient = null;
    this.dcnmMirror?.detach();
    if (dcnm) { await dcnm.close(); dcnm.removeAllListeners('state'); dcnm.removeAllListeners('status'); }
    await client.close();
    client.removeAllListeners('state');
    client.removeAllListeners('status');
    if (sim) { this.sim = null; await sim.close().catch(err => this.log.warn(`simulator: ${err.message}`)); }
    this.cache.clear();
    this.connectedSince = null;
    this.emit('status', this.status());
    return this.status();
  }

  /** Auto-connect at startup if configured; failures are logged and retried by the client. */
  async start() {
    await this.load();
    // The launcher's simulation always connects: it has no login and nothing else to wait for (WO-098).
    if ((this.launcherSim && this.simProfile) || this.settings.autoConnect && (this.simProfile || (this.settings.host && (this.settings.user || this.settings.system === 'dcn-smd')))) {
      this.connect().catch(err => this.log.warn(`auto-connect failed: ${err.message}`));
    }
  }
}
