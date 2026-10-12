// Switcher driver factory + in-memory mock switcher (WO-037, DEC-012); Kramer MV-6 and tvONE CORIO (WO-112, DEC-033).
import { EventEmitter } from 'node:events';
import { AtemSwitcher } from './atem.js';
import { KramerSwitcher } from './kramer.js';
import { TvOneSwitcher } from './tvone.js';

/** In-memory switcher with 8 inputs (demos, tests, UI work without hardware). */
export class MockSwitcher extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = { me: 0, ...options };
    this.connected = false;
    this.program = 1;
    this.preview = 2;
    this.cuts = [];
  }
  async connect() { this.connected = true; this.emit('status', this.status()); }
  async programCut(input) {
    this.preview = this.program;
    this.program = Number(input);
    this.cuts.push(this.program);
    this.emit('program', { me: this.options.me, input: this.program });
    this.emit('status', this.status());
  }
  async previewInput(input) {
    this.preview = Number(input);
    this.previews = [...(this.previews ?? []), this.preview];
    this.emit('status', this.status());
  }
  state() {
    return { program: this.program, preview: this.preview, inputs: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Camera ${i + 1}`, short: `CAM${i + 1}` })) };
  }
  status() { return { connected: this.connected, driver: 'mock', me: this.options.me, model: 'Mock switcher', ...this.state(), lastError: null }; }
  async close() { this.connected = false; }
}

export const SWITCHER_DRIVERS = {
  atem: o => new AtemSwitcher(o),
  'kramer-mv6': o => new KramerSwitcher(o),
  'tvone-corio': o => new TvOneSwitcher(o),
  mock: o => new MockSwitcher(o),
};

export function createSwitcher(config) {
  const make = SWITCHER_DRIVERS[config.driver];
  if (!make) throw new Error(`Unknown switcher driver '${config.driver}'`);
  return make(config);
}
