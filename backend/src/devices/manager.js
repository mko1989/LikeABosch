// Device manager (WO-038, DEC-012): camera + switcher configuration, connections, control.
// Config: <dataDir>/devices.json (mode 0600; camera passwords are stored there so automation works after a restart,
// but never returned by the API). Status is published to the state cache as `devices.cameras` / `devices.switcher`.
import { EventEmitter } from 'node:events';
import { readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../lib/errors.js';
import { createCamera, CAMERA_DRIVERS } from './cameras/index.js';
import { createSwitcher, SWITCHER_DRIVERS } from './switchers/index.js';

const RETRY_MS = 10_000;

const CAMERA_FIELDS = {
  name: v => typeof v === 'string' && v.trim().length > 0 && v.length <= 60,
  driver: v => v in CAMERA_DRIVERS,
  host: v => typeof v === 'string',
  port: v => v === null || (Number.isInteger(v) && v > 0 && v < 65536),
  transport: v => v === 'udp' || v === 'tcp',
  framing: v => v === 'sony' || v === 'raw',
  address: v => Number.isInteger(v) && v >= 1 && v <= 7,
  username: v => typeof v === 'string',
  password: v => typeof v === 'string',
  switcherInput: v => v === null || (Number.isInteger(v) && v >= 0),
  automation: v => typeof v === 'boolean', // DEC-015: false = the director leaves this camera alone
};
const SWITCHER_FIELDS = {
  driver: v => v in SWITCHER_DRIVERS,
  host: v => typeof v === 'string',
  port: v => v === null || (Number.isInteger(v) && v > 0 && v < 65536),
  me: v => Number.isInteger(v) && v >= 0 && v <= 3,
  automation: v => typeof v === 'boolean', // DEC-015: false = the director never cuts
};
const SWITCHER_CONNECTION = ['driver', 'host', 'port', 'me'];
// Bitfocus Companion (WO-099, DEC-027): where to send button presses; rows/cols only size the picker grid.
const COMPANION_FIELDS = {
  host: v => typeof v === 'string' && v.trim().length > 0 && v.length <= 253,
  port: v => v === null || (Number.isInteger(v) && v > 0 && v < 65536),
  enabled: v => typeof v === 'boolean',
  rows: v => Number.isInteger(v) && v >= 1 && v <= 32,
  cols: v => Number.isInteger(v) && v >= 1 && v <= 32,
};
export const DEFAULT_COMPANION = { port: 8000, enabled: true, rows: 4, cols: 8 };

function validate(fields, patch, { requireAll = [] } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new AppError('VALIDATION', 'Body must be a JSON object');
  const details = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in fields)) details.push(`${k}: unknown field`);
    else if (!fields[k](v)) details.push(`${k}: invalid value`);
  }
  for (const k of requireAll) if (patch[k] === undefined) details.push(`${k}: required`);
  if (details.length) throw new AppError('VALIDATION', 'Invalid device settings', { details });
}

/**
 * Cameras + switcher from an imported project file (DEC-016 §6): unknown fields and invalid devices dropped,
 * camera ids kept (seat shots refer to them).
 * @param {any} raw
 */
export function sanitizeDevices(raw) {
  const pick = (fields, o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => k in fields && fields[k](v)));
  const cameras = [];
  const seen = new Set();
  for (const c of Array.isArray(raw?.cameras) ? raw.cameras : []) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !/^[\w-]{1,40}$/.test(c.id) || seen.has(c.id)) continue;
    const config = pick(CAMERA_FIELDS, c);
    if (!config.name || !config.driver) continue;
    seen.add(c.id);
    cameras.push({ id: c.id, switcherInput: null, ...config });
  }
  const sw = raw?.switcher && typeof raw.switcher === 'object' ? pick(SWITCHER_FIELDS, raw.switcher) : null;
  const companion = raw?.companion && typeof raw.companion === 'object' ? pick(COMPANION_FIELDS, raw.companion) : null;
  return { version: 1, cameras, switcher: sw?.driver ? { me: 0, ...sw } : null, companion: companion?.host ? { ...DEFAULT_COMPANION, ...companion } : null };
}

export class DeviceManager extends EventEmitter {
  /**
   * @param {{ dataDir: string, cache: import('../state/cache.js').StateCache, log: any, retryMs?: number }} deps
   */
  constructor({ dataDir, cache, log, retryMs = RETRY_MS }) {
    super();
    this.file = join(dataDir, 'devices.json');
    this.cache = cache;
    this.log = log;
    this.retryMs = retryMs;
    /** id → { config, driver, timer } */
    this.cameras = new Map();
    /** { config, driver, timer } | null */
    this.switcher = null;
    /** Companion target (WO-099): { host, port, enabled, rows, cols } | null */
    this.companion = null;
    this.nextId = 1;
    /** @type {(() => void) | null} called after every save (projects: updatedAt, DEC-016) */
    this.onSaved = null;
  }

  /** Switch to another folder (a project, DEC-016): disconnect everything, then load and connect that folder's devices. */
  async open(dir) {
    await this.saving;
    await this.close();
    this.cameras = new Map();
    this.switcher = null;
    this.companion = null;
    this.nextId = 1;
    this.file = join(dir, 'devices.json');
    await this.start();
  }

  /** Resolves when all pending saves are on disk. */
  flush() { return this.saving ?? Promise.resolve(); }

  async start() {
    let saved = { cameras: [], switcher: null };
    try { saved = JSON.parse(await readFile(this.file, 'utf8')); } catch (err) { if (err.code !== 'ENOENT') this.log.warn(`cannot read ${this.file}: ${err.message}`); }
    for (const c of saved.cameras ?? []) {
      this.cameras.set(c.id, { config: c });
      this.nextId = Math.max(this.nextId, Number(String(c.id).replace(/\D/g, '')) + 1 || this.nextId);
    }
    if (saved.switcher) this.switcher = { config: saved.switcher };
    if (saved.companion?.host) this.companion = { ...DEFAULT_COMPANION, ...saved.companion };
    for (const id of this.cameras.keys()) this.#connectCamera(id);
    if (this.switcher) this.#connectSwitcher();
    this.#publish();
    this.emit('companion', this.companion);
  }

  // ------------------------------------------------------------- persistence + status

  #save() {
    // Serialise writes: concurrent saves would race on the temp file.
    const run = () => this.#write();
    const p = (this.saving ?? Promise.resolve()).then(run, run);
    this.saving = p.catch(() => {});
    return p;
  }

  async #write() {
    const data = { version: 1, cameras: [...this.cameras.values()].map(c => c.config), switcher: this.switcher?.config ?? null, companion: this.companion };
    await mkdir(join(this.file, '..'), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
    await chmod(this.file, 0o600).catch(() => {});
    this.onSaved?.();
  }

  #publicCamera({ config, driver, currentPreset }) {
    const { password, ...rest } = config;
    return { ...rest, automation: config.automation !== false, passwordSet: Boolean(password), status: driver?.status() ?? { connected: false, lastError: null }, currentPreset: currentPreset ?? null };
  }

  publicCameras() { return [...this.cameras.values()].map(c => this.#publicCamera(c)); }

  publicSwitcher() {
    if (!this.switcher) return null;
    return { ...this.switcher.config, automation: this.switcher.config.automation !== false, status: this.switcher.driver?.status() ?? { connected: false, lastError: null } };
  }

  #publish() {
    this.cache.set('devices.cameras', { cameras: this.publicCameras() });
    this.cache.set('devices.switcher', { switcher: this.publicSwitcher() });
    this.emit('changed');
  }

  // ------------------------------------------------------------- connections

  async #connectCamera(id) {
    const entry = this.cameras.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    await entry.driver?.close().catch(() => {});
    const driver = createCamera(entry.config);
    entry.driver = driver;
    driver.on('status', () => this.#publish());
    try {
      await driver.connect();
      this.log.info(`camera ${entry.config.name} (${entry.config.driver}) connected`);
    } catch (err) {
      driver.lastError = err.message;
      this.log.warn(`camera ${entry.config.name}: ${err.message}; retrying in ${this.retryMs / 1000} s`);
      entry.timer = setTimeout(() => this.#connectCamera(id), this.retryMs);
      entry.timer.unref?.();
    }
    this.#publish();
  }

  async #connectSwitcher() {
    const entry = this.switcher;
    if (!entry) return;
    clearTimeout(entry.timer);
    await entry.driver?.close().catch(() => {});
    const driver = createSwitcher(entry.config);
    entry.driver = driver;
    driver.on('status', () => this.#publish());
    driver.on('program', p => this.emit('program', p));
    try {
      await driver.connect();
      this.log.info(`switcher (${entry.config.driver}) connected`);
    } catch (err) {
      driver.lastError = err.message;
      this.log.warn(`switcher: ${err.message}; retrying in ${this.retryMs / 1000} s`);
      entry.timer = setTimeout(() => this.#connectSwitcher(), this.retryMs);
      entry.timer.unref?.();
    }
    this.#publish();
  }

  // ------------------------------------------------------------- camera CRUD

  async addCamera(config) {
    validate(CAMERA_FIELDS, config, { requireAll: ['name', 'driver'] });
    if (config.driver !== 'mock' && !config.host) throw new AppError('VALIDATION', 'Invalid device settings', { details: ['host: required'] });
    const id = `cam-${this.nextId++}`;
    this.cameras.set(id, { config: { id, switcherInput: null, ...config } });
    await this.#save();
    await this.#connectCamera(id);
    return this.#publicCamera(this.cameras.get(id));
  }

  async updateCamera(id, patch) {
    const entry = this.#camera(id);
    validate(CAMERA_FIELDS, patch);
    entry.config = { ...entry.config, ...patch };
    await this.#save();
    const connectionFields = ['driver', 'host', 'port', 'transport', 'framing', 'address', 'username', 'password'];
    if (Object.keys(patch).some(k => connectionFields.includes(k))) await this.#connectCamera(id);
    else this.#publish();
    return this.#publicCamera(entry);
  }

  /** Remove every camera, the switcher and the Companion target (WO-091 "Clear…" of a project). */
  async clearAll() {
    for (const id of [...this.cameras.keys()]) await this.removeCamera(id);
    if (this.switcher) await this.setSwitcher(null);
    if (this.companion) await this.setCompanion(null);
  }

  async removeCamera(id) {
    const entry = this.#camera(id);
    clearTimeout(entry.timer);
    await entry.driver?.close().catch(() => {});
    this.cameras.delete(id);
    await this.#save();
    this.#publish();
  }

  #camera(id) {
    const entry = this.cameras.get(id);
    if (!entry) throw new AppError('NOT_FOUND', `Unknown camera '${id}'`);
    return entry;
  }

  /** Connected driver of a camera (throws NOT_CONNECTED otherwise). */
  driver(id) {
    const entry = this.#camera(id);
    if (!entry.driver?.connected) throw new AppError('NOT_CONNECTED', `Camera '${entry.config.name}' is not connected`);
    return entry.driver;
  }

  cameraConfig(id) { return this.#camera(id).config; }

  /** DEC-015: may the director use this camera automatically? (unknown camera = no) */
  cameraAutomation(id) { const c = this.cameras.get(id); return Boolean(c) && c.config.automation !== false; }

  /** DEC-015: may the director cut the switcher automatically? */
  get switcherAutomation() { return this.switcher?.config.automation !== false; }

  // currentPreset (WO-054): the preset last recalled/stored through LikeABosch (incl. the director); `modified` once the
  // camera was jogged since, so the operator can overwrite that preset with the adjusted position.
  async recall(id, preset) {
    const r = await this.driver(id).recallPreset(preset);
    this.#camera(id).currentPreset = { preset, modified: false };
    this.#publish();
    return r;
  }
  async store(id, preset, name) {
    const stored = await this.driver(id).storePreset(preset, name);
    const entry = this.#camera(id);
    if (stored !== undefined && stored !== null) { entry.currentPreset = { preset: stored, modified: false }; this.#publish(); }
    return stored;
  }
  async move(id, v) {
    const r = await this.driver(id).move(v);
    const entry = this.#camera(id);
    if (entry.currentPreset && !entry.currentPreset.modified && (v?.pan || v?.tilt || v?.zoom)) {
      entry.currentPreset = { ...entry.currentPreset, modified: true };
      this.#publish();
    }
    return r;
  }
  async stop(id) { return this.driver(id).stop(); }
  async presets(id) { return this.driver(id).listPresets(); }
  async test(id) {
    const entry = this.#camera(id);
    if (!entry.driver?.connected) { await this.#connectCamera(id); }
    return { status: entry.driver.status(), power: entry.driver.connected ? await entry.driver.ping() : null };
  }

  // ------------------------------------------------------------- switcher

  async setSwitcher(config) {
    if (config === null) {
      await this.switcher?.driver?.close().catch(() => {});
      clearTimeout(this.switcher?.timer);
      this.switcher = null;
      await this.#save();
      this.#publish();
      return null;
    }
    validate(SWITCHER_FIELDS, config, { requireAll: ['driver'] });
    if (config.driver !== 'mock' && !config.host) throw new AppError('VALIDATION', 'Invalid device settings', { details: ['host: required'] });
    this.switcher = { ...this.switcher, config: { me: 0, ...this.switcher?.config, ...config } };
    await this.#save();
    await this.#connectSwitcher();
    return this.publicSwitcher();
  }

  /** Partial switcher update (DEC-015): reconnects only when a connection field changes. */
  async updateSwitcher(patch) {
    if (!this.switcher) throw new AppError('NOT_FOUND', 'No video switcher configured');
    validate(SWITCHER_FIELDS, patch);
    const reconnect = SWITCHER_CONNECTION.some(k => k in patch && patch[k] !== this.switcher.config[k]);
    this.switcher.config = { ...this.switcher.config, ...patch };
    await this.#save();
    if (reconnect) await this.#connectSwitcher(); else this.#publish();
    return this.publicSwitcher();
  }

  /** Switcher driver if connected, else null (the director skips cuts then). */
  get switcherDriver() { return this.switcher?.driver?.connected ? this.switcher.driver : null; }

  async cut(input) {
    const sw = this.switcherDriver;
    if (!sw) throw new AppError('NOT_CONNECTED', 'Video switcher is not connected');
    await sw.programCut(input);
  }

  async preview(input) {
    const sw = this.switcherDriver;
    if (!sw) throw new AppError('NOT_CONNECTED', 'Video switcher is not connected');
    await sw.previewInput(input);
  }

  // ------------------------------------------------------------- Companion (WO-099, DEC-027)

  /**
   * Set (or with null remove) the Companion target. A partial patch updates the existing one.
   * @param {Partial<typeof DEFAULT_COMPANION & { host: string }> | null} config
   */
  async setCompanion(config) {
    if (config === null) this.companion = null;
    else {
      validate(COMPANION_FIELDS, config, { requireAll: this.companion ? [] : ['host'] });
      this.companion = { ...DEFAULT_COMPANION, ...this.companion, ...config, ...(config.host ? { host: config.host.trim() } : {}) };
    }
    await this.#save();
    this.emit('companion', this.companion);
    return this.companion;
  }

  async close() {
    for (const c of this.cameras.values()) { clearTimeout(c.timer); await c.driver?.close().catch(() => {}); }
    clearTimeout(this.switcher?.timer);
    await this.switcher?.driver?.close().catch(() => {});
  }
}
