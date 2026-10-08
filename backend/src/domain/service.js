// Domain service (WO-017, DEC-010): keeps `domain.*` topics derived from the active system's raw topics.
import { capabilities, dcn, dcnSmd, wired, wireless, DOMAIN_TOPICS } from './mappers.js';

const MAPPERS = { wired, wireless, dcn, 'dcn-smd': dcnSmd };

export class DomainService {
  /**
   * @param {object} deps
   * @param {import('../state/cache.js').StateCache} deps.cache
   * @param {import('../connection/manager.js').ConnectionManager} deps.manager
   */
  constructor({ cache, manager }) {
    this.cache = cache;
    this.manager = manager;
    /** raw topic → domain topics depending on it */
    this.dependents = new Map();
    for (const [topic, def] of Object.entries(DOMAIN_TOPICS)) {
      for (const src of new Set([...def.wired, ...def.wireless, ...def.dcn, ...def['dcn-smd']])) this.dependents.set(src, [...(this.dependents.get(src) ?? []), topic]);
    }
    cache.on('change', topic => {
      if (topic.startsWith('domain.')) return;
      // Note: markUnavailable() of a never-cached source emits no change; recomputeAll() on status covers that.
      if (topic === 'permissions' || topic === 'dcnBridge' || topic === 'dicentis.status') this.#capabilities();
      for (const d of this.dependents.get(topic) ?? []) this.#compute(d);
    });
    cache.on('unavailable', topic => {
      if (!topic.startsWith('domain.')) for (const d of this.dependents.get(topic) ?? []) this.#compute(d);
    });
    manager.on('status', () => this.recomputeAll());
    this.recomputeAll();
  }

  get system() { return this.manager.system; } // the simulated system's type while simulating (DEC-026)

  recomputeAll() {
    this.#capabilities();
    for (const topic of Object.keys(DOMAIN_TOPICS)) this.#compute(topic);
  }

  #capabilities() {
    const permissions = this.system === 'dcn' ? dcnAllowed(this.cache.get('dcnBridge')?.data?.status) : this.cache.get('permissions')?.data?.permissions ?? [];
    const dicentis = this.system === 'wired' ? this.cache.get('dicentis.status')?.data?.features : null; // DEC-029 §3
    this.cache.set('domain.capabilities', { ...capabilities(this.system, permissions), dicentis: { audio: Boolean(dicentis?.audio), languages: Boolean(dicentis?.languages) } });
  }

  #compute(topic) {
    const def = DOMAIN_TOPICS[topic];
    const mappers = MAPPERS[this.system] ?? wired;
    const get = name => this.cache.get(name)?.data;
    const value = mappers[def.fn](get);
    if (value === undefined) {
      // Pass on why the sources are missing (e.g. "missing permission: canViewVoting") so the UI can say so.
      const sources = def[this.system] ?? def.wired;
      const reason = sources.map(t => this.cache.unavailable.get(t)).find(Boolean);
      if (reason || this.cache.get(topic)) this.cache.markUnavailable(topic, reason ?? 'no data from the connected system');
    } else {
      this.cache.set(topic, value);
    }
  }
}

/** DCN: names of the `Is*Allowed` flags that are true (bridge status, BRIDGE.md). */
const dcnAllowed = status => Object.entries({ ...status?.control?.allowed, ...status?.config?.allowed }).filter(([, v]) => v).map(([k]) => k);
