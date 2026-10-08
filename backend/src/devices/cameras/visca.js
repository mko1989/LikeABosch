// VISCA camera driver: Sony VISCA-over-IP framing or raw VISCA, over UDP or TCP (WO-036, DEC-012).
// Protocol reference: docs/protocol/cameras/README.md §1.
import dgram from 'node:dgram';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { AppError } from '../../lib/errors.js';

const TYPE = { command: 0x0100, inquiry: 0x0110, reply: 0x0111, control: 0x0200, controlReply: 0x0201 };
const ERRORS = { 0x02: 'syntax error', 0x03: 'command buffer full', 0x04: 'command canceled', 0x05: 'no socket', 0x41: 'command not executable' };
const DEFAULT_PORTS = { sony: 52381, raw: 1259 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hex = buf => [...buf].map(b => b.toString(16).padStart(2, '0')).join(' ');

/**
 * @typedef {object} ViscaOptions
 * @property {string} host
 * @property {number} [port]           default 52381 (sony) / 1259 (raw)
 * @property {'udp' | 'tcp'} [transport]
 * @property {'sony' | 'raw'} [framing]
 * @property {number} [address]        VISCA camera address 1–7 (default 1)
 * @property {number} [timeoutMs]      ACK timeout (default 1500)
 * @property {number} [completionTimeoutMs] completion wait for moves/presets (default 10000)
 */
export class ViscaCamera extends EventEmitter {
  /** @param {ViscaOptions} options */
  constructor(options) {
    super();
    this.options = { transport: 'udp', framing: 'sony', address: 1, timeoutMs: 1500, completionTimeoutMs: 10_000, ...options };
    this.options.port ??= DEFAULT_PORTS[this.options.framing];
    this.seq = 0;
    this.queue = Promise.resolve();
    this.waiter = null; // { onReply }
    this.tcpBuffer = Buffer.alloc(0);
    this.connected = false;
    this.lastError = null;
  }

  get head() { return 0x80 + this.options.address; }

  async connect() {
    const { host, port, transport } = this.options;
    if (transport === 'tcp') {
      this.socket = net.connect({ host, port });
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new AppError('NOT_CONNECTED', `VISCA TCP ${host}:${port}: connect timeout`)), this.options.timeoutMs * 2);
        this.socket.once('connect', () => { clearTimeout(t); resolve(); });
        this.socket.once('error', err => { clearTimeout(t); reject(new AppError('NOT_CONNECTED', `VISCA TCP ${host}:${port}: ${err.message}`)); });
      });
      this.socket.on('data', chunk => this.#onTcpData(chunk));
      this.socket.on('close', () => { this.connected = false; this.emit('status', this.status()); });
      this.socket.on('error', err => { this.lastError = err.message; });
    } else {
      this.socket = dgram.createSocket('udp4');
      this.socket.on('message', msg => this.#onMessage(msg));
      this.socket.on('error', err => { this.lastError = err.message; });
      await new Promise(resolve => this.socket.bind(0, resolve));
    }
    if (this.options.framing === 'sony') await this.#resetSequence().catch(() => {}); // some cameras don't answer; harmless
    await this.ping();
    this.connected = true;
    this.lastError = null;
    this.emit('status', this.status());
  }

  /** Power inquiry as a health check. Resolves 'on' | 'standby' | 'unknown'. */
  async ping() {
    const reply = await this.#send([this.head, 0x09, 0x04, 0x00, 0xff], { inquiry: true });
    return reply[2] === 0x02 ? 'on' : reply[2] === 0x03 ? 'standby' : 'unknown';
  }

  recallPreset(preset) {
    const pp = this.#preset(preset);
    return this.#send([this.head, 0x01, 0x04, 0x3f, 0x02, pp, 0xff], { waitCompletion: true });
  }

  async storePreset(preset) {
    const pp = this.#preset(preset);
    await this.#send([this.head, 0x01, 0x04, 0x3f, 0x01, pp, 0xff], { waitCompletion: true });
    return pp;
  }

  /** Jog: pan/tilt/zoom in -1…1 (positive = right / up / tele). 0 stops that axis. */
  async move({ pan = 0, tilt = 0, zoom = 0 } = {}) {
    const vv = clamp(Math.round(Math.abs(pan) * 0x18), 1, 0x18);
    const ww = clamp(Math.round(Math.abs(tilt) * 0x17), 1, 0x17);
    const xx = pan < 0 ? 0x01 : pan > 0 ? 0x02 : 0x03;
    const yy = tilt > 0 ? 0x01 : tilt < 0 ? 0x02 : 0x03;
    await this.#send([this.head, 0x01, 0x06, 0x01, vv, ww, xx, yy, 0xff]);
    const p = clamp(Math.round(Math.abs(zoom) * 7), 0, 7);
    await this.#send([this.head, 0x01, 0x04, 0x07, zoom > 0 ? 0x20 + p : zoom < 0 ? 0x30 + p : 0x00, 0xff]);
  }

  stop() { return this.move({ pan: 0, tilt: 0, zoom: 0 }); }

  listPresets() { return Promise.resolve(null); }

  status() {
    const { transport, framing, host, port } = this.options;
    return { connected: this.connected, driver: 'visca', transport, framing, host, port, lastError: this.lastError };
  }

  async close() {
    this.connected = false;
    if (!this.socket) return;
    if (this.options.transport === 'tcp') this.socket.destroy(); else this.socket.close();
    this.socket = null;
  }

  // ------------------------------------------------------------- internals

  #preset(preset) {
    const n = Number(preset);
    if (!Number.isInteger(n) || n < 0 || n > 255) throw new AppError('VALIDATION', `VISCA preset must be 0–255 (got ${preset})`);
    return n;
  }

  #resetSequence() {
    this.seq = 0;
    return this.#exchange(Buffer.from([0x01]), { type: TYPE.control, expectControl: true });
  }

  /** Serialise commands: one outstanding command at a time. */
  #send(bytes, { inquiry = false, waitCompletion = false } = {}) {
    const run = () => this.#exchange(Buffer.from(bytes), { type: inquiry ? TYPE.inquiry : TYPE.command, inquiry, waitCompletion });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  #exchange(payload, { type, inquiry = false, waitCompletion = false, expectControl = false }) {
    if (!this.socket) return Promise.reject(new AppError('NOT_CONNECTED', 'VISCA camera not connected'));
    // Raw framing has no sequence numbers: a late Completion would be taken as the next command's reply.
    // So always wait for the Completion (or its timeout) before releasing the queue.
    if (this.options.framing === 'raw' && !inquiry && !expectControl) waitCompletion = true;
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      let acked = false;
      let timer;
      // After an ACK, a missing completion is not an error (some cameras only ACK): resolve as acknowledged.
      const arm = ms => { clearTimeout(timer); timer = setTimeout(() => (acked && !inquiry ? finish(null, { acknowledged: true, completed: false }) : finish(new AppError('UPSTREAM_TIMEOUT', `VISCA ${hex(payload)}: no ${acked ? 'completion' : 'reply'}`))), ms); };
      const finish = (err, data) => {
        clearTimeout(timer);
        this.waiter = null;
        if (err) { this.lastError = err.message; reject(err); } else resolve(data ?? { completed: false });
      };
      this.waiter = {
        seq,
        onReply: (msg, replyType) => {
          if (expectControl) { if (replyType === TYPE.controlReply) finish(null, { ok: true }); return; }
          if (msg[0] !== 0x90 && (msg[0] & 0xf0) !== 0x90) return;
          const kind = msg[1] & 0xf0;
          if (kind === 0x60) finish(new AppError('UPSTREAM_ERROR', `VISCA error: ${ERRORS[msg[2]] ?? `0x${msg[2]?.toString(16)}`}`, { upstream: hex(msg) }));
          else if (kind === 0x40) { acked = true; if (!waitCompletion) finish(null, { acknowledged: true }); else arm(this.options.completionTimeoutMs); }
          else if (kind === 0x50) finish(null, inquiry ? msg : { acknowledged: true, completed: true });
        },
      };
      arm(this.options.timeoutMs);
      this.#write(payload, type, seq);
    });
  }

  #write(payload, type, seq) {
    const { framing, transport, host, port } = this.options;
    let packet = payload;
    if (framing === 'sony') {
      const header = Buffer.alloc(8);
      header.writeUInt16BE(type, 0);
      header.writeUInt16BE(payload.length, 2);
      header.writeUInt32BE(seq, 4);
      packet = Buffer.concat([header, payload]);
    }
    if (transport === 'tcp') this.socket.write(packet);
    else this.socket.send(packet, port, host);
  }

  #onMessage(msg) {
    if (this.options.framing === 'sony' && msg.length >= 8) {
      // A datagram may carry several framed messages back to back (seen with some devices): handle each.
      const len = msg.readUInt16BE(2);
      if (msg.length > 8 + len) {
        for (let offset = 0; offset + 8 <= msg.length;) {
          const l = msg.readUInt16BE(offset + 2);
          this.#onMessage(msg.subarray(offset, offset + 8 + l));
          offset += 8 + l;
        }
        return;
      }
      const type = msg.readUInt16BE(0);
      const seq = msg.readUInt32BE(4);
      if (!this.waiter || (seq !== this.waiter.seq && type !== TYPE.controlReply)) return;
      const body = msg.subarray(8, 8 + len);
      if (type === TYPE.controlReply) { this.waiter.onReply(body, type); return; }
      this.#splitVisca(body, type); // one payload may also carry several VISCA messages
      return;
    }
    this.#splitVisca(msg, TYPE.reply); // raw: a datagram may hold several VISCA messages
  }

  /** Feed each 0xFF-terminated VISCA message to the waiting command. */
  #splitVisca(buf, type) {
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0xff) { this.waiter?.onReply(buf.subarray(start, i + 1), type); start = i + 1; }
    }
  }

  #onTcpData(chunk) {
    this.tcpBuffer = Buffer.concat([this.tcpBuffer, chunk]);
    if (this.options.framing === 'sony') {
      while (this.tcpBuffer.length >= 8) {
        const len = this.tcpBuffer.readUInt16BE(2);
        if (this.tcpBuffer.length < 8 + len) break;
        this.#onMessage(this.tcpBuffer.subarray(0, 8 + len));
        this.tcpBuffer = this.tcpBuffer.subarray(8 + len);
      }
      return;
    }
    let idx;
    while ((idx = this.tcpBuffer.indexOf(0xff)) >= 0) {
      this.#onMessage(this.tcpBuffer.subarray(0, idx + 1));
      this.tcpBuffer = this.tcpBuffer.subarray(idx + 1);
    }
  }
}
