// Specs for distribution (WO-107): the protocol specs the app loads at run time, without text copied from Bosch's
// documents (summaries, descriptions, remarks, examples, exception texts, PDF page references). Kept: names,
// parameters, types, permissions, licences, events: what the code needs. Docs (.md), swagger.yaml and the PDF page
// index are not shipped. The full specs in docs/protocol stay the development source of truth (gitignored).
// Usage: node scripts/dist/strip-specs.mjs <from: docs/protocol> <to>
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const del = (o, ...keys) => { for (const k of keys) delete o[k]; return o; };
/** Delete prose keys whose value is text (a string or a list of strings); names used as data are never strings here. */
const PROSE = ['summary', 'description', 'remarks', 'example', 'exceptions'];
function stripProse(node) {
  if (Array.isArray(node)) { node.forEach(stripProse); return node; }
  if (!node || typeof node !== 'object') return node;
  for (const [k, v] of Object.entries(node)) {
    const text = typeof v === 'string' || (Array.isArray(v) && v.every(x => typeof x === 'string'));
    if (PROSE.includes(k) && text) delete node[k];
    else if (k === 'obsolete' && typeof v === 'string') node[k] = 'obsolete'; // the code only needs "is obsolete"
    else stripProse(v);
  }
  return node;
}

/** Conference Protocol operation: top-level prose only (request/response maps use names like "description" as data). */
export const stripOperation = op => del({ ...op }, 'summary', 'remarks', 'sourcePages', 'extractionNotes');

/** Conference Protocol type: its prose and the prose of each field / enum member. */
export function stripType(t) {
  const out = del(structuredClone(t), 'summary', 'sourcePages', 'extractionNotes');
  for (const list of [out.fields, out.members]) for (const x of list ?? []) del(x, 'summary', 'description', 'remarks');
  return out;
}

/** Swagger 2.0: operation / parameter / response / schema texts; schema property maps are walked by value. */
export function stripSwagger(doc) {
  const out = structuredClone(doc);
  const schema = s => {
    if (!s || typeof s !== 'object') return;
    del(s, 'description', 'title', 'example');
    for (const v of Object.values(s.properties ?? {})) schema(v);
    schema(s.items);
    if (typeof s.additionalProperties === 'object') schema(s.additionalProperties);
    for (const k of ['allOf', 'anyOf', 'oneOf']) (s[k] ?? []).forEach(schema);
  };
  const param = p => { del(p, 'description', 'x-example'); schema(p.schema); schema(p.items); };
  if (out.info) out.info = { title: 'DICENTIS Wireless REST API (interface only)', version: out.info.version };
  out.tags = (out.tags ?? []).map(t => ({ name: t.name }));
  delete out.externalDocs;
  for (const item of Object.values(out.paths ?? {})) {
    (item.parameters ?? []).forEach(param);
    for (const op of Object.values(item)) {
      if (!op || typeof op !== 'object' || Array.isArray(op)) continue;
      del(op, 'summary', 'description', 'externalDocs');
      (op.parameters ?? []).forEach(param);
      for (const r of Object.values(op.responses ?? {})) { r.description = ''; schema(r.schema); for (const hd of Object.values(r.headers ?? {})) del(hd, 'description'); }
    }
  }
  for (const d of Object.values(out.definitions ?? {})) schema(d);
  for (const p of Object.values(out.parameters ?? {})) param(p); // shared parameters
  for (const r of Object.values(out.responses ?? {})) { r.description = ''; schema(r.schema); }
  return out;
}

export const stripApi = doc => stripProse(structuredClone(doc)); // DCN-SW and DCNM api.json / types.json

const read = f => JSON.parse(readFileSync(f, 'utf8'));
const write = (f, v) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, `${JSON.stringify(v, null, 1)}\n`); };

/** Write the distribution specs from `from` (docs/protocol) into `to`. Returns the list of files written. */
export function stripSpecs(from, to) {
  const written = [];
  const put = (rel, v) => { write(join(to, rel), v); written.push(rel); };
  for (const dir of ['operations', 'types']) {
    for (const f of readdirSync(join(from, 'conference', dir)).filter(x => x.endsWith('.json'))) {
      const v = read(join(from, 'conference', dir, f));
      put(`conference/${dir}/${f}`, dir === 'operations' ? stripOperation(v) : stripType(v));
    }
  }
  put('conference/events.json', read(join(from, 'conference/events.json'))); // LikeABosch's own event map (WO-006)
  put('wireless-rest/swagger.json', stripSwagger(read(join(from, 'wireless-rest/swagger.json'))));
  cpSync(join(from, 'wireless-rest/undocumented.json'), join(to, 'wireless-rest/undocumented.json')); // our own (DEC-024)
  written.push('wireless-rest/undocumented.json');
  for (const f of ['dcn-swapi/api.json', 'dcn-swapi/types.json', 'dcn-swapi/dll-additions.json', 'dcnm-api/api.json', 'dcnm-api/types.json']) {
    if (existsSync(join(from, f))) put(f, stripApi(read(join(from, f))));
  }
  return written;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [from = 'docs/protocol', to] = process.argv.slice(2);
  if (!to) { console.error('usage: node scripts/dist/strip-specs.mjs <from> <to>'); process.exit(2); }
  console.log(`${stripSpecs(from, to).length} spec files written to ${to}`);
}
