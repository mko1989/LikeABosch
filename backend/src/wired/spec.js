// Loads the Conference Protocol spec JSON (DEC-003) and provides validation + default shapes.
// Shared by the backend (passthrough validation, WO-011) and the wired mock server (WO-010).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SPEC_DIR = fileURLToPath(new URL('../../../docs/protocol/conference/', import.meta.url));

/**
 * @typedef {string | Notation[] | { [field: string]: Notation }} Notation  type notation, see SPEC-FORMAT.md
 * @typedef {object} Operation
 * @property {string} operation
 * @property {string} summary
 * @property {string} category
 * @property {string} [excluded]
 * @property {string[]} permissions
 * @property {string[]} licenses
 * @property {Record<string, Notation>} request
 * @property {Record<string, Notation>} response
 * @typedef {object} EventMapping
 * @property {string} event
 * @property {'resync'} [action]
 * @property {string[]} refresh
 * @property {string[]} topics
 * @property {string[]} [alsoRefreshTopics]
 * @property {'documented'|'inferred'|'history-only'} confidence
 * @property {boolean} optional
 */

/**
 * Load all operations and the event map.
 * @param {string} [dir]
 */
export function loadSpec(dir = SPEC_DIR) {
  /** @type {Map<string, Operation>} key = lower-case operation name */
  const operations = new Map();
  for (const file of readdirSync(join(dir, 'operations')).filter(f => f.endsWith('.json'))) {
    const op = JSON.parse(readFileSync(join(dir, 'operations', file), 'utf8'));
    operations.set(op.operation.toLowerCase(), op);
  }
  /** @type {{ events: EventMapping[], topicsWithoutEvent: { topic: string, refresh: string[] }[] }} */
  const eventMap = JSON.parse(readFileSync(join(dir, 'events.json'), 'utf8'));

  /** operation name (lower case) → events that calling it re-arms */
  const rearms = new Map();
  for (const e of eventMap.events) {
    for (const op of e.refresh) {
      const key = op.toLowerCase();
      rearms.set(key, [...(rearms.get(key) ?? []), e.event]);
    }
  }
  const registerEnum = operations.get('registerevents').request.events[0];
  // Optional events (newer than the base set) are registered one by one by the bridge, so an older server that
  // rejects one of them cannot break the main RegisterEvents call (WO-044).
  const optional = new Set(eventMap.events.filter(e => e.optional).map(e => e.event.toLowerCase()));
  const registrableEvents = String(registerEnum).slice('enum:'.length).split('|').filter(e => !optional.has(e.toLowerCase()));

  return {
    /** @param {string} name case-insensitive */
    get: name => operations.get(String(name).toLowerCase()),
    /** @param {{ includeExcluded?: boolean }} [opts] */
    list: ({ includeExcluded = false } = {}) => [...operations.values()].filter(o => includeExcluded || !o.excluded),
    eventMap,
    /** Events for the main RegisterEvents call (the documented list minus the optional events). */
    registrableEvents,
    /** @param {string} operation */
    eventsRearmedBy: operation => rearms.get(String(operation).toLowerCase()) ?? [],
  };
}

/**
 * A response-shaped default value for a notation (string → "", int → 0, enum → first value, …).
 * @param {Notation} notation
 * @returns {unknown}
 */
export function defaultFor(notation) {
  if (typeof notation === 'string') {
    if (notation.startsWith('enum:')) return notation.slice(5).split('|')[0];
    switch (notation) {
      case 'string': return '';
      case 'bool': return false;
      case 'int': case 'long': case 'double': return 0;
      case 'object': return {};
      default: return null; // any, ref:*
    }
  }
  if (Array.isArray(notation)) return [];
  return Object.fromEntries(Object.entries(notation).map(([k, v]) => [k, defaultFor(v)]));
}

/**
 * Validate a value against a notation. Returns a list of problems (empty = valid).
 * Unknown object fields are errors (the server rejects them, PDF p.49); missing fields are fine.
 * @param {Notation} notation
 * @param {unknown} value
 * @param {string} [path]
 * @returns {{ path: string, problem: 'unknown-field' | 'type', expected?: string }[]}
 */
export function validateValue(notation, value, path = 'parameters') {
  if (value === null || value === undefined) return [];
  if (typeof notation === 'string') {
    const typeErr = expected => [{ path, problem: /** @type {const} */ ('type'), expected }];
    if (notation.startsWith('enum:')) {
      // Case-insensitive: the real server (6.50) returns some enums PascalCase and parses requests case-insensitively.
      const values = notation.slice(5).split('|');
      return typeof value === 'string' && values.some(v => v.toLowerCase() === value.toLowerCase()) ? [] : typeErr(`one of ${values.join(', ')}`);
    }
    switch (notation) {
      case 'string': return typeof value === 'string' ? [] : typeErr('string');
      case 'bool': return typeof value === 'boolean' ? [] : typeErr('boolean');
      case 'int': case 'long': return Number.isInteger(value) ? [] : typeErr('integer');
      case 'double': return typeof value === 'number' ? [] : typeErr('number');
      case 'object': return typeof value === 'object' && !Array.isArray(value) ? [] : typeErr('object');
      default: return []; // any, ref:* — not checkable
    }
  }
  if (Array.isArray(notation)) {
    if (!Array.isArray(value)) return [{ path, problem: 'type', expected: 'array' }];
    return value.flatMap((v, i) => validateValue(notation[0], v, `${path}[${i}]`));
  }
  if (typeof value !== 'object' || Array.isArray(value)) return [{ path, problem: 'type', expected: 'object' }];
  return Object.entries(value).flatMap(([k, v]) => (k in notation
    ? validateValue(notation[k], v, `${path}.${k}`)
    : [{ path: `${path}.${k}`, problem: /** @type {const} */ ('unknown-field') }]));
}
