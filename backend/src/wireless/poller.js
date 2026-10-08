// Wireless poller (WO-015, DEC-005): keeps wireless topics in the state cache.
// Live topics loop on `GET <path>?isPolling=true`. The WAP holds such a request until that resource changes or ~50 s
// pass (verified on firmware 1.73, WO-075), so updates are immediate. If an answer comes back at once anyway, the loop
// waits until `minIntervalMs` has passed, so the WAP is never hammered. Preparation topics are plain GETs every
// `intervalMs` (see topics.js for why not everything is long-polled). Loops start staggered, not in one burst.
import { createLogger } from '../lib/logger.js';
import { WIRELESS_TOPICS } from './topics.js';

export class WirelessPoller {
  /**
   * @param {object} deps
   * @param {import('../state/cache.js').StateCache} deps.cache
   * @param {ReturnType<createLogger>} [deps.log]
   * @param {number} [deps.minIntervalMs]   minimum time between two requests for the same topic
   * @param {number} [deps.longPollTimeoutMs] HTTP timeout for a long-poll request (longer than the WAP's ~50 s hold)
   * @param {number} [deps.intervalMs]      period of the plain (non-long-poll) topics
   * @param {number} [deps.staggerMs]       delay between starting two poll loops
   */
  constructor({ cache, log, minIntervalMs = 2_000, longPollTimeoutMs = 65_000, intervalMs = 5_000, staggerMs = 150 }) {
    this.cache = cache;
    this.log = log ?? createLogger({ name: 'wireless-poller' });
    this.minIntervalMs = minIntervalMs;
    this.longPollTimeoutMs = longPollTimeoutMs;
    this.intervalMs = intervalMs;
    this.staggerMs = staggerMs;
    /** @type {import('./client.js').WirelessClient | null} */
    this.client = null;
    this.generation = 0; // bumps on every (re)start; old loops notice and stop
    this.wakers = new Set();
    this.onLoggedIn = () => this.#start();
  }

  get topicNames() { return WIRELESS_TOPICS.map(t => t.topic); }

  /** @param {import('./client.js').WirelessClient} client */
  attach(client) {
    this.detach();
    this.client = client;
    client.on('loggedIn', this.onLoggedIn);
    if (client.state === 'loggedIn') this.#start();
  }

  detach() {
    this.client?.off('loggedIn', this.onLoggedIn);
    this.client = null;
    this.generation += 1;
    this.#wakeAll();
  }

  /** Fetch every topic now (e.g. after a write through the passthrough), without waiting for the poll loop. */
  async refreshAll() {
    await Promise.all(WIRELESS_TOPICS.map(t => this.#fetch(t, false)));
  }

  /** Resolves when the initial fetch after the latest login is done. */
  idle() { return this.initial ?? Promise.resolve(); }

  #start() {
    const generation = ++this.generation;
    this.#wakeAll();
    this.initial = this.refreshAll().then(async () => {
      this.log.info(`synchronised ${this.cache.topics.size} wireless topics (${this.cache.unavailable.size} unavailable)`);
      for (const t of WIRELESS_TOPICS.filter(x => x.poll)) {
        if (generation !== this.generation) return;
        this.#loop(t, generation);
        await this.#sleep(this.staggerMs);
      }
    });
  }

  async #loop(topic, generation) {
    const longPoll = topic.poll === 'long';
    if (!longPoll) await this.#sleep(topic.poll === 'slow' ? this.intervalMs * 3 : this.intervalMs); // just fetched by refreshAll
    while (generation === this.generation && this.client?.state === 'loggedIn') {
      const started = Date.now();
      const ok = await this.#fetch(topic, longPoll);
      const elapsed = Date.now() - started;
      const period = longPoll ? this.minIntervalMs : topic.poll === 'slow' ? this.intervalMs * 3 : this.intervalMs;
      const wait = ok ? Math.max(0, period - elapsed) : Math.max(period, this.minIntervalMs * 2);
      if (wait > 0) await this.#sleep(wait);
    }
  }

  /** @returns {Promise<boolean>} false on error */
  async #fetch({ topic, path }, longPoll) {
    const client = this.client;
    if (!client || client.state !== 'loggedIn') return false;
    try {
      const data = await client.request('GET', path, longPoll
        ? { query: { isPolling: true }, timeoutMs: this.longPollTimeoutMs }
        : {});
      if (this.client === client) this.cache.set(topic, data);
      return true;
    } catch (err) {
      if (err.code === 'NOT_CONNECTED') return false; // client reconnects; loop restarts on loggedIn
      if (err.code === 'UPSTREAM_TIMEOUT' && longPoll) return true; // held past our timeout: just poll again
      if (this.client === client) this.cache.markUnavailable(topic, err.message);
      return false;
    }
  }

  #sleep(ms) {
    return new Promise(resolve => {
      const t = setTimeout(() => { this.wakers.delete(waker); resolve(); }, ms);
      t.unref?.();
      const waker = () => { clearTimeout(t); resolve(); };
      this.wakers.add(waker);
    });
  }

  #wakeAll() {
    for (const w of this.wakers) w();
    this.wakers.clear();
  }
}
