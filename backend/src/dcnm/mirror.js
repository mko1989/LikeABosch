// Generic state mirror of the DICENTIS DCNM API (WO-079, DEC-021 §4): the last payload of every event is kept as cache
// topic `dcnm.<Api>.<Event>` (ApiEventArgs<T>.Parameter, else the args object), the bridge status as `dcnmStatus`, the last
// delegate callback as `dcnmCallback`. After every login, each parameterless Request…Async is called once ("sweep"): the
// API answers it by raising the matching event with the current state, which fills the mirror.
import { createLogger } from '../lib/logger.js';

const PREFIX = 'dcnm.';
const OWN = ['dcnmStatus', 'dcnmCallback', 'dcnmSweep'];
/** Topics updated more often than this are coalesced (VU meters can fire many times per second). */
const MIN_INTERVAL_MS = 100;

export const isDcnmTopic = topic => topic.startsWith(PREFIX) || OWN.includes(topic);

export class DcnmMirror {
  /**
   * @param {object} deps
   * @param {import('../state/cache.js').StateCache} deps.cache
   * @param {ReturnType<import('./spec.js').loadDcnmSpec>} deps.spec
   * @param {ReturnType<createLogger>} [deps.log]
   * @param {number} [deps.sweepConcurrency]
   */
  constructor({ cache, spec, log, sweepConcurrency = 4 }) {
    this.cache = cache;
    this.spec = spec;
    this.log = log ?? createLogger({ name: 'dcnm-mirror' });
    this.sweepConcurrency = sweepConcurrency;
    /** @type {import('./client.js').DcnmClient | null} */
    this.client = null;
    /** topic → { last, timer } for coalescing */
    this.throttle = new Map();
    this.sweeping = null;
    this.onEvent = e => this.#event(e);
    this.onStatus = s => this.cache.set('dcnmStatus', s);
    this.onCallback = c => this.cache.set('dcnmCallback', c);
    this.onLoggedIn = () => { this.sweeping = this.sweep(); };
    this.onState = state => { if (state === 'disconnected') this.clear('dicentis-bridge disconnected'); };
  }

  /** @param {import('./client.js').DcnmClient} client */
  attach(client) {
    this.detach();
    this.client = client;
    client.on('event', this.onEvent);
    client.on('status', this.onStatus);
    client.on('callback', this.onCallback);
    client.on('loggedIn', this.onLoggedIn);
    client.on('state', this.onState);
    if (client.bridgeStatus?.connection) this.cache.set('dcnmStatus', client.bridgeStatus);
    if (client.state === 'loggedIn') this.onLoggedIn();
  }

  detach() {
    const c = this.client;
    if (!c) return;
    c.off('event', this.onEvent);
    c.off('status', this.onStatus);
    c.off('callback', this.onCallback);
    c.off('loggedIn', this.onLoggedIn);
    c.off('state', this.onState);
    this.client = null;
    for (const { timer } of this.throttle.values()) clearTimeout(timer);
    this.throttle.clear();
    this.clear('dicentis-bridge not connected');
  }

  /** Resolves when the sweep after the latest login is done. */
  idle() { return this.sweeping ?? Promise.resolve(); }

  #event({ api, event, args }) {
    const topic = `${PREFIX}${api}.${event}`;
    const data = args && typeof args === 'object' && 'Parameter' in args ? args.Parameter : args;
    const t = this.throttle.get(topic);
    const now = Date.now();
    if (!t || now - t.last >= MIN_INTERVAL_MS) {
      this.throttle.set(topic, { last: now, timer: null, data: undefined });
      this.cache.set(topic, data ?? null);
      return;
    }
    t.data = data ?? null;
    t.timer ??= setTimeout(() => {
      t.timer = null;
      t.last = Date.now();
      this.cache.set(topic, t.data);
    }, MIN_INTERVAL_MS - (now - t.last));
  }

  /** Call every parameterless Request…Async the bridge has (sequentially per worker, errors only logged). */
  async sweep() {
    const client = this.client;
    if (!client) return;
    const found = Object.keys(client.interfaces ?? {});
    const todo = this.spec.sweep(found.length ? found : undefined);
    const failed = [];
    let next = 0;
    let called = 0;
    const worker = async () => {
      while (next < todo.length && this.client === client && client.state === 'loggedIn') {
        const [api, method] = todo[next++];
        called++;
        try { await client.call(api, method, {}, { timeoutMs: 10_000 }); } catch (err) { failed.push(`${api}.${method}: ${err.message}`); }
      }
    };
    await Promise.all(Array.from({ length: this.sweepConcurrency }, worker));
    if (this.client !== client) return;
    // Stopped early (connection lost): the next login sweeps again.
    const complete = called === todo.length;
    this.cache.set('dcnmSweep', { at: new Date().toISOString(), total: todo.length, requested: called, complete, failed });
    this.log.info(`requested the state of ${called - failed.length}/${todo.length} DCNM interfaces${failed.length ? ` (${failed.length} failed, see dcnmSweep)` : ''}${complete ? '' : ' (interrupted)'}`);
  }

  /** Remove the mirrored topics (the wired topics are not touched). */
  clear(reason) {
    for (const topic of [...this.cache.topics.keys()]) if (isDcnmTopic(topic)) this.cache.markUnavailable(topic, reason);
  }
}
