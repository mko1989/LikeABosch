// DCN client (WO-060, DEC-017): one TCP connection to the dcn-bridge (docs/protocol/dcn-swapi/BRIDGE.md), which hosts
// the DCN-SW API next to the DCN-SW server. Same state/event model as WiredClient and WirelessClient.
//   loggedIn = bridge reachable + ControlApi initialized + DCN-SW link available (IApi.IsAvailable).
import { EventEmitter } from 'node:events';
import { AppError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { BridgeSocket } from '../lib/bridge-socket.js';

export const BRIDGE_PROTOCOL = 1;

/**
 * @typedef {'disconnected' | 'connecting' | 'connected' | 'loggedIn' | 'reconnecting'} ClientState
 * @typedef {{ initialized: boolean, available: boolean, allowed: Record<string, boolean> }} RootStatus
 * @typedef {{ control?: RootStatus, config?: RootStatus }} BridgeStatus
 * @typedef {object} DcnClientOptions
 * @property {string} host                 bridge host
 * @property {number} [port]               bridge port (default 9480)
 * @property {string} token                bridge token (BRIDGE.md handshake)
 * @property {string} [dcnServer]          connection string the bridge passes to IApi.Initialize (default tcp://localhost:9461)
 * @property {string} user                 DCN-SW user
 * @property {string} password
 * @property {('control' | 'config')[]} [roots]  default both
 * @property {number} [requestTimeoutMs]   default 10000
 * @property {number} [connectTimeoutMs]   TCP + hello, default 10000
 * @property {number} [initTimeoutMs]      IApi.Initialize on the bridge, default 30000 (wrong credentials take ≥ 5 s)
 * @property {number} [heartbeatMs]        ping interval, default 15000 (0 = off)
 * @property {{ enabled?: boolean, minDelayMs?: number, maxDelayMs?: number }} [reconnect]
 * @property {ReturnType<createLogger>} [log]
 */

/**
 * Events: `state` (state, { error? }), `loggedIn` () every time the API becomes usable (re-sync here),
 * `event` ({ api, event, args, time }), `status` (BridgeStatus).
 */
export class DcnClient extends EventEmitter {
  /** @param {DcnClientOptions} options */
  constructor(options) {
    super();
    this.options = {
      port: 9480, dcnServer: 'tcp://localhost:9461', roots: ['control', 'config'],
      requestTimeoutMs: 10_000, connectTimeoutMs: 10_000, initTimeoutMs: 30_000, heartbeatMs: 15_000,
      ...options,
      reconnect: { enabled: true, minDelayMs: 1_000, maxDelayMs: 30_000, ...options.reconnect },
    };
    this.log = options.log ?? createLogger({ name: 'dcn' });
    /** @type {ClientState} */
    this.state = 'disconnected';
    /** @type {AppError | null} */
    this.lastError = null;
    /** @type {BridgeSocket | null} */
    this.link = null;
    /** @type {BridgeStatus} */
    this.bridgeStatus = {};
    /** hello reply: bridge info + struct constants */
    this.bridgeInfo = null;
    this.constants = {};
    this.closing = false;
    this.initialized = false; // connect() succeeded at least for the control root
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.heartbeat = null;
  }

  get address() { return `${this.options.host}:${this.options.port}`; }

  #setState(state, info = {}) {
    if (this.state === state && !info.error) return;
    this.state = state;
    this.emit('state', state, info);
  }

  /**
   * Connect to the bridge, authenticate, initialize the DCN-SW API. Resolves when logged in (or connected and waiting
   * for the DCN-SW link). Rejects with UPSTREAM_AUTH (token / DCN-SW credentials: no reconnect) or NOT_CONNECTED.
   */
  async connect() {
    if (this.state === 'loggedIn') return;
    this.closing = false;
    clearTimeout(this.reconnectTimer);
    this.#setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    try {
      await this.#open();
      const hello = await this.#send({ type: 'hello', protocol: BRIDGE_PROTOCOL, token: this.options.token ?? '', client: 'likeabosch' },
        this.options.connectTimeoutMs, 'hello');
      this.bridgeInfo = hello.bridge ?? null;
      this.constants = hello.constants ?? {};
      if (hello.status) this.bridgeStatus = hello.status;
      this.#setState('connected');
      const { dcnServer, user, password, roots } = this.options;
      const result = await this.#send({ type: 'connect', server: dcnServer, user, password: password ?? '', roots },
        this.options.initTimeoutMs, 'connect');
      const control = result.control ?? result[roots[0]];
      if (control !== 'NONE' && control !== 'ALREADY_INITIALIZED') throw initError(control, this.options);
      for (const r of roots) {
        if (result[r] && result[r] !== 'NONE' && result[r] !== 'ALREADY_INITIALIZED') this.log.warn(`DCN-SW ${r} API not initialized: ${result[r]}`);
      }
      // The status pushed after `connect` may arrive later than this reply: ask for it (requests run in order on the bridge).
      this.bridgeStatus = await this.#send({ type: 'status' }, this.options.requestTimeoutMs, 'status');
      this.initialized = true;
      this.lastError = null;
      this.reconnectAttempt = 0;
      this.#startHeartbeat();
      this.log.info(`DCN-SW API initialized via bridge ${this.address} (${dcnServer}, user ${user})`);
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

  /**
   * Raw call. Resolves with `{ returns, out }` (returns = API_ERROR name, also when not NONE).
   * @param {string} api     e.g. "control.DiscussionApi"
   * @param {string} method  e.g. "SpeakNow"
   * @param {Record<string, unknown>} [args]
   * @param {{ timeoutMs?: number }} [opts]
   */
  call(api, method, args = {}, { timeoutMs } = {}) {
    if (this.state !== 'loggedIn') {
      return Promise.reject(new AppError('NOT_CONNECTED', `Not connected to the DCN system (state: ${this.state})`));
    }
    return this.#send({ type: 'call', api, method, args }, timeoutMs ?? this.options.requestTimeoutMs, `${api}.${method}`);
  }

  /**
   * Call by full key and return the `out` parameters; any API_ERROR other than NONE is thrown as an AppError
   * (NO_AUTHORIZATION → UPSTREAM_AUTH, else UPSTREAM_ERROR) with `apiError`.
   * @param {string} key  e.g. "control.DiscussionApi.SpeakNow"
   * @param {Record<string, unknown>} [args]
   * @returns {Promise<Record<string, any>>}
   */
  async request(key, args = {}, opts = {}) {
    const i = key.lastIndexOf('.');
    const { returns, out } = await this.call(key.slice(0, i), key.slice(i + 1), args, opts);
    if (returns !== 'NONE') throw apiError(key, returns);
    return out ?? {};
  }

  /** Terminate the DCN-SW API on the bridge (best effort) and close; no reconnect afterwards. */
  async close() {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.link && this.initialized) await this.#send({ type: 'disconnect' }, 3_000, 'disconnect').catch(() => {});
    this.#teardown(new AppError('NOT_CONNECTED', 'Connection closed'));
    this.#setState('disconnected');
  }

  // ------------------------------------------------------------------ internals

  #open() {
    const link = new BridgeSocket({ host: this.options.host, port: this.options.port, name: 'dcn-bridge', mapError: bridgeError, log: this.log });
    this.link = link;
    link.on('message', msg => this.#onMessage(msg));
    link.on('close', () => {
      if (this.link !== link) return;
      const err = new AppError('NOT_CONNECTED', `Connection to dcn-bridge ${this.address} lost`);
      this.#teardown(err);
      if (this.closing) {
        this.#setState('disconnected', { error: this.lastError ?? err }); // e.g. replaced by another client
      } else if (this.initialized) {
        this.lastError = err;
        this.#scheduleReconnect(err);
      }
    });
    return link.connect(this.options.connectTimeoutMs);
  }

  /** Pushed messages (responses are matched by the BridgeSocket). */
  #onMessage(msg) {
    if (msg.type === 'status') {
      this.bridgeStatus = msg.status ?? {};
      this.emit('status', this.bridgeStatus);
      if (this.initialized) this.#evaluate();
    } else if (msg.type === 'event') {
      this.emit('event', { api: msg.api, event: msg.event, args: msg.args ?? null, time: msg.time ?? new Date().toISOString() });
    } else if (msg.type === 'closed') {
      this.log.warn(`dcn-bridge closed the connection: ${msg.reason}`);
      if (msg.reason === 'replaced') {
        // Another LikeABosch took over the bridge: don't fight over it.
        this.closing = true;
        this.lastError = new AppError('NOT_CONNECTED', 'Another client connected to the dcn-bridge', { reason: 'replaced' });
      }
    }
  }

  /** connected ↔ loggedIn from the bridge status (the DCN-SW API reconnects to its server by itself). */
  #evaluate() {
    const control = this.bridgeStatus.control;
    const usable = control?.initialized !== false && control?.available !== false;
    if (usable && this.state !== 'loggedIn') {
      this.#setState('loggedIn');
      this.emit('loggedIn');
    } else if (!usable && this.state === 'loggedIn') {
      this.lastError = new AppError('NOT_CONNECTED', 'DCN-SW server not available (the DCN-SW API is reconnecting)');
      this.#setState('connected', { error: this.lastError });
    }
  }

  #send(message, timeoutMs, what) {
    if (!this.link) return Promise.reject(new AppError('NOT_CONNECTED', 'Not connected to the dcn-bridge'));
    return this.link.send(message, timeoutMs, what);
  }

  #startHeartbeat() {
    clearInterval(this.heartbeat);
    if (!this.options.heartbeatMs) return;
    this.heartbeat = setInterval(() => {
      this.#send({ type: 'ping' }, this.options.heartbeatMs, 'ping').catch(err => {
        if (err.code === 'UPSTREAM_TIMEOUT') { this.log.warn('dcn-bridge does not answer pings; reconnecting'); this.link?.destroy(err); }
      });
    }, this.options.heartbeatMs);
    this.heartbeat.unref?.();
  }

  #teardown(err) {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
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

/** Short descriptions of the API_ERROR values we explain to the user (full list: types.json). */
const API_ERROR_HINTS = {
  NO_AUTHORIZATION: 'user unknown on the DCN-SW server, missing access rights or licence, or the DCN-SW server has no link to the master CCU',
  SETUP_LINK_FAILED: 'the DCN-SW API could not connect to the DCN-SW server',
  NOT_AVAILABLE: 'the DCN-SW API is not available (no link to the DCN-SW server)',
  NOT_ACTIVE: 'no meeting/session/voting is active',
  INCORRECT_MODE: 'not possible in the current microphone mode',
};

function initError(code, { dcnServer, user }) {
  if (code === 'NO_AUTHORIZATION') {
    return new AppError('UPSTREAM_AUTH', `DCN-SW login failed for user '${user}': ${API_ERROR_HINTS.NO_AUTHORIZATION}`, { apiError: code });
  }
  return new AppError('NOT_CONNECTED', `DCN-SW API Initialize(${dcnServer}) returned ${code}${API_ERROR_HINTS[code] ? `: ${API_ERROR_HINTS[code]}` : ''}`, { apiError: code });
}

/** @param {string} key @param {string} code */
export function apiError(key, code) {
  const hint = API_ERROR_HINTS[code] ? ` (${API_ERROR_HINTS[code]})` : '';
  return new AppError(code === 'NO_AUTHORIZATION' ? 'UPSTREAM_AUTH' : 'UPSTREAM_ERROR', `${key} returned ${code}${hint}`, { apiError: code, upstream: code });
}

export function bridgeError(what, error = {}) {
  const { code = 'UNKNOWN', message = '' } = error;
  if (code === 'BAD_TOKEN') return new AppError('UPSTREAM_AUTH', `dcn-bridge rejected the token: ${message}`, { reason: 'badToken' });
  if (code === 'BAD_ARGS' || code === 'UNKNOWN_METHOD' || code === 'UNKNOWN_API') return new AppError('VALIDATION', `${what}: ${message}`, { bridgeError: code });
  return new AppError('UPSTREAM_ERROR', `${what} failed on the dcn-bridge (${code}): ${message}`, { bridgeError: code });
}
