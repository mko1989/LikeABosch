// WO-090: mDNS browser for ATEM switchers: packet parsing (incl. name compression) and a query against a local responder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { discoverAtem, encodeQuery, instances, parseMessage } from '../src/devices/discovery/mdns.js';
import { startBackend } from './helpers/start.js';

/** Build a DNS response; names are written once and referenced by compression pointers afterwards. */
function response(records) {
  const parts = [];
  let length = 0; // bytes written so far (pointers are absolute offsets)
  const offsets = new Map();
  const name = n => {
    const labels = n.split('.');
    const out = [];
    for (let i = 0; i < labels.length; i++) {
      const rest = labels.slice(i).join('.');
      if (offsets.has(rest)) { const p = offsets.get(rest); out.push(Buffer.from([0xc0 | (p >> 8), p & 0xff])); return Buffer.concat(out); }
      offsets.set(rest, length + out.reduce((n2, b) => n2 + b.length, 0));
      out.push(Buffer.from([Buffer.byteLength(labels[i])]), Buffer.from(labels[i]));
    }
    out.push(Buffer.from([0]));
    return Buffer.concat(out);
  };
  const push = b => { parts.push(b); length += b.length; };
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(records.length, 6);
  push(header);
  for (const r of records) {
    push(name(r.name));
    const meta = Buffer.alloc(10);
    meta.writeUInt16BE(r.type, 0); meta.writeUInt16BE(1, 2); meta.writeUInt32BE(120, 4);
    let rdata;
    const at = length + 10;
    if (r.type === 12) { const save = length; length = at; rdata = name(r.data); length = save; }
    else if (r.type === 33) { const head = Buffer.alloc(6); head.writeUInt16BE(r.data.port, 4); const save = length; length = at + 6; const t = name(r.data.target); length = save; rdata = Buffer.concat([head, t]); }
    else if (r.type === 16) rdata = Buffer.concat(Object.entries(r.data).map(([k, v]) => { const s = Buffer.from(`${k}=${v}`); return Buffer.concat([Buffer.from([s.length]), s]); }));
    else rdata = Buffer.from(r.data.split('.').map(Number));
    meta.writeUInt16BE(rdata.length, 8);
    push(meta); push(rdata);
  }
  return Buffer.concat(parts);
}

const SERVICE = '_blackmagic._tcp.local';
const ATEM = [
  { name: SERVICE, type: 12, data: `ATEM Mini Pro.${SERVICE}` },
  { name: `ATEM Mini Pro.${SERVICE}`, type: 33, data: { port: 9910, target: 'atem-mini.local' } },
  { name: `ATEM Mini Pro.${SERVICE}`, type: 16, data: { class: 'AtemSwitcher', name: 'Studio ATEM', model: 'ATEM Mini Pro' } },
  { name: 'atem-mini.local', type: 1, data: '192.168.10.240' },
  // another Blackmagic device on the same service type: not a switcher
  { name: SERVICE, type: 12, data: `HyperDeck.${SERVICE}` },
  { name: `HyperDeck.${SERVICE}`, type: 16, data: { class: 'HyperDeck', name: 'Recorder' } },
];

test('query encoding and response parsing (PTR, SRV, TXT, A, compression)', () => {
  const q = encodeQuery(SERVICE);
  assert.equal(q.readUInt16BE(4), 1);
  assert.equal(q.subarray(12).toString('latin1').includes('_blackmagic'), true);
  const rr = parseMessage(response(ATEM));
  assert.equal(rr.length, 6);
  assert.deepEqual(rr[1].data, { port: 9910, target: 'atem-mini.local' });
  assert.deepEqual(rr[2].data, { class: 'AtemSwitcher', name: 'Studio ATEM', model: 'ATEM Mini Pro' });
  const found = instances(rr, SERVICE);
  assert.deepEqual(found[0], { instance: `ATEM Mini Pro.${SERVICE}`, label: 'ATEM Mini Pro', host: 'atem-mini.local', port: 9910, address: '192.168.10.240', txt: { class: 'AtemSwitcher', name: 'Studio ATEM', model: 'ATEM Mini Pro' } });
  assert.throws(() => parseMessage(Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 5])), /truncated/);
});

test('discoverAtem against a local responder: switchers only, address from the A record', async () => {
  const responder = dgram.createSocket('udp4');
  responder.on('message', (msg, rinfo) => {
    if (msg.toString('latin1').includes('_blackmagic')) responder.send(response(ATEM), rinfo.port, rinfo.address);
  });
  await new Promise(r => responder.bind(0, '127.0.0.1', r));
  try {
    const found = await discoverAtem({ timeoutMs: 300, address: '127.0.0.1', port: responder.address().port });
    assert.deepEqual(found, [{ name: 'Studio ATEM', model: 'ATEM Mini Pro', address: '192.168.10.240', port: 9910, instance: `ATEM Mini Pro.${SERVICE}` }]);
  } finally { responder.close(); }
});

test('GET /api/devices/switcher/discover answers a list (nothing on the test network)', async () => {
  const backend = await startBackend();
  try {
    const res = await fetch(`${backend.url}/api/devices/switcher/discover?timeoutMs=300`);
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.ok(Array.isArray(body.data));
    assert.equal((await fetch(`${backend.url}/api/devices/switcher/discover?timeoutMs=99999`)).status, 400);
  } finally { await backend.close(); }
});
