// Projects (WO-057, DEC-016): a project = room + cameras/switcher, one folder per project, auto-saved.
// Layout: <data>/project.json { current } · <data>/projects/<id>/{project.json, room.json, devices.json, room-background.*}
// Publishes topic `project` { current, projects }.
import { EventEmitter } from 'node:events';
import { readFile, writeFile, rename, mkdir, readdir, rm, copyFile, stat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AppError } from '../lib/errors.js';
import { BACKGROUND_TYPES, sanitizeRoom } from '../room/store.js';
import { sanitizeDevices } from '../devices/manager.js';

export const FILE_FORMAT = 'likeabosch-project';
const PROJECT_FILES = ['room.json', 'devices.json', ...Object.values(BACKGROUND_TYPES).map(ext => `room-background.${ext}`)];
const MAX_BACKGROUND = 5 * 1024 * 1024;

const exists = p => stat(p).then(() => true, () => false);
const readJson = async (p, fallback = null) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };
async function writeJson(p, data, mode) {
  await writeFile(`${p}.tmp`, JSON.stringify(data, null, 2), mode ? { mode } : undefined);
  await rename(`${p}.tmp`, p);
}
const slug = name => String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';

/** A project name: trimmed, 1–80 characters. */
function cleanName(name) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n || n.length > 80) throw new AppError('VALIDATION', 'Project name must be 1–80 characters');
  return n;
}

export class ProjectManager extends EventEmitter {
  /**
   * @param {object} deps
   * @param {string} deps.dataDir
   * @param {import('../room/store.js').RoomStore} deps.room
   * @param {import('../devices/manager.js').DeviceManager} deps.devices
   * @param {import('../state/cache.js').StateCache} deps.cache
   * @param {any} deps.log
   * @param {{ dir: string, name: string, copySettings: boolean }[]} [deps.legacyDirs]  imported once into a new folder
   */
  constructor({ dataDir, room, devices, cache, log, legacyDirs = [] }) {
    super();
    Object.assign(this, { dataDir, room, devices, cache, log, legacyDirs });
    this.projectsDir = join(dataDir, 'projects');
    this.pointer = join(dataDir, 'project.json');
    this.current = null;      // open project id
    this.metas = new Map();   // id → { name, createdAt, updatedAt, system? } (system: DEC-025)
    /** The DICENTIS system LikeABosch is connected to: { key, label, type, host, port } | null (DEC-025). */
    this.connected = null;
    /** How the open project was opened last: { id, reason: 'user' | 'system' | 'system-new' | 'system-adopt', label?, at } */
    this.lastOpen = null;
    this.queue = Promise.resolve();
    room.onSaved = () => this.#touch();
    devices.onSaved = () => this.#touch();
  }

  dirOf(id) { return join(this.projectsDir, id); }
  get currentDir() { return this.dirOf(this.current); }

  async start() {
    await mkdir(this.projectsDir, { recursive: true });
    await this.#migrate();
    for (const id of await readdir(this.projectsDir).catch(() => [])) {
      const meta = await readJson(join(this.dirOf(id), 'project.json'));
      if (meta?.name) this.metas.set(id, meta);
    }
    if (!this.metas.size) await this.#create('Untitled project');
    const wanted = (await readJson(this.pointer))?.current;
    await this.#open(this.metas.has(wanted) ? wanted : this.#list()[0].id);
  }

  // ------------------------------------------------------------- migration (DEC-016 §5, never deletes a source)

  async #migrate() {
    const hasProjects = (await readdir(this.projectsDir)).length > 0;
    // Old layout in this very folder (e.g. DATA_DIR=./data): move its files into a project.
    if (!hasProjects && ((await exists(join(this.dataDir, 'room.json'))) || (await exists(join(this.dataDir, 'devices.json'))))) {
      const id = await this.#create('My project');
      for (const f of PROJECT_FILES) if (await exists(join(this.dataDir, f))) await rename(join(this.dataDir, f), join(this.dirOf(id), f));
      this.log.info(`moved the room/cameras of ${this.dataDir} into project "My project"`);
      return;
    }
    if (hasProjects) return;
    // New default folder: copy what earlier versions stored elsewhere.
    let newest = null;
    for (const legacy of this.legacyDirs) {
      const files = [];
      for (const f of PROJECT_FILES) if (await exists(join(legacy.dir, f))) files.push(f);
      if (legacy.copySettings && (await exists(join(legacy.dir, 'settings.json'))) && !(await exists(join(this.dataDir, 'settings.json')))) {
        await copyFile(join(legacy.dir, 'settings.json'), join(this.dataDir, 'settings.json'));
      }
      if (!files.some(f => f === 'room.json' || f === 'devices.json')) continue;
      const id = await this.#create(legacy.name);
      for (const f of files) await copyFile(join(legacy.dir, f), join(this.dirOf(id), f));
      const mtime = Math.max(...await Promise.all(files.map(f => stat(join(legacy.dir, f)).then(s => s.mtimeMs))));
      if (!newest || mtime > newest.mtime) newest = { id, mtime };
      this.log.info(`copied ${legacy.dir} into project "${legacy.name}"`);
    }
    if (newest) await writeJson(this.pointer, { current: newest.id });
  }

  // ------------------------------------------------------------- list / publish

  #list() {
    return [...this.metas.entries()].map(([id, m]) => ({ id, ...m })).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  describe() {
    return {
      current: this.current ? { id: this.current, ...this.metas.get(this.current) } : null,
      projects: this.#list(),
      dataDir: this.dataDir,
      connected: this.connected ? { key: this.connected.key, label: this.connected.label } : null,
      lastOpen: this.lastOpen,
    };
  }

  #publish() { this.cache.set('project', this.describe()); }

  #serial(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  async #writeMeta(id) { await writeJson(join(this.dirOf(id), 'project.json'), this.metas.get(id)); }

  /** Auto-save bookkeeping: every room/devices save marks the open project as changed now. */
  #touch() {
    const id = this.current;
    if (!id || !this.metas.has(id)) return;
    this.metas.get(id).updatedAt = new Date().toISOString();
    this.#serial(() => this.#writeMeta(id)).catch(err => this.log.warn(`project meta: ${err.message}`));
    this.#publish();
  }

  #uniqueName(name) {
    const taken = new Set([...this.metas.values()].map(m => m.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i += 1) if (!taken.has(`${name} (${i})`.toLowerCase())) return `${name} (${i})`;
  }

  /** New project folder; linked to `system` (default: the connected system, DEC-025). */
  async #create(name, system = this.connected) {
    const id = `${slug(name)}-${randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();
    await mkdir(this.dirOf(id), { recursive: true });
    this.metas.set(id, { name: this.#uniqueName(name), createdAt: now, updatedAt: now, ...(system ? { system: { ...system } } : {}) });
    await this.#writeMeta(id);
    return id;
  }

  async #open(id, reason = 'user') {
    this.lastOpen = { id, reason, ...(reason.startsWith('system') && this.connected ? { label: this.connected.label } : {}), at: new Date().toISOString() };
    await Promise.all([this.room.flush(), this.devices.flush()]);
    await this.room.open(this.dirOf(id));
    await this.devices.open(this.dirOf(id));
    this.current = id;
    this.metas.get(id).openedAt = new Date().toISOString(); // "last used" for DEC-025 (not a change: updatedAt stays)
    await this.#writeMeta(id);
    await writeJson(this.pointer, { current: id });
    this.emit('opened', id);
    this.#publish();
    this.log.info(`project "${this.metas.get(id).name}" open`);
  }

  #known(id) {
    if (!this.metas.has(id)) throw new AppError('NOT_FOUND', `Unknown project '${id}'`);
    return id;
  }

  // ------------------------------------------------------------- API operations

  /** New project, empty or as a copy of the open one ("Save as…"); it is opened. */
  create({ name, copyCurrent = false } = {}) {
    const clean = cleanName(name);
    return this.#serial(async () => {
      // A copy belongs to the same system as the original (DEC-025).
      const id = await this.#create(clean, copyCurrent ? this.metas.get(this.current)?.system ?? this.connected : this.connected);
      if (copyCurrent) {
        await Promise.all([this.room.flush(), this.devices.flush()]);
        for (const f of PROJECT_FILES) if (await exists(join(this.currentDir, f))) await copyFile(join(this.currentDir, f), join(this.dirOf(id), f));
      }
      await this.#open(id);
      return this.describe();
    });
  }

  /**
   * Clear parts of the open project (WO-091): layout (placements + outline), shots, background (floor plan),
   * devices (cameras + switcher). At least one part.
   */
  clear(parts = {}) {
    const keys = ['layout', 'shots', 'background', 'devices'];
    const unknown = Object.keys(parts).filter(k => !keys.includes(k));
    if (unknown.length || !keys.some(k => parts[k] === true)) {
      throw new AppError('VALIDATION', `Choose what to clear: ${keys.join(', ')} (true)`, unknown.length ? { details: unknown.map(k => `unknown: ${k}`) } : undefined);
    }
    return this.#serial(async () => {
      await this.room.clear({ layout: parts.layout === true, shots: parts.shots === true, background: parts.background === true });
      if (parts.devices === true) await this.devices.clearAll();
      this.log.info(`project "${this.metas.get(this.current)?.name}" cleared: ${keys.filter(k => parts[k] === true).join(', ')}`);
      return this.describe();
    });
  }

  /**
   * The connection reached a DICENTIS system (DEC-025): open that system's project. Same system → nothing; the open
   * project not linked to any system yet → it is linked to this one; else the most recently changed project of this
   * system is opened, or a new empty one named after the system is created.
   * @param {{ key: string, label: string, type: string, host: string, port: number | null }} system
   */
  useSystem(system) {
    return this.#serial(async () => {
      this.connected = { ...system };
      const meta = this.metas.get(this.current);
      if (meta?.system?.key === system.key) {
        if (meta.system.label !== system.label) { meta.system = { ...system }; await this.#writeMeta(this.current); }
        this.#publish();
        return { action: 'kept' };
      }
      if (meta && !meta.system) {
        meta.system = { ...system };
        this.lastOpen = { id: this.current, reason: 'system-adopt', label: system.label, at: new Date().toISOString() };
        await this.#writeMeta(this.current);
        this.#publish();
        this.log.info(`project "${meta.name}" linked to ${system.label}`);
        return { action: 'linked' };
      }
      // The project last used with this system (opened most recently; older metas: last changed).
      const used = p => p.openedAt ?? p.updatedAt ?? '';
      const mine = this.#list().filter(p => p.system?.key === system.key).sort((a, b) => String(used(b)).localeCompare(String(used(a))));
      if (mine.length) {
        await this.#open(mine[0].id, 'system');
        return { action: 'opened', id: mine[0].id };
      }
      const id = await this.#create(system.label || 'New project', system);
      await this.#open(id, 'system-new');
      return { action: 'created', id };
    });
  }

  /** Link a project to the connected system (`'connected'`) or unlink it (`null`), DEC-025. */
  link(id, target) {
    return this.#serial(async () => {
      this.#known(id);
      if (target === 'connected' && !this.connected) throw new AppError('NOT_CONNECTED', 'Not connected to a DICENTIS system');
      if (target !== 'connected' && target !== null) throw new AppError('VALIDATION', "system must be 'connected' or null");
      const meta = this.metas.get(id);
      if (target === null) delete meta.system; else meta.system = { ...this.connected };
      await this.#writeMeta(id);
      this.#publish();
      return this.describe();
    });
  }

  rename(id, name) {
    const clean = cleanName(name);
    return this.#serial(async () => {
      this.#known(id);
      const meta = this.metas.get(id);
      if (meta.name.toLowerCase() !== clean.toLowerCase()) meta.name = this.#uniqueName(clean); else meta.name = clean;
      await this.#writeMeta(id);
      this.#publish();
      return this.describe();
    });
  }

  open(id) {
    return this.#serial(async () => {
      this.#known(id);
      if (id !== this.current) await this.#open(id);
      return this.describe();
    });
  }

  remove(id) {
    return this.#serial(async () => {
      this.#known(id);
      if (id === this.current) throw new AppError('CONFLICT', 'The open project cannot be deleted: open another one first');
      await rm(this.dirOf(id), { recursive: true, force: true });
      this.metas.delete(id);
      this.#publish();
      return this.describe();
    });
  }

  /** The project as one portable JSON document (DEC-016 §6; includes camera passwords, user decision). */
  async exportProject(id) {
    this.#known(id);
    if (id === this.current) await Promise.all([this.room.flush(), this.devices.flush()]);
    const dir = this.dirOf(id);
    const room = await readJson(join(dir, 'room.json'), {});
    const devices = await readJson(join(dir, 'devices.json'), { cameras: [], switcher: null });
    let background = null;
    if (room.background?.file && BACKGROUND_TYPES[room.background.type]) {
      const data = await readFile(join(dir, room.background.file)).catch(() => null);
      if (data) background = { type: room.background.type, data: data.toString('base64') };
    }
    const { background: _omit, ...roomData } = room;
    return {
      file: `${slug(this.metas.get(id).name)}.likeabosch.json`,
      document: {
        format: FILE_FORMAT, version: 1, name: this.metas.get(id).name, exportedAt: new Date().toISOString(),
        room: roomData, devices: { cameras: devices.cameras ?? [], switcher: devices.switcher ?? null }, background,
      },
    };
  }

  /** Load a project file as a new project and open it. */
  importProject(doc) {
    if (!doc || typeof doc !== 'object' || doc.format !== FILE_FORMAT) throw new AppError('VALIDATION', 'Not a LikeABosch project file');
    if (doc.version !== 1) throw new AppError('VALIDATION', `Unsupported project file version ${doc.version}`);
    let image = null;
    if (doc.background) {
      const ext = BACKGROUND_TYPES[doc.background.type];
      const data = typeof doc.background.data === 'string' ? Buffer.from(doc.background.data, 'base64') : null;
      if (!ext || !data?.length || data.length > MAX_BACKGROUND) throw new AppError('VALIDATION', 'Invalid floor plan image in the project file');
      image = { ext, data, type: doc.background.type };
    }
    const room = sanitizeRoom(doc.room);
    const devices = sanitizeDevices(doc.devices);
    const name = typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim().slice(0, 80) : 'Imported project';
    return this.#serial(async () => {
      const id = await this.#create(name);
      const dir = this.dirOf(id);
      if (image) {
        await writeFile(join(dir, `room-background.${image.ext}`), image.data);
        room.background = { file: `room-background.${image.ext}`, type: image.type, updatedAt: new Date().toISOString() };
      }
      await writeJson(join(dir, 'room.json'), room);
      await writeJson(join(dir, 'devices.json'), devices, 0o600);
      await chmod(join(dir, 'devices.json'), 0o600).catch(() => {});
      await this.#open(id);
      return this.describe();
    });
  }
}
