// Validates docs/protocol/dcn-swapi/{api,types}.json (WO-059): structure, counts, and that every type used by a
// method parameter, event or struct member is a primitive, an array of one, or documented in types.json.
// Usage: node scripts/validate-dcn-spec.mjs   (exit 1 on errors; undocumented types are warnings listed in the README)
import { readFileSync } from 'node:fs';

const dir = new URL('../docs/protocol/dcn-swapi/', import.meta.url);
const api = JSON.parse(readFileSync(new URL('api.json', dir), 'utf8'));
const types = JSON.parse(readFileSync(new URL('types.json', dir), 'utf8'));

const PRIMITIVES = new Set(['int', 'long', 'bool', 'string', 'byte', 'short', 'double', 'float', 'uint', 'DateTime', 'Object', 'EventArgs']);
/** Documented gaps: referenced by the CHM but without their own topic page (see README "Gaps"). */
const KNOWN_UNDOCUMENTED = new Set(['KeyValuePair<string, string>']); // the others came from the DLLs (WO-068)
const EXPECTED = { interfaces: 11, methods: 109, events: 68 }; // 104/62 in the 4.70 CHM + 5/6 found in the DLLs (WO-068)

const INTERFACES = new Set([...Object.values(api.interfaces).map(i => i.interface), ...Object.values(api.entry.roots).map(r => r.interface)]);
const errors = [];
const warnings = new Set();
const check = (type, where) => {
  const base = type.replace(/\[\]$/, '');
  if (PRIMITIVES.has(base) || types[base] || INTERFACES.has(base)) return;
  if (KNOWN_UNDOCUMENTED.has(base)) { warnings.add(base); return; }
  errors.push(`${where}: unknown type ${type}`);
};

const ifaces = Object.entries(api.interfaces);
let methods = 0;
let events = 0;
for (const [key, iface] of ifaces) {
  if (!/^(control|config)\.\w+Api$/.test(key)) errors.push(`${key}: bad interface key`);
  const names = new Set();
  for (const m of iface.methods) {
    methods += 1;
    if (names.has(m.name)) errors.push(`${key}.${m.name}: overloaded name (bridge addresses methods by name)`);
    names.add(m.name);
    if (m.returns.type !== 'API_ERROR') errors.push(`${key}.${m.name}: returns ${m.returns.type}, expected API_ERROR`);
    for (const p of m.params) {
      if (!['in', 'out', 'ref'].includes(p.direction)) errors.push(`${key}.${m.name}(${p.name}): bad direction`);
      check(p.type, `${key}.${m.name}(${p.name})`);
    }
    for (const e of m.errors) if (!types.API_ERROR.values.some(v => v.name === e)) errors.push(`${key}.${m.name}: unknown error ${e}`);
  }
  for (const e of iface.events) {
    events += 1;
    if (!e.args) errors.push(`${key}.${e.name}: no EventArgs type`);
    else check(e.args, `${key}.${e.name}`);
  }
}
for (const [name, t] of Object.entries(types)) {
  if (t.kind === 'enum') {
    if (!t.values.length) errors.push(`${name}: enum without values`);
    for (const v of t.values) if (!/^\w+$/.test(v.name)) errors.push(`${name}: bad enum member ${v.name}`);
    continue;
  }
  for (const m of [...(t.fields ?? []), ...(t.properties ?? [])]) check(m.type, `${name}.${m.name}`);
}
for (const [k, n] of Object.entries({ interfaces: ifaces.length, methods, events })) {
  if (n !== EXPECTED[k]) errors.push(`expected ${EXPECTED[k]} ${k}, found ${n}`);
}

console.log(`dcn-swapi: ${ifaces.length} interfaces, ${methods} methods, ${events} events, ${Object.keys(types).length} types`);
if (warnings.size) console.log(`undocumented (known gaps): ${[...warnings].sort().join(', ')}`);
if (errors.length) {
  console.error(errors.map(e => `ERROR ${e}`).join('\n'));
  process.exit(1);
}
console.log('OK');
