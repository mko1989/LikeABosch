// Loads the DICENTIS Wireless REST spec (docs/protocol/wireless-rest/swagger.json, verbatim from the vendor
// Swagger 2.0 YAML) and provides operation lookup + minimal JSON-schema validation (WO-014).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SPEC_FILE = fileURLToPath(new URL('../../../docs/protocol/wireless-rest/swagger.json', import.meta.url));
/** The WAP web UI's endpoints LikeABosch uses (DEC-024), same Swagger 2.0 shape; operations get `undocumented: true`. */
const EXTRA_FILE = fileURLToPath(new URL('../../../docs/protocol/wireless-rest/undocumented.json', import.meta.url));

/**
 * @typedef {object} WirelessOperation
 * @property {string} id          e.g. "GET /seats/{seat_id}"
 * @property {string} method      upper case
 * @property {string} path        template, e.g. "/seats/{seat_id}"
 * @property {RegExp} pattern
 * @property {string[]} pathParams
 * @property {string} summary
 * @property {string} description
 * @property {object | null} bodySchema
 * @property {boolean} bodyRequired
 * @property {{ name: string, type: string }[]} queryParams
 * @property {Record<string, { description: string, schema?: object }>} responses
 * @property {boolean} [undocumented]  from undocumented.json (WAP web UI, DEC-024)
 */

export function loadWirelessSpec(file = SPEC_FILE, extraFile = file === SPEC_FILE ? EXTRA_FILE : null) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const extra = extraFile ? JSON.parse(readFileSync(extraFile, 'utf8')) : { paths: {} };
  const resolve = obj => {
    if (Array.isArray(obj)) return obj.map(resolve);
    if (!obj || typeof obj !== 'object') return obj;
    if (obj.$ref) {
      const [, section, name] = obj.$ref.match(/^#\/(\w+)\/(.+)$/) ?? [];
      return resolve(doc[section]?.[name]);
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolve(v)]));
  };

  /** @type {WirelessOperation[]} */
  const operations = [];
  const sources = [[doc.paths, false], [extra.paths, true]];
  for (const [path, methods, undocumented] of sources.flatMap(([paths, u]) => Object.entries(paths).map(([p, m]) => [p, m, u]))) {
    for (const [method, raw] of Object.entries(methods)) {
      const op = resolve(raw);
      const params = op.parameters ?? [];
      const body = params.find(p => p.in === 'body');
      const pathParams = params.filter(p => p.in === 'path').map(p => p.name);
      operations.push({
        id: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        pattern: new RegExp(`^${path.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)')}$`),
        pathParams,
        summary: op.summary ?? '',
        description: String(op.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        bodySchema: body?.schema ?? null,
        bodyRequired: Boolean(body?.required),
        queryParams: params.filter(p => p.in === 'query').map(p => ({ name: p.name, type: p.type })),
        responses: op.responses ?? {},
        ...(undocumented ? { undocumented: true } : {}),
      });
    }
  }
  // Literal segments must win over parameters (e.g. /participants/settings vs /participants/{participant_id}).
  operations.sort((a, b) => (a.path.match(/\{/g)?.length ?? 0) - (b.path.match(/\{/g)?.length ?? 0));

  return {
    info: doc.info,
    basePath: doc.basePath ?? '/api',
    operations,
    /**
     * Find the operation for a concrete request.
     * @param {string} method
     * @param {string} path  e.g. "/seats/12"
     */
    match(method, path) {
      for (const op of operations) {
        if (op.method !== method.toUpperCase()) continue;
        const m = op.pattern.exec(path);
        if (m) return { op, params: { ...m.groups } };
      }
      return null;
    },
    /** Response schema for a status code (or the 200 one). */
    responseSchema: (op, status = 200) => op.responses[String(status)]?.schema ?? null,
  };
}

/**
 * Minimal JSON-schema validation for the subset Swagger 2.0 uses here
 * (type, properties, items, required, maxLength). Unknown properties are allowed (the WAP adds fields), and so is
 * `null` for scalar fields: the real WAP sends null battery/signal values for disconnected seats (WO-075).
 * @returns {string[]} problems
 */
export function validateSchema(schema, value, path = 'body') {
  if (!schema || value === undefined) return [];
  if (value === null && !['object', 'array'].includes(schema.type ?? (schema.properties ? 'object' : ''))) return [];
  const problems = [];
  const type = schema.type ?? (schema.properties ? 'object' : undefined);
  const is = {
    object: v => v !== null && typeof v === 'object' && !Array.isArray(v),
    array: Array.isArray,
    integer: Number.isInteger,
    number: v => typeof v === 'number',
    string: v => typeof v === 'string',
    boolean: v => typeof v === 'boolean',
  };
  if (type && is[type] && !is[type](value)) return [`${path}: expected ${type}`];
  if (type === 'string' && schema.maxLength && value.length > schema.maxLength) problems.push(`${path}: longer than ${schema.maxLength}`);
  if (type === 'array' && schema.items) value.forEach((v, i) => problems.push(...validateSchema(schema.items, v, `${path}[${i}]`)));
  if (type === 'object') {
    for (const req of schema.required ?? []) if (!(req in value)) problems.push(`${path}.${req}: required`);
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (k in value) problems.push(...validateSchema(sub, value[k], `${path}.${k}`));
    }
  }
  return problems;
}
