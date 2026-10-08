// Minimal mDNS / DNS-SD browser (WO-090): finds Blackmagic ATEM switchers, which announce `_blackmagic._tcp.local`
// with TXT `class=AtemSwitcher` (the same discovery ATEM Software Control and Bitfocus Companion use).
// No dependency (DEC-002): one PTR query over node:dgram, answers parsed here (PTR, SRV, TXT, A; name compression).
import dgram from 'node:dgram';

export const MDNS_ADDRESS = '224.0.0.251';
export const MDNS_PORT = 5353;
const TYPE = { A: 1, PTR: 12, TXT: 16, SRV: 33 };

/** Encode a DNS query for one PTR name. */
export function encodeQuery(name, { unicastResponse = false } = {}) {
  const labels = name.split('.').filter(Boolean).map(l => Buffer.concat([Buffer.from([Buffer.byteLength(l)]), Buffer.from(l)]));
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4); // one question
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(TYPE.PTR, 0);
  tail.writeUInt16BE(1 | (unicastResponse ? 0x8000 : 0), 2); // class IN (+ QU bit)
  return Buffer.concat([header, ...labels, Buffer.from([0]), tail]);
}

/** Read a (possibly compressed) name at `offset`. Returns [name, offset after the name]. */
function readName(buf, offset) {
  const labels = [];
  let pos = offset;
  let end = -1;
  for (let jumps = 0; jumps < 32; jumps++) {
    const len = buf[pos];
    if (len === undefined) throw new Error('truncated name');
    if (len === 0) { pos += 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (end < 0) end = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1];
      continue;
    }
    labels.push(buf.toString('utf8', pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  return [labels.join('.'), end < 0 ? pos : end];
}

/**
 * Parse a DNS message into its resource records (answers + authority + additional).
 * @returns {{ name: string, type: number, data: any }[]}
 */
export function parseMessage(buf) {
  const qd = buf.readUInt16BE(4);
  const rrCount = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let pos = 12;
  for (let i = 0; i < qd; i++) { [, pos] = readName(buf, pos); pos += 4; }
  const records = [];
  for (let i = 0; i < rrCount; i++) {
    let name;
    [name, pos] = readName(buf, pos);
    const type = buf.readUInt16BE(pos);
    const len = buf.readUInt16BE(pos + 8);
    const start = pos + 10;
    pos = start + len;
    let data = null;
    if (type === TYPE.PTR) [data] = readName(buf, start);
    else if (type === TYPE.SRV) data = { port: buf.readUInt16BE(start + 4), target: readName(buf, start + 6)[0] };
    else if (type === TYPE.A && len === 4) data = [...buf.subarray(start, start + 4)].join('.');
    else if (type === TYPE.TXT) {
      data = {};
      for (let p = start; p < start + len;) {
        const l = buf[p];
        const entry = buf.toString('utf8', p + 1, p + 1 + l);
        p += 1 + l;
        const eq = entry.indexOf('=');
        if (entry) data[eq < 0 ? entry : entry.slice(0, eq)] = eq < 0 ? true : entry.slice(eq + 1);
      }
    }
    records.push({ name, type, data });
  }
  return records;
}

/**
 * Combine the records of one or more answers into service instances.
 * @param {{ name: string, type: number, data: any }[]} records
 * @param {string} service  e.g. "_blackmagic._tcp.local"
 * @param {Map<string, string>} [sources]  instance name → sender address (fallback when no A record came)
 */
export function instances(records, service, sources = new Map()) {
  const lower = s => s.toLowerCase();
  const names = new Set(records.filter(r => r.type === TYPE.PTR && lower(r.name) === lower(service)).map(r => r.data));
  return [...names].map(instance => {
    const srv = records.find(r => r.type === TYPE.SRV && lower(r.name) === lower(instance))?.data;
    const txt = Object.assign({}, ...records.filter(r => r.type === TYPE.TXT && lower(r.name) === lower(instance)).map(r => r.data));
    const a = srv && records.find(r => r.type === TYPE.A && lower(r.name) === lower(srv.target))?.data;
    return { instance, label: instance.slice(0, -(service.length + 1)) || instance, host: srv?.target ?? null, port: srv?.port ?? null, address: a ?? sources.get(instance) ?? null, txt };
  });
}

/**
 * Browse for ATEM switchers for `timeoutMs`.
 * @param {{ timeoutMs?: number, address?: string, port?: number, log?: any }} [opts]  address/port: tests send to a local responder
 * @returns {Promise<{ name: string, model: string | null, address: string | null, port: number | null, instance: string }[]>}
 */
export async function discoverAtem({ timeoutMs = 3000, address = MDNS_ADDRESS, port = MDNS_PORT, log } = {}) {
  const service = '_blackmagic._tcp.local';
  const records = [];
  const sources = new Map();
  const sockets = [];
  const onMessage = (msg, rinfo) => {
    try {
      const rr = parseMessage(msg);
      records.push(...rr);
      for (const r of rr) if (r.type === TYPE.PTR) sources.set(r.data, rinfo.address);
    } catch (err) { log?.debug?.(`mdns: ignored a packet from ${rinfo.address}: ${err.message}`); }
  };
  const open = async (bindPort, multicast) => {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('message', onMessage);
    s.on('error', err => log?.debug?.(`mdns socket: ${err.message}`));
    await new Promise((resolve, reject) => { s.once('error', reject); s.bind(bindPort, () => { s.off('error', reject); resolve(); }); });
    if (multicast) { try { s.addMembership(MDNS_ADDRESS); s.setMulticastTTL(255); } catch (err) { log?.debug?.(`mdns membership: ${err.message}`); } }
    sockets.push(s);
    return s;
  };
  try {
    const query = encodeQuery(service);
    // 1. A socket on 5353 in the multicast group hears multicast answers (shared with the OS responder via reuseAddr).
    if (address === MDNS_ADDRESS) {
      try { (await open(MDNS_PORT, true)).send(query, port, address); } catch (err) { log?.debug?.(`mdns: cannot listen on 5353 (${err.message}), unicast answers only`); }
    }
    // 2. A "legacy unicast" query from an ephemeral port: responders answer it directly to that port (RFC 6762 §6.7).
    (await open(0, false)).send(query, port, address);
    await new Promise(resolve => setTimeout(resolve, timeoutMs));
  } finally {
    for (const s of sockets) { try { s.close(); } catch { /* already closed */ } }
  }
  return instances(records, service, sources)
    .filter(i => !i.txt.class || /atem/i.test(String(i.txt.class)))
    .map(i => ({ name: String(i.txt.name ?? i.label), model: i.txt.model ? String(i.txt.model) : null, address: i.address, port: i.port, instance: i.instance }));
}
