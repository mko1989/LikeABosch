#!/usr/bin/env node
// Validates docs/protocol/dcnm-api/{api,types}.json (WO-077): structure, unique members, and that every type used by a
// parameter, return value, event payload or property resolves to a .NET built-in, a generic of resolvable types, an
// interface in api.json, or an entry in types.json. Usage: node scripts/validate-dcnm-spec.mjs
import { readFileSync } from 'node:fs';

const api = JSON.parse(readFileSync(new URL('../docs/protocol/dcnm-api/api.json', import.meta.url), 'utf8'));
const types = JSON.parse(readFileSync(new URL('../docs/protocol/dcnm-api/types.json', import.meta.url), 'utf8'));

const BUILTIN = new Set(['void', 'bool', 'byte', 'sbyte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'float', 'double',
  'decimal', 'char', 'string', 'object', 'Guid', 'DateTime', 'TimeSpan', 'Uri', 'EventArgs', 'EventHandler', 'Task', 'Action',
  'Exception', 'Version',
  // framework types in signatures the bridge supplies itself (CancellationToken) or does not expose (the rest)
  'CancellationToken', 'SynchronizationContext', 'SerializationInfo', 'StreamingContext']);
const GENERIC = new Set(['Task', 'Action', 'Func', 'IList', 'List', 'IEnumerable', 'ICollection', 'IReadOnlyList',
  'IReadOnlyCollection', 'Dictionary', 'IDictionary', 'IReadOnlyDictionary', 'KeyValuePair', 'Tuple', 'EventHandler',
  'ApiEventArgs', 'Nullable', 'ObservableCollection', 'HashSet', 'ISet', 'Collection', 'ReadOnlyCollection']);
const interfaces = { ...api.interfaces, ...api.otherInterfaces };
const known = new Set([...Object.values(interfaces).map(i => i.interface), ...Object.keys(types.classes),
  ...Object.keys(types.enums), ...Object.keys(types.delegates)].map(n => n.replace(/<T>$/, '')));

const problems = [];
const unresolved = new Map();

/** Split "A, B<C, D>" at top-level commas. */
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '<') depth++;
    if (ch === '>') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function resolves(type) {
  let t = type.trim();
  if (t.endsWith('[]')) return resolves(t.slice(0, -2));
  if (t.endsWith('?')) return resolves(t.slice(0, -1));
  const g = /^([\w.]+)<(.*)>$/.exec(t);
  if (g) return (GENERIC.has(g[1]) || known.has(g[1])) && splitTop(g[2]).every(resolves);
  if (/^T\w*$/.test(t)) return true; // generic parameter
  return BUILTIN.has(t) || known.has(t);
}
function check(type, where) {
  if (!type) return;
  if (!resolves(type)) unresolved.set(type, [...(unresolved.get(type) ?? []), where]);
}

// ---------------------------------------------------------------- structure
if (!api.entry?.class || !Array.isArray(api.entry.properties)) problems.push('entry: missing class/properties');
for (const p of api.entry.properties) {
  if (!api.interfaces[p.name]) problems.push(`entry property ${p.name}: no interface entry`);
  else if (api.interfaces[p.name].interface !== p.type) problems.push(`entry property ${p.name}: type ${p.type} ≠ ${api.interfaces[p.name].interface}`);
}
const seenIfaces = new Set();
for (const [key, iface] of Object.entries(interfaces)) {
  if (seenIfaces.has(iface.interface)) problems.push(`${key}: interface ${iface.interface} listed twice`);
  seenIfaces.add(iface.interface);
  for (const base of iface.inherits ?? []) if (!seenIfaces.has(base) && !Object.values(interfaces).some(i => i.interface === base)) problems.push(`${key}: unknown base ${base}`);
  const sigs = new Set();
  for (const m of iface.methods) {
    const sig = `${m.name}(${m.params.map(p => p.type).join(',')})`;
    if (sigs.has(sig)) problems.push(`${key}.${sig}: duplicate`);
    sigs.add(sig);
    if (!m.returns?.type) problems.push(`${key}.${m.name}: no return type`);
    check(m.returns?.type, `${key}.${m.name} returns`);
    for (const p of m.params) {
      if (!p.name || !p.type) problems.push(`${key}.${m.name}: parameter without name/type`);
      check(p.type, `${key}.${m.name}(${p.name})`);
    }
  }
  const events = new Set();
  for (const e of iface.events) {
    if (events.has(e.name)) problems.push(`${key}.${e.name}: duplicate event`);
    events.add(e.name);
    check(e.handler, `${key}.${e.name} handler`);
    check(e.payload, `${key}.${e.name} payload`);
  }
  for (const p of iface.properties) check(p.type, `${key}.${p.name}`);
}
for (const [name, c] of Object.entries(types.classes)) {
  for (const p of c.properties) check(p.type, `${name}.${p.name}`);
  for (const ctor of c.constructors) for (const p of ctor.params) check(p.type, `${name}(${p.name})`);
}
for (const [name, e] of Object.entries(types.enums)) {
  if (!e.members.length) problems.push(`enum ${name}: no members`);
  const values = e.members.map(m => m.value);
  if (values.some(v => typeof v !== 'number')) problems.push(`enum ${name}: non-numeric value`);
}

for (const [type, where] of unresolved) problems.push(`unresolved type ${type} (${where.length}×, e.g. ${where[0]})`);

const methods = Object.values(interfaces).reduce((n, i) => n + i.methods.length, 0);
const events = Object.values(interfaces).reduce((n, i) => n + i.events.length, 0);
console.log(`dcnm-api: ${Object.keys(interfaces).length} interfaces, ${methods} methods, ${events} events, ` +
  `${Object.keys(types.classes).length} classes, ${Object.keys(types.enums).length} enums`);
if (problems.length) {
  console.log(problems.map(p => `  ✖ ${p}`).join('\n'));
  process.exit(1);
}
console.log('dcnm-api spec OK');
