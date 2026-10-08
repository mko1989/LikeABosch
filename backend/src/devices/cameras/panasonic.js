// Panasonic AW camera driver over HTTP CGI (WO-036, DEC-012). Reference: docs/protocol/cameras/README.md §2.
import { EventEmitter } from 'node:events';
import { AppError } from '../../lib/errors.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** -1…1 → Panasonic speed value 01…99 (50 = stop). */
const speed = v => String(clamp(Math.round(50 + v * 49), 1, 99)).padStart(2, '0');

export class PanasonicCamera extends EventEmitter {
  /** @param {{ host: string, port?: number, username?: string, password?: string, timeoutMs?: number }} options */
  constructor(options) {
    super();
    this.options = { port: 80, timeoutMs: 3000, ...options };
    this.connected = false;
    this.lastError = null;
  }

  async #command(cmd) {
    const { host, port, username, password, timeoutMs } = this.options;
    const url = `http://${host}:${port}/cgi-bin/aw_ptz?cmd=${encodeURIComponent(cmd)}&res=1`;
    const headers = username ? { authorization: `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}` } : {};
    let res;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      this.lastError = err.message;
      throw new AppError(err.name === 'TimeoutError' ? 'UPSTREAM_TIMEOUT' : 'NOT_CONNECTED', `Panasonic ${host}: ${err.cause?.code ?? err.message}`);
    }
    if (res.status === 401) throw new AppError('UPSTREAM_AUTH', `Panasonic ${host}: authentication failed`);
    const text = (await res.text()).trim();
    if (!res.ok || /^er/i.test(text)) {
      this.lastError = text || `HTTP ${res.status}`;
      throw new AppError('UPSTREAM_ERROR', `Panasonic ${cmd} failed: ${text || res.status}`, { upstream: text });
    }
    return text;
  }

  async connect() {
    await this.ping();
    this.connected = true;
    this.lastError = null;
    this.emit('status', this.status());
  }

  async ping() {
    const r = await this.#command('#O');
    return r === 'p1' ? 'on' : r === 'p0' ? 'standby' : 'unknown';
  }

  #preset(preset) {
    const n = Number(preset);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new AppError('VALIDATION', `Panasonic preset must be 1–100 (got ${preset})`);
    return String(n - 1).padStart(2, '0');
  }

  async recallPreset(preset) {
    await this.#command(`#R${this.#preset(preset)}`);
    return { acknowledged: true, completed: false };
  }

  async storePreset(preset) {
    await this.#command(`#M${this.#preset(preset)}`);
    return Number(preset);
  }

  async move({ pan = 0, tilt = 0, zoom = 0 } = {}) {
    await this.#command(`#PTS${speed(pan)}${speed(tilt)}`);
    await this.#command(`#Z${speed(zoom)}`);
  }

  stop() { return this.move({}); }

  listPresets() { return Promise.resolve(null); }

  status() {
    return { connected: this.connected, driver: 'panasonic', host: this.options.host, port: this.options.port, lastError: this.lastError };
  }

  async close() { this.connected = false; }
}
