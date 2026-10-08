// Room layout store (WO-034, DEC-012 §3): floor plan, seat/camera placements, shots, overview, director settings.
// Persisted as <dataDir>/room.json (+ background image file); published to the cache as topic `room`.
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../lib/errors.js';
import { validAction } from '../companion/client.js';

export const DEFAULT_ROOM = {
  version: 1,
  canvas: { x: 0, y: 0, width: 1600, height: 1000 }, // room outline in workspace units (1 unit ≈ 1 cm); items may lie outside
  background: null,            // { file, type, updatedAt }
  seats: {},                   // seatId → { x, y, rotation }
  cameras: {},                 // cameraId → { x, y, rotation }
  desks: {},                   // interpreter desk seatId (GetInterpreterSeats) → { x, y, rotation } (WO-048)
  shots: {},                   // seatId → { cameraId, preset }
  overview: null,              // { cameraId, preset }
  director: { enabled: false, strategy: 'safe', delayMs: 500, minShotMs: 3000, settleMs: 2500 },
  operate: { cogSendsPreview: false }, // room view behaviour in operate mode (WO-053)
  seatNames: {},               // seatId → name as the system called it (WO-096): matches the seats on another system
  triggers: { seats: {}, desks: {} }, // id → { on: [action], off: [action] }: Companion buttons (WO-099, DEC-027)
};

export const TRIGGER_KINDS = ['seats', 'desks'];
const MAX_TRIGGER_ACTIONS = 8;
const triggerSet = t => t && typeof t === 'object' && !Array.isArray(t)
  && ['on', 'off'].every(k => t[k] === undefined || (Array.isArray(t[k]) && t[k].length <= MAX_TRIGGER_ACTIONS && t[k].every(validAction)));
const cleanTrigger = t => ({ on: (t.on ?? []).map(({ page, row, column, action }) => ({ page, row, column, action })), off: (t.off ?? []).map(({ page, row, column, action }) => ({ page, row, column, action })) });

export const BACKGROUND_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }; // no SVG: could carry scripts
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const placement = p => p && typeof p === 'object' && num(p.x, -10_000, 10_000) && num(p.y, -10_000, 10_000) && (p.rotation === undefined || num(p.rotation, -360, 360));
const presetId = v => (typeof v === 'number' && Number.isInteger(v) && v >= 0) || (typeof v === 'string' && v.length > 0 && v.length <= 64);
const shot = s => s && typeof s === 'object' && typeof s.cameraId === 'string' && presetId(s.preset);

/**
 * A room from an imported project file (DEC-016 §6): defaults for missing parts, invalid entries dropped.
 * The background is set by the caller (the image travels separately).
 * @param {any} raw
 */
export function sanitizeRoom(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const places = v => Object.fromEntries(Object.entries(obj(v)).filter(([id, p]) => id && placement(p)).map(([id, p]) => [id, { x: p.x, y: p.y, rotation: p.rotation ?? 0 }]));
  const c = obj(r.canvas);
  const canvasOk = num(c.width, 100, 20_000) && num(c.height, 100, 20_000) && (c.x === undefined || num(c.x, -10_000, 10_000)) && (c.y === undefined || num(c.y, -10_000, 10_000));
  const d = obj(r.director);
  const directorOk = {
    enabled: typeof d.enabled === 'boolean', strategy: d.strategy === 'safe' || d.strategy === 'live',
    delayMs: num(d.delayMs, 0, 10_000), minShotMs: num(d.minShotMs, 0, 60_000), settleMs: num(d.settleMs, 0, 15_000),
  };
  return {
    ...structuredClone(DEFAULT_ROOM),
    canvas: canvasOk ? { x: c.x ?? 0, y: c.y ?? 0, width: c.width, height: c.height } : structuredClone(DEFAULT_ROOM.canvas),
    seats: places(r.seats),
    cameras: places(r.cameras),
    desks: places(r.desks),
    shots: Object.fromEntries(Object.entries(obj(r.shots)).filter(([id, s]) => id && shot(s)).map(([id, s]) => [id, { cameraId: s.cameraId, preset: s.preset }])),
    overview: shot(r.overview) ? { cameraId: r.overview.cameraId, preset: r.overview.preset } : null,
    director: { ...DEFAULT_ROOM.director, ...Object.fromEntries(Object.entries(directorOk).filter(([, ok]) => ok).map(([k]) => [k, d[k]])) },
    operate: { ...DEFAULT_ROOM.operate, ...(typeof obj(r.operate).cogSendsPreview === 'boolean' ? { cogSendsPreview: r.operate.cogSendsPreview } : {}) },
    seatNames: Object.fromEntries(Object.entries(obj(r.seatNames)).filter(([id, n]) => id && typeof n === 'string' && n.length <= 200)),
    triggers: Object.fromEntries(TRIGGER_KINDS.map(kind => [kind, Object.fromEntries(Object.entries(obj(obj(r.triggers)[kind]))
      .filter(([id, t]) => id && triggerSet(t)).map(([id, t]) => [id, cleanTrigger(t)]))])),
  };
}

export class RoomStore {
  /** @param {{ dataDir: string, cache: import('../state/cache.js').StateCache, log: any }} deps */
  constructor({ dataDir, cache, log }) {
    this.dir = dataDir;
    this.file = join(dataDir, 'room.json');
    this.cache = cache;
    this.log = log;
    this.room = structuredClone(DEFAULT_ROOM);
    this.queue = Promise.resolve(); // serialise mutations: concurrent saves would race on the temp file
    /** @type {(() => void) | null} called after every save (projects: updatedAt, DEC-016) */
    this.onSaved = null;
  }

  /** Switch to another folder (a project, DEC-016): waits for pending saves, then loads that folder's room. */
  async open(dir) {
    await this.queue;
    this.dir = dir;
    this.file = join(dir, 'room.json');
    this.room = structuredClone(DEFAULT_ROOM);
    await this.start();
  }

  /** Resolves when all pending saves are on disk. */
  flush() { return this.queue; }

  async start() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      this.room = { ...structuredClone(DEFAULT_ROOM), ...saved, canvas: { ...DEFAULT_ROOM.canvas, ...saved.canvas }, director: { ...DEFAULT_ROOM.director, ...saved.director }, operate: { ...DEFAULT_ROOM.operate, ...saved.operate }, triggers: { ...structuredClone(DEFAULT_ROOM.triggers), ...saved.triggers } };
    } catch (err) {
      if (err.code !== 'ENOENT') this.log.warn(`cannot read ${this.file}: ${err.message}`);
    }
    this.#publish();
  }

  get() { return this.room; }

  #publish() { this.cache.set('room', this.room); }

  async #save() {
    await mkdir(this.dir, { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.room, null, 2));
    await rename(`${this.file}.tmp`, this.file);
    this.#publish();
    this.onSaved?.();
  }

  #mutate(fn) {
    const run = async () => {
      const next = structuredClone(this.room);
      fn(next);
      this.room = next;
      await this.#save();
      return this.room;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  setCanvas(canvas) {
    if (!canvas || !num(canvas.width, 100, 20_000) || !num(canvas.height, 100, 20_000)
      || (canvas.x !== undefined && !num(canvas.x, -10_000, 10_000)) || (canvas.y !== undefined && !num(canvas.y, -10_000, 10_000))) {
      throw new AppError('VALIDATION', 'canvas needs width and height (100–20000) and optional x, y (±10000)');
    }
    return this.#mutate(r => { r.canvas = { x: canvas.x ?? r.canvas.x ?? 0, y: canvas.y ?? r.canvas.y ?? 0, width: canvas.width, height: canvas.height }; });
  }

  placeSeat(seatId, p) {
    if (!placement(p)) throw new AppError('VALIDATION', 'placement needs numeric x, y (and optional rotation)');
    return this.#mutate(r => { r.seats[seatId] = { x: p.x, y: p.y, rotation: p.rotation ?? 0 }; });
  }

  unplaceSeat(seatId) { return this.#mutate(r => { delete r.seats[seatId]; }); }

  /**
   * Many placements in one save (WO-055): { seats?, cameras?, desks? }, each id → { x, y, rotation } or null (unplace).
   * All entries are validated first, so a bad one changes nothing.
   */
  placeMany(patch) {
    const kinds = ['seats', 'cameras', 'desks'];
    const details = [];
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) details.push('body must be an object');
    else {
      for (const [kind, items] of Object.entries(patch)) {
        if (!kinds.includes(kind)) { details.push(`${kind}: unknown collection`); continue; }
        if (!items || typeof items !== 'object' || Array.isArray(items)) { details.push(`${kind}: must be an object`); continue; }
        const entries = Object.entries(items);
        if (entries.length > 2000) details.push(`${kind}: at most 2000 entries`);
        for (const [id, p] of entries) if (!id || (p !== null && !placement(p))) details.push(`${kind}.${id}: needs numeric x, y (and optional rotation) or null`);
      }
    }
    if (details.length) throw new AppError('VALIDATION', 'Invalid placements', { details: details.slice(0, 20) });
    return this.#mutate(r => {
      for (const [kind, items] of Object.entries(patch)) {
        for (const [id, p] of Object.entries(items)) {
          if (p === null) {
            delete r[kind][id];
            if (kind === 'cameras') this.#dropCameraRefs(r, id);
          } else r[kind][id] = { x: p.x, y: p.y, rotation: p.rotation ?? 0 };
        }
      }
    });
  }

  /** Interpreter desks are not in GetSeats (own ids), so they have their own placements (WO-048, DEC-014). */
  placeDesk(deskId, p) {
    if (!placement(p)) throw new AppError('VALIDATION', 'placement needs numeric x, y (and optional rotation)');
    return this.#mutate(r => { r.desks[deskId] = { x: p.x, y: p.y, rotation: p.rotation ?? 0 }; });
  }

  unplaceDesk(deskId) { return this.#mutate(r => { delete r.desks[deskId]; }); }

  placeCamera(cameraId, p) {
    if (!placement(p)) throw new AppError('VALIDATION', 'placement needs numeric x, y (and optional rotation)');
    return this.#mutate(r => { r.cameras[cameraId] = { x: p.x, y: p.y, rotation: p.rotation ?? 0 }; });
  }

  unplaceCamera(cameraId) {
    return this.#mutate(r => {
      delete r.cameras[cameraId];
      this.#dropCameraRefs(r, cameraId);
    });
  }

  /** A camera removed from the plan can't take shots any more. */
  #dropCameraRefs(r, cameraId) {
    for (const [seat, s] of Object.entries(r.shots)) if (s.cameraId === cameraId) delete r.shots[seat];
    if (r.overview?.cameraId === cameraId) r.overview = null;
  }

  setShot(seatId, s) {
    if (!shot(s)) throw new AppError('VALIDATION', 'shot needs cameraId (string) and preset (number or token)');
    return this.#mutate(r => { r.shots[seatId] = { cameraId: s.cameraId, preset: s.preset }; });
  }

  clearShot(seatId) { return this.#mutate(r => { delete r.shots[seatId]; }); }

  /** Remember the system's names of these seats (WO-096); saves only when something changed. */
  setSeatNames(names) {
    const known = this.room.seatNames ?? {};
    if (Object.entries(names).every(([id, n]) => known[id] === n)) return Promise.resolve(this.room);
    return this.#mutate(r => { r.seatNames = { ...(r.seatNames ?? {}), ...names }; });
  }

  /**
   * Move everything stored per seat to other seat ids (WO-096 "Match seats"): placement, shot, name.
   * `map`: old id → new id, or null to drop that seat from the plan. New ids must be distinct.
   */
  remapSeats(map) {
    const entries = map && typeof map === 'object' && !Array.isArray(map) ? Object.entries(map) : null;
    if (!entries) throw new AppError('VALIDATION', 'map must be an object of old seat id → new seat id | null');
    const targets = entries.map(([, to]) => to).filter(to => to !== null);
    const details = [];
    for (const [from, to] of entries) if (!from || (to !== null && (typeof to !== 'string' || !to))) details.push(`${from}: invalid target`);
    if (new Set(targets).size !== targets.length) details.push('two seats are mapped to the same seat');
    if (details.length) throw new AppError('VALIDATION', 'Invalid seat mapping', { details: details.slice(0, 20) });
    return this.#mutate(r => {
      const moved = { seats: {}, shots: {}, seatNames: {} };
      for (const [from, to] of entries) {
        for (const k of ['seats', 'shots', 'seatNames']) {
          if (r[k]?.[from] !== undefined) { if (to !== null) moved[k][to] = r[k][from]; delete r[k][from]; }
        }
      }
      // Seats not in the map keep their entries unless a mapped seat lands on their id.
      for (const k of ['seats', 'shots', 'seatNames']) r[k] = { ...(r[k] ?? {}), ...moved[k] };
      // Companion triggers of seats move the same way (WO-099).
      const seatTriggers = r.triggers?.seats ?? {};
      const movedTriggers = {};
      for (const [from, to] of entries) {
        if (seatTriggers[from] !== undefined) { if (to !== null) movedTriggers[to] = seatTriggers[from]; delete seatTriggers[from]; }
      }
      r.triggers = { ...structuredClone(DEFAULT_ROOM.triggers), ...r.triggers, seats: { ...seatTriggers, ...movedTriggers } };
    });
  }

  /**
   * Companion buttons of one seat or interpreter desk (WO-099): { on: [action], off: [action] }; both empty (or null)
   * removes the entry.
   * @param {'seats' | 'desks'} kind
   * @param {string} id
   * @param {{ on?: any[], off?: any[] } | null} t
   */
  setTrigger(kind, id, t) {
    if (!TRIGGER_KINDS.includes(kind)) throw new AppError('VALIDATION', `kind must be one of ${TRIGGER_KINDS.join(', ')}`);
    if (!id || id.length > 200) throw new AppError('VALIDATION', 'Invalid id');
    if (t !== null && !triggerSet(t)) {
      throw new AppError('VALIDATION', 'Invalid Companion trigger', { details: [`on/off: arrays of at most ${MAX_TRIGGER_ACTIONS} { page 1–999, row, column −99…99, action press|down|up }`] });
    }
    return this.#mutate(r => {
      r.triggers = { ...structuredClone(DEFAULT_ROOM.triggers), ...r.triggers };
      const clean = t && cleanTrigger(t);
      if (!clean || (!clean.on.length && !clean.off.length)) delete r.triggers[kind][id];
      else r.triggers[kind][id] = clean;
    });
  }

  /** Delete saved seat shots (WO-092): all, or only those of one camera; the overview shot too when it matches. */
  clearShots({ cameraId } = {}) {
    if (cameraId !== undefined && (typeof cameraId !== 'string' || !cameraId)) throw new AppError('VALIDATION', 'cameraId must be a camera id');
    return this.#mutate(r => {
      for (const [seat, s] of Object.entries(r.shots)) if (cameraId === undefined || s.cameraId === cameraId) delete r.shots[seat];
      if (cameraId === undefined || r.overview?.cameraId === cameraId) r.overview = null;
    });
  }

  /**
   * Reset parts of the room (WO-091 "Clear…"): layout = every placement + the room outline; shots = seat shots and
   * overview; background = the floor plan image. Director and operate settings stay.
   */
  async clear({ layout = false, shots = false, background = false } = {}) {
    if (background) await this.clearBackground();
    return this.#mutate(r => {
      if (layout) { r.seats = {}; r.cameras = {}; r.desks = {}; r.canvas = structuredClone(DEFAULT_ROOM.canvas); }
      if (shots) { r.shots = {}; r.overview = null; }
    });
  }

  /** Many shots in one save (WO-056): seatId → { cameraId, preset } or null (clear). All validated first. */
  setShots(map) {
    const details = [];
    if (!map || typeof map !== 'object' || Array.isArray(map)) details.push('body must be an object of seatId → shot | null');
    else {
      const entries = Object.entries(map);
      if (entries.length > 2000) details.push('at most 2000 shots');
      for (const [id, s] of entries) if (!id || (s !== null && !shot(s))) details.push(`${id}: needs cameraId (string) and preset (number or token), or null`);
    }
    if (details.length) throw new AppError('VALIDATION', 'Invalid shots', { details: details.slice(0, 20) });
    return this.#mutate(r => {
      for (const [id, s] of Object.entries(map)) {
        if (s === null) delete r.shots[id]; else r.shots[id] = { cameraId: s.cameraId, preset: s.preset };
      }
    });
  }

  setOverview(s) {
    if (s !== null && !shot(s)) throw new AppError('VALIDATION', 'overview needs cameraId and preset, or null');
    return this.#mutate(r => { r.overview = s && { cameraId: s.cameraId, preset: s.preset }; });
  }

  /** Operate-mode options of the room view (WO-053): cogSendsPreview = a camera's ⚙ click also sets the switcher preview. */
  setOperate(patch) {
    const ok = patch && typeof patch === 'object' && !Array.isArray(patch)
      && Object.entries(patch).every(([k, v]) => k === 'cogSendsPreview' && typeof v === 'boolean');
    if (!ok) throw new AppError('VALIDATION', 'Invalid operate settings', { details: ['allowed: cogSendsPreview (boolean)'] });
    return this.#mutate(r => { r.operate = { ...r.operate, ...patch }; });
  }

  setDirector(patch) {
    const allowed = {
      enabled: v => typeof v === 'boolean',
      strategy: v => v === 'safe' || v === 'live',
      delayMs: v => num(v, 0, 10_000),
      minShotMs: v => num(v, 0, 60_000),
      settleMs: v => num(v, 0, 15_000),
    };
    const details = Object.entries(patch ?? {}).filter(([k, v]) => !(k in allowed) || !allowed[k](v)).map(([k]) => `${k}: invalid`);
    if (details.length || !patch || typeof patch !== 'object') throw new AppError('VALIDATION', 'Invalid director settings', { details });
    return this.#mutate(r => { r.director = { ...r.director, ...patch }; });
  }

  async setBackground(buffer, type) {
    const ext = BACKGROUND_TYPES[type];
    if (!ext) throw new AppError('VALIDATION', `Floor plan must be PNG, JPEG or WebP (got ${type || 'no type'})`);
    if (!buffer?.length) throw new AppError('VALIDATION', 'Empty image');
    await mkdir(this.dir, { recursive: true });
    const file = `room-background.${ext}`;
    if (this.room.background?.file && this.room.background.file !== file) await rm(join(this.dir, this.room.background.file), { force: true });
    await writeFile(join(this.dir, file), buffer);
    return this.#mutate(r => { r.background = { file, type, updatedAt: new Date().toISOString() }; });
  }

  async clearBackground() {
    if (this.room.background) await rm(join(this.dir, this.room.background.file), { force: true });
    return this.#mutate(r => { r.background = null; });
  }

  backgroundPath() { return this.room.background ? join(this.dir, this.room.background.file) : null; }
}
