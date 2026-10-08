// Mock dcn-bridge (WO-060): speaks the bridge protocol (docs/protocol/dcn-swapi/BRIDGE.md) and serves a simulated
// DCN-SW server (dcnsw.js). For tests and for UI work without Windows / DCN hardware.
// Run: npm run mock:dcn  (port 9480, no token unless MOCK_DCN_TOKEN, user admin/admin)
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { loadDcnSpec } from '../../backend/src/dcn/spec.js';
import { DcnSwSimulation, MOCK_CONSTANTS } from './dcnsw.js';

const ROOTS = ['control', 'config'];

/**
 * @param {object} [opts]
 * @param {number} [opts.port]            0 = random
 * @param {string} [opts.host]
 * @param {string} [opts.token]
 * @param {Record<string, string>} [opts.users]  DCN-SW users
 * @param {number} [opts.authDelayMs]     delay before NO_AUTHORIZATION (real API: 5 s)
 * @param {boolean} [opts.meetingActive]
 * @param {number} [opts.seats]
 */
export async function createMockDcnBridge({ port = 0, host = '127.0.0.1', token = '', users = { admin: 'admin' }, authDelayMs = 50, meetingActive = true, seats = 20 } = {}) {
  const spec = loadDcnSpec();
  let sim = new DcnSwSimulation({ meetingActive, seats });
  /** DCN-SW API state on the "bridge" (survives client reconnects, like the real bridge) */
  const api = { init: null, available: true, allowed: allAllowed(spec) };
  /** @type {net.Socket | null} */
  let current = null;
  const sockets = new Set();
  const stats = { hellos: 0, connects: 0 };

  const send = (socket, msg) => { if (socket && !socket.destroyed) socket.write(`${JSON.stringify(msg)}\n`); };
  const status = () => Object.fromEntries(ROOTS.map(r => [r, {
    initialized: Boolean(api.init?.roots.includes(r)),
    available: Boolean(api.init?.roots.includes(r)) && api.available,
    allowed: api.init?.roots.includes(r) ? api.allowed[r] : {},
  }]));
  // Pushed on a later tick, like the real bridge (its status push is a separate write after the reply): keeps clients honest.
  const pushStatus = () => setImmediate(() => send(current, { type: 'status', status: status() }));

  const forward = (apiKey, event, args) => {
    const root = apiKey.split('.')[0];
    if (api.init?.roots.includes(root) && api.available) send(current, { type: 'event', api: apiKey, event, args, time: new Date().toISOString() });
  };
  sim.on('event', forward);

  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    let authed = false;
    let buffer = '';
    const helloTimer = setTimeout(() => { if (!authed) socket.destroy(); }, 5_000);
    socket.on('close', () => { sockets.delete(socket); clearTimeout(helloTimer); if (current === socket) current = null; });
    socket.on('error', () => {});
    socket.on('data', chunk => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) handle(line).catch(err => send(socket, { type: 'response', id: null, ok: false, error: { code: 'EXCEPTION', message: err.message } }));
      }
    });

    let queue = Promise.resolve(); // requests are executed one at a time, in order (BRIDGE.md)
    function handle(line) {
      queue = queue.then(() => process(line));
      return queue;
    }

    async function process(line) {
      let msg;
      try { msg = JSON.parse(line); } catch { send(socket, { type: 'response', id: null, ok: false, error: { code: 'BAD_REQUEST', message: 'not JSON' } }); return; }
      const reply = (result) => send(socket, { type: 'response', id: msg.id, ok: true, result });
      const error = (code, message) => send(socket, { type: 'response', id: msg.id, ok: false, error: { code, message } });

      if (msg.type === 'hello') {
        stats.hellos += 1;
        if (token && msg.token !== token) { // no token: open, like the bridge (DEC-019)
          send(socket, { type: 'hello', ok: false, error: { code: 'BAD_TOKEN', message: 'wrong token' } });
          socket.end();
          return;
        }
        authed = true;
        clearTimeout(helloTimer);
        if (current && current !== socket) { send(current, { type: 'closed', reason: 'replaced' }); current.end(); }
        current = socket;
        send(socket, { type: 'hello', ok: true, protocol: 1, bridge: { name: 'dcn-bridge-mock', version: '0.1.0', apiVersion: spec.version, fake: true, dllPath: null }, constants: MOCK_CONSTANTS, status: status() });
        return;
      }
      if (!authed) return error('NOT_HELLO', 'send hello first');

      switch (msg.type) {
        case 'ping': return reply({ time: new Date().toISOString() });
        case 'status': return reply(status());
        case 'connect': {
          stats.connects += 1;
          const roots = (msg.roots ?? ROOTS).filter(r => ROOTS.includes(r));
          const same = api.init && api.init.server === msg.server && api.init.user === msg.user && api.init.password === msg.password;
          if (same) { reply(Object.fromEntries(roots.map(r => [r, 'NONE']))); return pushStatus(); }
          api.init = null;
          if (users[msg.user] === undefined || users[msg.user] !== msg.password) {
            await new Promise(r => setTimeout(r, authDelayMs));
            reply(Object.fromEntries(roots.map(r => [r, 'NO_AUTHORIZATION'])));
            return pushStatus();
          }
          if (!/^tcp:\/\/[^:]+:\d+/.test(msg.server ?? '')) { reply(Object.fromEntries(roots.map(r => [r, 'SETUP_LINK_FAILED']))); return pushStatus(); }
          api.init = { server: msg.server, user: msg.user, password: msg.password, roots };
          reply(Object.fromEntries(roots.map(r => [r, 'NONE'])));
          return pushStatus();
        }
        case 'disconnect':
          api.init = null;
          reply({});
          return pushStatus();
        case 'call': {
          const key = `${msg.api}.${msg.method}`;
          const m = spec.get(key);
          if (!Object.keys(spec.api.interfaces).includes(msg.api)) return error('UNKNOWN_API', `no interface ${msg.api}`);
          if (!m) return error('UNKNOWN_METHOD', `no method ${key}`);
          const problems = spec.validateArgs(m, msg.args ?? {});
          if (problems.length) return error('BAD_ARGS', problems.join('; '));
          const root = msg.api.split('.')[0];
          if (!api.init?.roots.includes(root)) return error('NOT_INITIALIZED', `${root} API not initialized`);
          if (!api.available) return reply({ returns: 'NOT_AVAILABLE', out: {} });
          // Simplification: any Is*Allowed flag of the interface switched off → NO_AUTHORIZATION for all its methods.
          const prefix = `${msg.api.split('.')[1]}.`;
          if (Object.entries(api.allowed[root]).some(([k, v]) => k.startsWith(prefix) && v === false)) return reply({ returns: 'NO_AUTHORIZATION', out: {} });
          try {
            return reply(sim.call(spec, key, msg.args ?? {}));
          } catch (err) {
            return error('EXCEPTION', `${err.name}: ${err.message}`); // like the bridge when the API throws
          }
        }
        default:
          return error('BAD_REQUEST', `unknown type ${msg.type}`);
      }
    }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const address = /** @type {net.AddressInfo} */ (server.address());

  return {
    port: address.port,
    token,
    get sim() { return sim; },
    /** Fresh simulated DCN-SW server (initial data, meeting 1 / session 11 running); the API stays initialized. */
    reset() { sim.off('event', forward); sim = new DcnSwSimulation({ meetingActive, seats }); sim.on('event', forward); },
    stats,
    get clientConnected() { return Boolean(current); },
    /** Delegate actions, also at the top level for scripts/ui-check (it calls mock[fn](...args)). */
    requestToSpeak: seatId => sim.requestToSpeak(seatId),
    pressMic: seatId => sim.pressMic(seatId),
    castVote: (seatId, answer) => sim.castVote(seatId, answer),
    /** Simulate the DCN-SW server link going down/up (AvailabilityChange). */
    setAvailable(value) { api.available = value; pushStatus(); },
    /** Change an Is*Allowed flag, e.g. setAllowed('control', 'DiscussionApi.IsDiscussStandardViewAllowed', false). */
    setAllowed(root, name, value) { api.allowed[root][name] = value; pushStatus(); },
    /** Drop the client connection (bridge crash / network). */
    dropClient() { current?.destroy(); },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise(resolve => server.close(() => resolve()));
    },
  };
}

function allAllowed(spec) {
  const allowed = { control: { IsControlAllowed: true }, config: { IsConfigAllowed: true } };
  for (const [key, iface] of Object.entries(spec.api.interfaces)) {
    const [root, prop] = key.split('.');
    for (const p of iface.properties) if (p.type === 'bool' && p.name.startsWith('Is')) allowed[root][`${prop}.${p.name}`] = true;
  }
  return allowed;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.MOCK_DCN_PORT ?? 9480);
  const mock = await createMockDcnBridge({ port, host: process.env.MOCK_DCN_HOST ?? '127.0.0.1', token: process.env.MOCK_DCN_TOKEN ?? '', authDelayMs: 500 });
  console.log(`mock dcn-bridge on 127.0.0.1:${mock.port} (${mock.token ? `token "${mock.token}"` : 'no token'}, DCN-SW user admin/admin, ${mock.sim.seats.length} seats)`);
  // Some life for UI work: random requests and mic presses.
  if (process.env.MOCK_DCN_IDLE !== '1') {
    setInterval(() => {
      const seat = 2 + Math.floor(Math.random() * (mock.sim.seats.length - 1));
      if (Math.random() < 0.5) mock.sim.requestToSpeak(seat); else mock.sim.pressMic(seat);
    }, 8_000).unref();
  }
  const stop = async () => { await mock.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
