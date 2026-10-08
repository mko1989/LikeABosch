// Live store: state from the backend's SSE stream (DEC-005, DEC-009).
import { initialState, reduce, topicData, can, isLive } from './store-core.js';

export function createStore() {
  let state = initialState();
  /** Recent transient notifications (newest first, max 20) for views that show a history. */
  const notifications = [];
  /** key → Set<callback> ; keys: 'stream', 'connection', 'topic:<name>', 'notification' */
  const listeners = new Map();

  const emit = (key, payload) => listeners.get(key)?.forEach(cb => {
    try { cb(payload); } catch (err) { console.error(`listener for ${key} failed`, err); }
  });

  function dispatch(event, data) {
    const result = reduce(state, event, data);
    state = result.state;
    result.changed.forEach(key => emit(key, state));
    if (result.changed.length) emit('*', state);
  }

  return {
    get state() { return state; },
    topic: name => topicData(state, name),
    unavailable: name => state.unavailable[name],
    can: permission => can(state, permission),
    get live() { return isLive(state); },
    get notifications() { return notifications; },
    /** Domain capabilities of the connected system (DEC-010), or null before they are known. */
    get capabilities() { return topicData(state, 'domain.capabilities') ?? null; },
    get system() { return topicData(state, 'domain.capabilities')?.system ?? state.connection?.system ?? 'wired'; },
    /** Whether the connected system has a feature (unknown capabilities → true, so nothing flickers away at startup). */
    feature(name) { const c = topicData(state, 'domain.capabilities'); return c ? Boolean(c.features?.[name]) : true; },
    /** Whether a domain action is allowed (features + permissions). */
    action(name) { return Boolean(topicData(state, 'domain.capabilities')?.actions?.[name]); },

    /**
     * Subscribe to keys ('connection', 'stream', 'topic:seats', 'notification', '*'). Returns unsubscribe.
     * @param {string[]} keys
     * @param {(state: any) => void} callback
     */
    subscribe(keys, callback) {
      keys.forEach(k => { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k).add(callback); });
      return () => keys.forEach(k => listeners.get(k)?.delete(callback));
    },

    /** Open the SSE stream. EventSource reconnects by itself; a fresh snapshot arrives on each reconnect. */
    start() {
      const es = new EventSource('/api/events');
      const on = (event, fn) => es.addEventListener(event, e => fn(JSON.parse(e.data)));
      es.onopen = () => dispatch('stream', 'open');
      es.onerror = () => dispatch('stream', 'lost');
      on('snapshot', data => dispatch('snapshot', data));
      on('topic', data => dispatch('topic', data));
      on('connection', data => dispatch('connection', data));
      on('notification', data => {
        notifications.unshift({ ...data, receivedAt: new Date().toISOString() });
        notifications.length = Math.min(notifications.length, 20);
        emit('notification', data);
      });
      return () => es.close();
    },
  };
}
