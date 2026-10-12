// tvONE CORIOmaster / CORIOmatrix driver (WO-112, DEC-033): the CORIOmaster API over TCP (default port 10001).
//   login(admin,adminpw)          → !Info : User admin Logged In
//   Window1.Input = Slot1.In2     → Window1.Input = Slot1.In2 / !Done Window1.Input        (a cut)
//   Window1.Input                 → Window1.Input = Slot1.In2 / !Done Window1.Input        (read)
//   failures                      → !Error ...
// Cameras keep an integer switcher input (DEC-012): input n = the n-th name of `inputs` (e.g. "Slot1.In1,Slot1.In2").
// The CORIO does not push window changes unless subscribed, so the program window is re-read every `pollMs`.
import { EventEmitter } from 'node:events';
import { AppError } from '../../lib/errors.js';
import { LineConnection } from './line-connection.js';

export const DEFAULT_CORIO_INPUTS = ['Slot1.In1', 'Slot1.In2', 'Slot1.In3', 'Slot1.In4'];
const NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;

/** "Slot1.In1, Slot1.In2" or an array → names (invalid ones dropped). */
export function corioInputs(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const names = list.map(x => String(x).trim()).filter(x => NAME.test(x));
  return names.length ? names : DEFAULT_CORIO_INPUTS;
}

/** Events: `status` (status()), `program` ({ me, input }) when the program window's input changes. */
export class TvOneSwitcher extends EventEmitter {
  /**
   * @param {{ host: string, port?: number | null, username?: string, password?: string, window?: string | number,
   *   previewWindow?: string | null, inputs?: string | string[], pollMs?: number, retryMs?: number,
   *   connectTimeoutMs?: number, commandTimeoutMs?: number }} options
   */
  constructor(options) {
    super();
    this.options = { username: 'admin', password: 'adminpw', pollMs: 2000, retryMs: 5000, ...options, port: options.port ?? 10001 };
    this.inputs = corioInputs(this.options.inputs);
    this.connected = false;
    this.lastError = null;
    this.program = null;
    this.preview = null;
    this.model = null;
    this.conn = null;
    this.closing = false;
    this.timer = null;
  }

  /** "Window1" (a number n is taken as "Window<n>"). */
  get window() { return windowName(this.options.window) ?? 'Window1'; }
  get previewWindow() { return windowName(this.options.previewWindow); }

  async connect() {
    this.closing = false;
    clearTimeout(this.timer);
    this.conn?.close();
    const conn = new LineConnection({ host: this.options.host, port: this.options.port, eol: '\r\n', name: 'tvONE CORIO',
      connectTimeoutMs: this.options.connectTimeoutMs, commandTimeoutMs: this.options.commandTimeoutMs });
    this.conn = conn;
    conn.on('close', () => this.#lost(conn));
    await conn.open();
    try {
      const { username, password } = this.options;
      if (username) {
        // Without security the CORIO may answer the login with an error but still take commands: the read below decides.
        await conn.command(`login(${username},${password ?? ''})`, line => (/^!Error/i.test(line) ? 'error' : /^!Info/i.test(line) && /log/i.test(line)))
          .catch(err => { this.lastError = err.message; });
      }
      this.model = await this.#read('CORIOmax.Model_Name').catch(() => null);
      this.#setProgram(await this.#read(`${this.window}.Input`));
      if (this.previewWindow) this.preview = this.#inputNumber(await this.#read(`${this.previewWindow}.Input`).catch(() => null));
    } catch (err) {
      conn.close();
      this.conn = null;
      throw err;
    }
    this.connected = true;
    this.lastError = null;
    this.emit('status', this.status());
    this.#schedulePoll();
  }

  /** Read a property: the answer is "<path> = <value>" followed by "!Done <path>". */
  async #read(path) {
    const lines = await this.conn.command(path, line => (/^!Error/i.test(line) ? 'error' : line.toLowerCase().startsWith(`!done ${path.toLowerCase()}`)), { collectAll: true });
    const value = lines.map(l => l.split(' = ')).find(([k]) => k.trim().toLowerCase() === path.toLowerCase())?.[1];
    return value === undefined ? null : value.trim();
  }

  async #write(path, value) {
    await this.conn.command(`${path} = ${value}`, line => (/^!Error/i.test(line) ? 'error' : line.toLowerCase().startsWith(`!done ${path.toLowerCase()}`)), { collectAll: true });
  }

  #inputNumber(name) {
    const i = name ? this.inputs.findIndex(x => x.toLowerCase() === name.toLowerCase()) : -1;
    return i < 0 ? null : i + 1;
  }

  #setProgram(name) {
    const input = this.#inputNumber(name);
    this.programName = name;
    if (input === this.program) return;
    this.program = input;
    if (input !== null) this.emit('program', { me: 0, input });
  }

  #schedulePoll() {
    clearTimeout(this.timer);
    if (this.closing || !this.options.pollMs) return;
    this.timer = setTimeout(async () => {
      if (!this.connected) return;
      try {
        const before = this.program;
        this.#setProgram(await this.#read(`${this.window}.Input`));
        if (this.program !== before) this.emit('status', this.status());
      } catch { /* a lost connection is handled by #lost */ }
      this.#schedulePoll();
    }, this.options.pollMs);
    this.timer.unref?.();
  }

  #lost(conn) {
    if (conn !== this.conn) return;
    this.connected = false;
    this.conn = null;
    clearTimeout(this.timer);
    if (this.closing) return;
    this.lastError = 'connection lost';
    this.emit('status', this.status());
    const retry = () => this.connect().catch(err => {
      this.lastError = err.message;
      this.emit('status', this.status());
      this.timer = setTimeout(retry, this.options.retryMs);
      this.timer.unref?.();
    });
    this.timer = setTimeout(retry, this.options.retryMs);
    this.timer.unref?.();
  }

  #name(input) {
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1 || n > this.inputs.length) {
      throw new AppError('VALIDATION', `tvONE input must be 1–${this.inputs.length} (the list of CORIO inputs; got ${input})`);
    }
    return this.inputs[n - 1];
  }

  /** Route input n (its CORIO name) to the program window. */
  async programCut(input) {
    if (!this.connected) throw new AppError('NOT_CONNECTED', 'tvONE CORIO not connected');
    const name = this.#name(input);
    await this.#write(`${this.window}.Input`, name);
    this.#setProgram(name);
    this.emit('status', this.status());
  }

  /** Route input n to the preview window, if one is configured. */
  async previewInput(input) {
    if (!this.previewWindow) throw new AppError('NOT_SUPPORTED', 'No preview window configured for the tvONE CORIO');
    if (!this.connected) throw new AppError('NOT_CONNECTED', 'tvONE CORIO not connected');
    const name = this.#name(input);
    await this.#write(`${this.previewWindow}.Input`, name);
    this.preview = Number(input);
    this.emit('status', this.status());
  }

  state() {
    return { program: this.program, preview: this.previewWindow ? this.preview : null, inputs: this.inputs.map((name, i) => ({ id: i + 1, name, short: name.replace(/^Slot(\d+)\.In(\d+)$/i, 'S$1I$2') })) };
  }

  status() {
    return {
      connected: this.connected, driver: 'tvone-corio', host: this.options.host, window: this.window, previewWindow: this.previewWindow,
      model: this.model, programName: this.programName ?? null, ...this.state(), lastError: this.lastError,
    };
  }

  async close() {
    this.closing = true;
    this.connected = false;
    clearTimeout(this.timer);
    this.conn?.close();
    this.conn = null;
  }
}

function windowName(w) {
  if (Number.isInteger(w) && w > 0) return `Window${w}`;
  if (typeof w === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(w.trim())) return w.trim();
  return null;
}
