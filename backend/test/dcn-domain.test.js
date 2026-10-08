// DCN in the domain layer (WO-062): pure mappers + domain topics/actions against the mock bridge.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { capabilities, dcn } from '../src/domain/mappers.js';
import { startBackend } from './helpers/start.js';
import { createMockDcnBridge } from '../../mock/dcn/server.js';
import { MOCK_CONSTANTS } from '../../mock/dcn/dcnsw.js';

const P = (SeatId, ParticipantId = 0, extra = {}) => ({ SeatId, ParticipantId, IsSpeaking: false, IsNextToSpeak: false, ...extra });

describe('dcn mappers (pure)', () => {
  const raw = {
    dcnBridge: { constants: MOCK_CONSTANTS, status: {} },
    dcnSeatAssignments: [{ SeatId: 1, SeatName: 'Chairman', DelegateId: 101 }, { SeatId: 2, SeatName: 'Seat 2', DelegateId: 0 }],
    dcnDelegates: [{ id: 101, Title: 'Dr', FirstName: 'Anna', MiddleName: '', LastName: 'Novak' }, { id: 102, FirstName: 'Ben', LastName: 'Okafor' }],
    dcnRegisteredDelegates: [{ id: 101, AssignedSeatId: 1, Rights: 7, VoteWeight: 1 }, { id: 102, AssignedSeatId: 0, Rights: 1, VoteWeight: 1 }],
    dcnActiveMeeting: { meetingId: 1 },
    dcnMicStatus: [{ SeatId: 1, MicStatus: 'ON' }, { SeatId: 7, MicStatus: 'FIRST_REQUEST' }],
    dcnSpeakers: [P(1, 101, { IsSpeaking: true })],
    dcnRequests: [P(7), P(2)],
    dcnRespond: [],
    dcnRequestsToRespond: [P(2)],
  };
  const get = t => raw[t];

  test('capabilities follow the Is*Allowed flags', () => {
    const c = capabilities('dcn', ['DiscussionApi.IsDiscussStandardControllAllowed']);
    assert.equal(c.system, 'dcn');
    assert.equal(c.actions.manageDiscussion, true);
    assert.equal(c.actions.controlVoting, false);
    assert.equal(c.features.priorityCalls, true);
    assert.equal(c.features.meetings, false);
    assert.equal(capabilities('dcn', ['VoteApi.IsParliamentaryVotingControlAllowed']).actions.controlVoting, true);
  });

  test('seats: assignment + seats seen elsewhere, names, delegates, vote right', () => {
    const seats = dcn.seats(get);
    assert.deepEqual(seats.map(s => [s.id, s.name, s.person, s.canVote]), [['1', 'Chairman', 'Dr Anna Novak', true], ['2', 'Seat 2', '', false], ['7', 'Seat 7', '', false]]);
    assert.equal(seats[0].details.assignedParticipantId, '101');
    assert.equal(dcn.seats(() => undefined), undefined);
  });

  test('discussion: speakers, requests (first), requests to respond', () => {
    const d = dcn.discussion(get);
    assert.deepEqual(d.speakers.map(s => [s.seatId, s.name, s.micState, s.kind]), [['1', 'Dr Anna Novak', 'on', 'speaker']]);
    assert.deepEqual(d.requests.map(r => [r.seatId, r.name, r.kind, r.first]), [['7', 'Seat 7', 'request', true], ['2', 'Seat 2', 'request', false], ['2', 'Seat 2', 'responseRequest', false]]);
  });

  test('voting: state vocabulary, script info, answers from the answer set, results', () => {
    const base = { ...raw, dcnVotingScript: [{ id: 1001, VotingNumber: '1', VotingName: 'Agenda', Subject: 'Approve', VoteAnswerSet: 2 }] };
    const v = s => dcn.voting(t => ({ ...base, ...s })[t]);
    assert.equal(v({}), undefined);
    const open = v({ dcnVoting: { state: 'opened', votingId: 1001, outcome: null }, dcnVotingQuorum: { ConfigId: 1001, TotalResults: { PresentCount: 5, NotVotedCount: 3, Answers: [{ AnswerId: 1, CastCount: 2 }] } } });
    assert.deepEqual([open.state, open.subject, open.reference, open.answers, open.results], ['opened', 'Approve', '1', ['Yes', 'No', 'Abstain'], [{ answer: 'Yes', count: 2 }]]);
    const done = v({ dcnVoting: { state: 'done', votingId: 1001, outcome: 'rejected' }, dcnVoteResults: { ConfigId: 1001, TotalResults: { Answers: [{ AnswerId: 2, CastCount: 3 }] } } });
    assert.deepEqual([done.state, done.results], ['rejected', [{ answer: 'No', count: 3 }]]);
    const stale = v({ dcnVoting: { state: 'done', votingId: 1002, outcome: null }, dcnVoteResults: { ConfigId: 1001, TotalResults: { Answers: [{ AnswerId: 2, CastCount: 3 }] } } });
    assert.deepEqual(stale.results, []);
  });

  test('participants: registered delegates of the running meeting, seats, vote right', () => {
    const people = dcn.participants(get);
    assert.deepEqual(people.map(p => [p.id, p.name, p.seat, p.assignedSeatId, p.canVote]), [['101', 'Dr Anna Novak', 'Chairman', '1', true], ['102', 'Ben Okafor', null, null, false]]);
    const all = dcn.participants(t => ({ ...raw, dcnActiveMeeting: { meetingId: null } })[t]);
    assert.equal(all.length, 2);
    assert.equal(all[0].canVote, null);
    assert.equal(dcn.power(get), undefined);
  });
});

describe('domain API with a DCN system (mock bridge)', () => {
  let mock;
  let backend;
  const api = async (method, path, body) => {
    const res = await fetch(`${backend.url}/api${path}`, {
      method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const waitTopic = (topic, predicate, timeoutMs = 3000) => new Promise((resolve, reject) => {
    const { cache } = backend.services;
    const check = () => { const d = cache.get(topic)?.data; if (d !== undefined && predicate(d)) { cache.off('change', check); clearTimeout(t); resolve(d); } };
    const t = setTimeout(() => { cache.off('change', check); reject(new Error(`timeout waiting for ${topic}: ${JSON.stringify(cache.get(topic)?.data)}`)); }, timeoutMs);
    cache.on('change', check);
    check();
  });

  before(async () => {
    mock = await createMockDcnBridge();
    backend = await startBackend({
      DICENTIS_SYSTEM: 'dcn', DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(mock.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin',
      DICENTIS_BRIDGE_TOKEN: mock.token,
    });
    assert.equal((await api('POST', '/connection/connect')).status, 200);
    await backend.services.dcnEvents.idle();
  });
  after(async () => { await backend?.close(); await mock?.close(); });

  test('domain topics are populated', async () => {
    const caps = await waitTopic('domain.capabilities', c => c.system === 'dcn' && c.actions.manageDiscussion);
    assert.equal(caps.actions.controlVoting, true);
    const seats = await waitTopic('domain.seats', s => s.length === 20);
    assert.deepEqual([seats[0].id, seats[0].name, seats[0].person], ['1', 'Chairman', 'Chair Anna Novak']);
    await waitTopic('domain.participants', p => p.length === 10 && p[2].seat === 'Seat 3');
    await waitTopic('domain.discussion', d => d.speakers.length === 0 && d.requests.length === 0);
    await waitTopic('domain.voting', v => v.state === 'closed');
    assert.equal(backend.services.cache.get('domain.power'), null);
  });

  test('discussion actions', async () => {
    assert.equal((await api('POST', '/domain/discussion/speakers', { seatId: '3' })).status, 200);
    await waitTopic('domain.discussion', d => d.speakers.some(s => s.seatId === '3' && s.name === 'Clara Ruiz' && s.micState === 'on'));
    assert.equal((await api('POST', '/domain/discussion/requests', { seatId: '5' })).status, 200);
    await waitTopic('domain.discussion', d => d.requests.some(r => r.seatId === '5' && r.first));
    assert.equal((await api('DELETE', '/domain/discussion/requests/5')).status, 200);
    await waitTopic('domain.discussion', d => d.requests.length === 0);
    assert.equal((await api('DELETE', '/domain/discussion/speakers/3')).status, 200);
    await waitTopic('domain.discussion', d => d.speakers.length === 0);
    assert.equal((await api('POST', '/domain/discussion/priority/1')).status, 200);
    await waitTopic('domain.discussion', d => d.speakers.some(s => s.seatId === '1'));
    await waitTopic('dcnPrios', p => p.keyPrio === 1);
    assert.equal((await api('DELETE', '/domain/discussion/priority/1')).status, 200);
    mock.sim.requestToSpeak(8);
    mock.sim.pressMic(9);
    await waitTopic('domain.discussion', d => d.requests.length === 1 && d.speakers.length === 1);
    assert.equal((await api('DELETE', '/domain/discussion')).status, 200);
    await waitTopic('domain.discussion', d => d.requests.length === 0 && d.speakers.length === 0);
  });

  test('errors and unsupported actions', async () => {
    const bad = await api('POST', '/domain/discussion/speakers', { seatId: 'abc' });
    assert.equal(bad.status, 400);
    const unknown = await api('POST', '/domain/discussion/speakers', { seatId: '99' });
    assert.equal(unknown.status, 502);
    assert.equal(unknown.body.error.apiError, 'INVALID_PARAMETER');
    assert.equal((await api('POST', '/domain/discussion/speakers/3/mute')).body.error.code, 'NOT_SUPPORTED');
    assert.equal((await api('PUT', '/domain/power', { state: 'off' })).body.error.code, 'NOT_SUPPORTED');
    assert.equal((await api('POST', '/domain/voting/accept')).body.error.code, 'NOT_SUPPORTED');
    assert.match((await api('POST', '/domain/voting/open')).body.error.message, /No voting selected/);
  });

  test('voting: select (passthrough), open, hold, resume, close; results in domain.voting', async () => {
    assert.equal((await api('POST', '/dcn/ops/control.VoteApi/SelectVotingById', { votingId: 1002 })).status, 200);
    await waitTopic('domain.voting', v => v.state === 'ready' && v.subject === 'Approve the minutes' && v.answers.length === 4);
    assert.equal((await api('POST', '/domain/voting/open')).status, 200);
    await waitTopic('domain.voting', v => v.state === 'opened');
    mock.sim.castVote(2, 'Yes');
    mock.sim.castVote(3, 'Dnpv');
    await waitTopic('domain.voting', v => v.results.find(r => r.answer === 'Yes')?.count === 1);
    assert.equal((await api('POST', '/domain/voting/hold')).status, 200);
    await waitTopic('domain.voting', v => v.state === 'onHold');
    assert.equal((await api('POST', '/domain/voting/resume')).status, 200);
    await waitTopic('domain.voting', v => v.state === 'opened');
    assert.equal((await api('POST', '/domain/voting/close')).status, 200);
    const done = await waitTopic('domain.voting', v => v.state === 'accepted');
    assert.deepEqual(done.results.map(r => [r.answer, r.count]), [['Yes', 1], ['No', 0], ['Abstain', 0], ['Dnpv', 1]]);
  });

  test('the camera director sees DCN microphones through domain.discussion', async () => {
    mock.sim.pressMic(4);
    await waitTopic('domain.discussion', d => d.speakers.some(s => s.seatId === '4'));
    mock.sim.pressMic(4);
    await waitTopic('domain.discussion', d => !d.speakers.some(s => s.seatId === '4'));
  });
});

describe('meeting start / stop on DCN (WO-072)', () => {
  test('start = meeting + its first session; stop ends both', async () => {
    const mock = await createMockDcnBridge({ meetingActive: false });
    const backend = await startBackend({
      DICENTIS_SYSTEM: 'dcn', DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(mock.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin',
      DICENTIS_SMD_STREAM: 'false',
    });
    const post = (path, body) => fetch(`${backend.url}/api/domain${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
      .then(async r => ({ status: r.status, body: await r.json() }));
    try {
      await backend.services.manager.connect();
      await backend.services.dcnEvents.idle();
      const { cache } = backend.services;
      assert.equal(cache.get('domain.meeting').data.current, null);
      assert.equal(cache.get('domain.capabilities').data.actions.controlMeeting, true);
      assert.equal((await post('/meeting/start', { meetingId: 1 })).status, 200);
      await backend.services.dcnEvents.idle();
      const m = cache.get('domain.meeting').data;
      assert.deepEqual([m.current?.id, m.current?.running, m.session?.id, m.session?.title], [1, true, 11, 'Morning session']);
      assert.equal((await post('/meeting/start', { meetingId: 2 })).status, 400); // meeting 1 is running
      assert.equal((await post('/meeting/stop')).status, 200);
      await backend.services.dcnEvents.idle();
      assert.deepEqual([cache.get('domain.meeting').data.current, cache.get('domain.meeting').data.session], [null, null]);
      assert.equal((await post('/meeting/stop')).status, 400);
    } finally {
      await backend.close();
      await mock.close();
    }
  });
});
