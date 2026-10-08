// Protocol conformance of the real C# dicentis-bridge (WO-078), run in --fake mode on a modern .NET runtime: the same
// reflection, overload choice, Task awaiting, value conversion (incl. constructor-built data classes), events, handles and
// callbacks that host the DICENTIS DLLs on Windows, driven by DcnmClient and the backend.
// Run: npm run bridge:test   (needs the .NET SDK; DICENTIS_BRIDGE_TFM=net10.0 by default, DCN_BRIDGE_NO_BUILD=1 to skip the build)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { DcnmClient } from '../../../backend/src/dcnm/client.js';
import { loadDcnmSpec } from '../../../backend/src/dcnm/spec.js';
import { startBackend } from '../../../backend/test/helpers/start.js';
import { createMockWiredServer } from '../../../mock/wired/server.js';

const DIR = fileURLToPath(new URL('..', import.meta.url));
const TFM = process.env.DICENTIS_BRIDGE_TFM ?? 'net10.0';
const spec = loadDcnmSpec();
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const GUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

let dotnet = true;
try { execFileSync('dotnet', ['--version'], { stdio: 'ignore' }); } catch { dotnet = false; }

async function startBridge(extraArgs = []) {
  const proc = spawn('dotnet', [`bin/Release/${TFM}/dicentis-bridge.dll`, '--fake', '--listen', '127.0.0.1', '--port', '0', ...extraArgs], { cwd: DIR });
  const out = [];
  proc.stderr.on('data', d => out.push(String(d)));
  const port = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`bridge did not start:\n${out.join('')}`)), 20_000);
    proc.stdout.on('data', d => {
      out.push(String(d));
      const m = /READY port=(\d+)/.exec(out.join(''));
      if (m) { clearTimeout(t); resolve(Number(m[1])); }
    });
    proc.once('exit', code => reject(new Error(`bridge exited (${code}):\n${out.join('')}`)));
  });
  return { proc, port, output: out };
}
const stop = async b => { if (b?.proc.exitCode === null) { b.proc.kill(); await once(b.proc, 'exit'); } };
const nextEvent = (c, name) => new Promise(resolve => {
  const on = e => { if (e.event === name) { c.off('event', on); resolve(e); } };
  c.on('event', on);
});
const nextMessage = (c, type, pred = () => true) => new Promise(resolve => {
  const on = m => { if (pred(m)) { c.off(type, on); resolve(m); } };
  c.on(type, on);
});

/** Raw NDJSON session for protocol details the client hides. */
async function raw(port) {
  const sock = net.connect({ host: '127.0.0.1', port });
  await once(sock, 'connect');
  sock.setEncoding('utf8');
  const lines = [];
  let buf = '';
  sock.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  return {
    sock, lines,
    send: msg => sock.write(`${JSON.stringify(msg)}\n`),
    next: async pred => { for (let i = 0; i < 200; i++) { const m = lines.find(pred); if (m) { lines.splice(lines.indexOf(m), 1); return m; } await sleep(25); } throw new Error('no message'); },
  };
}

// ---------------------------------------------------------------- sample arguments from the spec
const ENUMS = spec.types.enums;
const CLASSES = spec.types.classes;
function sample(type, depth = 0) {
  const t = type.trim();
  if (t.endsWith('[]')) return t === 'byte[]' ? '' : [];
  const g = /^([\w.]+)<(.*)>$/.exec(t);
  if (g) {
    if (/^(IList|List|Collection|ReadOnlyCollection|IEnumerable|ICollection|IReadOnlyList|IReadOnlyCollection|ObservableCollection)$/.test(g[1])) return [];
    if (/Dictionary$/.test(g[1])) return {};
    if (g[1] === 'KeyValuePair') { const [k, v] = g[2].split(',').map(s => s.trim()); return { Key: sample(k, depth + 1), Value: sample(v, depth + 1) }; }
    return null;
  }
  switch (t) {
    case 'bool': return false;
    case 'string': return '';
    case 'Guid': return GUID;
    case 'DateTime': return '2026-10-07T12:00:00.0000000Z';
    case 'TimeSpan': return 0;
    case 'Version': return '1.0';
    case 'object': return null;
    case 'int': case 'long': case 'short': case 'byte': case 'uint': case 'ushort': case 'ulong': case 'double': case 'float': case 'decimal': return 0;
  }
  if (ENUMS[t]) return ENUMS[t].members[0].name;
  const c = CLASSES[t];
  if (c) {
    if (depth > 3) return null;
    // the constructor with the fewest parameters (the bridge picks a constructor by the member names given)
    const ctor = [...c.constructors].sort((a, b) => a.params.length - b.params.length)[0];
    if (!ctor) return {};
    return Object.fromEntries(ctor.params.filter(p => p.default === undefined).map(p => [p.name, sample(p.type, depth + 1)]));
  }
  return null;
}

describe('dicentis-bridge --fake (C#)', { skip: !dotnet && 'dotnet not installed' }, () => {
  let bridge;
  before(async () => {
    if (process.env.DCN_BRIDGE_NO_BUILD !== '1') {
      execFileSync('dotnet', ['build', '-c', 'Release', `-p:DevTfm=${TFM}`, '-f', TFM, '--nologo', '-v', 'q'], { cwd: DIR, stdio: 'inherit' });
    }
    bridge = await startBridge();
  });
  after(() => stop(bridge));
  const client = extra => new DcnmClient({ host: '127.0.0.1', port: bridge.port, user: 'admin', password: 'admin', heartbeatMs: 0, reconnect: { enabled: false }, log: quiet, ...extra });

  test('hello: interfaces found both ways, constants, status; token when configured', async () => {
    const r = await raw(bridge.port);
    r.send({ type: 'hello', protocol: 1 });
    const hello = await r.next(m => m.type === 'hello');
    r.sock.destroy();
    assert.equal(hello.ok, true);
    assert.equal(hello.bridge.name, 'dicentis-bridge');
    assert.equal(hello.bridge.fake, true);
    assert.equal(Object.keys(hello.interfaces).length, 37, '32 documented + 3 extra properties + 2 implemented by');
    assert.deepEqual(hello.interfaces.RoomAudioControl, { interface: 'IRoomAudioControl', source: 'implemented by SystemAudioControlApi' });
    assert.deepEqual(hello.interfaces.PrepareParticipant, { interface: 'IPrepareParticipant', source: 'implemented by PrepareParticipant2' });
    assert.deepEqual(hello.interfaces.ControlCamera, { interface: 'IControlCamera', source: 'property' });
    assert.equal(hello.constants['DcnmMicrophoneOptions.DEFAULT_OPEN_MICROPHONES'], 2);
    assert.equal(hello.constants['DcnmAudioEqualizerSettings.EQUALIZER_DEFAULT_MIN_QFACTOR'], 0.4000000059604645);
    assert.deepEqual(hello.status.connection, { open: false, authenticated: false, device: 'Disconnected', enabled: false, apiState: 'Offline' });

    const locked = await startBridge(['--token', 'secret']);
    try {
      await assert.rejects(new DcnmClient({ host: '127.0.0.1', port: locked.port, user: 'admin', password: 'admin', heartbeatMs: 0, reconnect: { enabled: false }, log: quiet }).connect(), { code: 'UPSTREAM_AUTH' });
      const ok = new DcnmClient({ host: '127.0.0.1', port: locked.port, token: 'secret', user: 'admin', password: 'admin', heartbeatMs: 0, reconnect: { enabled: false }, log: quiet });
      await ok.connect();
      await ok.close();
    } finally { await stop(locked); }
  });

  test('connect sequence (open → authenticate → device), wrong password, status after CapabilitiesChanged', async () => {
    await assert.rejects(client({ password: 'nope' }).connect(), { code: 'UPSTREAM_AUTH' });
    const c = client();
    await c.connect();
    assert.equal(c.state, 'loggedIn');
    assert.deepEqual(c.connection, { open: true, authenticated: true, device: 'Connected', enabled: true, apiState: 'Online' });
    const status = await nextMessage(c, 'status', s => s.interfaces?.ControlSpeaker?.CanControlSpeaker === true).catch(() => null)
      ?? c.bridgeStatus;
    assert.equal(status.interfaces.ControlSpeaker.CanControlSpeaker, true, 'Can… true after login (pushed after CapabilitiesChanged)');
    assert.equal(await c.get('Base', 'DicentisVersion'), '7.0.43431.0');
    await c.close();
  });

  test('calls: Task results, Guid lists, events from API threads, overloads, collections', async () => {
    const c = client();
    await c.connect();
    const ev = nextEvent(c, 'SpeakersListChanged');
    assert.equal(await c.call('ControlSpeaker', 'GrantSpeechAsync', { participantId: GUID }), true);
    const e = await ev;
    assert.equal(e.api, 'ControlSpeaker');
    assert.deepEqual(e.args.Parameter.map(s => [s.SpeakerId, s.MicrophoneState]), [[GUID, 'On']]);
    const gone = nextEvent(c, 'SpeakersListChanged');
    await c.call('ControlSpeaker', 'CancelSpeakersAsync', { participantIds: [GUID] });
    assert.deepEqual((await gone).args.Parameter, []);
    // overloads chosen by argument names
    assert.equal(await c.call('ControlSpeaker', 'SetSpeechTimeAsync', { participantId: GUID, speechDuration: 60, discussionType: 'Speaker' }), true);
    assert.equal(await c.call('ControlSpeaker', 'SetSpeechTimeAsync', { participantId: GUID, speechDuration: 60, discussionType: 'Speaker', resetSpeechTime: true }), true);
    assert.equal(await c.call('Device', 'ConnectAsDeviceAsync', { uniqueId: 'x', deviceAttributes: ['a', 'b'] }), true, 'Collection<string>');
    // Request…Async → the …Changed event with the current state
    const listed = nextEvent(c, 'SpeakersListChanged');
    await c.call('ControlSpeaker', 'RequestSpeakersListAsync');
    assert.deepEqual((await listed).args.Parameter, []);
    // a data class built through its constructor (no parameterless one), inside a list
    const p = { id: GUID, meetingId: GUID, assignedAt: GUID, vipType: 'None', userId: GUID, canDiscuss: true, canManageMeeting: false, canVote: true, canUsePriority: false, voteWeight: 1, hasSpecialPermission: false };
    assert.deepEqual(await c.call('PrepareParticipant2', 'RegisterParticipantsAsync', { participants: [p] }), []);
    await c.close();
  });

  test('errors: UNKNOWN_API/METHOD, BAD_ARGS (no overload, bad value, constructor), TIMEOUT, EXCEPTION, properties', async () => {
    const c = client();
    await c.connect();
    await assert.rejects(c.call('Nope', 'X'), err => err.code === 'VALIDATION' && err.extra.bridgeError === 'UNKNOWN_API');
    await assert.rejects(c.call('ControlSpeaker', 'Nope'), err => err.extra.bridgeError === 'UNKNOWN_METHOD');
    await assert.rejects(c.call('ControlSpeaker', 'GrantSpeechAsync', { seat: 1 }), err => err.extra.bridgeError === 'BAD_ARGS' && /overloads: GrantSpeechAsync\(participantId\)/.test(err.message));
    await assert.rejects(c.call('ControlSpeaker', 'GrantSpeechAsync', { participantId: 'not-a-guid' }), err => err.extra.bridgeError === 'BAD_ARGS');
    await assert.rejects(c.call('PrepareParticipant2', 'RegisterParticipantsAsync', { participants: [{ id: GUID }] }), err => err.extra.bridgeError === 'BAD_ARGS' && /constructors/.test(err.message));
    await assert.rejects(c.call('ControlSpeaker', 'SetSpeechTimeAsync', { participantId: GUID, speechDuration: -1, discussionType: 'Speaker' }, { timeoutMs: 400 }), { code: 'UPSTREAM_TIMEOUT' });
    await assert.rejects(c.call('ControlSpeaker', 'SetSpeechTimeAsync', { participantId: GUID, speechDuration: -2, discussionType: 'Speaker' }), err => err.code === 'UPSTREAM_ERROR' && /fake failure/.test(err.message));
    await assert.rejects(c.call('Base', 'SetCallbackContext', {}), err => err.extra.bridgeError === 'BAD_ARGS');
    await assert.rejects(c.get('Base', 'Nope'), err => err.extra.bridgeError === 'UNKNOWN_PROPERTY');
    await assert.rejects(c.set('Base', 'IsOpen', false), err => err.extra.bridgeError === 'UNKNOWN_PROPERTY');
    await c.close();
  });

  test('plugins: interface results as handles, handle arguments, delegate callbacks with and without results', async () => {
    const c = client();
    await c.connect();
    const commandCallback = nextMessage(c, 'callback', m => m.parameter === 'handler' && m.method === 'RegisterPluginAsync');
    const handle = await c.call('Plugins', 'RegisterPluginAsync', { plugin: { Name: 'likeabosch', Description: 'test' } });
    assert.deepEqual(handle, { $handle: '#1', interface: 'IPluginInstance' });
    const cb = await commandCallback;
    assert.equal(cb.expectsResult, true);
    assert.equal(cb.args.msg.Command, 'PING');
    await c.callbackResult(cb.callback, '{"pong":true}');
    assert.equal(await c.call('#1', 'SendPluginEventAsync', { eventName: 'e', parameters: '{}' }), true);
    const eventCallback = nextMessage(c, 'callback', m => m.method === 'SubscribePluginEventAsync');
    assert.equal(await c.call('Plugins', 'SubscribePluginEventAsync', { pluginName: 'p', eventName: 'e' }), true);
    const ecb = await eventCallback;
    assert.equal(ecb.expectsResult, false);
    assert.equal(ecb.args.msg.Parameters, '{"fake":true}');
    assert.equal(await c.call('Plugins', 'UnregisterPluginAsync', { pluginInstance: handle }), true, 'handle as argument');
    await c.release('#1');
    await assert.rejects(c.call('#1', 'SendPluginEventAsync', { eventName: 'e', parameters: '{}' }), err => err.extra.bridgeError === 'UNKNOWN_HANDLE');
    await c.close();
  });

  test('every documented method can be called with spec-generated arguments', async () => {
    const c = client();
    await c.connect();
    const handle = await c.call('Plugins', 'RegisterPluginAsync', { plugin: {} });
    const failures = [];
    let calls = 0;
    // These end the session (the client then leaves loggedIn, correctly): call them last.
    const LAST = ['Device.DisconnectAsDeviceAsync', 'Device.UninstallAsync', 'Base.RevokeUserAsync', 'Base.CloseAsync'];
    const all = Object.keys(c.interfaces).flatMap(key => [...new Set(spec.get(key).methods.map(m => m.name))].map(name => [key, name]))
      .sort((a, b) => LAST.indexOf(a.join('.')) - LAST.indexOf(b.join('.')));
    for (const [key, name] of all) {
      {
        if (name === 'SetCallbackContext' || name === 'SetTaskCompletionContext') continue; // not exposable (BAD_ARGS, tested above)
        for (const m of spec.overloads(key, name)) {
          const args = {};
          for (const p of m.params) {
            if (p.type === 'CancellationToken' || p.type in spec.types.delegates) continue;
            args[p.name] = p.type === 'IPluginInstance' ? handle : sample(p.type);
          }
          calls++;
          try { await c.call(key, name, args, { timeoutMs: 5_000 }); } catch (err) { failures.push(`${key}.${name}(${Object.keys(args).join(', ')}): ${err.message}`); }
        }
      }
    }
    assert.deepEqual(failures, []);
    assert.ok(calls >= 250, `${calls} calls`);
    await c.close();
  });

  test('a second client replaces the first', async () => {
    const a = client();
    await a.connect();
    const b = client();
    await b.connect();
    await new Promise(r => setTimeout(r, 200));
    assert.equal(a.state, 'disconnected');
    assert.equal(a.lastError?.extra?.reason, 'replaced');
    await b.close();
  });

  test('the backend runs against the real bridge: second connection, sweep, mirror, passthrough', async () => {
    const wired = await createMockWiredServer();
    const backend = await startBackend({
      DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(wired.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin', DICENTIS_AUTOCONNECT: 'true',
      DICENTIS_DCNM_BRIDGE: 'true', DICENTIS_DCNM_HOST: '127.0.0.1', DICENTIS_DCNM_PORT: String(bridge.port),
    });
    try {
      const { manager, dcnmMirror, cache } = backend.services;
      for (let i = 0; i < 100 && manager.dcnmClient?.state !== 'loggedIn'; i++) await sleep(50);
      assert.equal(manager.dcnmClient.state, 'loggedIn');
      await dcnmMirror.idle();
      const sweep = cache.get('dcnmSweep').data;
      assert.deepEqual(sweep.failed, []);
      assert.equal(sweep.complete, true, `sweep complete (${sweep.requested}/${sweep.total})`);
      assert.ok(sweep.requested >= 30);
      for (let i = 0; i < 40 && !cache.get('dcnm.ControlMeeting.MeetingsListChanged'); i++) await sleep(50);
      for (let i = 0; i < 40 && !cache.get('dcnm.ControlSpeaker.SpeakersListChanged'); i++) await sleep(50);
      assert.ok(cache.get('dcnm.ControlSpeaker.SpeakersListChanged'), `mirror filled by the sweep; state ${manager.dcnmClient.state}, sweep ${JSON.stringify(sweep)}, ` +
        `topics ${[...cache.topics.keys()].filter(t => t.startsWith('dcnm')).join(', ')}, unavailable ${JSON.stringify(Object.fromEntries([...cache.unavailable].filter(([t]) => t.startsWith('dcnm'))))}`);
      const res = await fetch(`${backend.url}/api/dcnm/ops/ControlSpeaker/GrantSpeechAsync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ participantId: GUID }) });
      assert.deepEqual(await res.json(), { ok: true, data: true });
      for (let i = 0; i < 40 && !cache.get('dcnm.ControlSpeaker.SpeakersListChanged').data.length; i++) await sleep(50);
      assert.equal(cache.get('dcnm.ControlSpeaker.SpeakersListChanged').data[0].SpeakerId, GUID);
    } finally {
      await backend.close();
      await wired.close();
    }
  });
});
