// Mock tvONE CORIOmaster / CORIOmatrix (WO-112, DEC-033): the CORIOmaster API over TCP, the subset the driver uses,
// per "tvONE CORIOmaster Commands" (API 4.11): login(user,password), property reads "<path>" and writes
// "<path> = <value>", answered with "<path> = <value>" and "!Done <path>"; failures "!Error : <text>".
// setWindow(window, input) simulates a change made elsewhere (front panel, CORIOgrapher).
// Run: node mock/switchers/tvone-corio.js   (env MOCK_PORT, default 10001; admin / adminpw)
import net from 'node:net';
import { pathToFileURL } from 'node:url';

/**
 * @param {{ port?: number, host?: string, username?: string, password?: string, requireLogin?: boolean,
 *   slots?: number, inputsPerSlot?: number, windows?: number }} [options]
 */
export async function createMockTvOneCorio({ port = 0, host = '127.0.0.1', username = 'admin', password = 'adminpw', requireLogin = true, slots = 2, inputsPerSlot = 4, windows = 2 } = {}) {
  const inputs = Array.from({ length: slots * inputsPerSlot }, (_, i) => `Slot${Math.floor(i / inputsPerSlot) + 1}.In${(i % inputsPerSlot) + 1}`);
  const state = {
    windows: Object.fromEntries(Array.from({ length: windows }, (_, i) => [`Window${i + 1}`, inputs[i] ?? inputs[0]])),
    received: [],
  };
  const clients = new Set();

  function handle(sock, text) {
    state.received.push(text);
    const out = l => sock.write(`${l}\r\n`);
    const login = /^login\(([^,]*),(.*)\)$/i.exec(text);
    if (login) {
      if (login[1] !== username || login[2] !== password) return out('!Error : Login failed');
      sock.loggedIn = true;
      return out(`!Info : User ${login[1]} Logged In`);
    }
    if (requireLogin && !sock.loggedIn) return out('!Error : Not logged in');
    if (/^logout$/i.test(text)) { sock.loggedIn = false; return out(`!Info : User ${username} Logged Out`); }
    const write = /^([A-Za-z0-9_.]+)\s*=\s*(.+)$/.exec(text);
    const path = (write?.[1] ?? text).trim();
    const win = /^(?:Routing\.Windows\.|Windows\.)?(Window\d+)\.Input$/i.exec(path);
    if (path === 'CORIOmax.Model_Name' && !write) { out('CORIOmax.Model_Name = CORIOmatrix (mock)'); return out('!Done CORIOmax.Model_Name'); }
    if (!win || !(win[1] in state.windows)) return out(`!Error : Unknown property ${path}`);
    if (write) {
      const value = write[2].trim();
      if (!inputs.includes(value)) return out(`!Error : Invalid input ${value}`);
      state.windows[win[1]] = value;
    }
    out(`${path} = ${state.windows[win[1]]}`);
    return out(`!Done ${path}`);
  }

  const server = net.createServer(sock => {
    clients.add(sock);
    sock.setEncoding('latin1');
    let buf = '';
    sock.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.search(/[\r\n]/)) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handle(sock, line);
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
    inputs,
    get clients() { return clients.size; },
    /** A change made outside LikeABosch (front panel, CORIOgrapher). */
    setWindow(window, input) { state.windows[window] = input; },
    dropClients() { for (const c of clients) c.destroy(); },
    async close() {
      for (const c of clients) c.destroy();
      await new Promise(resolve => server.close(() => resolve()));
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const mock = await createMockTvOneCorio({ port: Number(process.env.MOCK_PORT ?? 10001) });
  console.log(`[mock:tvone-corio] listening on 127.0.0.1:${mock.port} (admin / adminpw)`);
}
