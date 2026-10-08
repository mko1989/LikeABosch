// DICENTIS DCNM API client (WO-079, DEC-021): one TCP connection to the dicentis-bridge
// (docs/protocol/dcnm-api/BRIDGE.md), which hosts the DICENTIS .NET API on a Windows PC with the DICENTIS software.
// Same state model as the other clients: loggedIn = bridge reachable + API open + user authenticated.
// Connecting as a device (needed for most control functions) is reported in `connection.device` / `enabled`.
import { EventEmitter } from 'node:events';
import { AppError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { BridgeSocket } from '../lib/bridge-socket.js';

export const DCNM_BRIDGE_PROTOCOL = 1;

/**
 * @typedef {'disconnected' | 'connecting' | 'connected' | 'loggedIn' | 'reconnecting'} ClientState
 * @typedef {{ open: boolean, authenticated: boolean, device: string | null, enabled: boolean | null, apiState: string | null }} DcnmConnection
 * @typedef {{ connection?: DcnmConnection, interfaces?: Record<string, Record<string, unknown>> }} DcnmStatus
 * @typedef {object} DcnmClientOptions
 * @property {string} host                 bridge host
 * @property {number} [port]               bridge port (default 9481)
 * @property {string} [token]              bridge token (optional, DEC-019)
 * @property {string} user                 DICENTIS user
 * @property {string} password
 * @property {string} [server]             DICENTIS server for OpenAsync(hostNameOrAddress); '' = the API's own discovery
 * @property {string} [device]             unique device name for ConnectAsDeviceAsync; '' = don't connect as a device
 * @property {number} [requestTimeoutMs]   default 30000 (calls wait for the API's Task)
 * @property {number} [connectTimeoutMs]   TCP + hello, default 10000
 * @property {number} [stepTimeoutMs]      each connect step on the bridge (open, authenticate, device), default 30000
 * @property {number} [heartbeatMs]        ping interval, default 15000 (0 = off)
 * @property {{ enabled?: boolean, minDelayMs?: number, maxDelayMs?: number }} [reconnect]
 * @property {ReturnType<createLogger>} [log]
 */

/**
 * Events: `state` (state, { error? }), `loggedIn` () every time the API becomes usable (re-sync here),
 * `event` ({ api, event, args, time }), `status` (DcnmStatus), `callback` ({ callback, api, method, parameter, args, expectsResult }).
 */
export class DcnmClient extends EventEmitter {
  /** @param {DcnmClientOptions} options */
  constructor(options) {
    super();
    this.options = {
      port: 9481, server: '', device: 'LikeABosch',
      requestTimeoutMs: 30_000, connectTimeoutMs: 10_000, stepTimeoutMs: 30_000, heartbeatMs: 15_000,
      ...options,
      reconnect: { enabled: true, minDelayMs: 1_000, maxDelayMs: 30_000, ...options.reconnect },
    };
    this.log = options.log ?? createLogger({ name: 'dcnm' });
    /** @type {ClientState} */
    this.state = 'disconnected';
    /** @type {AppError | null} */
    this.lastError = null;
    /** @type {BridgeSocket | null} */
    this.link = null;
    /** hello: bridge info, interfaces found by the bridge, constants */
    this.bridgeInfo = null;
    /** @type {Record<string, { interface: string, source: string }>} */
    this.interfaces = {};
    this.constants = {};
    /** @type {DcnmStatus} */
    this.bridgeStatus = {};
    this.closing = false;
    this.connectedOnce = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.heartbeat = null;
    this.reopening = null;
    /** highest status `seq` seen: an older status arriving later is ignored (the bridge answers concurrently) */
    this.statusSeq = -1;
  }

  get address() { return `${this.options.host}:${this.options.port}`; }
  get connection() { return this.bridgeStatus.connection ?? null; }

  #setState(state, info = {}) {
    if (this.state === state && !info.error) return;
    this.state = state;
    this.emit('state', state, info);
  }

  /**
   * Connect to the bridge and run the connect sequence (open → authenticate → device). Resolves when logged in.
   * Rejects with UPSTREAM_AUTH (token or DICENTIS credentials: no reconnect) or NOT_CONNECTED / UPSTREAM_TIMEOUT.
   */
  async connect() {
    if (this.state === 'loggedIn') return;
    this.closing = false;
    clearTimeout(this.reconnectTimer);
    this.#setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    try {
      await this.#open();
      const hello = await this.#send({ type: 'hello', protocol: DCNM_BRIDGE_PROTOCOL, token: this.options.token ?? '', client: 'likeabosch' },
        this.options.connectTimeoutMs, 'hello');
      this.bridgeInfo = hello.bridge ?? null;
      this.interfaces = hello.interfaces ?? {};
      this.constants = hello.constants ?? {};
      this.statusSeq = -1;
      if (hello.status) this.#acceptStatus(hello.status);
      this.#setState('connected');
      await this.#runConnect();
      this.connectedOnce = true;
      this.lastError = null;
      this.reconnectAttempt = 0;
      this.#startHeartbeat();
      this.#evaluate();
    } catch (err) {
      const appErr = err instanceof AppError ? err : new AppError('NOT_CONNECTED', err.message);
      this.lastError = appErr;
      this.#teardown(appErr);
      if (appErr.code === 'UPSTREAM_AUTH') {
        this.closing = true;
        this.#setState('disconnected', { error: appErr });
      } else {
        this.#scheduleReconnect(appErr);
      }
      throw appErr;
    }
  }

  async #runConnect() {
    const { user, password, server, device, stepTimeoutMs } = this.options;
    // Three steps, each up to stepTimeoutMs on the bridge.
    const result = await this.#send({ type: 'connect', user, password: password ?? '', ...(server ? { server } : {}), ...(device ? { device } : {}), timeoutMs: stepTimeoutMs },
      stepTimeoutMs * 3 + 5_000, 'connect');
    if (!result.authenticated) {
      throw new AppError('UPSTREAM_AUTH', `DICENTIS login failed for user '${user}' (dicentis-bridge ${this.address})`, { reason: 'credentials' });
    }
    if (device && result.device !== 'Connected') this.log.warn(`not connected as device '${device}' (state ${result.device})`);
    else if (device && result.enabled === false) this.log.warn(`connected as device '${device}' but not enabled: assign it to a seat with manage rights in DICENTIS`);
    // The status pushed after `connect` may come later than its reply.
    this.#acceptStatus(await this.#send({ type: 'status' }, this.options.requestTimeoutMs, 'status'));
    this.log.info(`DICENTIS API open via dicentis-bridge ${this.address} (user ${user}${device ? `, device ${device}: ${result.device}` : ''})`);
  }

  /**
   * Call a method. Resolves with the awaited Task's result (null for Task/void).
   * @param {string} api     interface key (e.g. "ControlSpeaker") or a handle ("#3")
   * @param {string} method  e.g. "GrantSpeechAsync"
   * @param {Record<string, unknown>} [args]  parameters by name (without onFinish / CancellationToken / delegates)
   * @param {{ timeoutMs?: number }} [opts]
   */
  async call(api, method, args = {}, { timeoutMs } = {}) {
    this.#requireLoggedIn();
    const t = timeoutMs ?? this.options.requestTimeoutMs;
    const r = await this.#send({ type: 'call', api, method, args, timeoutMs: t }, t + 2_000, `${api}.${method}`);
    return r?.result ?? null;
  }

  /** Read a property (any type). */
  async get(api, property) {
    this.#requireLoggedIn();
    return (await this.#send({ type: 'get', api, property }, this.options.requestTimeoutMs, `${api}.${property}`))?.value ?? null;
  }

  /** Write a property. */
  async set(api, property, value) {
    this.#requireLoggedIn();
    await this.#send({ type: 'set', api, property, value }, this.options.requestTimeoutMs, `${api}.${property}`);
  }

  /** Forget an object handle. */
  release(handle) { return this.#send({ type: 'release', handle }, this.options.requestTimeoutMs, `release ${handle}`); }

  /** Answer a value-returning callback (BRIDGE.md "Delegate parameters"). */
  callbackResult(callback, result) { return this.#send({ type: 'callbackResult', callback, result }, this.options.requestTimeoutMs, `callback ${callback}`); }

  /** Disconnect the DICENTIS API on the bridge (best effort) and close; no reconnect afterwards. */
  async close() {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.link && this.connectedOnce) await this.#send({ type: 'disconnect' }, 5_000, 'disconnect').catch(() => {});
    this.#teardown(new AppError('NOT_CONNECTED', 'Connection closed'));
    this.#setState('disconnected');
  }

  // ------------------------------------------------------------------ internals

  /** Take a status unless it is older than one already seen. @returns {boolean} taken */
  #acceptStatus(status) {
    if (typeof status.seq === 'number') {
      if (status.seq < this.statusSeq) { this.log.debug(`ignored stale status ${status.seq} < ${this.statusSeq}`); return false; }
      this.statusSeq = status.seq;
    }
    this.bridgeStatus = status;
    return true;
  }

  #requireLoggedIn() {
    if (this.state !== 'loggedIn') throw new AppError('NOT_CONNECTED', `Not connected to the DICENTIS API (dicentis-bridge state: ${this.state})`);
  }

  #open() {
    const link = new BridgeSocket({ host: this.options.host, port: this.options.port, name: 'dicentis-bridge', mapError: bridgeError, log: this.log });
    this.link = link;
    link.on('message', msg => this.#onMessage(msg));
    link.on('close', () => {
      if (this.link !== link) return;
      const err = new AppError('NOT_CONNECTED', `Connection to dicentis-bridge ${this.address} lost`);
      this.#teardown(err);
      if (this.closing) this.#setState('disconnected', { error: this.lastError ?? err });
      else if (this.connectedOnce) {
        this.lastError = err;
        this.#scheduleReconnect(err);
      }
    });
    return link.connect(this.options.connectTimeoutMs);
  }

  #onMessage(msg) {
    if (msg.type === 'status') {
      if (!this.#acceptStatus(msg.status ?? {})) return;
      this.emit('status', this.bridgeStatus);
      if (this.connectedOnce) this.#evaluate();
    } else if (msg.type === 'event') {
      this.emit('event', { api: msg.api, event: msg.event, args: msg.args ?? null, time: msg.time ?? new Date().toISOString() });
    } else if (msg.type === 'callback') {
      this.emit('callback', msg);
    } else if (msg.type === 'closed') {
      this.log.warn(`dicentis-bridge closed the connection: ${msg.reason}`);
      if (msg.reason === 'replaced') {
        this.closing = true;
        this.lastError = new AppError('NOT_CONNECTED', 'Another client connected to the dicentis-bridge', { reason: 'replaced' });
      }
    }
  }

  /** loggedIn while the API is open and the user logged on; when DICENTIS drops, run the connect sequence again. */
  #evaluate() {
    const c = this.connection;
    const usable = c ? c.open && c.authenticated : true;
    if (usable && this.state !== 'loggedIn') {
      this.#setState('loggedIn');
      this.emit('loggedIn');
    } else if (!usable && this.state === 'loggedIn') {
      this.lastError = new AppError('NOT_CONNECTED', c.open ? 'DICENTIS user logged off' : 'DICENTIS API closed (system not reachable)');
      this.#setState('connected', { error: this.lastError });
      this.#reopen();
    }
  }

  /** Re-run the connect sequence on the open bridge connection, with backoff, until it works or we close. */
  #reopen(attempt = 0) {
    if (this.reopening || this.closing) return;
    const delay = Math.min(this.options.reconnect.maxDelayMs, this.options.reconnect.minDelayMs * 2 ** attempt);
    this.reopening = setTimeout(async () => {
      this.reopening = null;
      if (this.closing || this.state === 'loggedIn' || !this.link) return;
      try {
        await this.#runConnect();
        this.#evaluate();
      } catch (err) {
        this.log.debug(`re-open failed: ${err.message}`);
        if (err.code === 'UPSTREAM_AUTH') { this.lastError = err; this.#setState('connected', { error: err }); return; }
        this.#reopen(attempt + 1);
      }
    }, delay);
    this.reopening.unref?.();
  }

  #send(message, timeoutMs, what) {
    if (!this.link) return Promise.reject(new AppError('NOT_CONNECTED', 'Not connected to the dicentis-bridge'));
    return this.link.send(message, timeoutMs, what);
  }

  #startHeartbeat() {
    clearInterval(this.heartbeat);
    if (!this.options.heartbeatMs) return;
    this.heartbeat = setInterval(() => {
      this.#send({ type: 'ping' }, this.options.heartbeatMs, 'ping').catch(err => {
        if (err.code === 'UPSTREAM_TIMEOUT') { this.log.warn('dicentis-bridge does not answer pings; reconnecting'); this.link?.destroy(err); }
      });
    }, this.options.heartbeatMs);
    this.heartbeat.unref?.();
  }

  #teardown(err) {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    clearTimeout(this.reopening);
    this.reopening = null;
    const link = this.link;
    this.link = null;
    link?.destroy(err);
  }

  #scheduleReconnect(error) {
    const { enabled, minDelayMs, maxDelayMs } = this.options.reconnect;
    if (this.closing || !enabled) {
      this.#setState('disconnected', { error });
      return;
    }
    if (this.reconnectTimer) return;
    const delay = Math.min(maxDelayMs, minDelayMs * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.#setState('reconnecting', { error });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(err => this.log.debug(`reconnect failed: ${err.message}`));
    }, delay);
    this.reconnectTimer.unref?.();
  }
}

/** Bridge error (BRIDGE.md codes) → AppError. */
export function bridgeError(what, error = {}) {
  const { code = 'UNKNOWN', message = '' } = error;
  if (code === 'BAD_TOKEN') return new AppError('UPSTREAM_AUTH', `dicentis-bridge rejected the token: ${message}`, { reason: 'badToken' });
  if (['BAD_ARGS', 'UNKNOWN_METHOD', 'UNKNOWN_API', 'UNKNOWN_PROPERTY', 'UNKNOWN_HANDLE', 'BAD_REQUEST'].includes(code)) {
    return new AppError('VALIDATION', `${what}: ${message}`, { bridgeError: code });
  }
  if (code === 'TIMEOUT') return new AppError('UPSTREAM_TIMEOUT', `${what}: ${message}`, { bridgeError: code });
  return new AppError('UPSTREAM_ERROR', `${what} failed on the dicentis-bridge (${code}): ${message}`, { bridgeError: code, upstream: message });
}
