// Pure state reducer for the live store (no DOM, no network): unit-tested in web/test (DEC-009).

/**
 * @typedef {{ data: any, updatedAt: string }} TopicEntry
 * @typedef {object} StoreState
 * @property {'connecting' | 'open' | 'lost'} stream   SSE stream to the backend
 * @property {any} connection                          DICENTIS connection status from the backend
 * @property {Record<string, TopicEntry>} topics
 * @property {Record<string, string>} unavailable      topic → reason
 */

/** @returns {StoreState} */
export function initialState() {
  return { stream: 'connecting', connection: null, topics: {}, unavailable: {} };
}

/**
 * Apply one SSE message (or a stream status change). Returns the new state and the keys that changed:
 * 'stream', 'connection', 'topic:<name>'.
 * @param {StoreState} state
 * @param {'snapshot' | 'topic' | 'connection' | 'stream'} event
 * @param {any} data
 * @returns {{ state: StoreState, changed: string[] }}
 */
export function reduce(state, event, data) {
  switch (event) {
    case 'snapshot': {
      const topics = { ...(data.topics ?? {}) };
      const names = new Set([...Object.keys(state.topics), ...Object.keys(topics), ...Object.keys(state.unavailable), ...Object.keys(data.unavailable ?? {})]);
      return { state: { ...state, topics, unavailable: { ...(data.unavailable ?? {}) } }, changed: [...names].map(n => `topic:${n}`) };
    }
    case 'topic': {
      const topics = { ...state.topics };
      const unavailable = { ...state.unavailable };
      if (data.data === null) {
        delete topics[data.topic];
        if (data.reason) unavailable[data.topic] = data.reason;
      } else {
        topics[data.topic] = { data: data.data, updatedAt: data.updatedAt };
        delete unavailable[data.topic];
      }
      return { state: { ...state, topics, unavailable }, changed: [`topic:${data.topic}`] };
    }
    case 'connection':
      return { state: { ...state, connection: data }, changed: ['connection'] };
    case 'stream':
      return state.stream === data ? { state, changed: [] } : { state: { ...state, stream: data }, changed: ['stream'] };
    default:
      return { state, changed: [] };
  }
}

/** Data of a topic, or undefined. */
export const topicData = (state, name) => state.topics[name]?.data;

/** Whether the logged-in DICENTIS account has a permission. */
export const can = (state, permission) => Boolean(state.connection?.permissions?.includes(permission));

/** True when connected to DICENTIS and the SSE stream is open. */
export const isLive = state => state.stream === 'open' && state.connection?.state === 'loggedIn';
