// One TCP connection to a text-protocol switcher (WO-112, DEC-033): lines in and out, one command at a time, each
// answered by the lines up to the one `done` accepts. Lines that arrive while nothing waits for them (front-panel
// changes on a Kramer) are emitted as `line`. Events: `line` (text), `close` (error?).
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { AppError } from '../../lib/errors.js';

export class LineConnection extends EventEmitter {
  /**
   * @param {{ host: string, port: number, eol?: string, connectTimeoutMs?: number, commandTimeoutMs?: number, name?: string }} options
   */
  constructor(options) {
    super();
    const given = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)); // undefined = default
    this.options = { eol: '\r\n', connectTimeoutMs: 5000, commandTimeoutMs: 3000, name: 'switcher', ...given };
    this.socket = null;
    this.buffer = '';
    /** @type {{ done: (line: string) => boolean | 'error', lines: string[], resolve: Function, reject: Function, timer: any } | null} */
    this.pending = null;
    this.queue = Promise.resolve();
  }

  /** Open the connection. Rejects with NOT_CONNECTED. */
  open() {
    const { host, port, connectTimeoutMs, name } = this.options;
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host, port });
      this.socket = socket;
      socket.setNoDelay(true);
      socket.setEncoding('latin1');
      const t = setTimeout(() => { socket.destroy(); reject(new AppError('NOT_CONNECTED', `${name} ${host}:${port}: no connection within ${connectTimeoutMs} ms`)); }, connectTimeoutMs);
      socket.once('connect', () => { clearTimeout(t); socket.setKeepAlive(true, 10_000); resolve(); });
      socket.on('data', chunk => this.#data(chunk));
      socket.once('error', err => { clearTimeout(t); reject(new AppError('NOT_CONNECTED', `${name} ${host}:${port}: ${err.code ?? err.message}`)); });
      socket.once('close', () => {
        clearTimeout(t);
        if (this.socket !== socket) return;
        this.socket = null;
        this.#fail(new AppError('NOT_CONNECTED', `${name} connection closed`));
        this.emit('close');
      });
    });
  }

  get isOpen() { return Boolean(this.socket && !this.socket.destroyed); }

  #data(chunk) {
    this.buffer += chunk;
    let i;
    while ((i = this.buffer.search(/\r?\n|\r/)) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(this.buffer[i] === '\r' && this.buffer[i + 1] === '\n' ? i + 2 : i + 1);
      if (line) this.#line(line);
    }
  }

  #line(line) {
    const p = this.pending;
    const verdict = p ? p.done(line) : false;
    if (verdict === false) {
      if (p?.collectAll) p.lines.push(line); // part of the answer (e.g. tvONE "Window1.Input = Slot1.In1")
      else this.emit('line', line);
      return;
    }
    p.lines.push(line);
    this.pending = null;
    clearTimeout(p.timer);
    if (verdict === 'error') p.reject(new AppError('UPSTREAM_ERROR', `${this.options.name}: ${line}`));
    else p.resolve(p.lines);
  }

  #fail(err) {
    const p = this.pending;
    this.pending = null;
    if (p) { clearTimeout(p.timer); p.reject(err); }
  }

  /**
   * Send one command and wait for its answer. Commands run one after the other.
   * @param {string} text  without line end
   * @param {(line: string) => boolean | 'error'} done  true = last line of the answer; 'error' = failed; false = not ours
   * @param {{ collectAll?: boolean, timeoutMs?: number }} [opts]  collectAll: keep the lines before the last one too
   * @returns {Promise<string[]>}
   */
  command(text, done, { collectAll = false, timeoutMs } = {}) {
    const run = () => new Promise((resolve, reject) => {
      if (!this.isOpen) return reject(new AppError('NOT_CONNECTED', `${this.options.name} not connected`));
      const ms = timeoutMs ?? this.options.commandTimeoutMs;
      this.pending = {
        done, collectAll, lines: [], resolve, reject,
        timer: setTimeout(() => { this.pending = null; reject(new AppError('UPSTREAM_TIMEOUT', `${this.options.name}: no answer to "${text}" within ${ms} ms`)); }, ms),
      };
      this.socket.write(`${text}${this.options.eol}`);
    });
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  close() {
    const s = this.socket;
    this.socket = null;
    this.#fail(new AppError('NOT_CONNECTED', `${this.options.name} closed`));
    s?.destroy();
  }
}
