// Conference Protocol client: one WSS connection to a DICENTIS server (WO-009).
// Protocol rules: docs/protocol/conference/README.md
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { AppError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';

const PATH = '/Dicentis/API';
const SUBPROTOCOL = 'DICENTIS_1_0';
const MAX_MESSAGE_ID = 2 ** 31 - 1;

/**
 * @typedef {'disconnected' | 'connecting' | 'connected' | 'loggedIn' | 'reconnecting'} ClientState
 * @typedef {object} WiredClientOptions
 * @property {string} host
 * @property {number} [port]               default 31416
 * @property {string} user
 * @property {string} password
 * @property {boolean} [tlsInsecure]       accept self-signed certificates (default true)
 * @property {number} [requestTimeoutMs]   default 10000
 * @property {number} [connectTimeoutMs]   default 10000
 * @property {{ enabled?: boolean, minDelayMs?: number, maxDelayMs?: number }} [reconnect]
 * @property {ReturnType<createLogger>} [log]
 */

/**
 * Events emitted:
 * - `state` (state: ClientState, info: { error?: AppError })
 * - `loggedIn` ()        after every successful login, including after a reconnect → re-register events here
 * - `event` (names: string[])   server event notification (no data, see protocol README)
 * - `error` (AppError)  only when someone listens; connection problems are also reflected in `state`
 */
export class WiredClient extends EventEmitter {
  /** @param {WiredClientOptions} options */
  constructor(options) {
    super();
    this.options = {
      port: 31416,
      tlsInsecure: true,
      requestTimeoutMs: 10_000,
      connectTimeoutMs: 10_000,
      ...options,
      reconnect: { enabled: true, minDelayMs: 1_000, maxDelayMs: 30_000, ...options.reconnect },
    };
    this.log = options.log ?? createLogger({ name: 'wired' });
    /** @type {ClientState} */
    this.state = 'disconnected';
    /** @type {AppError | null} */
    this.lastError = null;
    /** @type {WebSocket | null} */
    this.ws = null;
    /** @type {Map<number, { resolve: Function, reject: Function, timer: NodeJS.Timeout, operation: string }>} */
    this.pending = new Map();
    this.nextId = 1;
    this.closing = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
  }

  get url() {
    return `wss://${this.options.host}:${this.options.port}${PATH}`;
  }

  /**
   * Open the socket and log in. Resolves when logged in.
   * Rejects with UPSTREAM_AUTH (bad credentials; no reconnect) or NOT_CONNECTED (network/TLS; reconnects if enabled).
   */
  async connect() {
    if (this.state === 'loggedIn') return;
    this.closing = false;
    clearTimeout(this.reconnectTimer);
    try {
      await this.#open();
      await this.#login();
      this.reconnectAttempt = 0;
    } catch (err) {
      const appErr = toAppError(err);
      this.lastError = appErr;
      // Detach first so the socket's close handler doesn't schedule a second reconnect.
      const ws = this.ws;
      this.ws = null;
      ws?.terminate();
      this.#rejectAll(appErr);
      if (appErr.code === 'UPSTREAM_AUTH') {
        this.closing = true; // don't reconnect with wrong credentials
        this.#setState('disconnected', { error: appErr });
      } else {
        this.#scheduleReconnect(appErr);
      }
      throw appErr;
    }
  }

  /**
   * Send an operation and await its response parameters.
   * @param {string} operation
   * @param {Record<string, unknown>} [parameters]
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<Record<string, any>>}
   */
  request(operation, parameters = {}, { timeoutMs } = {}) {
    if (this.state !== 'loggedIn' && !(this.state === 'connected' && operation === 'Login')) {
      return Promise.reject(new AppError('NOT_CONNECTED', `Not connected to DICENTIS server (state: ${this.state})`));
    }
    return this.#send(operation, parameters, timeoutMs ?? this.options.requestTimeoutMs);
  }

  /** Log out (best effort) and close; no reconnect afterwards. */
  async close() {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    if (this.state === 'loggedIn') {
      await this.request('Logout', {}, { timeoutMs: 2_000 }).catch(() => {});
    }
    const ws = this.ws;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      await new Promise(resolve => {
        ws.once('close', resolve);
        ws.close();
        setTimeout(() => { ws.terminate(); resolve(); }, 2_000).unref();
      });
    }
    this.#setState('disconnected');
  }

  #setState(state, info = {}) {
    if (this.state === state && !info.error) return;
    this.state = state;
    this.emit('state', state, info);
  }

  #open() {
    this.#setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, SUBPROTOCOL, {
        rejectUnauthorized: !this.options.tlsInsecure,
        handshakeTimeout: this.options.connectTimeoutMs,
      });
      this.ws = ws;
      let opened = false;
      ws.on('open', () => {
        opened = true;
        this.#setState('connected');
        resolve();
      });
      ws.on('message', data => this.#onMessage(data));
      ws.on('error', err => {
        this.log.debug(`socket error: ${err.message}`);
        if (!opened) reject(new AppError('NOT_CONNECTED', `Cannot connect to ${this.url}: ${err.message}`));
      });
      ws.on('close', (code, reason) => {
        if (this.ws !== ws) return;
        this.ws = null;
        const err = new AppError('NOT_CONNECTED', `Connection closed (${code}${reason.length ? `: ${reason}` : ''})`);
        this.#rejectAll(err);
        if (!opened) reject(err);
        else if (!this.closing) {
          this.log.warn(`connection lost: ${err.message}`);
          this.lastError = err;
          this.#scheduleReconnect(err);
        }
      });
    });
  }

  async #login() {
    const { user, password } = this.options;
    const res = await this.#send('Login', { user, password }, this.options.requestTimeoutMs);
    if (!res.loggedIn) throw new AppError('UPSTREAM_AUTH', `DICENTIS login failed for user '${user}'`);
    this.lastError = null;
    this.#setState('loggedIn');
    this.log.info(`logged in to ${this.options.host} as ${user}`);
    this.emit('loggedIn');
  }

  #scheduleReconnect(error) {
    const { enabled, minDelayMs, maxDelayMs } = this.options.reconnect;
    if (this.closing || !enabled) {
      this.#setState('disconnected', { error });
      return;
    }
    const delay = Math.min(maxDelayMs, minDelayMs * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.#setState('reconnecting', { error });
    this.log.info(`reconnecting in ${delay} ms (attempt ${this.reconnectAttempt})`);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(err => this.log.debug(`reconnect failed: ${err.message}`));
    }, delay);
    this.reconnectTimer.unref?.();
  }

  #send(operation, parameters, timeoutMs) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new AppError('NOT_CONNECTED', 'Socket is not open'));
    }
    const messageId = this.nextId;
    this.nextId = this.nextId >= MAX_MESSAGE_ID ? 1 : this.nextId + 1; // never 0: reserved for events
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new AppError('UPSTREAM_TIMEOUT', `${operation} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(messageId, { resolve, reject, timer, operation });
      ws.send(JSON.stringify({ messageId, operation, parameters }));
    });
  }

  #onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      this.log.warn('received non-JSON message from server');
      return;
    }
    if (msg.messageId === 0 && msg.operation === 'event') {
      const events = msg.parameters?.events ?? [];
      this.log.debug(`events: ${events.join(', ')}`);
      this.emit('event', events);
      return;
    }
    const entry = this.pending.get(msg.messageId);
    if (!entry) {
      this.log.debug(`response for unknown messageId ${msg.messageId}`);
      return;
    }
    this.pending.delete(msg.messageId);
    clearTimeout(entry.timer);
    if (msg.operation === 'error') {
      const upstream = msg.parameters?.message ?? 'Unknown error';
      entry.reject(new AppError('UPSTREAM_ERROR', `${entry.operation} failed: ${upstream}`, { upstream }));
    } else {
      entry.resolve(msg.parameters ?? {});
    }
  }

  #rejectAll(err) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
      this.pending.delete(id);
    }
  }
}

function toAppError(err) {
  return err instanceof AppError ? err : new AppError('NOT_CONNECTED', err?.message ?? String(err));
}
