// DCN-SWSMD client (WO-066, DEC-018): reads the Streaming Meeting Data of the DCN-SW server over TCP (default port
// 20000). One-way and unauthenticated: the server allows or rejects clients by IP (AllowedClients). Same state/event
// model as the other clients; `loggedIn` = TCP connection open.
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { AppError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { FrameDecoder } from './frames.js';
import { parseXml } from './xml.js';

/** A connection closed by the server this soon after connecting, without data, looks like an AllowedClients rejection. */
const REJECT_WINDOW_MS = 1_500;

/**
 * @typedef {'disconnected' | 'connecting' | 'connected' | 'loggedIn' | 'reconnecting'} ClientState
 * @typedef {object} DcnSmdClientOptions
 * @property {string} host   PC running the DCN-SW server
 * @property {number} [port] default 20000
 * @property {number} [connectTimeoutMs]  default 10000
 * @property {{ enabled?: boolean, minDelayMs?: number, maxDelayMs?: number }} [reconnect]
 * @property {ReturnType<createLogger>} [log]
 */

/**
 * Events: `state` (state, { error? }), `loggedIn` () after every (re)connect, `activity` ({ root, topicName, encoding, bytes }),
 * `parseError` ({ error, text }).
 */
export class DcnSmdClient extends EventEmitter {
  /** @param {DcnSmdClientOptions} options */
  constructor(options) {
    super();
    this.options = {
      port: 20000, connectTimeoutMs: 10_000, ...options,
      reconnect: { enabled: true, minDelayMs: 1_000, maxDelayMs: 30_000, ...options.reconnect },
    };
    this.log = options.log ?? createLogger({ name: 'dcn-smd' });
    /** @type {ClientState} */
    this.state = 'disconnected';
    /** @type {AppError | null} */
    this.lastError = null;
    this.socket = null;
    this.closing = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.stats = { connectedAt: null, bytes: 0, messages: 0, encoding: null, parseErrors: 0 };
  }

  get address() { return `${this.options.host}:${this.options.port}`; }

  #setState(state, info = {}) {
    if (this.state === state && !info.error) return;
    this.state = state;
    this.emit('state', state, info);
  }

  /** Open the stream. Resolves when the TCP connection is up; rejects with NOT_CONNECTED (and keeps retrying). */
  connect() {
    if (this.state === 'loggedIn') return Promise.resolve();
    this.closing = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.#setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.options.host, port: this.options.port });
      this.socket = socket;
      socket.setKeepAlive(true, 10_000);
      const decoder = new FrameDecoder();
      let opened = false;
      let openedAt = 0;
      let received = 0;
      const timer = setTimeout(() => socket.destroy(new Error('timeout')), this.options.connectTimeoutMs);

      socket.once('connect', () => {
        clearTimeout(timer);
        opened = true;
        openedAt = Date.now();
        this.reconnectAttempt = 0;
        this.lastError = null;
        this.stats = { ...this.stats, connectedAt: new Date().toISOString() };
        this.log.info(`connected to DCN-SWSMD stream ${this.address}`);
        this.#setState('loggedIn');
        this.emit('loggedIn');
        resolve();
      });
      socket.on('data', chunk => {
        received += chunk.length;
        this.stats.bytes += chunk.length;
        let frames;
        try {
          frames = decoder.push(chunk);
        } catch (err) {
          this.log.warn(err.message);
          socket.destroy(err); // out of sync: reconnect gives a clean frame boundary
          return;
        }
        for (const f of frames) {
          this.stats.messages += 1;
          this.stats.encoding = f.encoding;
          try {
            this.emit('activity', { root: parseXml(f.text), topicName: f.topicName, encoding: f.encoding, bytes: f.bytes });
          } catch (error) {
            this.stats.parseErrors += 1;
            this.log.warn(`cannot parse SWSMD message (topic ${f.topicName}): ${error.message}`);
            this.emit('parseError', { error, text: f.text.slice(0, 2000) });
          }
        }
      });
      socket.on('error', err => {
        clearTimeout(timer);
        if (!opened) {
          const hint = err.code === 'ECONNREFUSED'
            ? ' (is the DCN-SW server running, and is the SWSMD port right? Default 20000)'
            : err.message === 'timeout' ? ' (timeout: host reachable? firewall on the DCN-SW PC?)' : '';
          const appErr = new AppError('NOT_CONNECTED', `Cannot connect to the DCN-SWSMD stream at ${this.address}: ${err.code ?? err.message}${hint}`);
          this.lastError = appErr;
          this.socket = null;
          this.#scheduleReconnect(appErr);
          reject(appErr);
        } else {
          this.log.debug(`SWSMD socket error: ${err.message}`);
        }
      });
      socket.on('close', () => {
        if (!opened || this.socket !== socket) return;
        this.socket = null;
        if (this.closing) return;
        const rejected = received === 0 && Date.now() - openedAt < REJECT_WINDOW_MS;
        const err = new AppError('NOT_CONNECTED', rejected
          ? `The DCN-SW server closed the stream right after connecting: is this PC allowed (AllowedClients in Server.exe.config)?`
          : `DCN-SWSMD stream ${this.address} closed`, rejected ? { reason: 'rejected' } : undefined);
        this.lastError = err;
        this.#scheduleReconnect(err);
      });
    });
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

  /** Close the stream; no reconnect. (Nothing to log out of: the stream is unauthenticated.) */
  async close() {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
    this.#setState('disconnected');
  }
}
