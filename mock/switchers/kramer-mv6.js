// Mock Kramer MV-6 (WO-112, DEC-033): Kramer Protocol 3000 over TCP, the commands the driver uses plus a few
// read-only ones, per the MV-6 user manual (rev 11, §10–11). Replies "~01@…\r\n"; unknown commands "~01@<CMD> ERR 002".
// frontPanel(window, input) simulates a button press on the device: the change is sent to every connected client.
// Run: node mock/switchers/kramer-mv6.js   (env MOCK_PORT, default 5000)
import net from 'node:net';
import { pathToFileURL } from 'node:url';

/** @param {{ port?: number, host?: string, inputs?: number, windows?: number }} [options] */
export async function createMockKramerMv6({ port = 0, host = '127.0.0.1', inputs = 6, windows = 4 } = {}) {
  const state = { windows: Array.from({ length: windows }, (_, i) => Math.min(i + 1, inputs)), preset: 1, received: [] };
  const clients = new Set();
  const reply = (sock, body) => sock.write(`~01@${body}\r\n`);
  const broadcast = body => { for (const c of clients) reply(c, body); };

  function handle(sock, raw) {
    const text = raw.trim();
    state.received.push(text);
    if (text === '#') return reply(sock, ' OK');
    const m = /^#\s*([A-Z0-9-]+\??)\s*(.*)$/i.exec(text);
    if (!m) return reply(sock, 'ERR 001');
    const cmd = m[1].toUpperCase();
    const args = m[2].split(',').map(x => x.trim()).filter(Boolean).map(Number);
    switch (cmd) {
      case 'MODEL?': return reply(sock, 'MODEL MV-6');
      case 'VERSION?': return reply(sock, 'VERSION 1.10.0001');
      case 'PRST-RCL':
        if (!(args[0] >= 1 && args[0] <= 6)) return reply(sock, 'PRST-RCL ERR 003');
        state.preset = args[0];
        return reply(sock, `PRST-RCL ${args[0]}`);
      case 'SRC-VID?': {
        const w = args[0];
        if (!(w >= 1 && w <= windows)) return reply(sock, 'SRC-VID ERR 003');
        return reply(sock, `SRC-VID ${w},${state.windows[w - 1]}`);
      }
      case 'SRC-VID': {
        const [w, input] = args;
        if (!(w >= 1 && w <= windows) || !(input >= 1 && input <= inputs)) return reply(sock, 'SRC-VID ERR 003');
        state.windows[w - 1] = input;
        // Sent to the asking port, and to all other ports as a change notification (manual: "response triggers").
        reply(sock, `SRC-VID ${w},${input}`);
        for (const c of clients) if (c !== sock) reply(c, `SRC-VID ${w},${input}`);
        return undefined;
      }
      default: return reply(sock, `${cmd.replace(/\?$/, '')} ERR 002`);
    }
  }

  const server = net.createServer(sock => {
    clients.add(sock);
    sock.setEncoding('latin1');
    let buf = '';
    sock.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.search(/[\r\n]/)) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) handle(sock, line);
      }
    });
    sock.on('close', () => clients.delete(sock));
    sock.on('error', () => {});
  });
  server.listen(port, host);
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });

  return {
    port: server.address().port,
    state,
    get clients() { return clients.size; },
    /** A front-panel / IR change: window `w` shows `input`; every client is told. */
    frontPanel(w, input) { state.windows[w - 1] = input; broadcast(`SRC-VID ${w},${input}`); },
    /** Drop every client connection (device restart). */
    dropClients() { for (const c of clients) c.destroy(); },
    async close() {
      for (const c of clients) c.destroy();
      await new Promise(resolve => server.close(() => resolve()));
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const mock = await createMockKramerMv6({ port: Number(process.env.MOCK_PORT ?? 5000) });
  console.log(`[mock:kramer-mv6] listening on 127.0.0.1:${mock.port}`);
}
