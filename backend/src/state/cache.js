// In-memory state cache: topic → latest data (DEC-005). Emits `change` only when data actually changed.
import { EventEmitter } from 'node:events';
import { isDeepStrictEqual } from 'node:util';

/** Topics owned by LikeABosch itself, not by the connected DICENTIS system (WO-034, WO-038, WO-039, WO-057). */
export const isLocalTopic = topic => topic === 'room' || topic === 'director' || topic === 'project' || topic.startsWith('devices.');

/**
 * @typedef {{ data: unknown, updatedAt: string }} TopicEntry
 * Events: `change` (topic: string, entry: TopicEntry | null)   null = topic removed
 */
export class StateCache extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, TopicEntry>} */
    this.topics = new Map();
    /** topic → reason it is unavailable (missing permission, licence, server error) */
    this.unavailable = new Map();
  }

  /** @param {string} topic */
  get(topic) { return this.topics.get(topic) ?? null; }

  /** @param {string} topic @param {unknown} data */
  set(topic, data) {
    this.unavailable.delete(topic);
    const prev = this.topics.get(topic);
    if (prev && isDeepStrictEqual(prev.data, data)) return false;
    const entry = { data, updatedAt: new Date().toISOString() };
    this.topics.set(topic, entry);
    this.emit('change', topic, entry);
    return true;
  }

  /** @param {string} topic @param {string} reason */
  markUnavailable(topic, reason) {
    const changed = this.unavailable.get(topic) !== reason;
    this.unavailable.set(topic, reason);
    if (this.topics.delete(topic)) this.emit('change', topic, null);
    else if (changed) this.emit('unavailable', topic, reason);
  }

  /** Remove the DICENTIS system state; LikeABosch's own topics (room layout, devices, director) survive a disconnect. */
  clear() {
    for (const topic of [...this.topics.keys()]) {
      if (isLocalTopic(topic)) continue;
      this.topics.delete(topic);
      this.emit('change', topic, null);
    }
    for (const topic of [...this.unavailable.keys()]) if (!isLocalTopic(topic)) this.unavailable.delete(topic);
  }

  snapshot() {
    return {
      topics: Object.fromEntries(this.topics),
      unavailable: Object.fromEntries(this.unavailable),
    };
  }
}
