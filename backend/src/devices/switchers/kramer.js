// Kramer MV-6 driver (WO-112, DEC-033): Kramer Protocol 3000 over TCP (default port 5000). The MV-6 is a 6-input
// multiviewer; "program" is the input of one window (default 1, the full-screen window in the Full layout):
//   #SRC-VID <window>,<input>␍  → ~01@SRC-VID <window>,<input>␍␊      set the window's input (a cut)
//   #SRC-VID? <window>␍         → ~01@SRC-VID <window>,<input>␍␊      read it
//   #PRST-RCL <n>␍              → ~01@PRST-RCL <n>␍␊                   recall a layout preset (optional, after connecting)
//   #MODEL?␍                    → ~01@MODEL MV-6␍␊
// Errors come back as "~01@<CMD> ERR <code>" (or "~01@ERR <code>"). Changes made on the front panel are sent
// unsolicited in the same format and followed as program changes.
import { EventEmitter } from 'node:events';
import { AppError } from '../../lib/errors.js';
import { LineConnection } from './line-connection.js';

export const KRAMER_INPUTS = 6;
const REPLY = /^~\d+@\s*([A-Z0-9?-]*)\s*(.*)$/i;

/** Parse a Protocol 3000 reply line: { cmd, params, error } or null. */
export function parseP3000(line) {
  const m = REPLY.exec(line);
  if (!m) return null;
  const cmd = m[1].toUpperCase().replace(/\?$/, '');
  const rest = m[2].trim().replace(/\s+OK$/i, ''); // some Protocol 3000 firmwares end set replies with OK
  const error = cmd === 'ERR' || /^ERR\b/i.test(rest);
  return { cmd, params: error ? [] : rest.split(',').map(x => x.trim()).filter(Boolean), error };
}

/** Events: `status` (status()), `program` ({ me, input }) when the window's input changes (also from the front panel). */
export class KramerSwitcher extends EventEmitter {
  /**
   * @param {{ host: string, port?: number | null, window?: number, layoutPreset?: number | null, retryMs?: number,
   *   connectTimeoutMs?: number, commandTimeoutMs?: number }} options
   */
  constructor(options) {
    super();
    this.options = { window: 1, layoutPreset: null, retryMs: 5000, ...options, port: options.port ?? 5000 };
    this.connected = false;
    this.lastError = null;
    this.program = null;
    this.model = null;
    this.conn = null;
    this.closing = false;
    this.retryTimer = null;
  }

  get window() { return Number.isInteger(this.options.window) ? this.options.window : 1; }

  async connect() {
    this.closing = false;
    clearTimeout(this.retryTimer);
    this.conn?.close();
    const conn = new LineConnection({ host: this.options.host, port: this.options.port, eol: '\r', name: 'Kramer MV-6',
      connectTimeoutMs: this.options.connectTimeoutMs, commandTimeoutMs: this.options.commandTimeoutMs });
    this.conn = conn;
    conn.on('line', line => this.#unsolicited(line));
    conn.on('close', () => this.#lost(conn));
    await conn.open();
    try {
      await this.#cmd('#', ''); // handshake: "~01@ OK"
      this.model = (await this.#cmd('#MODEL?', 'MODEL').catch(() => null))?.params.join(',') || null;
      if (Number.isInteger(this.options.layoutPreset)) await this.#cmd(`#PRST-RCL ${this.options.layoutPreset}`, 'PRST-RCL');
      const now = await this.#cmd(`#SRC-VID? ${this.window}`, 'SRC-VID');
      this.#setProgram(Number(now.params[1]));
    } catch (err) {
      conn.close();
      this.conn = null;
      throw err;
    }
    this.connected = true;
    this.lastError = null;
    this.emit('status', this.status());
  }

  /** Send a command, wait for the reply whose command is `expect` ('' = the handshake's bare "OK"). */
  async #cmd(text, expect) {
    const lines = await this.conn.command(text, line => {
      const r = parseP3000(line);
      if (!r) return false;
      if (r.error && (r.cmd === expect || r.cmd === 'ERR')) return 'error';
      return expect === '' ? /\bOK\b/i.test(line) : r.cmd === expect;
    });
    return parseP3000(lines.at(-1));
  }

  #unsolicited(line) {
    const r = parseP3000(line);
    if (r?.cmd === 'SRC-VID' && Number(r.params[0]) === this.window) {
      this.#setProgram(Number(r.params[1]));
      this.emit('status', this.status());
    }
  }

  #setProgram(input) {
    if (!Number.isInteger(input) || input === this.program) return;
    this.program = input;
    this.emit('program', { me: 0, input });
  }

  #lost(conn) {
    if (conn !== this.conn) return;
    this.connected = false;
    this.conn = null;
    if (this.closing) return;
    this.lastError = 'connection lost';
    this.emit('status', this.status());
    const retry = () => this.connect().catch(err => {
      this.lastError = err.message;
      this.emit('status', this.status());
      this.retryTimer = setTimeout(retry, this.options.retryMs);
      this.retryTimer.unref?.();
    });
    this.retryTimer = setTimeout(retry, this.options.retryMs);
    this.retryTimer.unref?.();
  }

  /** Show `input` (1–6) in the program window. */
  async programCut(input) {
    if (!this.connected) throw new AppError('NOT_CONNECTED', 'Kramer MV-6 not connected');
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1 || n > KRAMER_INPUTS) throw new AppError('VALIDATION', `Kramer MV-6 input must be 1–${KRAMER_INPUTS} (got ${input})`);
    const r = await this.#cmd(`#SRC-VID ${this.window},${n}`, 'SRC-VID');
    this.#setProgram(Number(r.params[1]) || n);
    this.emit('status', this.status());
  }

  async previewInput() {
    throw new AppError('NOT_SUPPORTED', 'The Kramer MV-6 has no preview bus');
  }

  state() {
    return {
      program: this.program, preview: null,
      inputs: Array.from({ length: KRAMER_INPUTS }, (_, i) => ({ id: i + 1, name: `Input ${i + 1}`, short: `IN${i + 1}` })),
    };
  }

  status() {
    return {
      connected: this.connected, driver: 'kramer-mv6', host: this.options.host, window: this.window,
      model: this.model, ...this.state(), lastError: this.lastError,
    };
  }

  async close() {
    this.closing = true;
    this.connected = false;
    clearTimeout(this.retryTimer);
    this.conn?.close();
    this.conn = null;
  }
}
