import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { capabilities, wired, wireless } from '../src/domain/mappers.js';
import { startBackend, startConnectedBackend } from './helpers/start.js';
import { createMockWiredServer } from '../../mock/wired/server.js';
import { createMockWirelessServer } from '../../mock/wireless/server.js';

describe('mappers (pure)', () => {
  test('capabilities: wired actions follow permissions; wireless offers its features', () => {
    const c = capabilities('wired', ['canManageMeeting']);
    assert.equal(c.actions.manageDiscussion, true);
    assert.equal(c.actions.muteMicrophones, false);
    assert.equal(c.actions.controlVoting, false);
    assert.equal(c.features.meetings, true);
    const w = capabilities('wireless');
    assert.equal(w.features.meetings, false);
    assert.equal(w.features.requestQueueAdd, true);
    assert.equal(w.actions.controlVoting, true);
  });

  test('wired seats: details for the room seat panel (6.50 PascalCase normalised, WO-047)', () => {
    const raw = { seats: { seats: [{
      seatId: 's1', seatName: 'Seat 1', screenLine: 'Anna', status: 'Connected', seatType: 'Local', visType: 'None', hideSeat: false,
      supportsSpeaking: false, assignedParticipantId: 'p1', seatedParticipantId: '', attributes: ['Chairman'],
      devices: [{ id: 'd1', name: 'DCNM-DE', typeOf: 'DiscussionDeviceExtended', serialNumber: 'SN1', version: '6.5', deviceState: 'Operational', capabilities: ['HasNone'], isFoundAtSeat: true }],
    }] } };
    const [seat] = wired.seats(n => raw[n]);
    assert.deepEqual(seat.details, {
      status: 'connected', seatType: 'local', visType: 'none', supportsSpeaking: false, hasVotingLicense: null, attributes: ['Chairman'],
      assignedParticipantId: 'p1', seatedParticipantId: null,
      devices: [{ id: 'd1', name: 'DCNM-DE', type: 'discussionDeviceExtended', serial: 'SN1', version: '6.5', state: 'operational', capabilities: [], foundAtSeat: true, selected: false }],
    });
    const people = wired.participants(n => ({
      participants: { participants: [{ participantId: 'p1', firstName: 'Anna', lastName: 'V', userName: 'anna' }] },
      participantSeats: { participantSeats: [{ participantId: 'p1', assignedSeatId: 's1', seatedSeatId: '' }] },
      seats: raw.seats,
    })[n]);
    assert.deepEqual([people[0].assignedSeatId, people[0].seatedSeatId, people[0].userName, people[0].seat], ['s1', null, 'anna', 'Seat 1']);
  });

  test('wired discussion: speakers vs requests, kinds, timers, seat names', () => {
    const raw = {
      discussionList: {
        referenceTime: 5000,
        discussionList: [
          { seatId: 's1', speakerType: 'isPrioritySpeaker', microphoneState: 'on', screenLine: 'Chair', remainingSpeechDuration: 1, speechStartTime: 2, showSpeechTimer: true },
          { seatId: 's2', speakerType: 'isRequest', microphoneState: 'off', screenLine: '', isFirst: true },
        ],
      },
      seats: { seats: [{ seatId: 's1', seatName: 'Seat 1' }, { seatId: 's2', seatName: 'Seat 2' }] },
    };
    const d = wired.discussion(n => raw[n]);
    assert.equal(d.referenceTime, 5000);
    assert.deepEqual(d.speakers.map(s => [s.seatId, s.kind, s.priority, s.micState]), [['s1', 'priority', true, 'on']]);
    assert.deepEqual(d.requests.map(r => [r.seatId, r.name, r.first]), [['s2', 'Seat 2', true]]);
  });

  test('wireless voting and power: integer states and mode answers', () => {
    const raw = {
      wirelessVotingState: { state: 2 },
      wirelessVoting: { mode: 3, subject: 'M1' },
      wirelessVotingResults: { state: 2, mode: 3, results: [{ name: 'present', value: 9 }, { name: 'yes', value: 4 }] },
      wirelessSystemStatus: { state: 1 },
    };
    assert.deepEqual(wireless.voting(n => raw[n]), {
      state: 'onHold', subject: 'M1', description: '', reference: '', answers: ['yes', 'no'], results: [{ answer: 'yes', count: 4 }],
    });
    assert.deepEqual(wireless.power(n => raw[n]), { state: 'standby' });
    assert.equal(wireless.seats(() => undefined), undefined, 'missing sources → undefined');
  });
});

const call = async (backend, method, path, body) => {
  const res = await fetch(`${backend.url}/api/domain${path}`, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

/** Wait until a domain topic satisfies a predicate. */
function waitTopic(backend, topic, predicate, timeoutMs = 4000) {
  const { cache } = backend.services;
  return new Promise((resolve, reject) => {
    const check = () => {
      const d = cache.get(topic)?.data;
      if (d !== undefined && predicate(d)) { cache.off('change', check); clearTimeout(t); resolve(d); }
    };
    const t = setTimeout(() => { cache.off('change', check); reject(new Error(`timeout: ${topic} ${JSON.stringify(cache.get(topic)?.data)?.slice(0, 300)}`)); }, timeoutMs);
    cache.on('change', check);
    check();
  });
}

describe('domain on the wired mock', () => {
  let mock;
  let backend;
  before(async () => { mock = await createMockWiredServer(); backend = await startConnectedBackend(mock); });
  after(async () => { await backend.close(); await mock.close(); });

  test('domain topics exist', () => {
    const { cache } = backend.services;
    for (const t of ['domain.capabilities', 'domain.seats', 'domain.discussion', 'domain.voting', 'domain.power', 'domain.participants']) assert.ok(cache.get(t), t);
    assert.equal(cache.get('domain.capabilities').data.system, 'wired');
    assert.equal(cache.get('domain.seats').data.length, 20);
  });

  test('discussion actions', async () => {
    assert.equal((await call(backend, 'POST', '/discussion/speakers', { seatId: 'seat-3' })).status, 200);
    await waitTopic(backend, 'domain.discussion', d => d.speakers.some(s => s.seatId === 'seat-3' && s.micState === 'on'));
    await call(backend, 'POST', '/discussion/speakers/seat-3/mute');
    await waitTopic(backend, 'domain.discussion', d => d.speakers.find(s => s.seatId === 'seat-3')?.micState === 'mute');
    await call(backend, 'POST', '/discussion/speakers/seat-3/unmute');
    await waitTopic(backend, 'domain.discussion', d => d.speakers.find(s => s.seatId === 'seat-3')?.micState === 'on');
    await call(backend, 'DELETE', '/discussion/speakers/seat-3');
    await waitTopic(backend, 'domain.discussion', d => d.speakers.length === 0);
    const r = await call(backend, 'POST', '/discussion/requests', { seatId: 'seat-3' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'NOT_SUPPORTED');
  });

  test('power and voting', async () => {
    await call(backend, 'PUT', '/power', { state: 'off' });
    await waitTopic(backend, 'domain.power', p => p.state === 'off');
    await call(backend, 'PUT', '/power', { state: 'on' });
    assert.equal((await call(backend, 'PUT', '/power', { state: 'standby' })).body.error.code, 'NOT_SUPPORTED');
    await fetch(`${backend.url}/api/wired/ops/ActivateVoting`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ votingId: 'meeting-1-voting-2' }) });
    await call(backend, 'POST', '/voting/open');
    mock.castVote('seat-1', 'no');
    await waitTopic(backend, 'domain.voting', v => v.state === 'opened' && v.results.some(r => r.answer === 'no' && r.count === 1));
    await call(backend, 'POST', '/voting/close');
    await call(backend, 'POST', '/voting/accept');
    await waitTopic(backend, 'domain.voting', v => v.state === 'accepted' && v.subject === 'Adopt budget 2027');
    assert.equal((await call(backend, 'PUT', '/voting/parameters', { mode: 1 })).body.error.code, 'NOT_SUPPORTED');
  });

  test('participant editing is not supported by the Conference Protocol (DEC-023)', async () => {
    const r = await call(backend, 'POST', '/participants', { name: 'New Person' });
    assert.equal(r.body.error.code, 'NOT_SUPPORTED');
    assert.match(r.body.error.message, /WO-081/);
    assert.equal((await call(backend, 'PUT', '/seats/seat-1/participant', { participantId: null })).body.error.code, 'NOT_SUPPORTED');
  });
});

describe('domain on the wireless mock', () => {
  let mock;
  let backend;
  before(async () => {
    mock = await createMockWirelessServer({ longPollMs: 500 });
    backend = await startBackend({
      DICENTIS_SYSTEM: 'wireless', DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(mock.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin', DICENTIS_AUTOCONNECT: 'true',
    });
    if (backend.services.manager.client?.state !== 'loggedIn') await once(backend.services.manager.client, 'loggedIn');
    await backend.services.poller.idle();
  });
  after(async () => { await backend.close(); await mock.close(); });

  test('domain topics exist with wireless shapes', async () => {
    const { cache } = backend.services;
    assert.equal(cache.get('domain.capabilities').data.system, 'wireless');
    const seats = cache.get('domain.seats').data;
    assert.equal(seats[0].id, '1');
    assert.equal(seats[0].person, 'Anna de Vries');
    assert.ok(seats[0].diagnostics.signalDbm < 0);
    assert.equal(cache.get('domain.power').data.state, 'on');
  });

  test('discussion actions incl. requests, priority and clear', async () => {
    await call(backend, 'POST', '/discussion/speakers', { seatId: '3' });
    await call(backend, 'POST', '/discussion/requests', { seatId: '9' });
    await call(backend, 'POST', '/discussion/priority/1');
    let d = await waitTopic(backend, 'domain.discussion', x => x.requests.length === 1 && x.speakers.length === 2);
    assert.deepEqual(d.speakers.map(s => [s.seatId, s.kind]), [['1', 'priority'], ['3', 'speaker']]);
    await call(backend, 'DELETE', '/discussion/speakers/1'); // priority entry → DELETE /priority
    await waitTopic(backend, 'domain.discussion', x => !x.speakers.some(s => s.seatId === '1'));
    await call(backend, 'DELETE', '/discussion');
    d = await waitTopic(backend, 'domain.discussion', x => x.speakers.length === 0 && x.requests.length === 0);
    assert.equal((await call(backend, 'POST', '/discussion/speakers/3/mute')).body.error.code, 'NOT_SUPPORTED');
    assert.equal((await call(backend, 'POST', '/discussion/speakers', { seatId: 'seat-3' })).status, 400);
  });

  test('power standby and voting with parameters', async () => {
    await call(backend, 'PUT', '/power', { state: 'standby' });
    await waitTopic(backend, 'domain.power', p => p.state === 'standby');
    await call(backend, 'PUT', '/power', { state: 'on' });
    await call(backend, 'PUT', '/voting/parameters', { subject: 'Wireless motion', mode: 1 });
    await call(backend, 'POST', '/voting/open');
    mock.castVote(5, 'abstain');
    const v = await waitTopic(backend, 'domain.voting', x => x.state === 'opened' && x.results.some(r => r.answer === 'abstain' && r.count === 1));
    assert.deepEqual(v.answers, ['for', 'against', 'abstain']);
    assert.equal(v.subject, 'Wireless motion');
    assert.equal((await call(backend, 'POST', '/voting/accept')).body.error.code, 'NOT_SUPPORTED');
    await call(backend, 'POST', '/voting/close');
    await waitTopic(backend, 'domain.voting', x => x.state === 'closed');
  });

  test('participants: create on a taken seat, move, unassign, rename, delete (WO-084)', async () => {
    const seatOf = (people, name) => people.find(p => p.name === name)?.assignedSeatId ?? null;
    const before = await waitTopic(backend, 'domain.participants', x => x.length > 2);
    const bart = before.find(p => p.assignedSeatId === '2');
    assert.ok(bart, 'mock: someone sits at seat 2');
    // create on seat 2: its holder loses the seat
    const created = await call(backend, 'POST', '/participants', { name: '  Zoe New ', seatId: '2' });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.match(created.body.data.id, /^\d+$/);
    let people = await waitTopic(backend, 'domain.participants', x => seatOf(x, 'Zoe New') === '2');
    assert.equal(people.find(p => p.id === bart.id).assignedSeatId, null);
    // move Chloe (seat 3) to seat 2: Zoe is freed, seat 3 becomes free
    const chloe = people.find(p => p.assignedSeatId === '3');
    assert.equal((await call(backend, 'PUT', '/seats/2/participant', { participantId: chloe.id })).status, 200);
    people = await waitTopic(backend, 'domain.participants', x => x.find(p => p.id === chloe.id).assignedSeatId === '2');
    assert.equal(seatOf(people, 'Zoe New'), null);
    assert.ok(!people.some(p => p.assignedSeatId === '3'));
    // unassign seat 2
    await call(backend, 'PUT', '/seats/2/participant', { participantId: null });
    await waitTopic(backend, 'domain.participants', x => !x.some(p => p.assignedSeatId === '2'));
    // rename + seat via PUT, then delete
    const zoe = people.find(p => p.name === 'Zoe New');
    assert.equal((await call(backend, 'PUT', `/participants/${zoe.id}`, { name: 'Zoe Renamed', seatId: '3' })).status, 200);
    await waitTopic(backend, 'domain.participants', x => seatOf(x, 'Zoe Renamed') === '3');
    assert.equal((await call(backend, 'DELETE', `/participants/${zoe.id}`)).status, 200);
    await waitTopic(backend, 'domain.participants', x => !x.some(p => p.id === zoe.id));
    // validation
    assert.equal((await call(backend, 'POST', '/participants', { name: ' ' })).body.error.code, 'VALIDATION');
    assert.equal((await call(backend, 'PUT', '/participants/99999', { name: 'X' })).body.error.code, 'NOT_FOUND');
    assert.equal((await call(backend, 'PUT', '/seats/2/participant', { participantId: 'abc' })).body.error.code, 'VALIDATION');
    // restore: Bart back on seat 2
    await call(backend, 'PUT', '/seats/2/participant', { participantId: bart.id });
    await waitTopic(backend, 'domain.participants', x => x.find(p => p.id === bart.id).assignedSeatId === '2');
  });
});

describe('domain unavailable reasons', () => {
  test('a domain topic carries the reason its sources are missing (e.g. permission)', async () => {
    const mock = await createMockWiredServer();
    mock.state.userPermissions.admin = ['canViewSynoptic'];
    const backend = await startConnectedBackend(mock);
    try {
      assert.equal(backend.services.cache.get('domain.voting'), null);
      assert.match(backend.services.cache.unavailable.get('domain.voting'), /missing permission: canViewVoting/);
      assert.ok(backend.services.cache.get('domain.seats'), 'other domain topics unaffected');
    } finally {
      await backend.close();
      await mock.close();
    }
  });
});

describe('meeting start / stop for the Room top bar (WO-072)', () => {
  test('wired: start = activate + open, stop = close; another active meeting must be stopped first', async () => {
    const mock = await createMockWiredServer();
    const backend = await startConnectedBackend(mock);
    try {
      let m = await waitTopic(backend, 'domain.meeting', x => x.current?.id === 'meeting-1');
      assert.deepEqual(m.current, { id: 'meeting-1', title: 'City Council', state: 'opened', running: true });
      assert.deepEqual(m.meetings.map(x => x.id), ['meeting-1', 'meeting-2']);
      assert.equal(backend.services.cache.get('domain.capabilities').data.actions.controlMeeting, true);
      const busy = await call(backend, 'POST', '/meeting/start', { meetingId: 'meeting-2' });
      assert.equal(busy.status, 400);
      assert.match(busy.body.error.message, /City Council.*stop it first/);
      assert.equal((await call(backend, 'POST', '/meeting/stop')).status, 200);
      await waitTopic(backend, 'domain.meeting', x => x.current === null);
      assert.equal((await call(backend, 'POST', '/meeting/start', { meetingId: 'meeting-2' })).status, 200);
      m = await waitTopic(backend, 'domain.meeting', x => x.current?.id === 'meeting-2' && x.current.running);
      assert.equal(m.current.state, 'opened');
      assert.equal((await call(backend, 'POST', '/meeting/start', { meetingId: 'nope' })).status, 400);
    } finally {
      await backend.close();
      await mock.close();
    }
  });
});
