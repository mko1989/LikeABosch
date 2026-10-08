#!/usr/bin/env node
// End-to-end test of the whole wired API against a real DICENTIS server (WO-032).
// Runs THROUGH OUR BACKEND: calls go via the HTTP passthrough (/api/wired/ops/*) and the domain API (/api/domain/*);
// effects are verified via the live state cache (/api/state/*), i.e. through DICENTIS events → event bridge → cache.
// Only probes of alternative request forms use the raw client. It CHANGES STATE (power, meeting, files, plugins …)
// and restores what it can at the end. Use only on a system you may modify (dev server).
//
// Usage: DICENTIS_HOST=… DICENTIS_USER=… DICENTIS_PASSWORD=… node scripts/e2e-wired.mjs [--out report.md] [--keep-power]
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { once } from 'node:events';
import { start } from '../backend/src/server.js';
import { loadConfig } from '../backend/src/config.js';
import { validateValue } from '../backend/src/wired/spec.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : fallback; };
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = arg('--out', `data/e2e-wired-${stamp}.md`);
const keepPower = process.argv.includes('--keep-power');
const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.error('E2E: hard timeout (20 min)'); process.exit(3); }, 20 * 60_000).unref();

// ---------------------------------------------------------------- backend in-process
const dataDir = mkdtempSync(join(tmpdir(), 'e2e-wired-'));
const backend = await start(loadConfig({ ...process.env, PORT: '0', LOG_LEVEL: process.env.E2E_LOG ?? 'warn', DATA_DIR: dataDir, DICENTIS_AUTOCONNECT: 'true' }));
const { manager, bridge, spec } = backend.services;
if (!manager.client) { console.error('Set DICENTIS_HOST and DICENTIS_USER'); process.exit(2); }
if (manager.client.state !== 'loggedIn') await once(manager.client, 'loggedIn');
await bridge.idle();
const raw = manager.client;
const events = [];
raw.on('event', names => names.forEach(n => events.push({ name: n, at: Date.now() })));

// ---------------------------------------------------------------- recording
/** @type {{ area: string, op: string, params: unknown, outcome: string, detail: string }[]} */
const calls = [];
/** @type {{ area: string, name: string, ok: boolean, detail: string }[]} */
const checks = [];
let area = 'setup';
const DENIED = /no permission|permission/i;

async function http(method, path, body) {
  const res = await fetch(`${backend.url}/api${path}`, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

/**
 * Call an operation through the backend passthrough and record it.
 * @returns {Promise<{ ok: boolean, data?: any, error?: string }>}
 */
async function op(name, params = {}, { viaRaw = false } = {}) {
  let result;
  if (viaRaw) {
    try { result = { ok: true, data: await raw.request(name, params) }; } catch (e) { result = { ok: false, error: e.extra?.upstream ?? e.message }; }
  } else {
    const body = await http('POST', `/wired/ops/${name}`, params);
    result = body.ok ? { ok: true, data: body.data } : { ok: false, error: body.error.upstream ?? [body.error.message, ...(body.error.details ?? [])].join('; ') };
  }
  let outcome = result.ok ? 'ok' : DENIED.test(result.error) ? 'denied' : 'error';
  let detail = result.ok ? JSON.stringify(result.data) : result.error;
  if (result.ok) {
    const def = spec.get(name);
    const dev = def ? validateValue(def.response, result.data).map(p => `${p.path}: ${p.problem === 'unknown-field' ? 'not in spec' : `expected ${p.expected}`}`) : [];
    if (dev.length) { outcome = 'ok*'; detail = `${detail} ⟶ spec deviations: ${dev.slice(0, 4).join('; ')}`; }
  }
  calls.push({ area, op: def(name), params, outcome, detail: String(detail).slice(0, 400) });
  return result;
}
const def = name => spec.get(name)?.operation ?? name;

/** Domain API call (records as `domain:<path>`). */
async function domain(method, path, body) {
  const res = await http(method, `/domain${path}`, body);
  calls.push({ area, op: `domain ${method} ${path}`, params: body ?? {}, outcome: res.ok ? 'ok' : 'error', detail: res.ok ? '' : res.error.message });
  return res;
}

async function stateEntry(topic) {
  const res = await http('GET', `/state/${topic}`);
  return res.ok ? res.data : undefined;
}
async function state(topic) { return (await stateEntry(topic))?.data; }

/**
 * Wait until a cached topic satisfies `pred` (proves event → bridge → cache).
 * `since`: only accept a value cached after this time (the server processes commands asynchronously).
 */
async function waitState(topic, pred, timeoutMs = 15_000, { since = 0 } = {}) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    const entry = await stateEntry(topic);
    last = entry?.data;
    const fresh = !since || (entry && Date.parse(entry.updatedAt) >= since);
    try { if (last !== undefined && fresh && pred(last)) return last; } catch { /* keep waiting */ }
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${topic}; last = ${JSON.stringify(last)?.slice(0, 300)}`);
}

// Notifications from the bridge (plugin queues, access denied) — in-process listener.
const notifications = [];
bridge.on('notification', n => notifications.push({ ...n, at: Date.now() }));

async function check(name, fn) {
  try {
    const detail = await fn();
    checks.push({ area, name, ok: true, detail: detail ?? '' });
    console.log(`  ✔ ${area}: ${name}`);
  } catch (e) {
    checks.push({ area, name, ok: false, detail: e.message });
    console.log(`  ✖ ${area}: ${name}: ${e.message}`);
  }
}
const expectOk = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.error}`); return r.data; };
// Operations newer than the server (spec `since`, WO-044): "unknown operation" means not supported, not a failure.
const UNKNOWN_OP = /is an unknown operation/i;
const newerOp = (r, name) => (!r.ok && UNKNOWN_OP.test(r.error) ? `${name}: not supported by this server (spec: since ${spec.get(name)?.since ?? '?'})` : null);
const sinceEvents = t => events.filter(e => e.at >= t).map(e => e.name);

// ---------------------------------------------------------------- restore list (LIFO)
const restore = [];

// ================================================================= tests
const perms = (await state('permissions'))?.permissions ?? [];
const can = p => perms.includes(p);
console.log(`Connected to ${manager.settings.host} as ${manager.settings.user}; ${perms.length} permissions`);

area = 'session';
await check('API state, permissions, room', async () => {
  expectOk(await op('GetApiState'), 'GetApiState');
  expectOk(await op('GetPermissions'), 'GetPermissions');
  await op('GetRoomName'); await op('GetRoomContactEmail'); await op('GetImageServerInfo');
  calls.push({ area, op: 'Login', params: { user: manager.settings.user }, outcome: 'ok', detail: 'session login by the backend' });
});
await check('UnregisterEvents / RegisterEvents (managed, raw)', async () => {
  expectOk(await op('UnregisterEvents', { events: ['roomNameChanged'] }, { viaRaw: true }), 'UnregisterEvents');
  expectOk(await op('RegisterEvents', { events: ['roomNameChanged', 'RoomContactEmailChanged'] }, { viaRaw: true }), 'RegisterEvents (mixed casing)');
  return 'event names are case-insensitive';
});
await check('7.0 event list: all events accepted, optional ones registered separately', async () => {
  const all = String(spec.get('RegisterEvents').request.events[0]).slice(5).split('|');
  expectOk(await op('RegisterEvents', { events: all }, { viaRaw: true }), `RegisterEvents (${all.length} events)`);
  const optional = spec.eventMap.events.filter(e => e.optional).map(e => e.event);
  const bogus = await op('RegisterEvents', { events: ['noSuchEventE2e'] }, { viaRaw: true });
  if (bogus.ok) throw new Error('an unknown event name was accepted');
  return `${all.length} events in one call; optional (separate): ${optional.join(', ')}; unknown name → ${bogus.error}`;
});
await check('managed operations are blocked on the passthrough', async () => {
  const r = await http('POST', '/wired/ops/Login', {});
  if (r.error?.code !== 'MANAGED_BY_BACKEND') throw new Error(JSON.stringify(r));
});

// ---- power
area = 'power';
const initialPower = (await state('systemPowerMode'))?.powerMode;
const powerTo = async (mode, viaDomain = false) => {
  const t = Date.now();
  if (viaDomain) { const r = await domain('PUT', '/power', { state: mode === 'poweredOn' ? 'on' : 'off' }); if (!r.ok) throw new Error(r.error.message); }
  else expectOk(await op('SetSystemPowerMode', { powerMode: mode }), `SetSystemPowerMode ${mode}`);
  const seen = new Set();
  await waitState('systemPowerMode', d => { seen.add(d.powerMode); return d.powerMode === mode; }, 300_000);
  return `${mode} after ${Math.round((Date.now() - t) / 1000)} s (states seen: ${[...seen].join(' → ')})`;
};
await check(`power cycle (initial: ${initialPower})`, async () => {
  const out = [];
  if (initialPower === 'poweredOn') out.push(await powerTo('poweredOff', true));
  out.push(await powerTo('poweredOn'));
  if (!keepPower && initialPower !== 'poweredOn') restore.push(['power off', () => op('SetSystemPowerMode', { powerMode: initialPower ?? 'poweredOff' })]);
  return out.join(' | ');
});
await op('GetSystemPowerMode');
await check('domain power topic follows', async () => { await waitState('domain.power', d => d.state === 'on'); });
await sleep(5000); // let devices connect

// ---- seats & discussion
area = 'discussion';
const seats = expectOk(await op('GetSeats'), 'GetSeats').seats;
const seat = seats.find(s => s.status === 'connected' && !s.hideSeat && s.supportsSpeaking)
  ?? seats.find(s => s.status === 'connected' && !s.hideSeat) ?? seats.find(s => s.status === 'connected');
const seat2 = seats.find(s => s.status === 'connected' && s !== seat && s.seatId !== seat?.seatId);
console.log(`  test seats: ${seat?.seatName} (${seat?.seatId}), ${seat2?.seatName}`);
await op('GetDiscussionOptions'); await op('GetSpeechTimerOptions'); await op('GetDiscussionList');
await op('GetParticipantSeats'); await op('GetParticipants'); await op('GetParticipantAccessDeniedReasons');
if (seat) {
  const inList = d => d.discussionList.some(e => e.seatId === seat.seatId);
  await check('AddSeatToSpeakers → discussionList (via events)', async () => {
    const t = Date.now();
    expectOk(await op('AddSeatToSpeakers', { seatId: seat.seatId }), 'AddSeatToSpeakers');
    const d = await waitState('discussionList', inList, 15_000, { since: t });
    return JSON.stringify(d.discussionList.find(e => e.seatId === seat.seatId));
  });
  await check('speech time adjust (6.50)', async () => {
    const r1 = await op('IncreaseSpeechTime', { seatId: seat.seatId });
    const r2 = await op('DecreaseSpeechTime', { seatId: seat.seatId });
    const r3 = await op('ResetSpeechTime', { seatId: seat.seatId });
    return [r1, r2, r3].map(r => (r.ok ? JSON.stringify(r.data) : r.error)).join(' | ');
  });
  await check('Deactivate/ActivateMicrophone (PDF form {seatId})', async () => {
    const a = await op('DeactivateMicrophone', { seatId: seat.seatId });
    const b = await op('ActivateMicrophone', { seatId: seat.seatId });
    return `deactivate: ${a.ok ? 'ok' : a.error} | activate: ${b.ok ? 'ok' : b.error}`;
  });
  await check('Deactivate/ActivateMicrophone (6.50 form {seatIds:[]}, raw probe)', async () => {
    const a = await op('DeactivateMicrophone', { seatIds: [seat.seatId] }, { viaRaw: true });
    const b = await op('ActivateMicrophone', { seatIds: [seat.seatId] }, { viaRaw: true });
    return `deactivate: ${a.ok ? 'ok' : a.error} | activate: ${b.ok ? 'ok' : b.error}`;
  });
  await check('RemoveSeatFromDiscussionList → removed', async () => {
    const t = Date.now();
    expectOk(await op('RemoveSeatFromDiscussionList', { seatId: seat.seatId }), 'RemoveSeatFromDiscussionList');
    await waitState('discussionList', d => !inList(d), 15_000, { since: t });
  });
  await check('RequestSpeech → listed; GrantSpeech → speaker; RemoveSpeech → gone (6.50)', async () => {
    let t = Date.now();
    expectOk(await op('RequestSpeech', { seatIds: [seat.seatId] }), 'RequestSpeech');
    const req = await waitState('discussionList', inList, 15_000, { since: t });
    const t1 = req.discussionList.find(e => e.seatId === seat.seatId).speakerType;
    expectOk(await op('GrantSpeech', { seatIds: [seat.seatId] }), 'GrantSpeech');
    const g = await waitState('discussionList', d => d.discussionList.some(e => e.seatId === seat.seatId && e.speakerType === 'isSpeaker'));
    const t2 = g.discussionList.find(e => e.seatId === seat.seatId).speakerType;
    t = Date.now();
    expectOk(await op('RemoveSpeech', { seatIds: [seat.seatId] }), 'RemoveSpeech');
    await waitState('discussionList', d => !inList(d), 15_000, { since: t });
    return `after RequestSpeech: ${t1} (discussion mode ${(await state('discussionOptions'))?.discussionMode}), after GrantSpeech: ${t2}`;
  });
  await check('RequestResponse / GrantResponse / RemoveResponse (6.50)', async () => {
    const out = [];
    for (const name of ['RequestResponse', 'GrantResponse', 'RemoveResponse']) {
      const r = await op(name, { seatIds: [seat.seatId] });
      await sleep(500);
      const d = await state('discussionList');
      out.push(`${name}: ${r.ok ? 'ok' : r.error} → ${JSON.stringify(d?.discussionList?.map(e => [e.seatName ?? e.seatId, e.speakerType]))}`);
    }
    await op('RemoveSeatFromDiscussionList', { seatId: seat.seatId });
    return out.join(' | ');
  });
  await check('domain discussion API end to end (add, speech time ±, remove)', async () => {
    let t = Date.now();
    const r = await domain('POST', '/discussion/speakers', { seatId: seat.seatId });
    if (!r.ok) throw new Error(r.error.message);
    await waitState('domain.discussion', d => d.speakers.some(s => s.seatId === seat.seatId), 15_000, { since: t });
    const id = encodeURIComponent(seat.seatId);
    for (const action of ['increase', 'decrease', 'reset']) {
      const x = await domain('POST', `/discussion/speakers/${id}/time/${action}`);
      if (!x.ok) throw new Error(`time ${action}: ${x.error.message}`);
    }
    t = Date.now();
    const del = await domain('DELETE', `/discussion/speakers/${id}`);
    if (!del.ok) throw new Error(del.error.message);
    await waitState('domain.discussion', d => !d.speakers.some(s => s.seatId === seat.seatId), 15_000, { since: t });
  });
  if (seat2) {
    await check('two speakers + priority/kind mapping in the domain topic', async () => {
      const t = Date.now();
      await op('AddSeatToSpeakers', { seatId: seat.seatId });
      await op('AddSeatToSpeakers', { seatId: seat2.seatId });
      const d = await waitState('domain.discussion', x => x.speakers.length >= 2, 15_000, { since: t });
      await op('RemoveSeatFromDiscussionList', { seatId: seat.seatId });
      await op('RemoveSeatFromDiscussionList', { seatId: seat2.seatId });
      await waitState('domain.discussion', x => !x.speakers.some(s => s.seatId === seat.seatId || s.seatId === seat2.seatId), 15_000);
      return JSON.stringify(d.speakers.map(s => [s.seatName, s.kind, s.micState, s.timer ? 'timer' : '-']));
    });
  }
}

// ---- microphone sensitivity (6.50)
area = 'microphone sensitivity';
if (seat) {
  await check('Get/Update/Reset microphone sensitivity', async () => {
    const desc = expectOk(await op('GetMicrophoneSensitivityDescription'), 'description').micSensitivityDescription;
    const v0 = expectOk(await op('GetMicrophoneSensitivity', { seatIds: [seat.seatId] }), 'get').seatMicrophoneSensitivities[0].sensitivityValue;
    const target = Math.min(desc.maximumMicrophoneSensitivity, v0 + desc.microphoneSensitivityStepSize * 2);
    const u = expectOk(await op('UpdateMicrophoneSensitivity', { seatMicrophoneSensitivity: [{ seatId: seat.seatId, sensitivityValue: target }] }), 'update');
    const v1 = expectOk(await op('GetMicrophoneSensitivity', { seatIds: [seat.seatId] }), 'get').seatMicrophoneSensitivities[0].sensitivityValue;
    const r = expectOk(await op('ResetMicrophoneSensitivity', { seatIds: [seat.seatId] }), 'reset');
    const v2 = expectOk(await op('GetMicrophoneSensitivity', { seatIds: [seat.seatId] }), 'get').seatMicrophoneSensitivities[0].sensitivityValue;
    await op('UpdateMicrophoneSensitivity', { seatMicrophoneSensitivity: [{ seatId: seat.seatId, sensitivityValue: v0 }] });
    const trace = `${v0} → update ${JSON.stringify(u)} → ${v1} → reset ${JSON.stringify(r)} → ${v2} → restored ${v0}`;
    if (u.status === false) return `API verified; the device rejects the change (status:false, supportsSpeaking:${seat.supportsSpeaking}): ${trace}`;
    if (v1 !== target) throw new Error(`update reported ok but not applied: ${trace}`);
    return trace;
  });
  await check('microphoneSensitivity topic: every seat (seatIds []), refreshed by seatMicrophoneSensitivityUpdated', async () => {
    const seatCount = (await state('seats'))?.seats?.length;
    const all = await waitState('microphoneSensitivity', d => d.seatMicrophoneSensitivities.length === seatCount);
    const t0 = Date.now();
    const u = expectOk(await op('UpdateMicrophoneSensitivity', { seatMicrophoneSensitivity: [{ seatId: seat.seatId, sensitivityValue: 0.5 }] }), 'update');
    if (u.status === false) return `${all.seatMicrophoneSensitivities.length} seats cached; the device rejects changes (status:false), so the event cannot be triggered here`;
    await waitState('microphoneSensitivity', d => d.seatMicrophoneSensitivities.find(x => x.seatId === seat.seatId)?.sensitivityValue === 0.5, 15_000, { since: t0 });
    expectOk(await op('ResetMicrophoneSensitivity', { seatIds: [seat.seatId] }), 'reset');
    return `${all.seatMicrophoneSensitivities.length} seats cached; update → event → topic refreshed (${sinceEvents(t0).join(', ')})`;
  });
}

// ---- master volume
area = 'master volume';
await check('SetMasterVolume → masterVolume topic (dB)', async () => {
  const range = expectOk(await op('GetMasterVolumeRange'), 'range').range;
  const v0 = expectOk(await op('GetMasterVolume'), 'get').volume;
  const target = v0 - 1.5 >= range.minimumVolume ? v0 - 1.5 : v0 + 1.5;
  restore.push(['master volume', () => op('SetMasterVolume', { volume: v0 })]);
  expectOk(await op('SetMasterVolume', { volume: target }), 'set');
  await waitState('masterVolume', d => d.volume === target);
  const bad = await op('SetMasterVolume', { volume: range.maximumVolume + 10 });
  expectOk(await op('SetMasterVolume', { volume: v0 }), 'restore');
  await waitState('masterVolume', d => d.volume === v0);
  return `${v0} → ${target} → ${v0}; out of range: ${bad.ok ? 'accepted (!)' : bad.error}`;
});

// ---- presentation
area = 'presentation';
await check('Activate/DeactivatePresentation → presentationState', async () => {
  const s0 = expectOk(await op('GetPresentationState'), 'get').isPresentationEnabled;
  const a = await op(s0 ? 'DeactivatePresentation' : 'ActivatePresentation');
  if (!a.ok) return `not possible: ${a.error}`;
  await waitState('presentationState', d => d.isPresentationEnabled === !s0);
  expectOk(await op(s0 ? 'ActivatePresentation' : 'DeactivatePresentation'), 'restore');
  await waitState('presentationState', d => d.isPresentationEnabled === s0);
  return `${s0} → ${!s0} → ${s0}`;
});

// ---- seat illumination
area = 'seat illumination';
await check('EnableSeatIllumination / SetIlluminateSeat', async () => {
  const g = await op('GetEnableSeatIllumination');
  const i0 = await op('GetIlluminatedSeat');
  const on = await op('EnableSeatIllumination', { enable: true });
  const s = seat ? await op('SetIlluminateSeat', { seatId: seat.seatId, setIlluminate: true }) : { ok: false, error: 'no seat' };
  const i1 = await op('GetIlluminatedSeat');
  if (seat && s.ok) await op('SetIlluminateSeat', { seatId: seat.seatId, setIlluminate: false });
  const off = await op('EnableSeatIllumination', { enable: false });
  return [g, i0, on, s, i1, off].map(r => (r.ok ? JSON.stringify(r.data) : r.error)).join(' | ');
});

// ---- meeting & agenda
area = 'meeting';
const meetings = expectOk(await op('GetMeetings'), 'GetMeetings').meetings;
const info0 = (await op('GetMeetingInfo')).data?.meetingInfo;
await op('GetAgendaTopics'); await op('GetVotings');
if (info0) {
  const id = info0.meetingId;
  await check(`meeting lifecycle on "${info0.title}" (initial ${info0.state}): close → Default → activate → opened`, async () => {
    const out = [];
    let t = Date.now();
    expectOk(await op('CloseMeeting'), 'CloseMeeting');
    const d1 = await waitState('meetingInfo', x => x.meetingInfo.meetingId !== id, 20_000, { since: t });
    const l1 = await waitState('meetings', x => x.meetings.find(m => m.meetingId === id)?.state === 'deactivated', 20_000);
    out.push(`CloseMeeting → active "${d1.meetingInfo.title}" (${d1.meetingInfo.state}), "${info0.title}" ${l1.meetings.find(m => m.meetingId === id).state}`);
    const o = await op('OpenMeeting'); out.push(`OpenMeeting on built-in: ${o.ok ? 'ok' : o.error}`);
    const c = await op('CloseMeeting'); out.push(`CloseMeeting on built-in: ${c.ok ? 'ok' : c.error}`);
    const dm = await op('DeactivateMeeting'); out.push(`DeactivateMeeting on built-in: ${dm.ok ? 'ok' : dm.error}`);
    t = Date.now();
    expectOk(await op('ActivateMeeting', { meetingId: id }), 'ActivateMeeting');
    const d2 = await waitState('meetingInfo', x => x.meetingInfo.meetingId === id, 20_000, { since: t });
    if (d2.meetingInfo.state !== 'opened') { await op('OpenMeeting'); }
    const d3 = await waitState('meetingInfo', x => x.meetingInfo.meetingId === id && x.meetingInfo.state === 'opened', 20_000);
    out.push(`ActivateMeeting → ${d2.meetingInfo.state} (autoOpenOnActivate ${info0.autoOpenOnActivate}) → ${d3.meetingInfo.state}`);
    const dom = await state('domain.capabilities');
    out.push(`capabilities still ${dom?.system}`);
    return out.join(' | ');
  });
  await check('meetingInfo topic reflects the meeting after the lifecycle', async () => {
    const d = await waitState('meetingInfo', x => x.meetingInfo?.meetingId === id && x.meetingInfo.state === info0.state, 20_000);
    return d.meetingInfo.state;
  });
  await check('agenda (no topics prepared → errors expected)', async () => {
    const o = await op('OpenAgenda', { agendaTopicId: '00000000-0000-0000-0000-000000000000' });
    const c = await op('CloseAgenda');
    return `OpenAgenda: ${o.ok ? 'ok' : o.error} | CloseAgenda: ${c.ok ? 'ok' : c.error}`;
  });
}
console.log(`  meetings: ${meetings.map(m => `${m.title} (${m.state})`).join(', ')}`);

// ---- voting
area = 'voting';
await check('voting operations (account permissions decide)', async () => {
  const out = [];
  for (const [name, params] of [
    ['GetVotingState', {}], ['GetVotingInfo', {}], ['GetVotingResults', {}], ['GetSeatVotingResults', {}], ['GetIndividualVotingResults', {}],
    ['GetMajorityResult', {}], ['GetQuorumResult', {}], ['GetRemainingVoteTime', {}],
    ['ActivateAdHocVoting', { subject: 'E2E test', number: 'E2E-1', description: 'automated test' }],
    ['OpenVoting', {}], ['HoldVoting', {}], ['ResumeVoting', {}], ['CloseVoting', {}], ['AcceptVoting', {}], ['RejectVoting', {}], ['AbortVoting', {}],
    ['ActivateVoting', { votingId: '00000000-0000-0000-0000-000000000000' }],
  ]) {
    const r = await op(name, params);
    out.push(`${name}: ${r.ok ? 'ok' : r.error}`);
  }
  return out.join(' | ');
});

// ---- interpretation
area = 'interpretation';
const langs = (await op('GetInterpretationLanguages')).data?.languages ?? [];
const booths = (await op('GetInterpreterBooths')).data?.booths ?? [];
const desks = (await op('GetInterpreterSeats')).data?.seats ?? [];
await op('GetInterpretationRoutings'); await op('GetBoothNotifications'); await op('GetInterpretationMetaFunctionStatus'); await op('GetSupportedHeadphones');
const desk = desks.find(d => d.status !== 'disconnected') ?? desks[0];
if (booths[0]) {
  await check('RaiseBoothNotification values', async () => {
    const out = [];
    for (const value of ['PhoneCall', 'Alarm', 'phoneCall', 'alarm']) {
      const r = await op('RaiseBoothNotification', { boothId: booths[0].boothId, notification: value });
      out.push(`${value}: ${r.ok ? 'ok' : r.error}`);
    }
    await sleep(800);
    out.push(`notifications: ${JSON.stringify((await state('boothNotifications'))?.notifications)}`);
    return out.join(' | ');
  });
}
if (desk) {
  await check(`interpreter desk controls on desk ${desk.deskNumber} (${desk.status})`, async () => {
    const out = [];
    for (const [name, params] of [
      ['IssueInterpreterMetaFunction', { seatId: desk.seatId, request: 'speakSlow' }],
      ['CancelInterpreterMetaFunction', { seatId: desk.seatId, request: 'speakSlow' }],
      ['GrantInterpretation', { seatId: desk.seatId, microphoneState: 'activeOnOutputA' }],
      ['GrantInterpretation', { seatId: desk.seatId, microphoneState: 'off' }],
      ['SelectInterpretationFloor', { seatId: desk.seatId }],
      ['SelectRelayInterpretation', { seatId: desk.seatId }],
      ['SelectInterpretationInputLanguage', { seatId: desk.seatId, inputButton: 'inputPresetA', languageId: langs[0]?.languageId ?? '' }],
      ['SetInterpretationOutputPreset', { seatId: desk.seatId, outputButton: 'outputPresetB', languageId: desk.bLanguageId || langs[0]?.languageId || '' }],
    ]) {
      const r = await op(name, params);
      out.push(`${name}(${params.request ?? params.microphoneState ?? params.inputButton ?? params.outputButton ?? ''}): ${r.ok ? `ok ${JSON.stringify(r.data)}` : r.error}`);
    }
    out.push(`meta status: ${JSON.stringify((await op('GetInterpretationMetaFunctionStatus')).data)}`);
    return out.join(' | ');
  });
}

// ---- files, images, notes
area = 'files';
await check('layout file create → list (event) → load → update → delete', async () => {
  const payload = JSON.stringify({ e2e: true, at: new Date().toISOString() });
  const { fileId } = expectOk(await op('CreateFile', { title: 'E2E test layout', attributes: ['Bosch.Synoptic.Layout'], payload }), 'CreateFile');
  restore.push(['delete test file', () => op('DeleteFile', { fileId })]);
  await waitState('files', d => d.fileInfoList.some(f => f.fileId === fileId));
  const loaded = expectOk(await op('LoadFile', { fileId }), 'LoadFile').fileInfo;
  if (loaded.payload !== payload) throw new Error(`payload mismatch: ${loaded.payload}`);
  expectOk(await op('UpdateFile', { fileId, title: 'E2E test layout (updated)', attributes: ['Bosch.Synoptic.Layout'], payload: '{"updated":true}' }), 'UpdateFile');
  const re = expectOk(await op('LoadFile', { fileId }), 'LoadFile').fileInfo;
  expectOk(await op('DeleteFile', { fileId }), 'DeleteFile');
  restore.pop();
  await waitState('files', d => !d.fileInfoList.some(f => f.fileId === fileId));
  return `fileId ${fileId}; updated title "${re.title}", attributes ${JSON.stringify(re.attributes)}`;
});
await op('ListFiles', { attributes: ['Bosch.Synoptic.Index'] });
await op('ListImages');
await check('image save → list → delete (refreshAfter)', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const s = expectOk(await op('SaveImage', { name: 'e2e-test.png', imageData: png }), 'SaveImage');
  restore.push(['delete test image', () => op('DeleteImage', { imageName: 'e2e-test.png' })]);
  await waitState('images', d => d.images.some(i => i.endsWith('e2e-test.png')));
  expectOk(await op('DeleteImage', { imageName: 'e2e-test.png' }), 'DeleteImage');
  restore.pop();
  await waitState('images', d => !d.images.some(i => i.endsWith('e2e-test.png')));
  return `saveImageUri ${s.saveImageUri}`;
});
await check('ValidateImageFile (7.0 CHM)', async () => {
  const good = await op('ValidateImageFile', { imageData: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', imageExt: '.png' });
  const skip = newerOp(good, 'ValidateImageFile');
  if (skip) return skip;
  const bad = expectOk(await op('ValidateImageFile', { imageData: Buffer.from('not an image').toString('base64'), imageExt: '.png' }), 'invalid image');
  if (expectOk(good, 'valid image').isValidImageFile !== true || bad.isValidImageFile !== false) throw new Error(`png → ${JSON.stringify(good.data)}, text → ${JSON.stringify(bad)}`);
  return 'png → valid, text → invalid';
});
area = 'notes';
await check('notes list / transform / tamper check / delete', async () => {
  const range = { searchDateRange: { startDate: '2000-01-01', endDate: '2100-12-31' } };
  const files = expectOk(await op('GetNotesFileList', range), 'list').fileData;
  // Use the newest file that is at least 10 minutes old: files written seconds ago read as empty/"tampered".
  const settled = [...files].filter(f => Date.now() - Date.parse(f.creationDateTime) > 10 * 60_000);
  const newest = settled.sort((a, b) => b.creationDateTime.localeCompare(a.creationDateTime))[0];
  if (!newest) return 'no settled notes files';
  const t = expectOk(await op('TransformNotesFile', { fileName: newest.fileName }), 'transform');
  const v = expectOk(await op('CheckNotesFileTampered', { fileName: newest.fileName }), 'tamper');
  const d = await op('DeleteNotesFiles', { fileNames: ['does-not-exist-e2e.xml'] });
  // Delete the oldest file (dev server; the user allowed modifications) to prove deletion end to end.
  const oldest = [...files].sort((a, b) => a.creationDateTime.localeCompare(b.creationDateTime))[0];
  const del = await op('DeleteNotesFiles', { fileNames: [oldest.fileName] });
  const after = expectOk(await op('GetNotesFileList', range), 'list').fileData;
  // DICENTIS 6.7+: file info + chunked read.
  const info = await op('GetTransformedNotesFilesInfo', { fileName: newest.fileName });
  const chunk = await op('ReadNotesFile', { fileName: newest.fileName, offset: 0, length: 32 });
  const v67 = newerOp(info, 'GetTransformedNotesFilesInfo') ?? `info ${JSON.stringify(expectOk(info, 'info').notesFileInfo)}; ReadNotesFile → ${JSON.stringify(expectOk(chunk, 'read').FileBytes).slice(0, 80)}`;
  return `${v67}; ${files.length} files; ${newest.fileName}: transform ${t.notesHtml?.length ?? 0} chars of HTML; tamper ${JSON.stringify(v.fileVerificationResponse)}; delete nonexistent → ${JSON.stringify(d.data ?? d.error)}; delete oldest ${oldest.fileName} → ${JSON.stringify(del.data ?? del.error)}, now ${after.length} files`;
});

// ---- plugins
area = 'plugins';
await check('plugin register → subscribe → event → command round trip → unregister', async () => {
  const name = 'plugin://e2e.likeabosch.test:0';
  const out = [];
  const plugins = expectOk(await op('GetPlugins'), 'GetPlugins').plugins;
  if (plugins[0]) await op('GetPlugin', { pluginName: plugins[0] });
  const reg = await op('RegisterPlugin', { pluginName: name, pluginInterface: 'interface://e2e.likeabosch.test/0.1.0', pluginCommands: [{ name: 'PING' }], pluginEvents: [{ name: 'PONG' }] });
  out.push(`register: ${reg.ok ? 'ok' : reg.error}`);
  if (!reg.ok) return out.join(' | ');
  restore.push(['unregister test plugin', () => op('UnRegisterPlugin', { pluginName: name })]);
  await waitState('plugins', d => d.plugins.includes(name));
  out.push(`GetPlugin: ${JSON.stringify((await op('GetPlugin', { pluginName: name })).data)}`);
  out.push(`subscribe: ${(await op('SubscribePluginEvent', { pluginName: name, eventName: 'PONG' })).ok}`);
  const ev = await op('SendPluginEvent', { pluginName: name, event: 'PONG', parameters: '{"hello":"world"}' });
  out.push(`SendPluginEvent: ${ev.ok ? 'ok' : ev.error}`);
  const waitNote = async (topic, from) => {
    const end = Date.now() + 10_000;
    while (Date.now() < end) { const n = notifications.find(x => x.topic === topic && x.at >= from); if (n) return n.data; await sleep(200); }
    return null;
  };
  // The bridge fetches the plugin queues on PluginEventAvailable / PluginCommandAvailable and forwards them as notifications.
  out.push(`event data (via bridge notification): ${JSON.stringify(await waitNote('pluginEventData', Date.now() - 2000))}`);
  await op('GetPluginEventData'); // direct call too (coverage); queue is normally already drained
  // Command round trip: we are both caller and plugin. Send without awaiting, answer it, then await.
  const tCmd = Date.now();
  const sending = op('SendPluginCommand', { pluginName: name, command: 'PING', parameters: '{"n":1}' });
  const batch = await waitNote('pluginCommands', tCmd);
  const cmds = batch?.pluginCommands ?? [];
  out.push(`pending commands (via bridge notification): ${JSON.stringify(cmds)}`);
  await op('GetPluginCommands');
  const cmd = cmds[0];
  const correlationId = cmd && (cmd.correlationId ?? cmd.CorrelationId ?? Object.entries(cmd).find(([k]) => /correlation/i.test(k))?.[1]);
  if (correlationId) out.push(`SetPluginCommandResult: ${(await op('SetPluginCommandResult', { correlationId, result: '{"pong":true}' })).ok}`);
  const sent = await Promise.race([sending, sleep(15_000).then(() => ({ ok: false, error: 'no response within 15 s' }))]);
  out.push(`SendPluginCommand → ${sent.ok ? JSON.stringify(sent.data) : sent.error}`);
  out.push(`unsubscribe: ${(await op('UnSubscribePluginEvent', { pluginName: name, eventName: 'PONG' })).ok}`);
  out.push(`unregister: ${(await op('UnRegisterPlugin', { pluginName: name })).ok}`);
  restore.pop();
  return out.join(' | ');
});

// ---- excluded operations (DEC-007, WO-044): informational probe only
area = 'excluded (DEC-007)';
for (const { operation } of spec.list({ includeExcluded: true }).filter(o => o.excluded)) await op(operation, {}, { viaRaw: true });

// ---------------------------------------------------------------- restore + report
area = 'restore';
for (const [what, fn] of restore.reverse()) {
  const r = await fn();
  console.log(`  restore ${what}: ${r.ok ? 'ok' : r.error}`);
}
if (initialPower && !keepPower && initialPower !== 'poweredOn') {
  await check('power restored', async () => { await waitState('systemPowerMode', d => d.powerMode === initialPower || d.powerMode === 'poweringOff', 120_000); });
}

calls.push({ area: 'session', op: 'Logout', params: {}, outcome: 'ok', detail: 'sent by the backend on shutdown (WiredClient.close)' });
const allOps = spec.list({ includeExcluded: true }).map(o => o.operation);
const byOp = new Map();
for (const c of calls) if (!c.op.startsWith('domain ')) byOp.set(c.op, [...(byOp.get(c.op) ?? []), c.outcome]);
const coverage = allOps.map(o => [o, byOp.get(o) ?? []]);
const uncovered = coverage.filter(([, v]) => !v.length).map(([o]) => o);
const lines = [
  `# DICENTIS wired end-to-end test: ${new Date().toISOString()}`, '',
  `Server \`${manager.settings.host}\`, user \`${manager.settings.user}\`, through backend passthrough + domain API + state cache.`,
  `Initial power: ${initialPower}. Permissions (${perms.length}): ${perms.join(', ')}`, '',
  `## Checks (${checks.filter(c => c.ok).length}/${checks.length} passed)`, '',
  '| Area | Check | Result | Detail |', '|---|---|---|---|',
  ...checks.map(c => `| ${c.area} | ${c.name} | ${c.ok ? '✔' : '✖'} | ${c.detail.replace(/\|/g, '/').slice(0, 900)} |`), '',
  `## Operation coverage (${allOps.length - uncovered.length}/${allOps.length} called)`, '',
  'Outcomes: ok · ok* (spec deviations) · denied (account lacks permission) · error.', '',
  '| Operation | Outcomes |', '|---|---|',
  ...coverage.map(([o, v]) => `| ${o} | ${v.length ? [...new Set(v)].join(', ') : '**not called**'} |`), '',
  '## Call log', '', '| Area | Operation | Params | Outcome | Detail |', '|---|---|---|---|---|',
  ...calls.map(c => `| ${c.area} | ${c.op} | \`${JSON.stringify(c.params).slice(0, 120)}\` | ${c.outcome} | ${c.detail.replace(/\|/g, '/').replace(/\n/g, ' ')} |`), '',
  `## Events received (${events.length})`, '', [...new Set(events.map(e => e.name))].join(', '), '',
];
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join('\n'));
console.log(`\n${checks.filter(c => c.ok).length}/${checks.length} checks passed; ${allOps.length - uncovered.length}/${allOps.length} operations called${uncovered.length ? ` (not called: ${uncovered.join(', ')})` : ''}`);
console.log(`Report: ${outFile}`);
await backend.close(); // WiredClient.close() sends Logout
rmSync(dataDir, { recursive: true, force: true });
process.exit(checks.every(c => c.ok) ? 0 : 1);
