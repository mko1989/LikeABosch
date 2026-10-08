// Blackmagic ATEM switcher driver via atem-connection (WO-037, DEC-012). Program cut on a configurable M/E.
import { EventEmitter } from 'node:events';
import { AppError } from '../../lib/errors.js';

/**
 * Events: `status` (status()), `program` ({ me, input }) when the program input changes (also from the panel).
 */
export class AtemSwitcher extends EventEmitter {
  /**
   * @param {{ host: string, port?: number, me?: number, connectTimeoutMs?: number, AtemClass?: any }} options
   *   `AtemClass` lets tests inject a stub with the atem-connection API.
   */
  constructor(options) {
    super();
    this.options = { me: 0, connectTimeoutMs: 8000, ...options };
    this.connected = false;
    this.lastError = null;
    this.atem = null;
    this.lastProgram = null;
  }

  async connect() {
    const AtemClass = this.options.AtemClass ?? (await import('atem-connection')).Atem;
    const atem = new AtemClass({ disableMultithreaded: true });
    this.atem = atem;
    atem.on('connected', () => { this.connected = true; this.lastError = null; this.#checkProgram(); this.emit('status', this.status()); });
    atem.on('disconnected', () => { this.connected = false; this.emit('status', this.status()); });
    atem.on('error', msg => { this.lastError = String(msg); });
    atem.on('stateChanged', (_state, paths) => {
      if (paths.some(p => p.startsWith('video.mixEffects') || p.startsWith('inputs'))) {
        this.#checkProgram();
        this.emit('status', this.status());
      }
    });
    const ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new AppError('NOT_CONNECTED', `ATEM ${this.options.host}: no connection within ${this.options.connectTimeoutMs} ms`)), this.options.connectTimeoutMs);
      atem.once('connected', () => { clearTimeout(t); resolve(); });
    });
    await atem.connect(this.options.host, this.options.port);
    // atem-connection keeps retrying in the background after a timeout; the device manager shows the status.
    await ready;
  }

  #me() { return this.atem?.state?.video?.mixEffects?.[this.options.me]; }

  #checkProgram() {
    const input = this.#me()?.programInput ?? null;
    if (input !== this.lastProgram) {
      this.lastProgram = input;
      if (input !== null) this.emit('program', { me: this.options.me, input });
    }
  }

  /** Hard cut of `input` to program on the configured M/E (user decision, DEC-012). */
  async programCut(input) {
    if (!this.connected) throw new AppError('NOT_CONNECTED', 'ATEM not connected');
    const n = Number(input);
    if (!Number.isInteger(n) || n < 0) throw new AppError('VALIDATION', `ATEM input must be a source id (got ${input})`);
    await this.atem.changeProgramInput(n, this.options.me);
  }

  /** Put `input` on the preview bus of the configured M/E (WO-053). */
  async previewInput(input) {
    if (!this.connected) throw new AppError('NOT_CONNECTED', 'ATEM not connected');
    const n = Number(input);
    if (!Number.isInteger(n) || n < 0) throw new AppError('VALIDATION', `ATEM input must be a source id (got ${input})`);
    await this.atem.changePreviewInput(n, this.options.me);
  }

  /** { program, preview, inputs: [{ id, name, short }] } */
  state() {
    const me = this.#me();
    const inputs = Object.values(this.atem?.state?.inputs ?? {})
      .filter(Boolean)
      .map(i => ({ id: i.inputId, name: i.longName, short: i.shortName }));
    return { program: me?.programInput ?? null, preview: me?.previewInput ?? null, inputs };
  }

  status() {
    return {
      connected: this.connected, driver: 'atem', host: this.options.host, me: this.options.me,
      model: this.atem?.state?.info?.productIdentifier ?? null, ...this.state(), lastError: this.lastError,
    };
  }

  async close() {
    this.connected = false;
    const atem = this.atem;
    this.atem = null;
    if (atem) await atem.destroy().catch(() => {});
  }
}
