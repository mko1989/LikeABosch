// Camera director (WO-039, DEC-012 §4): active microphone → camera preset → switcher program cut.
// Input: `domain.discussion` (wired and wireless) + `room` (shots, overview, settings). Output: device commands.
// Publishes topic `director` { enabled, strategy, target, onAirCamera, busy, log }.
import { EventEmitter } from 'node:events';
import { updateOrder, targetSeat, shotFor, plan, automaticRoom } from './decide.js';

const LOG_SIZE = 30;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Director extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('../state/cache.js').StateCache} deps.cache
   * @param {import('../devices/manager.js').DeviceManager} deps.devices
   * @param {import('../room/store.js').RoomStore} deps.room
   * @param {any} deps.log
   * @param {number} [deps.settleMs]  wait after a recall when the camera can't report completion
   */
  constructor({ cache, devices, room, log, settleMs = 2500 }) {
    super();
    Object.assign(this, { cache, devices, room, log, settleMs });
    this.order = [];
    this.cameraPreset = {};    // camera → preset last recalled by us
    this.onAirCamera = null;   // derived from switcher program input
    this.target = null;        // desired shot
    this.lastCutAt = 0;
    this.logEntries = [];
    this.timer = null;
    this.running = false;
    this.rerun = false;
    this.manualShot = null;
    cache.on('change', topic => {
      if (topic === 'domain.discussion') this.#onDiscussion();
      if (topic === 'room') this.#publish();
    });
    devices.on('program', ({ input }) => {
      this.onAirCamera = this.#cameraForInput(input);
      this.#publish();
    });
    // Know what's on air as soon as the switcher (re)connects, not only after our first cut.
    devices.on('changed', () => {
      const program = devices.publicSwitcher()?.status?.program;
      const cam = program === null || program === undefined ? null : this.#cameraForInput(program);
      if (cam !== this.onAirCamera) { this.onAirCamera = cam; this.#publish(); }
    });
    this.#publish();
  }

  get settings() { return this.room.get().director; }

  #cameraForInput(input) {
    return this.devices.publicCameras().find(c => c.switcherInput === input)?.id ?? null;
  }

  #log(message, extra = {}) {
    this.logEntries.unshift({ at: new Date().toISOString(), message, ...extra });
    this.logEntries.length = Math.min(this.logEntries.length, LOG_SIZE);
    this.log.info(`director: ${message}`);
  }

  state() {
    const s = this.settings;
    return {
      enabled: s.enabled, strategy: s.strategy, delayMs: s.delayMs, minShotMs: s.minShotMs,
      activeOrder: this.order, target: this.target, onAirCamera: this.onAirCamera, busy: this.running, log: this.logEntries,
    };
  }

  #publish() { this.cache.set('director', this.state()); }

  #onDiscussion() {
    const speakers = this.cache.get('domain.discussion')?.data?.speakers ?? [];
    const before = this.order.join();
    this.order = updateOrder(this.order, speakers);
    if (this.order.join() !== before) this.#publish();
    if (!this.settings.enabled) return;
    const seat = targetSeat(this.order, speakers);
    const shot = shotFor(seat, this.#automaticRoom());
    if (!shot || (this.target && this.target.cameraId === shot.cameraId && this.target.preset === shot.preset && this.target.seatId === shot.seatId)) return;
    // Debounce: a new target waits `delayMs`; respect the minimum shot duration of what's on air.
    clearTimeout(this.timer);
    const wait = Math.max(this.settings.delayMs, this.lastCutAt + this.settings.minShotMs - Date.now(), 0);
    this.timer = setTimeout(() => this.#go(shot, 'automatic'), wait);
    this.timer.unref?.();
  }

  /** Room minus cameras taken out of the automation (DEC-015). */
  #automaticRoom() { return automaticRoom(this.room.get(), id => this.devices.cameraAutomation(id)); }

  /** Manual shot (works in auto and manual mode; ignores the per-device automation switches, DEC-015). `seatId` null = overview. */
  async takeShot(seatId) {
    const shot = shotFor(seatId, this.room.get());
    if (!shot) throw new Error(seatId ? `No shot assigned to seat ${seatId} and no overview` : 'No overview shot configured');
    clearTimeout(this.timer);
    await this.#go(shot, 'manual');
    return this.target;
  }

  async #go(shot, reason) {
    this.target = shot;
    this.#publish();
    if (this.running) { this.rerun = true; return; }
    this.running = true;
    try {
      do {
        this.rerun = false;
        await this.#execute(this.target, reason);
      } while (this.rerun);
    } finally {
      this.running = false;
      this.#publish();
    }
  }

  async #execute(target, reason) {
    const manual = reason === 'manual';
    const room = manual ? this.room.get() : this.#automaticRoom();
    const cuts = manual || this.devices.switcherAutomation;
    const steps = plan({ target, onAirCamera: this.onAirCamera, cameraPreset: this.cameraPreset, overview: room.overview, strategy: room.director.strategy, cuts });
    this.#log(`${reason}: ${target.overview ? 'overview' : `seat ${target.seatId}`} → ${target.cameraId} preset ${target.preset}${cuts ? '' : ' (switcher automation off: no cut)'}`, { steps: steps.map(s => s.step) });
    const completed = {};
    for (const s of steps) {
      if (this.rerun) return; // a newer target arrived: re-plan from the current state
      try {
        if (s.step === 'recall') {
          const r = await this.devices.recall(s.cameraId, s.preset);
          this.cameraPreset[s.cameraId] = s.preset;
          completed[s.cameraId] = Boolean(r?.completed);
        } else if (s.step === 'wait') {
          if (!completed[s.cameraId]) await sleep(this.settings.settleMs ?? this.settleMs); // camera can't report arrival
        } else if (s.step === 'cut') {
          const input = this.devices.cameraConfig(s.cameraId).switcherInput;
          if (input === null || input === undefined) { this.#log(`no switcher input for ${s.cameraId}; cut skipped`); continue; }
          if (!this.devices.switcherDriver) { this.#log('switcher not connected; cut skipped'); continue; }
          await this.devices.cut(input);
          this.onAirCamera = s.cameraId;
          this.lastCutAt = Date.now();
        }
      } catch (err) {
        this.#log(`${s.step} on ${s.cameraId} failed: ${err.message}`, { error: true });
        if (s.step === 'recall') delete this.cameraPreset[s.cameraId];
      }
    }
  }

  /** Another project was opened (DEC-016): forget what we know about cameras and shots. */
  reset() {
    clearTimeout(this.timer);
    this.cameraPreset = {};
    this.target = null;
    this.onAirCamera = null;
    this.#publish();
  }

  close() { clearTimeout(this.timer); }
}
