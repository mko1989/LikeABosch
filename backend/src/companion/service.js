// Companion triggers (WO-099, DEC-027): seat / interpreter desk microphone on → the seat's "on" buttons, off → "off".
// Input: `domain.discussion` (seats, all systems), `interpretationRoutings` (wired desks), `domain.interpreterDesks`
// (DCN desks); triggers from the room, target from the devices. Publishes topic `devices.companion` { config, status, log }.
import { sendAction, ping, locationLabel } from './client.js';

const LOG_SIZE = 30;

/** Activity sources: which ids are "activated" according to one cache topic. */
const SOURCES = [
  { topic: 'domain.discussion', kind: 'seats', active: d => (d?.speakers ?? []).filter(s => s.micState === 'on').map(s => String(s.seatId)) },
  // wired (WO-048): a desk is listed only while its microphone is on; the state names the active output
  { topic: 'interpretationRoutings', kind: 'desks', active: d => (d?.routings ?? []).filter(r => r.microphoneState && String(r.microphoneState).toLowerCase() !== 'off').map(r => String(r.seatId)) },
  { topic: 'domain.interpreterDesks', kind: 'desks', active: d => (Array.isArray(d) ? d : []).filter(x => x.live).map(x => String(x.id)) },
];
const KIND_LABEL = { seats: 'seat', desks: 'desk' };

export class CompanionService {
  /**
   * @param {object} deps
   * @param {import('../state/cache.js').StateCache} deps.cache
   * @param {import('../devices/manager.js').DeviceManager} deps.devices
   * @param {import('../room/store.js').RoomStore} deps.room
   * @param {any} deps.log
   */
  constructor({ cache, devices, room, log }) {
    Object.assign(this, { cache, devices, room, log });
    /** topic → Set of active ids, or null = no baseline yet (first data after a (re)connect does not fire) */
    this.previous = new Map(SOURCES.map(s => [s.topic, null]));
    this.logEntries = [];
    this.status = { lastOkAt: null, lastError: null };
    this.queue = Promise.resolve();
    this.onChange = topic => {
      const source = SOURCES.find(s => s.topic === topic);
      if (source) this.#onActivity(source);
    };
    cache.on('change', this.onChange);
    this.onConfig = () => this.#publish();
    devices.on('companion', this.onConfig);
    for (const s of SOURCES) this.#onActivity(s);
    this.#publish();
  }

  get config() { return this.devices.companion; }

  state() { return { config: this.config && { ...this.config }, status: { ...this.status }, log: this.logEntries.map(e => ({ ...e })) }; }

  #publish() { this.cache.set('devices.companion', this.state()); }

  #log(message, extra = {}) {
    this.logEntries.unshift({ at: new Date().toISOString(), message, ...extra });
    this.logEntries.length = Math.min(this.logEntries.length, LOG_SIZE);
  }

  #onActivity(source) {
    const data = this.cache.get(source.topic)?.data;
    if (data === null || data === undefined) { this.previous.set(source.topic, null); return; }
    const now = new Set(source.active(data));
    const before = this.previous.get(source.topic);
    this.previous.set(source.topic, now);
    if (!before) return; // baseline
    for (const id of now) if (!before.has(id)) this.#fire(source.kind, id, 'on');
    for (const id of before) if (!now.has(id)) this.#fire(source.kind, id, 'off');
  }

  #fire(kind, id, edge) {
    const actions = this.room.get().triggers?.[kind]?.[id]?.[edge] ?? [];
    if (!actions.length) return;
    const what = `${KIND_LABEL[kind]} ${id} ${edge === 'on' ? 'activated' : 'deactivated'}`;
    const cfg = this.config;
    if (!cfg?.host || !cfg.enabled) {
      this.#log(`${what}: not sent (${cfg?.host ? 'Companion triggers are switched off' : 'no Companion configured'})`, { skipped: true });
      this.#publish();
      return;
    }
    // One queue: buttons go out in the order things happened (a "down" before its "up").
    this.queue = this.queue.then(() => this.#send(cfg, actions, what));
  }

  async #send(cfg, actions, what) {
    for (const a of actions) {
      try {
        await sendAction(cfg, a);
        this.status = { ...this.status, lastOkAt: new Date().toISOString(), lastError: null };
        this.#log(`${what}: ${a.action} ${locationLabel(a)}`);
      } catch (err) {
        this.status = { ...this.status, lastError: err.message };
        this.#log(`${what}: ${a.action} ${locationLabel(a)} failed: ${err.message}`, { error: true });
        this.log.warn(`companion: ${err.message}`);
      }
    }
    this.#publish();
  }

  /** Reachability check from Settings → Companion. Optional target overrides the saved one (test before saving). */
  async test(target = this.config) {
    try {
      const r = await ping(target);
      this.status = { ...this.status, lastOkAt: new Date().toISOString(), lastError: null };
      return { ok: true, ...r };
    } catch (err) {
      this.status = { ...this.status, lastError: err.message };
      throw err;
    } finally { this.#publish(); }
  }

  /** Press one button by hand (picker "Test"). Ignores the master switch: the operator asked for it. */
  async press(action) {
    if (!this.config?.host) throw new Error('No Companion configured');
    await sendAction(this.config, action);
    this.#log(`test: ${action.action} ${locationLabel(action)}`);
    this.status = { ...this.status, lastOkAt: new Date().toISOString(), lastError: null };
    this.#publish();
  }

  /** Resolves when all queued button requests are done (tests). */
  idle() { return this.queue; }

  close() {
    this.cache.off('change', this.onChange);
    this.devices.off('companion', this.onConfig);
  }
}
