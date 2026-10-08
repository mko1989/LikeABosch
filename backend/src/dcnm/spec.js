// DICENTIS DCNM API spec for the Node side (WO-079, DEC-021): docs/protocol/dcnm-api/{api,types}.json, keyed like the
// dicentis-bridge keys interfaces (WindowsApiInstance property name; documented interfaces without a property: their name
// without the leading "I", e.g. RoomAudioControl). Validation here is light: the bridge chooses overloads and converts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../../../docs/protocol/dcnm-api/', import.meta.url));

/** Request…Async methods without parameters that are not state reads (started streams). */
const NOT_IN_SWEEP = new Set(['RoomAudioControl.RequestVUMeterReadingsAsync']);

/**
 * @typedef {{ name: string, type: string, default?: string }} Param
 * @typedef {{ name: string, summary: string, params: Param[], returns: { type: string }, callback: boolean, overloaded?: boolean, obsolete?: string }} Method
 * @typedef {{ key: string, interface: string, summary: string, inherits: string[], methods: Method[], events: { name: string, payload: string | null, summary: string }[], properties: { name: string, type: string, access: string }[] }} Interface
 */
export function loadDcnmSpec(dir = DIR) {
  const api = JSON.parse(readFileSync(`${dir}/api.json`, 'utf8'));
  const types = JSON.parse(readFileSync(`${dir}/types.json`, 'utf8'));
  /** @type {Map<string, Interface>} */
  const interfaces = new Map();
  const byName = new Map();
  for (const [key, i] of Object.entries(api.interfaces)) interfaces.set(key, { key, ...i });
  for (const [name, i] of Object.entries(api.otherInterfaces)) interfaces.set(name.replace(/^I/, ''), { key: name.replace(/^I/, ''), ...i });
  for (const i of interfaces.values()) byName.set(i.interface, i);

  /** Members of an interface including the interfaces it inherits (IDeviceApi : IApi). */
  const members = (i, kind) => [...i[kind], ...i.inherits.flatMap(b => (byName.has(b) ? members(byName.get(b), kind) : []))];

  return {
    version: api.version,
    types,
    interfaces,
    /** @param {string} key */
    get: key => interfaces.get(key) ?? null,
    /** Overloads of a method (own and inherited). */
    overloads(key, method) {
      const i = interfaces.get(key);
      return i ? members(i, 'methods').filter(m => m.name === method) : [];
    },
    /** Events of an interface (own and inherited). */
    events: key => (interfaces.has(key) ? members(interfaces.get(key), 'events') : []),
    /** Properties of an interface (own and inherited). */
    properties: key => (interfaces.has(key) ? members(interfaces.get(key), 'properties') : []),
    /**
     * Problems with a call before sending it: unknown method, or argument names no overload has. Interfaces the spec
     * does not know (undocumented ones the bridge found) are passed through unchecked.
     */
    validateCall(key, method, args) {
      const i = interfaces.get(key);
      if (!i) return [];
      const overloads = members(i, 'methods').filter(m => m.name === method);
      if (!overloads.length) return [`${key}.${method}: no such method (documented: ${[...new Set(members(i, 'methods').map(m => m.name))].join(', ')})`];
      const names = Object.keys(args);
      if (overloads.some(m => names.every(n => m.params.some(p => p.name === n)))) return [];
      return [`${key}.${method}: no overload takes (${names.join(', ')}); overloads: ${overloads.map(m => `(${m.params.map(p => p.name).join(', ')})`).join(' | ')}`];
    },
    /** Parameterless Request…Async methods: after connecting, each makes its …Changed event fire with the current state. */
    sweep(keys = [...interfaces.keys()]) {
      const out = [];
      for (const key of keys) {
        const i = interfaces.get(key);
        if (!i) continue;
        for (const m of i.methods) {
          if (/^Request\w*Async$/.test(m.name) && !m.params.length && !m.obsolete && !NOT_IN_SWEEP.has(`${key}.${m.name}`)) out.push([key, m.name]);
        }
      }
      return out;
    },
    list() {
      return [...interfaces.values()].map(i => ({
        api: i.key, interface: i.interface, summary: i.summary, inherits: i.inherits,
        methods: members(i, 'methods').map(m => ({ name: m.name, params: m.params, returns: m.returns.type, ...(m.obsolete ? { obsolete: m.obsolete } : {}) })),
        events: members(i, 'events').map(e => ({ name: e.name, payload: e.payload })),
        properties: members(i, 'properties').map(p => ({ name: p.name, type: p.type, access: p.access })),
      }));
    },
  };
}
