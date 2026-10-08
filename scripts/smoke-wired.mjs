#!/usr/bin/env node
// Read-only smoke test against a real (or mock) DICENTIS server (WO-016).
// Logs in, checks permissions, calls every Get*/List* operation, validates each response against the spec JSON,
// probes event registration, and writes a Markdown report. Never calls state-changing operations.
//
// Usage:  node --env-file=.env scripts/smoke-wired.mjs [--out report.md] [--timeout 10000] [--delay 0]
//         --delay N: wait N ms before every request after Login (spread load on a live system).
// Env:    DICENTIS_HOST, DICENTIS_PORT (31416), DICENTIS_USER, DICENTIS_PASSWORD, DICENTIS_TLS_INSECURE (true)
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadConfig } from '../backend/src/config.js';
import { loadSpec, validateValue } from '../backend/src/wired/spec.js';
import { WiredClient } from '../backend/src/wired/client.js';
import { createLogger } from '../backend/src/lib/logger.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = arg('--out', `data/smoke-wired-${stamp}.md`);
const timeoutMs = Number(arg('--timeout', '10000'));
const delayMs = Number(arg('--delay', '0'));

const { dicentis } = loadConfig();
if (!dicentis.host || !dicentis.user) {
  console.error('Set DICENTIS_HOST, DICENTIS_USER and DICENTIS_PASSWORD (e.g. in .env, run with --env-file=.env).');
  process.exit(2);
}

const spec = loadSpec();
const client = new WiredClient({ ...dicentis, requestTimeoutMs: timeoutMs, reconnect: { enabled: false }, log: createLogger({ level: 'warn', name: 'smoke' }) });
const lines = [];
const out = s => { lines.push(s); console.log(s); };

/** Summarise validation problems: response fields/values the spec doesn't know. */
function deviations(op, data) {
  return validateValue(op.response, data).map(p => (p.problem === 'unknown-field'
    ? `field not in spec: \`${p.path}\``
    : `\`${p.path}\` = ${JSON.stringify(get(data, p.path))} (spec: ${p.expected})`));
}
function get(obj, path) {
  return path.replace(/^parameters\.?/, '').split(/\.|\[(\d+)\]/).filter(Boolean).reduce((o, k) => o?.[k], obj);
}

const events = [];
client.on('event', names => events.push(...names));

out(`# DICENTIS wired smoke test: ${new Date().toISOString()}`);
out('');
out(`Server: \`${dicentis.host}:${dicentis.port}\`, user \`${dicentis.user}\`, TLS insecure: ${dicentis.tlsInsecure}`);
out('');

try {
  await client.connect();
} catch (err) {
  out(`**Login failed:** ${err.code}: ${err.message}`);
  await save();
  process.exit(1);
}
out('Login: OK');
if (delayMs > 0) {
  const request = client.request.bind(client);
  client.request = async (...a) => { await new Promise(r => setTimeout(r, delayMs)); return request(...a); };
}

const { permissions = [] } = await client.request('GetPermissions');
const permissionType = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../docs/protocol/conference/types/Permission.json', import.meta.url), 'utf8'));
const knownPermissions = new Set(permissionType.members.map(m => m.name));
out(`Permissions (${permissions.length}): ${permissions.map(p => `\`${p}\``).join(', ') || '(none)'}`);
const newPerms = permissions.filter(p => !knownPermissions.has(p));
if (newPerms.length) out(`Permissions not in types/Permission.json: ${newPerms.join(', ')}`);
out('');

// ---- events ----
out('## Event registration');
out('');
try {
  await client.request('RegisterEvents', { events: spec.registrableEvents });
  out(`Documented events (${spec.registrableEvents.length}): accepted`);
} catch (err) {
  out(`Documented events: **rejected**: ${err.extra?.upstream ?? err.message}`);
  for (const e of spec.registrableEvents) {
    await client.request('RegisterEvents', { events: [e] }).catch(x => out(`- \`${e}\` rejected: ${x.extra?.upstream ?? x.message}`));
  }
}
for (const e of spec.eventMap.events.filter(x => x.optional)) {
  for (const name of [e.event, e.event[0].toUpperCase() + e.event.slice(1)]) {
    const r = await client.request('RegisterEvents', { events: [name] }).then(() => 'accepted', x => `rejected (${x.extra?.upstream ?? x.message})`);
    out(`History-only event \`${name}\`: ${r}`);
  }
}
out('');

// ---- read operations ----
out('## Read operations');
out('');
out('| Operation | Result | Spec deviations |');
out('|---|---|---|');
const readOps = spec.list().filter(op => /^(Get|List)/.test(op.operation) && op.operation !== 'GetPermissions');
const summary = { ok: 0, deviating: 0, failed: 0, skipped: 0 };
const samples = {};
for (const op of readOps) {
  const missing = op.permissions.filter(p => !permissions.includes(p));
  if (missing.length) {
    summary.skipped += 1;
    out(`| ${op.operation} | skipped (missing ${missing.join(', ')}) | |`);
    continue;
  }
  try {
    const refreshParams = Object.assign({}, ...spec.eventMap.events.map(e => e.refreshParams ?? {}));
    const data = await client.request(op.operation, refreshParams[op.operation] ?? {});
    const dev = deviations(op, data);
    samples[op.operation] = data;
    if (dev.length) summary.deviating += 1; else summary.ok += 1;
    out(`| ${op.operation} | ok | ${dev.slice(0, 5).join('<br>')}${dev.length > 5 ? `<br>… ${dev.length - 5} more` : ''} |`);
  } catch (err) {
    summary.failed += 1;
    out(`| ${op.operation} | **${err.code}**: ${(err.extra?.upstream ?? err.message).replace(/\|/g, '/')} | |`);
  }
}
out('');
out(`Summary: ${summary.ok} ok, ${summary.deviating} ok with spec deviations, ${summary.failed} failed, ${summary.skipped} skipped (permissions).`);
out('');
out(`Events received during the run: ${[...new Set(events)].join(', ') || '(none)'}`);
out('');

// Small response samples help fix the spec (secrets are not expected in these responses, but review before sharing).
out('## Response samples (first array element only)');
out('');
for (const [name, data] of Object.entries(samples)) {
  const trimmed = JSON.stringify(data, (_k, v) => (Array.isArray(v) ? v.slice(0, 1) : v));
  out(`- **${name}**: \`${trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed}\``);
}

await client.close();
await save();
process.exit(0);

async function save() {
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${lines.join('\n')}\n`);
  console.error(`\nReport written to ${outFile}`);
}
