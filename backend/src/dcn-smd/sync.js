// DCN-SWSMD sync (WO-066, DEC-018): activities → SmdState → `smd*` topics in the state cache, with the state persisted
// to <dataDir>/dcn-smd-state.json (the stream cannot be asked for the current state; a restart must not lose it).
import { readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../lib/logger.js';
import { SECTIONS, SmdState } from './state.js';

/** section → cache topic */
export const SMD_TOPICS = Object.fromEntries(SECTIONS.map(s => [s, `smd${s[0].toUpperCase()}${s.slice(1)}`]));

export class DcnSmdSync {
  /**
   * @param {object} deps
   * @param {import('../state/cache.js').StateCache} deps.cache
   * @param {string} [deps.dataDir]   without it nothing is persisted (tests)
   * @param {ReturnType<createLogger>} [deps.log]
   * @param {number} [deps.saveDelayMs]
   */
  constructor({ cache, dataDir, log, saveDelayMs = 1_000 }) {
    this.cache = cache;
    this.file = dataDir ? join(dataDir, 'dcn-smd-state.json') : null;
    this.log = log ?? createLogger({ name: 'dcn-smd-sync' });
    this.saveDelayMs = saveDelayMs;
    this.state = this.#load();
    /** live = an activity arrived on the current connection; restored = only persisted data so far */
    this.origin = this.state.stats.activities ? 'restored' : 'empty';
    this.client = null;
    this.saveTimer = null;
    this.saving = Promise.resolve();
    this.onActivity = a => this.#apply(a);
    this.onLoggedIn = () => this.publishAll();
    this.onParseError = () => this.#publishStream();
  }

  #load() {
    if (!this.file) return new SmdState();
    try {
      const s = SmdState.fromJSON(JSON.parse(readFileSync(this.file, 'utf8')));
      this.log.info(`restored DCN meeting data from ${this.file} (${s.stats.activities} activities, last ${s.stats.lastActivityAt})`);
      return s;
    } catch (err) {
      if (err.code !== 'ENOENT') this.log.warn(`cannot read ${this.file}: ${err.message}`);
      return new SmdState();
    }
  }

  get topicNames() { return [...Object.values(SMD_TOPICS), 'smdStream']; }

  /** @param {import('./client.js').DcnSmdClient} client */
  attach(client) {
    this.detach();
    this.client = client;
    client.on('activity', this.onActivity);
    client.on('loggedIn', this.onLoggedIn);
    client.on('parseError', this.onParseError);
    client.on('state', this.onParseError);
    if (client.state === 'loggedIn') this.publishAll();
  }

  detach() {
    if (!this.client) return;
    this.client.off('activity', this.onActivity);
    this.client.off('loggedIn', this.onLoggedIn);
    this.client.off('parseError', this.onParseError);
    this.client.off('state', this.onParseError);
    this.client = null;
  }

  #apply({ root, topicName }) {
    const changed = this.state.apply(root, { topicName });
    this.origin = 'live';
    for (const section of changed) this.cache.set(SMD_TOPICS[section], this.state.view(section));
    this.#publishStream();
    this.#scheduleSave();
  }

  /** Every topic from the current state (after a connect, a restore or a reset). */
  publishAll() {
    for (const [section, topic] of Object.entries(SMD_TOPICS)) this.cache.set(topic, this.state.view(section));
    this.#publishStream();
  }

  #publishStream() {
    const c = this.client;
    this.cache.set('smdStream', {
      state: c?.state ?? 'disconnected',
      origin: this.origin, // empty | restored | live
      connectedAt: c?.stats.connectedAt ?? null,
      messages: c?.stats.messages ?? 0,
      bytes: c?.stats.bytes ?? 0,
      encoding: c?.stats.encoding ?? null,
      parseErrors: c?.stats.parseErrors ?? 0,
      activities: this.state.stats.activities,
      unknownActivities: this.state.stats.unknown,
      lastActivityAt: this.state.stats.lastActivityAt,
    });
  }

  /** Forget everything (e.g. after a meeting ended while LikeABosch was not connected). */
  async reset() {
    this.state = new SmdState();
    this.origin = 'empty';
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.file) await rm(this.file, { force: true });
    if (this.client) this.publishAll();
  }

  #scheduleSave() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saving = this.saving.then(() => this.#save()).catch(err => this.log.warn(`cannot save ${this.file}: ${err.message}`));
    }, this.saveDelayMs);
    this.saveTimer.unref?.();
  }

  async #save() {
    await mkdir(join(this.file, '..'), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.state));
    await rename(`${this.file}.tmp`, this.file);
  }

  /** Write pending changes now (shutdown, tests). */
  async flush() {
    if (!this.file) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.saving = this.saving.then(() => this.#save());
    }
    await this.saving;
  }
}
