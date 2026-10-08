// Mock DICENTIS server for the Conference Protocol (WO-010, DEC-006).
// Run: npm run mock:wired  (env MOCK_PORT, default 31416; user admin / password admin)
// Tests: const mock = await createMockWiredServer({ port: 0 }); … await mock.close();
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { loadSpec, defaultFor, validateValue } from '../../backend/src/wired/spec.js';
import { createState } from './state.js';
import { behaviours } from './behaviours/index.js';
import { requestToSpeak } from './behaviours/seats.js';

const CERT_DIR = new URL('./certs/', import.meta.url);
const PATH = '/Dicentis/API';
const SUBPROTOCOL = 'DICENTIS_1_0';

class MockFailure extends Error {}

/**
 * Per-connection event registration with fire-once semantics (PDF p.51–52):
 * an event is delivered once, then stays silent until re-armed by fetching its data
 * (the refresh operation in events.json) or by calling RegisterEvents for it again.
 */
/** Event names on the wire: the real 6.50 server sends PascalCase (e.g. "MasterVolumeChanged"). */
const wireName = e => e.charAt(0).toUpperCase() + e.slice(1);
const key = e => String(e).toLowerCase();

class EventEngine {
  constructor(send) {
    this.send = send;
    this.registered = new Set();
    this.armed = new Set();
    this.pending = new Set();
  }

  // Names are matched case-insensitively (like the real server) and stored lower-case.
  register(events) { events.map(key).forEach(e => { this.registered.add(e); this.armed.add(e); }); }
  unregister(events) { events.map(key).forEach(e => { this.registered.delete(e); this.armed.delete(e); }); }
  rearm(events) { events.map(key).forEach(e => { if (this.registered.has(e)) this.armed.add(e); }); }

  fire(event) {
    const k = key(event);
    if (!this.registered.has(k) || !this.armed.has(k)) return;
    this.armed.delete(k);
    this.pending.add(wireName(event));
    if (this.pending.size === 1) {
      setImmediate(() => {
        const events = [...this.pending];
        this.pending.clear();
        this.send({ messageId: 0, operation: 'event', parameters: { events } });
      });
    }
  }
}

/**
 * @param {object} [options]
 * @param {number} [options.port]        0 = random
 * @param {string} [options.host]
 * @param {Record<string, string>} [options.users]  user → password
 * @param {boolean} [options.historyEvents]  accept the history-only optional events (DICENTIS ≥ 4.2 behaviour)
 * @param {(msg: string) => void} [options.log]
 * @param {number} [options.seatCount]  simulation (WO-095): number of seats
 * @param {string} [options.roomName]   simulation: the room name the server reports
 */
export async function createMockWiredServer({
  port = 0, host = '127.0.0.1', users = { admin: 'admin' }, historyEvents = true, log = () => {}, seatCount = 20, roomName,
} = {}) {
  const spec = loadSpec();
  const state = createState({ seatCount });
  if (roomName) state.roomName = roomName;
  const optionalEvents = spec.eventMap.events.filter(e => e.optional).map(e => e.event);
  const knownEvents = new Set([...spec.registrableEvents, ...(historyEvents ? optionalEvents : [])].map(e => e.toLowerCase()));
  /** operation (lower case) → error message, for tests (`failOperation`) */
  const forcedFailures = new Map();
  /** @type {Set<{ engine: EventEngine, ws: import('ws').WebSocket, user: string | null }>} */
  const connections = new Set();

  const fire = (...events) => {
    for (const conn of connections) if (conn.user) events.forEach(e => conn.engine.fire(e));
  };

  const https = createServer({ cert: readFileSync(new URL('mock-cert.pem', CERT_DIR)), key: readFileSync(new URL('mock-key.pem', CERT_DIR)) });
  const wss = new WebSocketServer({
    server: https,
    path: PATH,
    handleProtocols: protocols => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
  });

  wss.on('connection', ws => {
    const send = msg => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
    const conn = { ws, user: null, engine: new EventEngine(send) };
    connections.add(conn);
    ws.on('close', () => connections.delete(conn));
    ws.on('message', raw => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        log('malformed JSON, closing socket');
        ws.close(1002, 'Protocol error');
        return;
      }
      Promise.resolve(handle(conn, msg)).then(send); // behaviours may be async (SendPluginCommand)
    });
  });

  /** Process one request message and return the response message (or a promise of it). */
  function handle(conn, msg) {
    const messageId = Number.isInteger(msg?.messageId) ? msg.messageId : 0;
    const error = message => ({ messageId, operation: 'error', parameters: { message } });
    if (!msg || typeof msg !== 'object' || typeof msg.operation !== 'string' || !Number.isInteger(msg.messageId)
      || !('parameters' in msg) || (msg.parameters !== null && (typeof msg.parameters !== 'object' || Array.isArray(msg.parameters)))) {
      return error('Bad message format');
    }
    const op = spec.get(msg.operation);
    if (!op) return error(`${msg.operation.toUpperCase()} is an unknown operation`); // real 6.50 server upper-cases the name
    const params = msg.parameters ?? {};
    const name = op.operation;

    if (name !== 'Login' && !conn.user) return error('Please login first'); // real server text; checked before parameters

    // RegisterEvents/UnregisterEvents may name history-only events that are not in the documented enum.
    const isEventOp = name === 'RegisterEvents' || name === 'UnregisterEvents';
    const problems = validateValue(op.request, isEventOp ? { ...params, events: undefined } : params);
    if (problems.length) {
      const p = problems[0];
      return error(p.problem === 'unknown-field'
        ? `Could not find member '${p.path.split('.').pop()}' on object of type '${name}Request'. Path '${p.path}'.`
        : `Error converting value at '${p.path}': expected ${p.expected}.`);
    }

    const onError = err => {
      if (err instanceof MockFailure || /^Unable to perform/.test(err.message)) return error(err.message);
      log(`behaviour crashed: ${err.stack}`);
      return error(`Internal server error in ${name}`);
    };
    try {
      const parameters = dispatch(conn, op, params);
      if (parameters instanceof Promise) {
        return parameters.then(p => ({ messageId, operation: msg.operation, parameters: p }), onError);
      }
      return { messageId, operation: msg.operation, parameters };
    } catch (err) {
      return onError(err);
    }
  }

  function dispatch(conn, op, params) {
    const name = op.operation;
    const fail = message => { throw new MockFailure(message); };
    switch (name) {
      case 'Login': {
        if (conn.user) fail('Already logged in. Please disconnect to log off');
        const ok = Object.hasOwn(users, params.user ?? '') && users[params.user] === params.password;
        if (ok) conn.user = params.user;
        // userId since DICENTIS 6.3 (seen on the 6.50 server, WO-044)
        return ok ? { loggedIn: true, token: `mock-token-${params.user}`, userId: `user-${params.user}` } : { loggedIn: false, token: '' };
      }
      case 'Logout':
        conn.user = null;
        conn.engine.unregister([...conn.engine.registered]);
        return {};
      case 'RegisterEvents':
      case 'UnregisterEvents': {
        const events = params.events ?? [];
        if (!Array.isArray(events)) fail("Error converting value at 'parameters.events': expected array.");
        const bad = events.findIndex(e => !knownEvents.has(String(e).toLowerCase()));
        if (bad > -1) fail(`Error converting value "${events[bad]}" to type 'SynopticControl.Common.ConferenceEvent'. Path 'parameters.events[${bad}]'.`); // real 6.50 text
        if (name === 'RegisterEvents') conn.engine.register(events);
        else conn.engine.unregister(events);
        return {};
      }
      default: {
        if (forcedFailures.has(name.toLowerCase())) fail(forcedFailures.get(name.toLowerCase()));
        const behaviour = behaviours.get(name.toLowerCase());
        const fireTo = (target, ...evs) => { if (target?.user) evs.forEach(e => target.engine.fire(e)); };
        const ctx = { state, user: conn.user, conn, fail, fire, fireTo };
        const result = behaviour ? behaviour(ctx, params) : defaultFor(op.response);
        conn.engine.rearm(spec.eventsRearmedBy(name)); // fetching data re-arms its event (PDF p.52)
        return result;
      }
    }
  }

  await new Promise((resolve, reject) => {
    https.once('error', reject);
    https.listen(port, host, resolve);
  });
  const actualPort = /** @type {import('node:net').AddressInfo} */ (https.address()).port;

  return {
    port: actualPort,
    host,
    url: `wss://${host}:${actualPort}${PATH}`,
    state,
    /** Simulate a server-side change: deliver these events to registered, armed connections. */
    fire,
    /** Test helper: cast a vote from a seat in the active voting. */
    castVote(seatId, answer) {
      const voting = state.votings.find(v => v.votingId === state.activeVotingId);
      if (!voting || voting.state !== 'opened') throw new Error('No open voting');
      state.votes.set(seatId, answer);
      fire('votingResultChanged', 'individualVotingResultsChanged', 'majorityResultChanged', 'quorumResultChanged');
    },
    /** Test helper: a delegate presses the request-to-speak button. */
    requestToSpeak(seatId) {
      requestToSpeak({ state, user: 'device', fire, fail: m => { throw new Error(m); } }, seatId);
    },
    /** Test helper: make an operation fail with `message` (pass null to clear). */
    failOperation(name, message) {
      if (message) forcedFailures.set(name.toLowerCase(), message); else forcedFailures.delete(name.toLowerCase());
    },
    /** Test helper: a participant is refused at a seat (e.g. 'incorrectSeat'). */
    denyAccess(...reasons) {
      state.accessDeniedReasons = reasons;
      fire('participantAccessDenied');
    },
    /** Test helper: drop all client connections without a close handshake. */
    dropConnections() { for (const c of connections) c.ws.terminate(); },
    get connectionCount() { return connections.size; },
    async close() {
      for (const c of connections) c.ws.terminate();
      await new Promise(resolve => wss.close(() => resolve()));
      await new Promise(resolve => https.close(() => resolve()));
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const mock = await createMockWiredServer({
    port: Number(process.env.MOCK_PORT ?? 31416),
    host: process.env.MOCK_HOST ?? '127.0.0.1',
    log: msg => console.log(`[mock:wired] ${msg}`),
  });
  console.log(`[mock:wired] listening on ${mock.url} (user admin / password admin, self-signed cert)`);
  process.on('SIGINT', async () => { await mock.close(); process.exit(0); });
}
