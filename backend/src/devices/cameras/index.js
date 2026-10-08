// Camera driver factory + in-memory mock driver (WO-036, DEC-012).
import { EventEmitter } from 'node:events';
import { ViscaCamera } from './visca.js';
import { PanasonicCamera } from './panasonic.js';
import { OnvifCamera } from './onvif.js';

/** In-memory camera (demos, tests, UI work without hardware). */
export class MockCamera extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.connected = false;
    this.preset = null;
    this.presets = new Set([1, 2, 3]);
    this.moving = null;
    this.log = [];
  }
  async connect() { this.connected = true; this.emit('status', this.status()); }
  async recallPreset(preset) { this.preset = preset; this.log.push(['recall', preset]); return { acknowledged: true, completed: true }; }
  async storePreset(preset) { this.presets.add(preset); this.log.push(['store', preset]); return preset; }
  async move(v) { this.moving = v; this.log.push(['move', v]); }
  async stop() { this.moving = null; this.log.push(['stop']); }
  async listPresets() { return null; }
  async ping() { return 'on'; }
  status() { return { connected: this.connected, driver: 'mock', preset: this.preset, moving: Boolean(this.moving), lastError: null }; }
  async close() { this.connected = false; }
}

export const CAMERA_DRIVERS = {
  visca: o => new ViscaCamera(o),
  panasonic: o => new PanasonicCamera(o),
  onvif: o => new OnvifCamera(o),
  mock: o => new MockCamera(o),
};

/**
 * @param {{ driver: keyof CAMERA_DRIVERS } & Record<string, any>} config
 */
export function createCamera(config) {
  const make = CAMERA_DRIVERS[config.driver];
  if (!make) throw new Error(`Unknown camera driver '${config.driver}'`);
  return make(config);
}
