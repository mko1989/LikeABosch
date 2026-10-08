#!/usr/bin/env node
// End-to-end test of the whole DICENTIS Wireless REST API against a real WAP (WO-075).
// Runs THROUGH OUR BACKEND like e2e-wired.mjs: calls go via the passthrough (/api/wireless/*) and the domain API
// (/api/domain/*); effects are verified via the state cache (/api/state/*), i.e. through long-poll → poller → cache.
// Protocol probes (session transport, long-poll timing) use fetch / the raw client.
// It CHANGES STATE (speakers, participants, identification, voting, power standby/on, discussion mode) and restores
// it at the end. Power "Off" is never sent. Participants that existed before are never touched; "delete all" is only
// sent when the participant list was empty at the start. Use only on a system you may modify.
//
// Usage: DICENTIS_HOST=… DICENTIS_USER=admin DICENTIS_PASSWORD= node scripts/e2e-wireless.mjs [--out report.md]
//        [--keep-power] (no standby/on)  [--quick] (skip the ~50 s long-poll hold measurement)
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { start } from '../backend/src/server.js';
import { loadConfig } from '../backend/src/config.js';
import { loadWirelessSpec, validateSchema } from '../backend/src/wireless/spec.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : fallback; };
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = arg('--out', `data/e2e-wireless-${stamp}.md`);
const keepPower = process.argv.includes('--keep-power');
const quick = process.argv.includes('--quick');
const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.error('E2E: hard timeout (15 min)'); process.exit(3); }, 15 * 60_000).unref();
if (!process.env.DICENTIS_HOST) { console.error('Set DICENTIS_HOST (and DICENTIS_USER / DICENTIS_PASSWORD)'); process.exit(2); }

// ---------------------------------------------------------------- backend in-process
const dataDir = mkdtempSync(join(tmpdir(), 'e2e-wireless-'));
const backend = await start(loadConfig({
  ...process.env, DICENTIS_SYSTEM: 'wireless', DICENTIS_USER: process.env.DICENTIS_USER || 'admin',
  PORT: '0', LOG_LEVEL: process.env.E2E_LOG ?? 'warn', DATA_DIR: dataDir, DICENTIS_AUTOCONNECT: 'false',
}));
const { manager, poller } = backend.services;
await manager.connect({ override: true }); // one session per user on the WAP: take over a stale one
await poller.idle();
const raw = manager.wirelessClient;
const spec = loadWirelessSpec();
const base = raw.baseUrl;

// ---------------------------------------------------------------- recording
/** @type {{ area: string, op: string, params: unknown, outcome: string, detail: string }[]} */
const calls = [];
/** @type {{ area: string, name: string, ok: boolean, detail: string }[]} */
const checks = [];
let area = 'setup';

async function http(method, path, body) {
  const res = await fetch(`${backend.url}/api${path}`, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

/** Fields present in the data that the swagger schema does not declare (the WAP adds some). */
function undeclared(schema, value, path = '') {
  if (!schema || value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return schema.items ? [...new Set(value.flatMap(v => undeclared(schema.items, v, `${path}[]`)))] : [];
  if (!schema.properties) return [];
  return Object.entries(value).flatMap(([k, v]) => (k in schema.properties ? undeclared(schema.properties[k], v, `${path}.${k}`) : [`${path}.${k}`]));
}

/**
 * Call a swagger operation through the backend passthrough and record it.
 * @returns {Promise<{ ok: boolean, data?: any, error?: string, status?: number }>}
 */
async function op(method, path, body) {
  const res = await http(method, `/wireless${path}`, body);
  const found = spec.match(method, path);
  const id = found?.op.id ?? `${method} ${path}`;
  const result = res.ok ? { ok: true, data: res.data }
    : { ok: false, error: res.error.upstream ?? [res.error.message, ...(res.error.details ?? [])].join('; '), status: res.error.status };
  let outcome = result.ok ? 'ok' : 'error';
  let detail = result.ok ? JSON.stringify(result.data) ?? '' : `${result.status ? `HTTP ${result.status}: ` : ''}${result.error}`;
  if (result.ok && found && method === 'GET') {
    const schema = spec.responseSchema(found.op);
    const problems = validateSchema(schema, result.data);
    const extra = undeclared(schema, result.data);
    if (problems.length || extra.length) {
      outcome = 'ok*';
      detail = `${detail.slice(0, 200)} ⟶ ${[...problems.slice(0, 3), ...(extra.length ? [`not in swagger: ${extra.join(', ')}`] : [])].join('; ')}`;
    }
  }
  calls.push({ area, op: id, params: body ?? {}, outcome, detail: String(detail).slice(0, 500) });
  return result;
}
/** An operation that is expected to fail (validation probe): recorded as `rejected`, not `error`. */
async function reject(method, path, body, pattern) {
  const r = await op(method, path, body);
  const last = calls.at(-1);
  if (r.ok) throw new Error(`${method} ${path} ${JSON.stringify(body ?? '')} was accepted, expected a rejection`);
  last.outcome = 'rejected (expected)';
  if (pattern && !pattern.test(r.error)) throw new Error(`${method} ${path}: unexpected error "${r.error}"`);
  return r.error;
}
async function domain(method, path, body) {
  const res = await http(method, `/domain${path}`, body);
  calls.push({ area, op: `domain ${method} ${path}`, params: body ?? {}, outcome: res.ok ? 'ok' : 'error', detail: res.ok ? '' : res.error.message });
  if (!res.ok) throw new Error(`domain ${method} ${path}: ${res.error.message}`);
  return res.data;
}
const stateEntry = async topic => { const r = await http('GET', `/state/${topic}`); return r.ok ? r.data : undefined; };
async function waitState(topic, pred, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = (await stateEntry(topic))?.data;
    try { if (last !== undefined && pred(last)) return last; } catch { /* keep waiting */ }
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${topic}; last = ${JSON.stringify(last)?.slice(0, 300)}`);
}
/** The WAP applies writes asynchronously: poll a GET until it matches. */
async function eventually(method, path, pred, timeoutMs = 5_000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await raw.request(method, path);
    if (pred(last)) return last;
    await sleep(250);
  }
  throw new Error(`${path} did not reach the expected state; last = ${JSON.stringify(last)?.slice(0, 300)}`);
}
async function check(name, fn) {
  try {
    const detail = await fn();
    checks.push({ area, name, ok: true, detail: detail ?? '' });
    console.log(`  ✔ ${area}: ${name}`);
  } catch (e) {
    checks.push({ area, name, ok: false, detail: e.message });
    console.log(`  ✖ ${area}: ${name}: ${e.message}`);
  }
}
const expectOk = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.error}`); return r.data; };
/** @type {[string, () => Promise<unknown>][]} restore steps, run LIFO */
const restore = [];
const ids = list => list.map(e => e.id);

// ================================================================= snapshot
const snapshot = {
  info: await raw.request('GET', '/system-info'),
  power: (await raw.request('GET', '/system/status')).state,
  identification: (await raw.request('GET', '/participants/settings')).identification_mode,
  voting: await raw.request('GET', '/voting'),
  votingState: (await raw.request('GET', '/voting/state')).state,
  participants: await raw.request('GET', '/participants'),
  speakers: ids(await raw.request('GET', '/speakers')),
  waiting: ids(await raw.request('GET', '/waiting-list')),
  // Undocumented (WAP web UI): discussion settings. null when the firmware has no such endpoint.
  discuss: await raw.request('GET', '/discuss').catch(() => null),
};
const seatsAtStart = await raw.request('GET', '/seats');
const live = seatsAtStart.filter(s => s.connected).map(s => s.id);
console.log(`WAP ${snapshot.info['Device Type']} ${snapshot.info.Versions?.Firmware} (API ${snapshot.info.Versions?.Api?.join(', ')}); ` +
  `${seatsAtStart.length} seats, connected: ${live.join(', ') || 'none'}; power ${snapshot.power}; discussion mode ${snapshot.discuss?.mode ?? '?'}`);
calls.push({ area: 'session', op: 'POST /login', params: { override: true }, outcome: 'ok', detail: 'session login by the backend (connect with override)' });

// ================================================================= session / protocol
area = 'session';
await check('session transport: cookie and Bosch-Sid accepted, swagger header `sid` refused', async () => {
  const st = async headers => (await fetch(`${base}/system/status`, { headers })).status;
  const r = { cookie: await st({ cookie: `sid=${raw.sid}` }), boschSid: await st({ 'bosch-sid': raw.sid }), sidHeader: await st({ sid: raw.sid }), none: await st({}) };
  if (r.cookie !== 200 || r.boschSid !== 200 || r.none !== 401) throw new Error(JSON.stringify(r));
  return JSON.stringify(r);
});
await check('second login without override → 409', async () => {
  const res = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: manager.settings.user, password: manager.settings.password ?? '' }) });
  if (res.status !== 409) throw new Error(`HTTP ${res.status}`);
  return (await res.text()).slice(0, 200);
});
await check('GET /system-info', async () => JSON.stringify(expectOk(await op('GET', '/system-info'), 'system-info')).slice(0, 300));

area = 'long-poll';
await check('isPolling=true is released by a change of that resource', async () => {
  if (!live.length) return 'skipped: no connected seat';
  const t = Date.now();
  const held = raw.request('GET', '/speakers', { query: { isPolling: true }, timeoutMs: 70_000 });
  await sleep(1500);
  await raw.request('POST', '/speakers', { body: [live[0]] });
  await held;
  const ms = Date.now() - t;
  await raw.request('DELETE', '/speakers');
  if (ms > 10_000) throw new Error(`held ${ms} ms despite the change`);
  return `answered ${ms} ms after the request (change sent at 1500 ms)`;
});
/** The poller shares our session and its own long-polls would release ours: pause it for these measurements. */
async function withoutPoller(fn) {
  poller.detach();
  try { return await fn(); } finally { poller.attach(raw); await poller.idle(); }
}
await check('one long-poll per path and session: a second one releases the first', () => withoutPoller(async () => {
  await sleep(500); // let a long-poll the poller left on /voting/state be released by ours, not the other way round
  const t = Date.now();
  const first = raw.request('GET', '/voting/state', { query: { isPolling: true }, timeoutMs: 70_000 }).then(() => Date.now() - t);
  await sleep(1500);
  const second = raw.request('GET', '/voting/state', { query: { isPolling: true }, timeoutMs: 70_000 });
  const ms = await first;
  second.catch(() => {}); // left to time out on the WAP
  if (ms < 1400 || ms > 10_000) throw new Error(`first long-poll answered after ${ms} ms`);
  return `first answered ${ms} ms after start (second sent at 1500 ms)`;
}));
if (!quick) {
  await check('isPolling=true without a change is held until the WAP timeout', () => withoutPoller(async () => {
    const t = Date.now();
    await raw.request('GET', '/participants/settings', { query: { isPolling: true }, timeoutMs: 70_000 });
    const s = (Date.now() - t) / 1000;
    if (s < 2) throw new Error(`answered after ${s} s without a change`);
    return `held ${s.toFixed(1)} s`;
  }));
}

// ================================================================= seats
area = 'seats';
await check('GET /seats, /seats/{id}, unknown seat', async () => {
  const seats = expectOk(await op('GET', '/seats'), 'seats');
  expectOk(await op('GET', `/seats/${live[0] ?? seats[0].id}`), 'seat');
  const err = await reject('GET', '/seats/9999', undefined, /Invalid seat id/i);
  const cached = await waitState('domain.seats', d => d.length === seats.length);
  return `${seats.length} seats, ${cached.filter(s => s.connected).length} connected in domain.seats; unknown: ${err}`;
});

area = 'load';
await check('burst of 10 parallel GETs while the poller long-polls: no request parked', async () => {
  const paths = ['/system-info', '/seats', '/speakers', '/waiting-list', '/participants', '/participants/settings', '/voting', '/voting/state', '/voting/results', '/system/status'];
  const times = [];
  for (let round = 0; round < 3; round++) {
    times.push(...await Promise.all(paths.map(async p => { const t = Date.now(); await http('GET', `/wireless${p}`); return Date.now() - t; })));
    await sleep(500);
  }
  const max = Math.max(...times);
  if (max > 15_000) throw new Error(`slowest request ${max} ms`);
  return `30 requests, slowest ${max} ms, median ${times.sort((a, b) => a - b)[15]} ms`;
});

// ================================================================= discussion
area = 'discussion';
const OPEN = 0;
if (snapshot.discuss && snapshot.discuss.mode !== OPEN) {
  // The waiting list only exists in Open mode: switch for the test (undocumented PUT /discuss), restore at the end.
  restore.push(['discussion settings', () => raw.request('PUT', '/discuss', { body: snapshot.discuss })]);
  await check('waiting list refused outside Open mode (bare 500)', async () => {
    if (!live.length) return 'skipped: no connected seat';
    return reject('POST', '/waiting-list', [live[0]]);
  });
  await raw.request('PUT', '/discuss', { body: { ...snapshot.discuss, mode: OPEN } });
  await eventually('GET', '/discuss', d => d.mode === OPEN);
}
restore.push(['speakers and waiting list', async () => {
  await raw.request('DELETE', '/speakers');
  if (snapshot.speakers.length) await raw.request('POST', '/speakers', { body: snapshot.speakers }).catch(() => {});
  if (snapshot.waiting.length) await raw.request('POST', '/waiting-list', { body: snapshot.waiting }).catch(() => {});
}]);
await check('speakers: available, add (domain), list, remove (domain), errors', async () => {
  if (!live.length) throw new Error('no connected seat: cannot test the discussion');
  const [a, b] = live;
  expectOk(await op('GET', '/speakers/available'), 'available');
  await op('DELETE', '/speakers');
  await domain('POST', '/discussion/speakers', { seatId: String(a) });
  await waitState('domain.discussion', d => d.speakers.some(s => s.seatId === String(a)));
  expectOk(await op('GET', '/speakers'), 'speakers');
  if (b) expectOk(await op('POST', '/speakers', [b]), 'POST /speakers');
  await domain('DELETE', `/discussion/speakers/${a}`);
  await waitState('domain.discussion', d => !d.speakers.some(s => s.seatId === String(a)));
  const notIn = await reject('DELETE', `/speakers/${a}`, undefined);
  const offline = seatsAtStart.find(s => !s.connected);
  const off = offline ? await reject('POST', '/speakers', [offline.id], /Invalid seat id/) : 'no offline seat';
  const shape = await reject('POST', '/speakers', { id: a }, /body/i).catch(e => `(passthrough refused the shape: ${e.message})`);
  return `remove twice: ${notIn}; offline seat: ${off}; object body: ${shape}`;
});
await check('waiting list: available, add (domain), list, remove one, clear', async () => {
  const [a, b] = live;
  await op('DELETE', '/speakers');
  expectOk(await op('GET', '/waiting-list/available'), 'available');
  await domain('POST', '/discussion/requests', { seatId: String(a) });
  await waitState('domain.discussion', d => d.requests.some(s => s.seatId === String(a)));
  expectOk(await op('GET', '/waiting-list'), 'waiting-list');
  await domain('DELETE', `/discussion/requests/${a}`);
  await waitState('domain.discussion', d => !d.requests.length);
  const notIn = await reject('DELETE', `/waiting-list/${a}`, undefined, /not found/i);
  expectOk(await op('POST', '/waiting-list', b ? [a, b] : [a]), 'POST /waiting-list');
  await eventually('GET', '/waiting-list', l => l.length === (b ? 2 : 1));
  expectOk(await op('DELETE', '/waiting-list'), 'DELETE /waiting-list');
  await eventually('GET', '/waiting-list', l => l.length === 0);
  return `remove when absent: ${notIn}`;
});
await check('shift: POST /speakers [] moves the first waiter to the speakers', async () => {
  const [a] = live;
  await op('DELETE', '/speakers');
  const none = await reject('POST', '/speakers', [], /No waiter to shift/);
  expectOk(await op('POST', '/waiting-list', [a]), 'waiting');
  await eventually('GET', '/waiting-list', l => l.length === 1);
  expectOk(await op('POST', '/speakers', []), 'shift');
  await eventually('GET', '/speakers', l => l.some(e => e.id === a));
  return `empty waiting list: ${none}`;
});
await check('clear all (domain DELETE /discussion)', async () => {
  await op('POST', '/speakers', [live[0]]);
  await domain('DELETE', '/discussion');
  await waitState('domain.discussion', d => !d.speakers.length && !d.requests.length);
});
await check('priority calls', async () => {
  const chair = seatsAtStart.find(s => s.prio && s.connected);
  if (!chair) {
    const err = await reject('POST', '/priority', [live[0]], /chairman/i);
    await reject('DELETE', `/priority/${live[0]}`, undefined, /chairman/i);
    return `no connected chairman seat: success path not verifiable (${err})`;
  }
  expectOk(await op('POST', '/priority', [chair.id]), 'POST /priority');
  await waitState('domain.discussion', d => d.speakers.some(s => s.seatId === String(chair.id) && s.priority));
  await op('DELETE', '/speakers');
  const kept = await eventually('GET', '/speakers', l => l.some(e => e.id === chair.id && e.prioOn));
  expectOk(await op('DELETE', `/priority/${chair.id}`), 'DELETE /priority');
  await eventually('GET', '/speakers', l => !l.some(e => e.id === chair.id));
  await domain('POST', `/discussion/priority/${chair.id}`);
  await waitState('domain.discussion', d => d.speakers.some(s => s.seatId === String(chair.id) && s.priority));
  await domain('DELETE', `/discussion/priority/${chair.id}`);
  await waitState('domain.discussion', d => !d.speakers.some(s => s.seatId === String(chair.id)));
  return `DELETE /speakers keeps the priority call, mic ${kept.find(e => e.id === chair.id).micOn ? 'on' : 'off'}`;
});

// ================================================================= participants
area = 'participants';
const created = [];
restore.push(['participants created by the test', async () => {
  for (const id of created) await raw.request('DELETE', `/participants/${id}`).catch(() => {});
}]);
const freeSeat = seatsAtStart.find(s => !snapshot.participants.some(p => p.seatId === s.id))?.id ?? -1;
await check('create (all fields required), get, update, delete', async () => {
  expectOk(await op('GET', '/participants'), 'list');
  const missing = await reject('POST', '/participants', { name: 'E2E Missing' }, /Missing field/);
  const r = expectOk(await op('POST', '/participants', { name: 'E2E Alice', seatId: freeSeat, nfc: '04:E2:E2:E2:E2:E2:01' }), 'create');
  const id = r?.id ?? (await raw.request('GET', '/participants')).find(p => p.name === 'E2E Alice')?.id;
  if (!id) throw new Error(`no id after create (${JSON.stringify(r)})`);
  created.push(id);
  await waitState('domain.participants', d => d.some(p => p.id === String(id)));
  expectOk(await op('GET', `/participants/${id}`), 'get');
  expectOk(await op('PUT', `/participants/${id}`, { name: 'E2E Alice Renamed' }), 'partial update');
  const after = await eventually('GET', `/participants/${id}`, p => p.name === 'E2E Alice Renamed');
  const r2 = expectOk(await op('POST', '/participants', { name: 'E2E Bob', seatId: -1, nfc: '' }), 'create without seat/nfc');
  const id2 = r2?.id;
  if (id2) created.push(id2);
  expectOk(await op('DELETE', `/participants/${id2}`), 'delete');
  created.splice(created.indexOf(id2), 1);
  return `create returns ${JSON.stringify(r)}; missing fields: ${missing}; after partial PUT: ${JSON.stringify(after)}`;
});
await check('validation: name length, seat, NFC format and duplicates, unknown id', async () => {
  const out = [];
  out.push(await reject('POST', '/participants', { name: 'N'.repeat(33), seatId: -1, nfc: '' }, /name/));
  out.push(await reject('POST', '/participants', { name: 'E2E Seat', seatId: 99999, nfc: '' }, /seat/i));
  if (created[0] && freeSeat !== -1) out.push(await reject('POST', '/participants', { name: 'E2E Seat2', seatId: freeSeat, nfc: '' }, /Seat already assigned/));
  out.push(await reject('POST', '/participants', { name: 'E2E Nfc', seatId: -1, nfc: 'zz' }, /NFC/));
  if (created[0]) out.push(await reject('POST', '/participants', { name: 'E2E Dup', seatId: -1, nfc: '04:E2:E2:E2:E2:E2:01' }, /NFC already assigned/));
  out.push(await reject('GET', '/participants/99999', undefined));
  out.push(await reject('PUT', '/participants/99999', { name: 'x' }));
  out.push(await reject('DELETE', '/participants/99999', undefined));
  return out.join(' | ');
});
await check('identification settings (GET/PUT), out of range', async () => {
  expectOk(await op('GET', '/participants/settings'), 'get');
  const other = snapshot.identification === 3 ? 0 : 3;
  restore.push(['identification mode', () => raw.request('PUT', '/participants/settings', { body: { identification_mode: snapshot.identification } })]);
  expectOk(await op('PUT', '/participants/settings', { identification_mode: other }), 'put');
  await waitState('wirelessIdentification', d => d.identification_mode === other);
  return reject('PUT', '/participants/settings', { identification_mode: 7 }, /out of range/);
});
await check('delete all (only when the list was empty at the start)', async () => {
  if (snapshot.participants.length) {
    calls.push({ area, op: 'DELETE /participants', params: {}, outcome: 'skipped', detail: `${snapshot.participants.length} participants existed before the test` });
    return 'skipped: the WAP had participants before the test';
  }
  // Identification needs participants: restore "off" first if the test switched it on (else the WAP refuses below).
  if (snapshot.identification === 3) await raw.request('PUT', '/participants/settings', { body: { identification_mode: 3 } });
  expectOk(await op('DELETE', '/participants'), 'delete all');
  await eventually('GET', '/participants', l => l.length === 0);
  created.length = 0;
  await waitState('domain.participants', d => d.length === 0);
  return `then identification without participants: ${await reject('PUT', '/participants/settings', { identification_mode: 0 }, /without participants/)}`;
});

// ================================================================= voting
area = 'voting';
restore.push(['voting parameters', () => raw.request('PUT', '/voting', {
  body: { mode: snapshot.voting.mode, subject: snapshot.voting.subject, hundredPercentMode: snapshot.voting.hundredPercentMode, resultsSettings: snapshot.voting.resultsSettings },
})]);
restore.push(['voting state', async () => {
  const st = (await raw.request('GET', '/voting/state')).state;
  if (st !== snapshot.votingState && st !== 0) await raw.request('PUT', '/voting/state', { body: { state: 0 } });
}]);
await check('parameters: GET, PUT (domain), validation', async () => {
  expectOk(await op('GET', '/voting'), 'get');
  await domain('PUT', '/voting/parameters', { subject: 'E2E motion', mode: 4 });
  await waitState('domain.voting', v => v.subject === 'E2E motion' && v.answers.includes('yes'));
  const out = [];
  out.push(await reject('PUT', '/voting', { mode: 9 }, /mode/));
  out.push(await reject('PUT', '/voting', { subject: 'S'.repeat(142) }, /subject/));
  out.push(await reject('PUT', '/voting', { resultsSettings: { interimResultsMode: 0, individuals: false } }));
  out.push(await reject('PUT', '/voting', { individuals: true, resultsSettings: { interimResultsMode: 1, individuals: false } }, /deprecated/i));
  expectOk(await op('PUT', '/voting', { hundredPercentMode: snapshot.voting.hundredPercentMode === 2 ? 0 : 2 }), 'hundredPercentMode');
  return out.join(' | ');
});
await check('state machine: open → hold → resume → close (domain); illegal transitions refused', async () => {
  if (snapshot.votingState !== 0) return `skipped: a voting was ${snapshot.votingState === 1 ? 'open' : 'on hold'} at the start`;
  const out = [await reject('PUT', '/voting/state', { state: 2 }, /Cannot change state from 0 to 2/)];
  await domain('POST', '/voting/open');
  await waitState('domain.voting', v => v.state === 'opened');
  out.push(await reject('PUT', '/voting/state', { state: 1 }, /Cannot change state from 1 to 1/));
  expectOk(await op('GET', '/voting/state'), 'state');
  const res = expectOk(await op('GET', '/voting/results'), 'results');
  // Parameters changed while open only apply to the next round.
  expectOk(await op('PUT', '/voting', { subject: 'E2E next round' }), 'PUT while open');
  const during = await waitState('domain.voting', v => v.state === 'opened');
  await domain('POST', '/voting/hold');
  await waitState('domain.voting', v => v.state === 'onHold');
  await domain('POST', '/voting/resume');
  await waitState('domain.voting', v => v.state === 'opened');
  await domain('POST', '/voting/close');
  await waitState('domain.voting', v => v.state === 'closed');
  out.push(`results while open: ${JSON.stringify(res.results)}; domain subject during the round: "${during.subject}"`);
  return out.join(' | ');
});

// ================================================================= power
area = 'power';
await check('GET /system/status; standby → seats drop off; on → seats back (domain)', async () => {
  expectOk(await op('GET', '/system/status'), 'status');
  if (keepPower) return 'skipped (--keep-power)';
  if (snapshot.power !== 0) return `skipped: system was in state ${snapshot.power} at the start`;
  restore.push(['power on', () => raw.request('PUT', '/system/status', { body: { state: 0 } })]);
  await domain('PUT', '/power', { state: 'standby' });
  await waitState('domain.power', p => p.state === 'standby');
  const t = Date.now();
  await eventually('GET', '/seats', l => !l.some(s => s.connected), 15_000);
  const dropped = Date.now() - t;
  const refused = await reject('PUT', '/system/status', { state: 7 }, /out of range/);
  await domain('PUT', '/power', { state: 'on' });
  await waitState('domain.power', p => p.state === 'on');
  const t2 = Date.now();
  await eventually('GET', '/seats', l => live.every(id => l.find(s => s.id === id)?.connected), 60_000);
  restore.pop();
  return `seats gone ${dropped} ms after standby; ${live.length} seats back ${Date.now() - t2} ms after on; ${refused}`;
});

// ================================================================= undocumented (read-only, informational)
area = 'undocumented (read-only)';
// The curated endpoints LikeABosch uses (undocumented.json, DEC-024) first, then a few more for information.
const USED = spec.operations.filter(o => o.undocumented && o.method === 'GET').map(o => o.path);
const UNDOCUMENTED = [...new Set([...USED, '/camera', '/system', '/system/battery', '/seats/battery-signal', '/redundancy/status', '/licensing/features', '/diagnostics', '/date-time'])];
const undocumented = [];
for (const path of UNDOCUMENTED) {
  // Only status and top-level keys go into the report (some of these endpoints return credentials).
  try {
    const d = await raw.request('GET', path);
    const keys = v => (v && typeof v === 'object' ? Object.keys(v).join(', ') : typeof v);
    undocumented.push(`| \`GET ${path}\` | 200 | ${Array.isArray(d) ? `array[${d.length}] of { ${keys(d[0])} }` : keys(d)} |`);
  } catch (e) {
    undocumented.push(`| \`GET ${path}\` | ${e.extra?.status ?? e.code} | |`);
  }
}

await check('undocumented endpoints used by LikeABosch answer (DEC-024; GET only)', async () => {
  const missing = USED.filter(path => !undocumented.some(row => row.startsWith(`| \`GET ${path}\` | 200 `)));
  if (missing.length) throw new Error(`not available on this firmware: ${missing.join(', ')}`);
  return `${USED.length} endpoints`;
});

// ---------------------------------------------------------------- restore + report
area = 'restore';
for (const [what, fn] of restore.reverse()) {
  try { await fn(); console.log(`  restore ${what}: ok`); } catch (e) { console.log(`  restore ${what}: ${e.message}`); }
}
await check('state restored', async () => {
  const diff = [];
  await sleep(1000);
  if ((await raw.request('GET', '/participants/settings')).identification_mode !== snapshot.identification) diff.push('identification');
  const v = await raw.request('GET', '/voting');
  if (v.mode !== snapshot.voting.mode || v.subject !== snapshot.voting.subject || v.hundredPercentMode !== snapshot.voting.hundredPercentMode) diff.push('voting parameters');
  const parts = await raw.request('GET', '/participants');
  if (JSON.stringify(parts.map(p => p.id).sort()) !== JSON.stringify(snapshot.participants.map(p => p.id).sort())) diff.push('participants');
  if ((await raw.request('GET', '/system/status')).state !== snapshot.power) diff.push('power');
  if (snapshot.discuss && (await raw.request('GET', '/discuss')).mode !== snapshot.discuss.mode) diff.push('discussion mode');
  if (diff.length) throw new Error(`differs: ${diff.join(', ')}`);
});

calls.push({ area: 'session', op: 'POST /logout', params: {}, outcome: 'ok', detail: 'sent by the backend on shutdown (WirelessClient.close)' });
const byOp = new Map();
for (const c of calls) if (!c.op.startsWith('domain ')) byOp.set(c.op, [...(byOp.get(c.op) ?? []), c.outcome]);
// Coverage = the vendor REST API (swagger). The undocumented WAP endpoints (DEC-024) are listed separately below.
const coverage = spec.operations.filter(o => !o.undocumented).map(o => [o.id, byOp.get(o.id) ?? []]);
const uncovered = coverage.filter(([, v]) => !v.length).map(([o]) => o);
const lines = [
  `# DICENTIS Wireless end-to-end test: ${new Date().toISOString()}`, '',
  `WAP \`${manager.settings.host}\` (${snapshot.info['Device Type']}, firmware ${snapshot.info.Versions?.Firmware}, API ${snapshot.info.Versions?.Api?.join(', ')}), ` +
    `user \`${manager.settings.user}\`, through backend passthrough + domain API + state cache.`,
  `Seats: ${seatsAtStart.length}, connected at start: ${live.join(', ') || 'none'}. Discussion mode at start: ${snapshot.discuss?.mode ?? 'n/a'}.`, '',
  `## Checks (${checks.filter(c => c.ok).length}/${checks.length} passed)`, '',
  '| Area | Check | Result | Detail |', '|---|---|---|---|',
  ...checks.map(c => `| ${c.area} | ${c.name} | ${c.ok ? '✔' : '✖'} | ${c.detail.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 900)} |`), '',
  `## Operation coverage (${coverage.length - uncovered.length}/${coverage.length} called)`, '',
  'Outcomes: ok · ok* (response differs from the swagger) · rejected (expected) · error · skipped.', '',
  '| Operation | Outcomes |', '|---|---|',
  ...coverage.map(([o, v]) => `| ${o} | ${v.length ? [...new Set(v)].join(', ') : '**not called**'} |`), '',
  '## Undocumented endpoints (GET only; keys, no values)', '', '| Endpoint | Status | Top-level keys |', '|---|---|---|', ...undocumented, '',
  '## Call log', '', '| Area | Operation | Body | Outcome | Detail |', '|---|---|---|---|---|',
  ...calls.map(c => `| ${c.area} | ${c.op} | \`${JSON.stringify(c.params).slice(0, 120)}\` | ${c.outcome} | ${c.detail.replace(/\|/g, '/').replace(/\n/g, ' ')} |`), '',
];
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join('\n'));
console.log(`\n${checks.filter(c => c.ok).length}/${checks.length} checks passed; ${coverage.length - uncovered.length}/${coverage.length} operations called${uncovered.length ? ` (not called: ${uncovered.join(', ')})` : ''}`);
console.log(`Report: ${outFile}`);
await backend.close(); // WirelessClient.close() sends POST /logout
rmSync(dataDir, { recursive: true, force: true });
process.exit(checks.every(c => c.ok) ? 0 : 1);
