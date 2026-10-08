// Settings → DCN (meeting data stream) (WO-067, DEC-018): what the read-only DCN-SWSMD stream reports beyond the shared
// views: stream health, meeting/session, voting details (quorum, majority, percentages), usher calls, interpretation,
// microphone test, and the activity log. The only write is "Reset", which clears LikeABosch's own reconstructed state.
import { h, replace, humanize, actionButton } from '../dom.js';

const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
const time = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
};
const ago = iso => {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(iso).toLocaleString();
};

export default {
  id: 'dcn-stream',
  feature: 'dcnStream',
  title: 'DCN',
  topics: ['smdStream'],
  mount(el, { store, api }) {
    const boxes = Object.fromEntries(['stream', 'meeting', 'voting', 'calls', 'interpretation', 'test', 'log'].map(k => [k, h('div')]));
    const t = name => store.topic(name);
    const seatName = id => (store.topic('smdSeats') ?? []).find(s => s.id === id)?.name ?? (id == null ? '—' : `Seat ${id}`);
    const person = id => {
      const p = (store.topic('smdParticipants') ?? []).find(x => x.id === id);
      return p ? [p.title, p.firstName, p.lastName].filter(Boolean).join(' ') : '';
    };
    const seatLabel = id => {
      const s = (store.topic('smdSeats') ?? []).find(x => x.id === id);
      const who = s?.participantId ? person(s.participantId) : '';
      return who ? `${seatName(id)} · ${who}` : seatName(id);
    };

    function renderStream() {
      const s = t('smdStream');
      if (!s) return replace(boxes.stream, h('p', { class: 'muted' }, 'Not connected'));
      const note = {
        empty: 'Nothing received yet. LikeABosch learns the meeting from the stream: it appears when the DCN-SW server sends it (e.g. when a meeting starts, or replayed from its queue).',
        restored: 'Showing the last known state (saved by LikeABosch). It is confirmed with the next activity from the DCN-SW server.',
        live: null,
      }[s.origin];
      replace(boxes.stream,
        h('p', { class: 'headline' }, h('span', { class: ['pill', s.state] }, s.state === 'loggedIn' ? 'Receiving' : humanize(s.state))),
        kv('Last activity', ago(s.lastActivityAt)),
        kv('Activities', String(s.activities)),
        kv('Messages this connection', `${s.messages} (${s.encoding ?? 'encoding not seen yet'})`),
        s.parseErrors ? kv('Unreadable messages', h('strong', null, String(s.parseErrors))) : null,
        s.unknownActivities ? kv('Activities LikeABosch ignores', String(s.unknownActivities)) : null,
        note ? h('p', { class: 'muted hint' }, note) : null,
        h('div', { class: 'actions' }, actionButton('Reset', () => api.post('/dcn-smd/reset'), {
          cls: 'danger-outline', danger: true,
          confirm: 'Forget everything LikeABosch knows about the DCN meeting? Use this if a meeting ended while LikeABosch was not connected. The picture is rebuilt from new activities.',
        })));
    }

    function renderMeeting() {
      const m = t('smdMeeting');
      if (!m?.meeting) return replace(boxes.meeting, h('p', { class: 'muted' }, 'No meeting running (as far as the stream has told).'));
      const { meeting, session, sessions } = m;
      replace(boxes.meeting,
        h('p', { class: 'headline' }, meeting.subject || `Meeting ${meeting.id}`),
        meeting.description ? h('p', { class: 'muted' }, meeting.description) : null,
        kv('Started', time(meeting.startedAt)),
        kv('Attendance registration', meeting.attendanceRegistration ? 'running' : 'off'),
        kv('Participants', String(meeting.participantIds?.length ?? 0)),
        kv('Channels', (meeting.channels ?? []).map(c => `${c.number} ${c.abbreviation ?? c.language ?? ''}`.trim()).join(', ') || '—'),
        sessions.length ? h('div', { class: 'list' }, sessions.map(s => h('div', { class: ['row-item', s.id === session?.id && 'current'] },
          h('span', { class: ['state-dot', s.id === session?.id ? (session.state === 'suspended' ? 'onHold' : 'opened') : 'deactivated'] }),
          h('span', { class: 'name' }, s.subject || `Session ${s.id}`, s.id === session?.id ? h('small', { class: 'sub' }, session.state === 'suspended' ? 'suspended' : 'running') : s.done ? h('small', { class: 'sub' }, 'done') : null),
          h('span'), h('span')))) : null);
    }

    function renderVoting() {
      const v = t('smdVoting');
      const cur = v?.current;
      if (!cur) return replace(boxes.voting, h('p', { class: 'muted' }, 'No voting selected or running.'));
      const r = cur.results ?? {};
      const label = id => cur.answers.find(a => a.id === id)?.text ?? `Answer ${id}`;
      const state = v.state === 'done' && r.approved !== undefined ? (r.approved ? 'accepted' : 'rejected') : v.state;
      replace(boxes.voting,
        h('p', { class: 'headline' }, cur.subject || cur.name || `Voting ${cur.id}`),
        kv('State', h('span', { class: ['state', state] }, humanize(state))),
        (r.answers ?? []).length ? h('ul', { class: 'compact' }, r.answers.map(a => h('li', null, `${label(a.answerId)}: ${a.casts ?? 0}${a.percentage !== undefined ? ` (${a.percentage}%)` : ''}`))) : null,
        r.actualQuorum !== undefined ? kv('Quorum', `${r.actualQuorum} of ${r.maximumQuorum ?? '?'} (required ${r.requiredQuorum ?? '?'})`) : null,
        r.actualMajority !== undefined ? kv('Majority', `${r.actualMajority} (required ${r.requiredMajority ?? '?'})`) : null,
        r.numberOfAuthorizedPresentParticipants !== undefined ? kv('Present, may vote', `${r.numberOfAuthorizedPresentParticipants} · ${r.numberOfAuthorizedPresentParticipantsWithoutVote ?? 0} did not vote`) : null,
        (r.groups ?? []).length ? h('details', null, h('summary', null, 'Per group'), h('ul', { class: 'compact' },
          r.groups.map(g => h('li', null, `${g.group ?? '—'}: ${g.answers.map(a => `${label(a.answerId)} ${a.casts}`).join(', ')}`)))) : null);
    }

    function renderCalls() {
      const c = t('smdServiceCalls');
      if (!c) return replace(boxes.calls, h('p', { class: 'muted' }, '—'));
      replace(boxes.calls,
        c.open.length ? h('div', { class: 'list' }, c.open.map(x => h('div', { class: ['row-item', 'current'] },
          h('span', { class: ['state-dot', x.state === 'called' ? 'onHold' : 'opened'] }),
          h('span', { class: 'name' }, seatLabel(x.seatId), h('small', { class: 'sub' }, `${x.state === 'called' ? 'waiting for an usher' : 'usher on the way'} · since ${time(x.since)}`)),
          h('span'), h('span')))) : h('p', { class: 'muted' }, 'No open usher calls.'),
        c.done.length ? h('details', null, h('summary', null, `Recent (${c.done.length})`),
          h('ul', { class: 'compact' }, c.done.map(x => h('li', null, `${time(x.at)} ${seatLabel(x.seatId)}: ${x.state}`)))) : null);
    }

    function renderInterpretation() {
      const i = t('smdInterpretation');
      if (!i?.desks.length && !i?.booths.length) return replace(boxes.interpretation, h('p', { class: 'muted' }, 'No interpreter desks reported.'));
      replace(boxes.interpretation,
        h('ul', { class: 'compact' }, i.desks.map(d => h('li', null,
          h('strong', null, `Booth ${d.boothNumber ?? '?'} · desk ${d.number}`), ' ',
          d.translating ? `${d.source?.abbreviation ?? d.source?.language ?? 'floor'} → ${d.destination?.output ?? ''} ${d.destination?.abbreviation ?? d.destination?.language ?? ''}`.trim() : h('span', { class: 'muted' }, 'not translating')))),
        i.booths.length ? kv('Booths in use', i.booths.filter(b => b.inUse).map(b => b.number).join(', ') || 'none') : null);
    }

    function renderTest() {
      const m = t('smdMicTest');
      if (!m?.state && !m?.channelTest) return replace(boxes.test, h('p', { class: 'muted' }, 'No test run seen.'));
      const failed = (m.results ?? []).filter(r => !r.passed).flatMap(r => r.seatIds);
      const passed = (m.results ?? []).filter(r => r.passed).flatMap(r => r.seatIds);
      replace(boxes.test,
        m.state ? kv('Microphone test', `${humanize(m.state)} · ${time(m.at)}`) : null,
        m.results?.length ? kv('Result', `${passed.length} passed, ${failed.length} failed`) : null,
        failed.length ? h('p', null, h('strong', null, 'Failed: '), failed.map(seatName).join(', ')) : null,
        m.channelTest ? kv('Channel test', m.channelTest.running ? 'running' : `done · ${time(m.channelTest.at)}`) : null);
    }

    function renderLog() {
      const log = t('smdLog') ?? [];
      replace(boxes.log, log.length
        ? h('table', { class: 'data' }, h('tbody', null, log.slice(0, 40).map(e => h('tr', null,
          h('td', { class: 'muted' }, time(e.at)), h('td', null, humanize(e.type)), h('td', { class: 'muted' }, e.summary || '')))))
        : h('p', { class: 'muted' }, 'No activities yet.'));
    }

    const card = (title, box) => h('article', { class: 'card' }, h('h2', null, title), box);
    el.append(
      h('h1', { id: 'view-title' }, 'DCN'),
      h('p', { class: 'muted' }, 'Read-only: LikeABosch follows the DCN meeting through the DCN-SW server\'s meeting data stream (DCN-SWSMD). The meeting is operated on the DCN system.'),
      h('div', { class: 'split' },
        h('div', { class: 'stack' }, card('Meeting', boxes.meeting), card('Voting', boxes.voting), card('Usher calls', boxes.calls), card('Interpretation', boxes.interpretation)),
        h('div', { class: 'stack' }, card('Meeting data stream', boxes.stream), card('Tests', boxes.test), card('Activity log', boxes.log))),
    );
    const parts = [
      [['topic:smdStream'], renderStream],
      [['topic:smdMeeting'], renderMeeting],
      [['topic:smdVoting'], renderVoting],
      [['topic:smdServiceCalls', 'topic:smdSeats', 'topic:smdParticipants'], renderCalls],
      [['topic:smdInterpretation'], renderInterpretation],
      [['topic:smdMicTest', 'topic:smdSeats'], renderTest],
      [['topic:smdLog'], renderLog],
    ];
    parts.forEach(([, fn]) => fn());
    const offs = parts.map(([keys, fn]) => store.subscribe([...keys, 'connection'], fn));
    const tick = setInterval(renderStream, 10_000); // keep "x s ago" fresh
    return () => { offs.forEach(off => off()); clearInterval(tick); };
  },
};
