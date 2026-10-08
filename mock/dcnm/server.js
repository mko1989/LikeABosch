// Mock dicentis-bridge (WO-079, DEC-006): speaks docs/protocol/dcnm-api/BRIDGE.md and emulates enough of the DICENTIS
// DCNM API for backend tests and UI work on any OS. Driven by api.json: every documented method can be called (overloads
// by argument names, results shaped by the return type), every Request…Async raises its …Changed event with the stored
// state. Behaviours: connect sequence (user admin / password admin; device → Connected + enabled), speakers list,
// participant registration and seat assignment, plugin handles and delegate callbacks. With `world` (WO-101,
// behaviours.js): stateful room audio + VU meters, seats (Dante out), languages, meeting languages, desks, presentation.
// Run: npm run mock:dcnm   (env MOCK_PORT, default 9481)
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadDcnmSpec } from '../../backend/src/dcnm/spec.js';
import { createDcnmWorld, handleCall, vuReadings, onChange } from './behaviours.js';

const HIDDEN = new Set(['CancellationToken']);
/** Where the dicentis-bridge finds the documented interfaces without a property (as in its fake). */
const IMPLEMENTED_BY = { RoomAudioControl: 'SystemAudioControlApi', PrepareParticipant: 'PrepareParticipant2' };
const isDelegate = (spec, type) => type in spec.types.delegates;

/**
 * @param {{ port?: number, host?: string, users?: Record<string, string>, token?: string, world?: ReturnType<typeof createDcnmWorld>, vuIntervalMs?: number }} [options]
 */
export async function createMockDcnmBridge({ port = 0, host = '127.0.0.1', users = { admin: 'admin' }, token = '', world = null, vuIntervalMs = 200 } = {}) {
  const spec = loadDcnmSpec();
  // Keys as the real bridge finds them: properties + the documented interfaces without one (IPluginInstance only as handle).
  const keys = [...spec.interfaces.keys()].filter(k => k !== 'PluginInstance' && k !== 'Capabilities');
  const state = {
    open: false, authenticated: false, device: 'Disconnected', enabled: false, apiState: 'Offline',
    /** api → property → value (scalars only, reported in status) */
    props: Object.fromEntries(keys.map(k => [k, Object.fromEntries(spec.properties(k).filter(p => /^(bool|int|string)$/.test(p.type)).map(p => [p.name, p.type === 'bool' ? false : p.type === 'int' ? 0 : '']))])),
    /** `${api}.${event}` → payload for the event Request…Async raises */
    events: new Map([['ControlSpeaker.SpeakersListChanged', []], ['PrepareParticipant2.ParticipantsRegistered', []]]),
    participants: [],
    handles: new Map(),
    calls: [],
  };
  let current = null;
  let nextHandle = 0;
  let nextCallback = 0;
  const pendingCallbacks = new Map();

  const send = (sock, msg) => { if (sock && !sock.destroyed) sock.write(`${JSON.stringify(msg)}\n`); };
  const push = msg => send(current, msg);
  const connection = () => ({ open: state.open, authenticated: state.authenticated, device: state.device, enabled: state.enabled, apiState: state.apiState });
  let statusSeq = 0;
  const status = () => ({ seq: ++statusSeq, connection: connection(), interfaces: structuredClone(state.props) });
  const pushStatus = () => push({ type: 'status', status: status() });
  const event = (api, name, parameter) => setTimeout(() => push({ type: 'event', api, event: name, args: parameter === undefined ? {} : { Parameter: parameter }, time: new Date().toISOString() }), 5);

  function setCapabilities(value) {
    for (const [api, props] of Object.entries(state.props)) {
      for (const k of Object.keys(props)) if (k.startsWith('Can')) props[k] = value;
      if (spec.events(api).some(e => e.name === 'CapabilitiesChanged')) event(api, 'CapabilitiesChanged');
    }
  }

  /** Default result for a return type ("Task<bool>" → true, lists → [], others null). */
  function result(returns) {
    const t = /^Task<(.*)>$/.exec(returns)?.[1] ?? (returns === 'Task' || returns === 'void' ? null : returns);
    if (t === null) return null;
    if (t === 'bool') return true;
    if (/^(int|long|double|float)$/.test(t)) return 0;
    if (t === 'string') return '';
    if (/^(IList|List|Collection|ReadOnlyCollection|IEnumerable)</.test(t)) return [];
    return null;
  }

  const fail = (code, message) => { const e = new Error(message); e.code = code; throw e; };

  function choose(api, method, args) {
    const overloads = spec.overloads(api, method);
    if (!overloads.length) fail('UNKNOWN_METHOD', `no method ${api}.${method}`);
    const given = Object.keys(args);
    const visible = m => m.params.filter(p => !HIDDEN.has(p.type) && !isDelegate(spec, p.type));
    const match = overloads.filter(m => given.every(g => visible(m).some(p => p.name === g)) && visible(m).every(p => p.default !== undefined || given.includes(p.name)))
      .sort((a, b) => visible(a).length - visible(b).length)[0];
    if (!match) fail('BAD_ARGS', `${api}.${method}: no overload takes (${given.join(', ')})`);
    return match;
  }

  /** @returns {Promise<unknown>} the call's result */
  async function call(api, method, args) {
    if (api.startsWith('#')) {
      const h = state.handles.get(api) ?? fail('UNKNOWN_HANDLE', `no handle ${api}`);
      api = h.key;
    } else if (!keys.includes(api)) fail('UNKNOWN_API', `no interface ${api}`);
    const m = choose(api, method, args);
    state.calls.push({ api, method, args });
    if (world && state.authenticated) {
      const handled = handleCall(world, api, method, args, event);
      if (handled) return handled.result;
    }
    switch (`${api}.${method}`) {
      case 'Base.OpenAsync':
        state.open = true; state.apiState = 'Online'; state.props.Base.CanAuthenticate = true; state.props.Base.IsOpen = true;
        event('Base', 'OpenStateChanged', true);
        return true;
      case 'Base.AuthenticateUserAsync': {
        const ok = users[args.userName] !== undefined && users[args.userName] === args.password;
        if (ok) { state.authenticated = true; state.props.Base.IsUserLoggedOn = true; state.props.Device.CanConnectAsDevice = true; setCapabilities(true); }
        return ok;
      }
      case 'Base.CloseAsync': state.open = false; state.apiState = 'Offline'; state.props.Base.IsOpen = false; return null;
      case 'Base.RevokeUserAsync': state.authenticated = false; state.props.Base.IsUserLoggedOn = false; setCapabilities(false); return null;
      case 'Device.ConnectAsDeviceAsync':
        state.device = 'Connected'; state.enabled = true; state.props.Device.IsEnabledAsDevice = true;
        event('Device', 'DeviceApiConnectionStateChanged', 'Connected');
        return true;
      case 'Device.DisconnectAsDeviceAsync': state.device = 'Disconnected'; state.enabled = false; return true;
      case 'ControlSpeaker.GrantSpeechAsync': {
        const list = state.events.get('ControlSpeaker.SpeakersListChanged');
        if (!list.some(s => s.SpeakerId === args.participantId)) list.push({ SpeakerId: args.participantId, MicrophoneState: 'On', ParticipantInfo: null, SeatInfo: null, SpeechTimerInfo: null });
        event('ControlSpeaker', 'SpeakersListChanged', structuredClone(list));
        return true;
      }
      case 'ControlSpeaker.CancelSpeakersAsync': {
        const list = state.events.get('ControlSpeaker.SpeakersListChanged').filter(s => !args.participantIds.includes(s.SpeakerId));
        state.events.set('ControlSpeaker.SpeakersListChanged', list);
        event('ControlSpeaker', 'SpeakersListChanged', structuredClone(list));
        return true;
      }
      case 'ControlSpeaker.SetSpeechTimeAsync':
        if (args.speechDuration === -1) fail('TIMEOUT', 'ControlSpeaker.SetSpeechTimeAsync did not finish');
        if (args.speechDuration === -2) fail('EXCEPTION', 'InvalidOperationException: fake failure');
        return true;
      case 'PrepareParticipant2.RegisterParticipantsAsync': {
        const added = args.participants.map(p => ({ ...p, Id: p.Id ?? p.id ?? randomUUID() }));
        state.participants.push(...added);
        event('PrepareParticipant2', 'ParticipantsRegistered', added);
        return added;
      }
      case 'PrepareParticipant2.AssignParticipantsToSeatsAsync':
        event('PrepareParticipant2', 'ParticipantsUpdated', args.participantInfos);
        return true;
      case 'Plugins.RegisterPluginAsync': {
        const id = `#${++nextHandle}`;
        state.handles.set(id, { key: 'PluginInstance', plugin: args.plugin });
        // The registered command handler is called once, like a plugin client would: a callback the client answers.
        setTimeout(() => callback('Plugins', 'RegisterPluginAsync', 'handler', { msg: { PluginName: 'mock', Command: 'PING', Parameters: '{}' } }, true), 20);
        return { $handle: id, interface: 'IPluginInstance' };
      }
      case 'Plugins.SubscribePluginEventAsync':
        setTimeout(() => callback('Plugins', 'SubscribePluginEventAsync', 'handler', { msg: { PluginName: args.pluginName, Event: args.eventName, Parameters: '{"mock":true}' } }, false), 20);
        return true;
    }
    if (/^Request\w*Async$/.test(method) && !m.params.length) {
      const ev = `${method.slice(7, -5)}Changed`;
      if (spec.events(api).some(e => e.name === ev)) event(api, ev, structuredClone(state.events.get(`${api}.${ev}`) ?? (spec.events(api).find(e => e.name === ev).payload?.match(/^(IList|List|Collection)</) ? [] : null)));
    }
    return result(m.returns.type);
  }

  function callback(api, method, parameter, args, expectsResult) {
    const id = ++nextCallback;
    if (expectsResult) pendingCallbacks.set(id, null);
    push({ type: 'callback', callback: id, api, method, parameter, args, expectsResult, time: new Date().toISOString() });
  }

  async function handle(sock, msg) {
    const reply = result => send(sock, { type: 'response', id: msg.id, ok: true, result });
    const error = (code, message) => send(sock, { type: 'response', id: msg.id, ok: false, error: { code, message } });
    try {
      switch (msg.type) {
        case 'ping': return reply({ time: new Date().toISOString() });
        case 'status': return reply(status());
        case 'connect': {
          if (!state.open) await call('Base', 'OpenAsync', msg.server ? { hostNameOrAddress: msg.server } : {});
          let authenticated = state.authenticated;
          if (!authenticated && msg.user) authenticated = await call('Base', 'AuthenticateUserAsync', { userName: msg.user, password: msg.password ?? '' });
          if (authenticated && msg.device && state.device !== 'Connected') await call('Device', 'ConnectAsDeviceAsync', { uniqueId: msg.device });
          setTimeout(pushStatus, 10);
          return reply({ ...connection(), authenticated });
        }
        case 'disconnect':
          state.device = 'Disconnected'; state.enabled = false; state.authenticated = false; state.open = false; state.apiState = 'Offline';
          setCapabilities(false);
          setTimeout(pushStatus, 10);
          return reply({});
        case 'call': return reply({ result: await call(msg.api, msg.method, msg.args ?? {}) });
        case 'get': {
          const v = state.props[msg.api]?.[msg.property];
          if (v === undefined) return error('UNKNOWN_PROPERTY', `${msg.api}.${msg.property}: no readable property`);
          return reply({ value: v });
        }
        case 'set': {
          const p = spec.properties(msg.api).find(x => x.name === msg.property);
          if (!p || !p.access.includes('set')) return error('UNKNOWN_PROPERTY', `${msg.api}.${msg.property}: no writable property`);
          (state.props[msg.api] ??= {})[msg.property] = msg.value;
          setTimeout(pushStatus, 10);
          return reply({});
        }
        case 'release':
          if (!state.handles.delete(msg.handle)) return error('UNKNOWN_HANDLE', `no handle ${msg.handle}`);
          return reply({});
        case 'callbackResult':
          if (!pendingCallbacks.has(msg.callback)) return error('BAD_REQUEST', `no pending callback ${msg.callback}`);
          pendingCallbacks.set(msg.callback, msg.result);
          return reply({});
        default: return error('BAD_REQUEST', `unknown type ${msg.type}`);
      }
    } catch (err) {
      return error(err.code ?? 'EXCEPTION', err.message);
    }
  }

  const server = net.createServer(sock => {
    let buffer = '';
    let authed = false;
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    sock.on('close', () => { if (current === sock) current = null; });
    sock.on('data', chunk => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { send(sock, { type: 'response', id: null, ok: false, error: { code: 'BAD_REQUEST', message: 'not JSON' } }); continue; }
        if (msg.type === 'hello') {
          if (token && msg.token !== token) { send(sock, { type: 'hello', ok: false, error: { code: 'BAD_TOKEN', message: 'wrong token' } }); sock.end(); return; }
          authed = true;
          if (current && current !== sock) { send(current, { type: 'closed', reason: 'replaced' }); current.end(); }
          current = sock;
          send(sock, {
            type: 'hello', ok: true, protocol: 1,
            bridge: { name: 'dicentis-bridge', version: '0.1.0-mock', apiVersion: '7.0.43431.0', fake: true, dllPath: null, runtime: 'node mock', is64Bit: true },
            interfaces: Object.fromEntries(keys.map(k => [k, { interface: spec.get(k).interface, source: IMPLEMENTED_BY[k] ? `implemented by ${IMPLEMENTED_BY[k]}` : 'property' }])),
            constants: { 'DcnmMicrophoneOptions.DEFAULT_OPEN_MICROPHONES': 2 },
            status: status(),
          });
          continue;
        }
        if (!authed) { send(sock, { type: 'response', id: msg.id, ok: false, error: { code: 'NOT_HELLO', message: 'send hello first' } }); continue; }
        handle(sock, msg);
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });

  // World extras: VU readings while requested, IsPresentationActive follows the presentation state.
  const setPresentationProperty = active => {
    if (!state.props.ControlPresentationApi || state.props.ControlPresentationApi.IsPresentationActive === active) return;
    state.props.ControlPresentationApi.IsPresentationActive = active;
    setTimeout(pushStatus, 10);
  };
  let vuTimer = null;
  if (world) {
    setPresentationProperty(world.presentation);
    onChange(world, kind => { if (kind === 'presentation') setPresentationProperty(world.presentation); });
    vuTimer = setInterval(() => { if (world.audio.vuOn && state.authenticated) event('RoomAudioControl', 'VUMeterReadingsChanged', vuReadings(world)); }, vuIntervalMs);
    vuTimer.unref?.();
  }

  return {
    port: server.address().port,
    state,
    pendingCallbacks,
    /** Raise an event as the API would. */
    emit(api, name, parameter) { event(api, name, parameter); },
    /** Simulate the DICENTIS system going away / coming back (the API closes / reopens). */
    setOpen(open) { state.open = open; state.apiState = open ? 'Online' : 'Offline'; if (!open) state.authenticated = false; pushStatus(); },
    /** Change a property and raise CapabilitiesChanged like the API does. */
    setProperty(api, name, value) { (state.props[api] ??= {})[name] = value; event(api, 'CapabilitiesChanged'); setTimeout(pushStatus, 10); },
    /** Send any message to the current client (e.g. a stale status). */
    pushRaw(msg) { push(msg); },
    /** Drop the current client connection (bridge restart). */
    kick() { current?.destroy(); },
    world,
    setPresentationProperty,
    close() { clearInterval(vuTimer); current?.destroy(); return new Promise(resolve => server.close(() => resolve())); },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const world = createDcnmWorld({
    seats: Array.from({ length: 20 }, (_, i) => ({ id: `seat-${i + 1}`, name: i === 0 ? 'Chairman' : `Seat ${i + 1}` })),
    interpreterSeats: [{ id: 'seat-booth1-desk1', name: 'Booth 1 Desk 1' }, { id: 'seat-booth1-desk2', name: 'Booth 1 Desk 2' }],
  });
  const mock = await createMockDcnmBridge({ port: Number(process.env.MOCK_PORT ?? 9481), host: process.env.MOCK_HOST ?? '127.0.0.1', world });
  console.log(`[mock:dcnm] dicentis-bridge mock on 127.0.0.1:${mock.port} (user admin / password admin)`);
  console.log(`READY port=${mock.port}`);
  process.on('SIGINT', async () => { await mock.close(); process.exit(0); });
}
