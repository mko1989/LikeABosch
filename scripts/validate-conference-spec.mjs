#!/usr/bin/env node
// Validates docs/protocol/conference/{operations,types}/*.json against SPEC-FORMAT.md.
// Usage: node scripts/validate-conference-spec.mjs [--only Name1,Name2]
// Exit code 1 if any error. Warnings do not fail.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { validateValue } from '../backend/src/wired/spec.js';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(root, 'docs/protocol/conference');
const index = JSON.parse(readFileSync(join(base, 'source-index.json'), 'utf8'));

const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > -1 ? new Set(process.argv[onlyArg + 1].split(',')) : null;

const CATEGORIES = new Set(['auth', 'system', 'events', 'permissions', 'meeting', 'agenda', 'discussion', 'seats',
  'participants', 'voting', 'interpretation', 'presentation', 'volume', 'power', 'illumination', 'files',
  'images', 'notes', 'plugins', 'room', 'license', 'token']);
const PRIMS = new Set(['string', 'bool', 'int', 'long', 'double', 'object', 'any']);

const errors = [];
const warnings = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warnings.push(`${f}: ${m}`);

function checkNotation(file, path, v) {
  if (typeof v === 'string') {
    if (PRIMS.has(v)) return;
    if (/^enum:[^|]+(\|[^|]+)*$/.test(v)) return;
    if (/^ref:[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return;
    err(file, `${path}: invalid type notation "${v}"`);
  } else if (Array.isArray(v)) {
    if (v.length !== 1) err(file, `${path}: array notation must have exactly one element`);
    else checkNotation(file, `${path}[]`, v[0]);
  } else if (v && typeof v === 'object') {
    for (const [k, sub] of Object.entries(v)) checkNotation(file, `${path}.${k}`, sub);
  } else {
    err(file, `${path}: invalid notation value ${JSON.stringify(v)}`);
  }
}

function load(dir, name) {
  const file = join(base, dir, `${name}.json`);
  if (!existsSync(file)) return [null, file];
  try {
    return [JSON.parse(readFileSync(file, 'utf8')), file];
  } catch (e) {
    err(`${dir}/${name}.json`, `invalid JSON: ${e.message}`);
    return [undefined, file];
  }
}

// ---- operations ----
// Operations not in the PDF (e.g. DICENTIS 6.50 additions) carry `source` instead of PDF pages (WO-031).
const extraOpFiles = readdirSync(join(base, 'operations')).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5))
  .filter(n => !index.operations.some(o => o.name === n));
const extraOps = extraOpFiles.filter(n => JSON.parse(readFileSync(join(base, 'operations', `${n}.json`), 'utf8')).source);
const opNames = new Set([...index.operations.map(o => o.name), ...extraOps]);
for (const { name, pages } of [...index.operations, ...extraOps.map(name => ({ name, pages: null }))]) {
  if (only && !only.has(name)) continue;
  const f = `operations/${name}.json`;
  const [op] = load('operations', name);
  if (op === null) { err(f, 'missing'); continue; }
  if (op === undefined) continue;
  for (const k of ['operation', 'summary', 'category', 'permissions', 'licenses', 'request', 'response', 'remarks', 'seeAlso', 'sourcePages', 'extractionNotes']) {
    if (!(k in op)) err(f, `missing field "${k}"`);
  }
  if (op.operation !== name) err(f, `operation "${op.operation}" != file name "${name}"`);
  if (Array.isArray(op.licenses)) op.licenses.forEach(l => { if (!/^DCNM-L[A-Z]+$/.test(l)) err(f, `bad licence name "${l}"`); });
  else err(f, 'licenses must be an array');
  if (!CATEGORIES.has(op.category)) err(f, `unknown category "${op.category}"`);
  if (!Array.isArray(op.permissions)) err(f, 'permissions must be an array');
  else op.permissions.forEach(p => { if (!/^(can|has)[A-Z]\w*$/.test(p)) warn(f, `unusual permission name "${p}"`); });
  for (const k of ['request', 'response']) {
    if (!op[k] || typeof op[k] !== 'object' || Array.isArray(op[k])) err(f, `${k} must be an object`);
    else checkNotation(f, k, op[k]);
  }
  if (Array.isArray(op.seeAlso)) op.seeAlso.forEach(s => { if (!opNames.has(s)) warn(f, `seeAlso "${s}" is not a known operation`); });
  if (pages === null) {
    if (op.sourcePages !== null || typeof op.source !== 'string') err(f, 'operations outside the PDF need sourcePages: null and a `source` string');
  } else if (JSON.stringify(op.sourcePages) !== JSON.stringify(pages)) warn(f, `sourcePages ${JSON.stringify(op.sourcePages)} != index ${JSON.stringify(pages)}`);
  if ('excluded' in op && (typeof op.excluded !== 'string' || !op.excluded)) err(f, 'excluded must be a non-empty reason string');
  if (op.extractionNotes && !op.excluded) warn(f, `note: ${op.extractionNotes}`);
  // Guard against swapped blocks (RegisterPlugin had this): a write op with an empty request but a non-empty response.
  if (!/^(Get|List)/.test(name) && op.request && op.response && !Object.keys(op.request).length && Object.keys(op.response).length
    && !op.excluded && !['ActivateMeeting'].includes(name)) {
    warn(f, 'empty request but non-empty response on a non-Get operation: check for swapped Request/Response blocks');
  }
}
extraOpFiles.filter(n => !extraOps.includes(n)).forEach(n => err(`operations/${n}.json`, 'not in source-index.json and no `source`'));

// ---- types ----
const typeFiles = existsSync(join(base, 'types')) ? readdirSync(join(base, 'types')).filter(n => n.endsWith('.json')) : [];
for (const n of typeFiles) {
  const name = n.slice(0, -5);
  if (only && !only.has(name)) continue;
  const f = `types/${n}`;
  const [t] = load('types', name);
  if (!t) continue;
  for (const k of ['name', 'kind', 'summary', 'wrapper', 'fields', 'members', 'sourcePages', 'extractionNotes']) {
    if (!(k in t)) err(f, `missing field "${k}"`);
  }
  if (t.name !== name) err(f, `name "${t.name}" != file name`);
  if (!['class', 'struct', 'enum'].includes(t.kind)) err(f, `bad kind "${t.kind}"`);
  if (t.kind === 'enum' && !(t.members?.length)) err(f, 'enum without members');
  (t.fields || []).forEach((fl, i) => { if (fl.type != null) checkNotation(f, `fields[${i}].type`, fl.type); });
  if (t.extractionNotes) warn(f, `note: ${t.extractionNotes}`);
}
if (!only) {
  const missingTypes = index.types.filter(t => !typeFiles.some(n => n.startsWith(t.name)));
  missingTypes.forEach(t => warn(`types/${t.name}.json`, 'no type file found for index entry'));
}

// ---- ref: resolution ----
const typeNames = new Set(typeFiles.map(n => n.slice(0, -5)));
function collectRefs(v, out) {
  if (typeof v === 'string' && v.startsWith('ref:')) out.add(v.slice(4));
  else if (Array.isArray(v)) v.forEach(x => collectRefs(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => collectRefs(x, out));
}
for (const name of opNames) {
  const [op] = load('operations', name);
  if (!op) continue;
  const refs = new Set();
  collectRefs([op.request, op.response], refs);
  refs.forEach(r => { if (!typeNames.has(r)) warn(`operations/${name}.json`, `ref:${r} has no types/${r}.json`); });
}

// ---- events.json (WO-006) ----
const eventsFile = join(base, 'events.json');
if (!only && existsSync(eventsFile)) {
  const f = 'events.json';
  const ev = JSON.parse(readFileSync(eventsFile, 'utf8'));
  const [reg] = load('operations', 'RegisterEvents');
  const registered = new Set(reg.request.events[0].slice(5).split('|'));
  const mapped = new Set();
  const topics = new Set();
  const checkRefresh = (where, ops) => ops.forEach(o => {
    const [op] = load('operations', o);
    if (!op) err(f, `${where}: refresh op ${o} does not exist`);
    else if (op.excluded) err(f, `${where}: refresh op ${o} is excluded`);
  });
  for (const e of ev.events) {
    if (mapped.has(e.event)) err(f, `duplicate event ${e.event}`);
    mapped.add(e.event);
    if (!registered.has(e.event) && !e.optional) err(f, `${e.event} is not in RegisterEvents and not marked optional`);
    if (!['documented', 'inferred', 'history-only'].includes(e.confidence)) err(f, `${e.event}: bad confidence`);
    if (!e.action && !e.refresh.length) err(f, `${e.event}: no refresh op and no action`);
    if (e.refresh.length !== e.topics.length) err(f, `${e.event}: refresh/topics length mismatch`);
    checkRefresh(e.event, e.refresh);
    for (const [op, params] of Object.entries(e.refreshParams ?? {})) {
      if (!e.refresh.includes(op)) err(f, `${e.event}: refreshParams for ${op} which is not a refresh op`);
      else validateValue(load('operations', op)[0].request, params).forEach(p => err(f, `${e.event}: refreshParams ${p.path} ${p.problem}`));
    }
    e.topics.forEach(t => { if (topics.has(t)) err(f, `topic ${t} defined twice`); topics.add(t); });
  }
  for (const r of registered) if (!mapped.has(r)) err(f, `RegisterEvents event ${r} is not mapped`);
  const allTopics = new Set([...topics, ...ev.topicsWithoutEvent.map(t => t.topic)]);
  for (const e of ev.events) (e.alsoRefreshTopics || []).forEach(t => { if (!allTopics.has(t)) err(f, `${e.event}: alsoRefreshTopics ${t} unknown`); });
  for (const t of ev.topicsWithoutEvent) {
    checkRefresh(t.topic, t.refresh);
    checkRefresh(`${t.topic}.refreshAfter`, t.refreshAfter ?? []);
    if (topics.has(t.topic)) err(f, `topic ${t.topic} defined twice`);
    topics.add(t.topic);
  }
}

warnings.forEach(w => console.log('WARN ', w));
errors.forEach(e => console.log('ERROR', e));
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
