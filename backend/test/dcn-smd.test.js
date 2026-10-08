// DCN Streaming Meeting Data (WO-066, DEC-018): XML parser, framing, state reducer, backend against the mock stream.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseXml, items, child, attr } from '../src/dcn-smd/xml.js';
import { FrameDecoder, encodeFrame, decodeMessage } from '../src/dcn-smd/frames.js';
import { SmdState } from '../src/dcn-smd/state.js';
import { DcnSmdClient } from '../src/dcn-smd/client.js';
import { startBackend } from './helpers/start.js';
import { createMockSmdServer } from '../../mock/dcn-smd/server.js';

const EXAMPLES = JSON.parse(readFileSync(new URL('./fixtures/dcn-smd-manual-examples.json', import.meta.url), 'utf8'));
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

describe('XML parser (lenient)', () => {
  test('all examples of the manual parse, typos included', () => {
    for (const [name, xml] of Object.entries(EXAMPLES)) {
      const root = parseXml(xml);
      assert.match(root.name, /Activity$/, name);
      assert.ok(attr(root, 'Type'), `${name} has a Type`);
    }
    // InterpretationTranslationStarted: `<Desk Number=”1” />` … `</Desk>` and `</Channel` without '>'
    const desk = child(parseXml(EXAMPLES.InterpretationTranslationStarted), 'Desk');
    assert.deepEqual(desk.children.map(c => c.name), ['Booth', 'Seat', 'Source', 'Destination']);
    assert.equal(attr(child(child(child(desk, 'Destination'), 'Channel'), 'Language'), 'Name'), 'Dutch');
    assert.equal(attr(desk, 'Number'), '1'); // typographic quotes
    // MeetingStarted: plural wrappers + Container suffix
    const meeting = child(parseXml(EXAMPLES.MeetingStarted), 'Meeting');
    assert.equal(items(meeting, 'Participant').length, 1);
    assert.equal(items(meeting, 'Session').length, 1);
    assert.equal(items(meeting, 'Channel').length, 2);
  });

  test('entities, single quotes, unquoted values, comments, CDATA, case-insensitive attributes', () => {
    const r = parseXml("<?xml version='1.0'?><!-- c --><A x='1 &amp; 2' y=3 TimeStamp=\"t\"><B><![CDATA[<raw>]]></B>&lt;ok&gt;</A>");
    assert.equal(r.attrs.x, '1 & 2');
    assert.equal(r.attrs.y, '3');
    assert.equal(attr(r, 'Timestamp'), 't');
    assert.equal(child(r, 'B').text, '<raw>');
    assert.equal(r.text, '<ok>');
    assert.throws(() => parseXml('no xml here'), /no XML element/);
  });
});

describe('framing', () => {
  const xml = '<SeatActivity Topic="Seat" Type="SeatUpdated"><Seat Id="1"><SeatData Name="Zoë" /></Seat></SeatActivity>';

  test('UTF-16LE and UTF-8 messages, split byte by byte and merged', () => {
    for (const enc of ['utf16le', 'utf8']) {
      const frames = Buffer.concat([encodeFrame(5, xml, enc), encodeFrame(0, '<SystemActivity Type="SystemStarted"/>', enc)]);
      const d = new FrameDecoder();
      const out = [];
      for (let i = 0; i < frames.length; i++) out.push(...d.push(frames.subarray(i, i + 1)));
      assert.deepEqual(out.map(m => [m.topicName, m.encoding]), [['Seat', enc], ['System', enc]]);
      assert.equal(out[0].text, xml);
      assert.equal(new FrameDecoder().push(frames).length, 2);
    }
  });

  test('BOMs and an impossible length', () => {
    assert.equal(decodeMessage(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<a/>', 'utf16le')])).text, '<a/>');
    assert.equal(decodeMessage(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<a/>')])).text, '<a/>');
    const bad = Buffer.alloc(8);
    bad.writeInt32LE(1, 0);
    bad.writeInt32LE(-5, 4);
    assert.throws(() => new FrameDecoder().push(bad), /out of sync/);
  });
});

describe('state reducer', () => {
  const apply = (s, xml) => s.apply(parseXml(xml));

  test('the manual examples build the expected picture', () => {
    const s = new SmdState();
    apply(s, EXAMPLES.MeetingStarted);
    const m = s.view('meeting');
    assert.equal(m.meeting.subject, 'DefaultMeeting');
    assert.deepEqual(m.meeting.participantIds, [2]);
    assert.equal(m.sessions[0].subject, 'Session');
    assert.equal(m.meeting.channels[1].language, 'Dutch');
    assert.deepEqual(s.participants[2], { ...s.participants[2], firstName: 'Carl', lastName: 'Coder', title: 'Sir', seatId: 3, group: null, votingAuthorisation: true });
    assert.equal(s.seats[3].participantId, 2);
    assert.equal(s.desks[1].seatId, 25);

    apply(s, EXAMPLES.SeatUpdated);
    assert.deepEqual([s.seats[6].name, s.seats[6].microphoneActive, s.seats[6].participantId], ['0006', true, 7]);

    apply(s, EXAMPLES.InterpretationTranslationStarted);
    assert.deepEqual(s.desks[1].destination, { output: 'A', number: 2, language: 'Dutch', abbreviation: 'NLD' });
    assert.equal(s.desks[1].translating, true);

    apply(s, EXAMPLES.VotingStopped);
    const v = s.view('voting');
    assert.equal(v.state, 'done');
    assert.equal(v.current.results.approved, true);
    assert.deepEqual(v.current.results.answers.map(a => [a.answerId, a.casts]), [[1, 1], [2, 0]]);
    assert.deepEqual(v.current.results.individual, [{ participantId: 2, answerId: 1 }]);

    apply(s, EXAMPLES.MicrophoneTestStopped);
    assert.deepEqual(s.micTest.results, [{ passed: true, seatIds: [16, 17, 18] }, { passed: false, seatIds: [19, 20] }]);

    apply(s, EXAMPLES.MeetingStopped);
    assert.equal(s.meeting, null);
    assert.equal(s.voting.state, 'closed');
    assert.equal(s.log.length, 6);
  });

  test('seat without participant clears it; interim results merge; priority; service calls; unknown activity', () => {
    const s = new SmdState();
    apply(s, EXAMPLES.SeatUpdated);
    apply(s, '<SeatActivity Type="SeatUpdated"><Seat Id="6"><SeatData Name="0006" MicrophoneActive="false" /></Seat></SeatActivity>');
    assert.equal(s.seats[6].participantId, null);
    apply(s, '<VotingActivity Type="VotingStarted"><Voting Id="4"><VotingData Subject="Q" /><Answers><AnswerContainer Id="1" AnswerText="Yes" /><AnswerContainer Id="2" AnswerText="No" /></Answers></Voting></VotingActivity>');
    apply(s, '<VotingActivity Type="VotingInterimResult"><Voting Id="4"><VotingResults><VotingTotalResults><VotingAnswerResults><VotingAnswerResultContainer AnswerId="1" NumberOfCasts="2" /></VotingAnswerResults></VotingTotalResults></VotingResults></Voting></VotingActivity>');
    apply(s, '<VotingActivity Type="VotingInterimResult"><Voting Id="4"><VotingResults><VotingTotalResults><VotingAnswerResults><VotingAnswerResultContainer AnswerId="2" NumberOfCasts="1" /></VotingAnswerResults></VotingTotalResults></VotingResults></Voting></VotingActivity>');
    assert.deepEqual(s.votings[4].results.answers.map(a => [a.answerId, a.casts]), [[1, 2], [2, 1]]);
    assert.deepEqual(s.votings[4].answers.map(a => a.text), ['Yes', 'No']);
    apply(s, '<SeatActivity Type="SeatPriorityButtonActivated"><Seat Id="1"><SeatData Name="0001" SeatType="Chairman" /></Seat></SeatActivity>');
    assert.deepEqual(s.priority, [1]);
    apply(s, '<SeatActivity Type="SeatPriorityButtonDeactivated"><Seat Id="1" /></SeatActivity>');
    assert.deepEqual(s.priority, []);
    apply(s, '<ServiceCallActivity Type="ServiceCallStarted"><ServiceCall Id="9"><Seat Id="6" /></ServiceCall></ServiceCallActivity>');
    assert.deepEqual(s.view('serviceCalls').open.map(c => [c.id, c.seatId, c.state]), [[9, 6, 'called']]);
    apply(s, '<ServiceCallActivity Type="ServiceCallHandled"><ServiceCall Id="9" /></ServiceCallActivity>');
    assert.deepEqual([s.view('serviceCalls').open.length, s.view('serviceCalls').done[0].state, s.view('serviceCalls').done[0].seatId], [0, 'handled', 6]);
    apply(s, '<FutureActivity Type="SomethingNew" />');
    assert.equal(s.stats.unknown, 1);
    // persistence round trip
    const copy = SmdState.fromJSON(JSON.parse(JSON.stringify(s)));
    assert.deepEqual(copy.view('voting'), s.view('voting'));
    assert.deepEqual(copy.view('seats'), s.view('seats'));
  });
});

describe('backend with system dcn-smd', () => {
  let mock;
  let backend;
  let dataDir;
  const api = async (method, path, body) => {
    const res = await fetch(`${backend.url}/api${path}`, {
      method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const waitTopic = (topic, predicate, timeoutMs = 3000) => new Promise((resolve, reject) => {
    const { cache } = backend.services;
    const check = () => { const d = cache.get(topic)?.data; if (d !== undefined && predicate(d)) { cache.off('change', check); clearTimeout(t); resolve(d); } };
    const t = setTimeout(() => { cache.off('change', check); reject(new Error(`timeout waiting for ${topic}: ${JSON.stringify(cache.get(topic)?.data)?.slice(0, 300)}`)); }, timeoutMs);
    cache.on('change', check);
    check();
  });
  const start = async () => {
    backend = await startBackend({ DATA_DIR: dataDir, DICENTIS_SYSTEM: 'dcn-smd', DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(mock.port), DICENTIS_AUTOCONNECT: 'true' });
    const { manager } = backend.services;
    if (manager.client?.state !== 'loggedIn') await once(manager.client, 'loggedIn');
  };

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'smd-test-'));
    mock = await createMockSmdServer();
    await start();
  });
  after(async () => {
    await backend?.close();
    await mock?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('connects without credentials; the queued meeting is replayed', async () => {
    assert.equal((await api('GET', '/connection')).body.data.state, 'loggedIn');
    await waitTopic('smdMeeting', m => m.meeting?.subject === 'Council meeting' && m.session.id === 1);
    await waitTopic('domain.participants', p => p.length === 10 && p[0].name === 'Chair Anna Novak' && p[0].group === 'Group A');
    const caps = await waitTopic('domain.capabilities', c => c.system === 'dcn-smd');
    assert.equal(caps.features.readOnly, true);
    assert.equal(Object.values(caps.actions).some(Boolean), false);
    assert.equal(mock.queued, 0);
  });

  test('live microphones, requests, priority, voting and service calls reach the domain topics', async () => {
    mock.micOn(3);
    mock.request(5);
    mock.request(7);
    await waitTopic('domain.discussion', d => d.speakers.some(s => s.seatId === '3' && s.name === 'Clara Ruiz')
      && d.requests.map(r => r.seatId).join() === '5,7' && d.requests[0].first);
    mock.micOn(5);
    await waitTopic('domain.discussion', d => d.speakers.length === 2 && d.requests.map(r => r.seatId).join() === '7');
    await waitTopic('domain.seats', s => s.find(x => x.id === '3')?.person === 'Clara Ruiz' && !s.some(x => x.id === '50')); // desk seat excluded
    mock.priority(1, true);
    await waitTopic('domain.discussion', d => d.speakers[0]?.seatId === '1' && d.speakers[0].priority);
    mock.priority(1, false);
    mock.micOff(3);
    mock.micOff(5);
    mock.cancelRequest(7);
    await waitTopic('domain.discussion', d => !d.speakers.length && !d.requests.length);

    mock.startVoting(1);
    await waitTopic('domain.voting', v => v.state === 'opened' && v.subject === 'Approve the agenda' && v.answers.join() === 'Yes,No,Abstain');
    mock.castVote(2, 1);
    mock.castVote(3, 1);
    mock.castVote(4, 2);
    await waitTopic('domain.voting', v => v.results.find(r => r.answer === 'Yes')?.count === 2);
    mock.stopVoting();
    const done = await waitTopic('domain.voting', v => v.state === 'accepted');
    assert.deepEqual(done.results.map(r => [r.answer, r.count]), [['Yes', 2], ['No', 1], ['Abstain', 0]]);

    const call = mock.serviceCall(4);
    await waitTopic('smdServiceCalls', c => c.open.some(x => x.seatId === 4));
    mock.serviceCallHandled(call);
    await waitTopic('smdServiceCalls', c => !c.open.length && c.done[0].state === 'handled');
    mock.interpretation(true);
    await waitTopic('smdInterpretation', i => i.desks[0]?.translating && i.booths[0]?.inUse);
    mock.micTest();
    await waitTopic('smdMicTest', t => t.state === 'ended' && t.results.length === 2);
  });

  test('read-only: domain actions are NOT_SUPPORTED', async () => {
    const r = await api('POST', '/domain/discussion/speakers', { seatId: '3' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'NOT_SUPPORTED');
    assert.match(r.body.error.message, /read-only/);
    assert.equal((await api('POST', '/domain/voting/open')).body.error.code, 'NOT_SUPPORTED');
  });

  test('the picture survives a backend restart (persisted), and can be reset', async () => {
    mock.micOn(6);
    await waitTopic('domain.discussion', d => d.speakers.some(s => s.seatId === '6'));
    await backend.close(); // flushes the state file
    assert.ok(existsSync(join(dataDir, 'dcn-smd-state.json')));
    await start(); // nothing queued: everything comes from the persisted state
    await waitTopic('domain.discussion', d => d.speakers.some(s => s.seatId === '6'));
    assert.equal(backend.services.cache.get('smdStream').data.origin, 'restored');
    mock.micOff(6);
    await waitTopic('smdStream', s => s.origin === 'live');
    await waitTopic('domain.discussion', d => !d.speakers.length);
    assert.equal((await api('POST', '/dcn-smd/reset')).status, 200);
    await waitTopic('smdMeeting', m => m.meeting === null);
    assert.equal(existsSync(join(dataDir, 'dcn-smd-state.json')), false);
    const full = (await api('GET', '/dcn-smd/state')).body.data;
    assert.equal(full.stream.state, 'loggedIn');
  });

  test('reconnects after the server drops the connection; activities in between are replayed', async () => {
    const { manager } = backend.services;
    const again = once(manager.client, 'loggedIn');
    mock.dropClients();
    await sleep(20);
    mock.request(9); // happens while disconnected → queued → replayed
    await again;
    await waitTopic('domain.discussion', d => d.requests.some(r => r.seatId === '9'));
    mock.cancelRequest(9);
  });
});

describe('DcnSmdClient edge cases', () => {
  test('a client not in AllowedClients gets a clear hint; UTF-8 stream works', async () => {
    const mock = await createMockSmdServer({ allowedClients: ['10.0.0.1'], encoding: 'utf8' });
    const c = new DcnSmdClient({ host: '127.0.0.1', port: mock.port, log: quiet, reconnect: { minDelayMs: 50, maxDelayMs: 50 } });
    try {
      await c.connect();
      await new Promise(resolve => c.on('state', s => s === 'reconnecting' && resolve()));
      assert.equal(c.lastError.extra.reason, 'rejected');
      assert.match(c.lastError.message, /AllowedClients/);
      mock.setAllowedClients(['127.0.0.1']);
      const got = [];
      c.on('activity', a => got.push(a));
      await once(c, 'loggedIn');
      while (got.length < 3) await sleep(20);
      assert.equal(got[0].encoding, 'utf8');
      assert.equal(attr(got[1].root, 'Type'), 'MeetingStarted');
    } finally {
      await c.close();
      await mock.close();
    }
  });

  test('nothing listening → NOT_CONNECTED with a hint', async () => {
    const c = new DcnSmdClient({ host: '127.0.0.1', port: 1, log: quiet, reconnect: { enabled: false } });
    await assert.rejects(c.connect(), e => e.code === 'NOT_CONNECTED' && /DCN-SW server running/.test(e.message));
    assert.equal(c.state, 'disconnected');
  });
});
