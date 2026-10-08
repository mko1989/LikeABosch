// Transport of the LikeABosch bridge protocol (dcn-bridge, dicentis-bridge; docs/protocol/dcn-swapi/BRIDGE.md):
// one TCP connection, one JSON object per line, requests matched to responses by `id` (hello = id 0), timeouts.
// Pushed messages (status, event, callback, closed) are emitted as `message`. Used by DcnClient and DcnmClient.
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { AppError } from './errors.js';

const MAX_LINE = 16 * 1024 * 1024;

/**
 * Events: `message` (msg) for every message that is not a hello/response, `close` () once when the socket closed.
 */
export class BridgeSocket extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} options.port
   * @param {string} options.name   e.g. "dcn-bridge", for messages
   * @param {(what: string, error: { code?: string, message?: string }) => Error} options.mapError  bridge error → AppError
   * @param {{ debug(m: string): void, warn(m: string): void }} options.log
   */
  constructor({ host, port, name, mapError, log }) {
    super();
    Object.assign(this, { host, port, name, mapError, log });
    /** @type {net.Socket | null} */
    this.socket = null;
    /** @type {Map<number, { resolve: Function, reject: Function, timer: NodeJS.Timeout, what: string }>} */
    this.pending = new Map();
    this.nextId = 1;
  }

  get address() { return `${this.host}:${this.port}`; }
  get open() { return Boolean(this.socket && !this.socket.destroyed); }

  /** Connect the TCP socket. Rejects with NOT_CONNECTED. */
  connect(timeoutMs) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.host, port: this.port });
      this.socket = socket;
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 10_000);
      const timer = setTimeout(() => { socket.destroy(); reject(new AppError('NOT_CONNECTED', `Timeout connecting to ${this.name} ${this.address}`)); }, timeoutMs);
      let buffer = '';
      socket.setEncoding('utf8');
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > MAX_LINE && !buffer.includes('\n')) { socket.destroy(new Error('message too long')); return; }
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) this.#onLine(line);
        }
      });
      socket.on('error', err => {
        clearTimeout(timer);
        this.log.debug(`${this.name} socket error: ${err.message}`);
        reject(new AppError('NOT_CONNECTED', `Cannot connect to ${this.name} ${this.address}: ${err.code ?? err.message}`));
      });
      socket.on('close', () => {
        if (this.socket === socket) this.socket = null;
        this.#rejectAll(new AppError('NOT_CONNECTED', `Connection to ${this.name} ${this.address} lost`));
        this.emit('close');
      });
    });
  }

  #onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { this.log.warn(`${this.name} sent invalid JSON: ${line.slice(0, 200)}`); return; }
    if (msg.type === 'hello' || msg.type === 'response') {
      const id = msg.type === 'hello' ? 0 : msg.id;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.type === 'hello' ? msg : msg.result);
      else p.reject(this.mapError(p.what, msg.error ?? {}));
      return;
    }
    this.emit('message', msg);
  }

  /**
   * Send a request and resolve with its `result` (hello: the whole reply).
   * @param {Record<string, unknown> & { type: string }} message
   * @param {number} timeoutMs
   * @param {string} what  for error messages
   */
  send(message, timeoutMs, what) {
    const socket = this.socket;
    if (!socket || socket.destroyed) return Promise.reject(new AppError('NOT_CONNECTED', `Not connected to the ${this.name}`));
    const id = message.type === 'hello' ? 0 : this.nextId++;
    if (this.nextId > 2 ** 31 - 1) this.nextId = 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppError('UPSTREAM_TIMEOUT', `${what} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, what });
      socket.write(`${JSON.stringify(message.type === 'hello' ? message : { ...message, id })}\n`);
    });
  }

  /** Fire-and-forget message (e.g. a callbackResult whose answer nobody waits for). */
  post(message) {
    if (this.open) this.socket.write(`${JSON.stringify({ ...message, id: this.nextId++ })}\n`);
  }

  #rejectAll(err) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  /** Close the socket and reject pending requests with `err`. `close` is still emitted. */
  destroy(err) {
    this.#rejectAll(err);
    this.socket?.destroy();
  }
}
