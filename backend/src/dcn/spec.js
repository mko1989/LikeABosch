// DCN-SW API spec (WO-059/060): loads docs/protocol/dcn-swapi/{api,types}.json and validates call arguments the way the
// bridge converts them (BRIDGE.md "Value encoding"). Shared with the mock (mock/dcn).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../../../docs/protocol/dcn-swapi/', import.meta.url));

const INTEGER = { byte: [0, 255], short: [-32768, 32767], int: [-(2 ** 31), 2 ** 31 - 1], long: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER] };

/**
 * @typedef {{ name: string, direction: 'in' | 'out' | 'ref', type: string, description: string }} DcnParam
 * @typedef {object} DcnMethod
 * @property {string} key        e.g. "control.DiscussionApi.SpeakNow"
 * @property {string} api        e.g. "control.DiscussionApi"
 * @property {string} name       e.g. "SpeakNow"
 * @property {string} summary
 * @property {DcnParam[]} params
 * @property {DcnParam[]} inParams   in + ref
 * @property {DcnParam[]} outParams  out + ref
 * @property {string[]} errors
 * @property {string} remarks
 * @typedef {{ api: string, name: string, args: string | null, summary: string }} DcnEvent
 */

export function loadDcnSpec(dir = DIR) {
  const api = JSON.parse(readFileSync(`${dir}/api.json`, 'utf8'));
  const types = JSON.parse(readFileSync(`${dir}/types.json`, 'utf8'));

  /** @type {Map<string, DcnMethod>} lower-case key → method */
  const methods = new Map();
  /** @type {DcnEvent[]} */
  const events = [];
  for (const [apiKey, iface] of Object.entries(api.interfaces)) {
    for (const m of iface.methods) {
      const key = `${apiKey}.${m.name}`;
      methods.set(key.toLowerCase(), {
        key, api: apiKey, name: m.name, summary: m.summary, params: m.params,
        inParams: m.params.filter(p => p.direction !== 'out'),
        outParams: m.params.filter(p => p.direction !== 'in'),
        errors: m.errors, remarks: m.remarks,
      });
    }
    for (const e of iface.events) events.push({ api: apiKey, name: e.name, args: e.args, summary: e.summary });
  }

  /** Data members of a struct/class as the bridge reads/writes them (constants excluded). */
  const members = typeName => {
    const t = types[typeName];
    if (!t) return null;
    return [
      ...(t.fields ?? []).filter(f => !f.constant).map(f => ({ name: f.name, type: f.type, settable: true })),
      ...(t.properties ?? []).map(p => ({ name: p.name, type: p.type, settable: p.set })),
    ];
  };

  /**
   * Check a JSON value against a .NET type name. Returns problems as strings ("path: …").
   * @param {string} type  e.g. "int", "int[]", "DISCUSSION_INFO", "MicrophoneActivationMode"
   * @param {unknown} value
   * @param {string} path
   * @returns {string[]}
   */
  function validateValue(type, value, path) {
    if (type.endsWith('[]')) {
      if (value === null) return [];
      if (!Array.isArray(value)) return [`${path}: expected an array of ${type.slice(0, -2)}`];
      return value.flatMap((v, i) => validateValue(type.slice(0, -2), v, `${path}[${i}]`));
    }
    if (type in INTEGER) {
      const [min, max] = INTEGER[type];
      return Number.isInteger(value) && value >= min && value <= max ? [] : [`${path}: expected ${type}`];
    }
    if (type === 'double' || type === 'float') return typeof value === 'number' ? [] : [`${path}: expected a number`];
    if (type === 'bool') return typeof value === 'boolean' ? [] : [`${path}: expected true or false`];
    if (type === 'string') return value === null || typeof value === 'string' ? [] : [`${path}: expected a string`];
    const t = types[type];
    if (t?.kind === 'enum') {
      const ok = t.values.some(v => v.name === value || v.value === value);
      return ok ? [] : [`${path}: expected one of ${t.values.map(v => v.name).join(', ')}`];
    }
    const ms = members(type);
    if (ms) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path}: expected an object (${type})`];
      const problems = [];
      for (const [k, v] of Object.entries(value)) {
        const m = ms.find(x => x.name === k);
        if (!m) problems.push(`${path}.${k}: unknown member of ${type}`);
        else if (!m.settable) problems.push(`${path}.${k}: read-only member of ${type}`);
        else problems.push(...validateValue(m.type, v, `${path}.${k}`));
      }
      return problems;
    }
    return []; // undocumented type (README "Gaps"): leave it to the bridge
  }

  return {
    version: api.version,
    api,
    types,
    events,
    /** @param {string} key "control.DiscussionApi.SpeakNow" (case-insensitive) */
    get: key => methods.get(String(key).toLowerCase()) ?? null,
    list: () => [...methods.values()],
    members,
    /** Value of an enum member by name, e.g. enumValue('API_ERROR', 'NOT_ACTIVE') → -51 */
    enumValue: (type, name) => types[type]?.values.find(v => v.name === name)?.value,

    /**
     * Validate call arguments: every `in`/`ref` parameter must be present, nothing else allowed.
     * @param {DcnMethod} method
     * @param {Record<string, unknown>} args
     */
    validateArgs(method, args) {
      const problems = [];
      for (const k of Object.keys(args)) {
        if (!method.inParams.some(p => p.name === k)) problems.push(`${k}: unknown parameter`);
      }
      for (const p of method.inParams) {
        if (!(p.name in args)) problems.push(`${p.name}: missing (${p.type})`);
        else problems.push(...validateValue(p.type, args[p.name], p.name));
      }
      return problems;
    },
    validateValue,
  };
}
