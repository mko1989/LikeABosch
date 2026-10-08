// Wired event bridge (WO-012, DEC-005): keeps the state cache in sync with the DICENTIS server.
// After login: GetPermissions → RegisterEvents(all) → fetch every permitted topic.
// On an event: call its refresh operation(s) from events.json (this also re-arms the event) and update the cache.
import { EventEmitter } from 'node:events';
import { createLogger } from '../lib/logger.js';

/**
 * Topics that are notifications, not state: forwarded once (SSE `notification`), never cached.
 * The plugin queues are consumed by fetching them (real 6.50 server, WO-032): caching would lose items and a
 * second reader would see nothing.
 */
const NOTIFICATION_TOPICS = new Set(['participantAccessDenied', 'pluginEventData', 'pluginCommands']);

/**
 * Events: `notification` ({ topic, data }) for NOTIFICATION_TOPICS.
 */
export class WiredEventBridge extends EventEmitter {
  /**
   * @param {object} deps
   * @param {ReturnType<import('./spec.js').loadSpec>} deps.spec
   * @param {import('../state/cache.js').StateCache} deps.cache
   * @param {ReturnType<createLogger>} [deps.log]
   * @param {number} [deps.coalesceMs]  collect events for this long before refreshing
   */
  constructor({ spec, cache, log, coalesceMs = 50 }) {
    super();
    this.spec = spec;
    this.cache = cache;
    this.log = log ?? createLogger({ name: 'wired-events' });
    this.coalesceMs = coalesceMs;
    /** @type {import('./client.js').WiredClient | null} */
    this.client = null;
    /** @type {string[]} */
    this.permissions = [];
    /** topic → refresh operation name */
    this.topicOps = new Map();
    /** refresh operation (lower case) → parameters to send (events.json refreshParams) */
    this.refreshParams = new Map();
    /** event → mapping */
    this.events = new Map();
    for (const e of spec.eventMap.events) {
      // Keyed lower-case: the real 6.50 server sends PascalCase ("MasterVolumeChanged"), the PDF uses camelCase.
      this.events.set(e.event.toLowerCase(), e);
      e.topics.forEach((t, i) => this.topicOps.set(t, e.refresh[i]));
      for (const [op, params] of Object.entries(e.refreshParams ?? {})) this.refreshParams.set(op.toLowerCase(), params);
    }
    /** operation (lower case) → topics to refresh after it succeeds (topics without a change event) */
    this.refreshAfter = new Map();
    for (const t of spec.eventMap.topicsWithoutEvent) {
      this.topicOps.set(t.topic, t.refresh[0]);
      for (const op of t.refreshAfter ?? []) this.refreshAfter.set(op.toLowerCase(), [...(this.refreshAfter.get(op.toLowerCase()) ?? []), t.topic]);
    }
    this.queue = new Set();
    this.timer = null;
    this.flushing = Promise.resolve();
    this.onLoggedIn = () => this.#run(() => this.resync());
    this.onEvent = names => this.#handleEvents(names);
  }

  /** All topics this bridge can provide. */
  get topicNames() { return [...this.topicOps.keys()]; }

  /** @param {import('./client.js').WiredClient} client */
  attach(client) {
    this.detach();
    this.client = client;
    client.on('loggedIn', this.onLoggedIn);
    client.on('event', this.onEvent);
    if (client.state === 'loggedIn') this.onLoggedIn();
  }

  detach() {
    if (!this.client) return;
    this.client.off('loggedIn', this.onLoggedIn);
    this.client.off('event', this.onEvent);
    this.client = null;
    clearTimeout(this.timer);
    this.timer = null; // a stale handle would block all future scheduling (#handleEvents checks it)
    this.queue.clear();
  }

  /** Wait until queued refreshes are done (tests, shutdown). */
  async idle() {
    while (this.timer || this.queue.size) await new Promise(r => setTimeout(r, this.coalesceMs));
    await this.flushing;
  }

  /**
   * Called by the passthrough after an operation succeeded: refresh topics that have no change event.
   * @param {string} operation
   */
  operationSucceeded(operation) {
    const topics = this.refreshAfter.get(String(operation).toLowerCase());
    if (topics) return this.#run(() => Promise.all(topics.map(t => this.refreshTopic(t))));
    return undefined;
  }

  /** Full sync: permissions, event registration, every permitted topic. */
  async resync() {
    const client = this.client;
    if (!client) return;
    await this.#refreshPermissions();
    await client.request('RegisterEvents', { events: this.spec.registrableEvents });
    const optional = this.spec.eventMap.events.filter(e => e.optional).map(e => e.event);
    for (const event of optional) {
      // Separate calls: older servers reject unknown events, which must not break the main registration.
      await client.request('RegisterEvents', { events: [event] })
        .catch(err => this.log.info(`optional event ${event} not supported: ${err.message}`));
    }
    // Notification topics are fetched only when their event fires; fetching at login would replay a stale notification.
    await Promise.all(this.topicNames.filter(t => t !== 'permissions' && !NOTIFICATION_TOPICS.has(t)).map(t => this.refreshTopic(t)));
    this.log.info(`synchronised ${this.cache.topics.size} topics (${this.cache.unavailable.size} unavailable)`);
  }

  /**
   * Fetch one topic and update the cache (or mark it unavailable).
   * @param {string} topic
   */
  async refreshTopic(topic) {
    const client = this.client;
    const opName = this.topicOps.get(topic);
    if (!client || !opName) return;
    const op = this.spec.get(opName);
    const missing = op.permissions.filter(p => !this.permissions.includes(p));
    if (missing.length) {
      this.cache.markUnavailable(topic, `missing permission: ${missing.join(', ')}`);
      return;
    }
    try {
      const data = await client.request(op.operation, this.refreshParams.get(op.operation.toLowerCase()) ?? {});
      if (NOTIFICATION_TOPICS.has(topic)) {
        const empty = Object.values(data ?? {}).every(v => Array.isArray(v) && !v.length);
        if (!empty) this.emit('notification', { topic, data });
      }
      else this.cache.set(topic, data);
    } catch (err) {
      if (err.code === 'NOT_CONNECTED') return; // reconnect will resync
      this.log.debug(`refresh ${topic} via ${op.operation} failed: ${err.message}`);
      this.cache.markUnavailable(topic, err.message);
      // A failed fetch doesn't re-arm the event (fire-once, PDF p.52), so re-arm it explicitly;
      // otherwise e.g. meetingInfoChanged would stay silent after "no active meeting".
      const events = [...new Set([...this.events.values()].filter(e => e.topics.includes(topic)).map(e => e.event))];
      if (events.length && this.client === client) {
        await client.request('RegisterEvents', { events }).catch(e => this.log.debug(`re-arm ${events} failed: ${e.message}`));
      }
    }
  }

  async #refreshPermissions() {
    const { permissions = [] } = await this.client.request('GetPermissions');
    this.permissions = permissions;
    this.cache.set('permissions', { permissions });
  }

  #handleEvents(names) {
    for (const name of names) {
      const mapping = this.events.get(String(name).toLowerCase());
      if (!mapping) {
        this.log.warn(`unmapped event '${name}' (add it to docs/protocol/conference/events.json)`);
        continue;
      }
      if (mapping.action === 'resync') this.queue.add('*resync');
      mapping.topics.forEach(t => this.queue.add(t));
      (mapping.alsoRefreshTopics ?? []).forEach(t => this.queue.add(t));
    }
    if (this.queue.size && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.#run(() => this.#flush());
      }, this.coalesceMs);
    }
  }

  async #flush() {
    const topics = [...this.queue];
    this.queue.clear();
    if (topics.includes('*resync')) return this.resync();
    if (topics.includes('permissions')) {
      await this.#refreshPermissions();
      // Permissions changed: re-evaluate every topic (newly allowed ones get fetched, lost ones marked unavailable).
      return Promise.all(this.topicNames.filter(t => t !== 'permissions' && !NOTIFICATION_TOPICS.has(t)).map(t => this.refreshTopic(t)));
    }
    return Promise.all(topics.map(t => this.refreshTopic(t)));
  }

  /** Serialise sync work so refreshes never overlap a resync. */
  #run(task) {
    this.flushing = this.flushing.then(task).catch(err => this.log.warn(`event sync failed: ${err.message}`));
    return this.flushing;
  }
}
