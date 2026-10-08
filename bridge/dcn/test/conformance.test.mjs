// Protocol conformance of the real C# dcn-bridge (WO-061), run in --fake mode on a modern .NET runtime:
// the same reflection, conversion and protocol code that hosts the Bosch DLLs on Windows, driven by DcnClient and the backend.
// Run: npm run bridge:test   (needs the .NET SDK; DCN_BRIDGE_TFM=net10.0 by default, DCN_BRIDGE_NO_BUILD=1 to skip the build)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { DcnClient } from '../../../backend/src/dcn/client.js';
import { loadDcnSpec } from '../../../backend/src/dcn/spec.js';
import { startBackend } from '../../../backend/test/helpers/start.js';

const DIR = fileURLToPath(new URL('..', import.meta.url));
const TFM = process.env.DCN_BRIDGE_TFM ?? 'net10.0';
const TOKEN = 'conformance-token';
const spec = loadDcnSpec();
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

let dotnet = true;
try { execFileSync('dotnet', ['--version'], { stdio: 'ignore' }); } catch { dotnet = false; }

let bridge;
let port;

/** Start the built bridge in --fake mode on a free port; resolves with { proc, port, output }. */
async function startBridge(extraArgs) {
  const proc = spawn('dotnet', [`bin/Release/${TFM}/dcn-bridge.dll`, '--fake', '--listen', '127.0.0.1', '--port', '0', ...extraArgs], { cwd: DIR });
  const out = [];
  proc.stderr.on('data', d => out.push(String(d)));
  const p = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`bridge did not start:\n${out.join('')}`)), 20_000);
    proc.stdout.on('data', d => {
      out.push(String(d));
      const m = /READY port=(\d+)/.exec(out.join(''));
      if (m) { clearTimeout(t); resolve(Number(m[1])); }
    });
    proc.once('exit', code => reject(new Error(`bridge exited (${code}):\n${out.join('')}`)));
  });
  return { proc, port: p, output: out };
}
const client = extra => new DcnClient({ host: '127.0.0.1', port, token: TOKEN, user: 'admin', password: 'admin', heartbeatMs: 0, reconnect: { enabled: false }, log: quiet, ...extra });
const nextEvent = (c, name) => new Promise(resolve => {
  const on = e => { if (e.event === name) { c.off('event', on); resolve(e); } };
  c.on('event', on);
});

describe('dcn-bridge --fake (C#)', { skip: !dotnet && 'dotnet not installed' }, () => {
  before(async () => {
    if (process.env.DCN_BRIDGE_NO_BUILD !== '1') {
      execFileSync('dotnet', ['build', '-c', 'Release', `-p:DevTfm=${TFM}`, '-f', TFM, '--nologo', '-v', 'q'], { cwd: DIR, stdio: 'inherit' });
    }
    ({ proc: bridge, port } = await startBridge(['--token', TOKEN]));
  });
  after(async () => {
    if (bridge && bridge.exitCode === null) { bridge.kill(); await once(bridge, 'exit'); }
  });

  test('without --token the bridge starts, warns and accepts a client without a token (DEC-019)', async () => {
    const open = await startBridge([]);
    try {
      assert.match(open.output.join(''), /WARN .*no token/);
      const c = client({ port: open.port, token: '' });
      await c.connect();
      assert.equal(c.state, 'loggedIn');
      await c.close();
    } finally {
      open.proc.kill();
      await once(open.proc, 'exit');
    }
  });

  test('handshake: wrong token, wrong DCN-SW credentials, hello contents', async () => {
    await assert.rejects(client({ token: 'nope' }).connect(), e => e.code === 'UPSTREAM_AUTH' && e.extra.reason === 'badToken');
    await assert.rejects(client({ password: 'x' }).connect(), e => e.code === 'UPSTREAM_AUTH' && e.extra.apiError === 'NO_AUTHORIZATION');
    const c = client();
    await c.connect();
    assert.equal(c.state, 'loggedIn');
    assert.equal(c.bridgeInfo.name, 'dcn-bridge');
    assert.equal(c.bridgeInfo.fake, true);
    assert.equal(c.constants['SEAT_ASSIGNMENT.DEFAULT_AREA'], 1);
    assert.equal(c.bridgeStatus.control.allowed['DiscussionApi.IsDiscussStandardViewAllowed'], true);
    assert.equal(c.bridgeStatus.config.allowed.IsConfigAllowed, true);
    await c.close();
  });

  test('primitives, out parameters, events from API threads', async () => {
    const c = client();
    await c.connect();
    assert.deepEqual(await c.request('control.DcnSystemApi.GetMasterVolume'), { masterVolume: 15 });
    const ev = nextEvent(c, 'masterVolumeChange');
    await c.request('control.DcnSystemApi.SetMasterVolume', { masterVolume: 20 });
    assert.deepEqual((await ev).args, { Count: 20, ConfigId: 0, ServiceId: 0 }); // inherited ControlEventArgs members (real hierarchy, WO-068)
    assert.equal((await ev).api, 'control.DcnSystemApi');
    assert.equal((await c.call('control.DcnSystemApi', 'SetMasterVolume', { masterVolume: 99 })).returns, 'OUT_OF_RANGE');
    const mute = nextEvent(c, 'masterMuteChange');
    await c.request('control.DcnSystemApi.SetMasterMute', { masterMute: true });
    assert.deepEqual((await mute).args, { OnOff: true, ConfigId: 0, ServiceId: 0 });
    assert.deepEqual(await c.request('control.DcnSystemApi.GetMasterMute'), { masterMute: true });
    await c.close();
  });

  test('struct arrays, enums by name, class round trip, KeyValuePair', async () => {
    const c = client();
    await c.connect();
    const micOn = nextEvent(c, 'MicOn');
    await c.request('control.DiscussionApi.SpeakNow', { participantId: 0, seatId: 3 });
    const e = await micOn;
    assert.equal(e.args.ParticiantInfo[0].SeatId, 3);
    const { participants } = await c.request('control.DiscussionApi.RetrieveSpeakersList');
    assert.deepEqual(Object.keys(participants[0]).sort(), spec.members('PARTICIPANT').map(m => m.name).sort());
    assert.equal(participants[0].SpeechTimeLimitInMillis, 120000);
    assert.deepEqual((await c.request('control.DiscussionApi.RetrieveMicrophoneStatus')).seatMicStatus, [{ MicStatus: 'ON', SeatId: 3 }]);

    const { discussionInfo } = await c.request('control.DiscussionApi.RetrieveDiscussionSettings');
    assert.equal(discussionInfo.NumberOfOpenMicrophones, 4);
    const upd = nextEvent(c, 'DiscussionSettingsUpdate');
    await c.request('control.DiscussionApi.SetDiscussionSettings', { discussionInfo: { ...discussionInfo, NumberOfOpenMicrophones: 6 } });
    assert.deepEqual((await upd).args.DiscussionInfo, { Key: 'NumberOfOpenMicrophones', Value: '6' });
    assert.equal((await c.request('control.DiscussionApi.RetrieveDiscussionSettings')).discussionInfo.NumberOfOpenMicrophones, 6);

    const start = nextEvent(c, 'VotingStart');
    await c.request('control.VoteApi.StartAdhocVoting', { votingSettings: { AnswerSet: 'ParliamentaryYesNo', Subject: 'Break?' } });
    assert.deepEqual((await start).args, { ConfigId: 9000, ServiceId: 0 });
    await c.request('control.VoteApi.StartAdhocVoting', { votingSettings: { AnswerSet: 2 } }); // enum by number
    assert.equal((await c.call('control.VoteApi', 'StartAdhocVoting', { votingSettings: {} })).returns, 'INVALID_PARAMETER');

    const { delegates, delegateIds } = await c.request('config.DelegateApi.RetrieveDelegates');
    assert.deepEqual(delegateIds, [101, 102]);
    assert.equal(delegates[0].FirstName, 'Anna');
    assert.equal(delegates[0].DEFAULT_PINCODE, undefined, 'constants are not serialised as data');
    const area = c.constants['SEAT_ASSIGNMENT.DEFAULT_AREA'];
    assert.equal((await c.request('config.DelegateApi.RetrieveSeatAssignmentForArea', { meetingId: 1, areaId: area })).assignments[0].SeatName, 'Chairman');
    await c.close();
  });

  test('BAD_ARGS, UNKNOWN_METHOD, NOT_INITIALIZED, EXCEPTION', async () => {
    const c = client();
    await c.connect();
    const bad = async (api, method, args, re) => {
      await assert.rejects(c.call(api, method, args), e => e.code === 'VALIDATION' && re.test(e.message), `${method} ${JSON.stringify(args)}`);
    };
    await bad('control.DiscussionApi', 'SpeakNow', { seatId: 1 }, /participantId: missing/);
    await bad('control.DiscussionApi', 'SpeakNow', { participantId: 0, seatId: 1, x: 1 }, /x: unknown parameter/);
    await bad('control.DiscussionApi', 'SpeakNow', { participantId: 'a', seatId: 1 }, /expected a number/);
    await bad('control.DiscussionApi', 'SpeakNow', { participantId: 2 ** 40, seatId: 1 }, /does not fit/);
    await bad('control.DiscussionApi', 'RetrieveSpeakersList', { participants: [] }, /unknown parameter/); // out params are not inputs
    await bad('control.VoteApi', 'StartAdhocVoting', { votingSettings: { AnswerSet: 'Maybe' } }, /not a member of VotingAnswerSetType/);
    await bad('control.DiscussionApi', 'SetDiscussionSettings', { discussionInfo: { Nope: 1 } }, /unknown or read-only member/);
    await bad('control.DiscussionApi', 'Nope', {}, /no method/);
    await bad('control.NopeApi', 'X', {}, /no interface/);
    await assert.rejects(c.call('config.MeetingApi', 'UpdateMeetingTitle', { meetingId: 1, newMeetingTitle: null }),
      e => e.code === 'UPSTREAM_ERROR' && e.extra.bridgeError === 'EXCEPTION' && /ArgumentNullException/.test(e.message));
    await c.close(); // sends disconnect → Terminate
    const d = client({ roots: ['control'] });
    await d.connect();
    await assert.rejects(d.call('config.MeetingApi', 'RetrieveMeetings'), e => e.extra?.bridgeError === 'NOT_INITIALIZED');
    await d.close();
  });

  test('every documented method can be invoked through reflection', async () => {
    const c = client();
    await c.connect();
    const sample = type => {
      if (type.endsWith('[]')) return [sample(type.slice(0, -2))];
      if (['int', 'long', 'short', 'byte'].includes(type)) return 1;
      if (type === 'bool') return false;
      if (type === 'string') return 'x';
      const t = spec.types[type];
      if (t?.kind === 'enum') return t.values.at(-1).name;
      return {};
    };
    const failures = [];
    for (const m of spec.list()) {
      const args = Object.fromEntries(m.inParams.map(p => [p.name, sample(p.type)]));
      try {
        const r = await c.call(m.api, m.name, args);
        for (const p of m.outParams) if (!(p.name in r.out)) failures.push(`${m.key}: out ${p.name} missing`);
      } catch (err) { failures.push(`${m.key}: ${err.message}`); }
    }
    assert.deepEqual(failures, []);
    await c.close();
  });

  test('a second client replaces the first', async () => {
    const a = client();
    await a.connect();
    const gone = new Promise(resolve => a.on('state', s => s === 'disconnected' && resolve()));
    const b = client();
    await b.connect();
    await gone;
    assert.equal(a.lastError?.extra?.reason, 'replaced');
    await b.close();
  });

  test('the backend runs against the real bridge', async () => {
    const backend = await startBackend({
      DICENTIS_SYSTEM: 'dcn', DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin',
      DICENTIS_BRIDGE_TOKEN: TOKEN, DICENTIS_AUTOCONNECT: 'true',
    });
    try {
      const { manager, dcnEvents, cache } = backend.services;
      if (manager.client?.state !== 'loggedIn') await once(manager.client, 'loggedIn');
      await dcnEvents.idle();
      assert.deepEqual(cache.get('dcnActiveMeeting').data, { meetingId: 1 });
      assert.equal(cache.get('dcnSeatAssignments').data[0].SeatName, 'Chairman'); // DEFAULT_AREA from the bridge's constants
      assert.deepEqual(cache.get('dcnActiveVoting').data, { votingId: null }); // NOT_ACTIVE → inactive value
      const unavailable = [...cache.unavailable.keys()].filter(t => t.startsWith('dcn'));
      assert.deepEqual(unavailable, []);
      const res = await fetch(`${backend.url}/api/dcn/ops/control.DcnSystemApi/SetMasterVolume`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ masterVolume: 7 }),
      });
      assert.equal(res.status, 200);
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('no masterVolume update')), 3000);
        const check = () => { if (cache.get('dcnMasterVolume')?.data?.volume === 7) { clearTimeout(t); cache.off('change', check); resolve(); } };
        cache.on('change', check);
        check();
      });
    } finally {
      await backend.close();
    }
  });
});
