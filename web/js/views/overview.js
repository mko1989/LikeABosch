// Overview: read-only summary of the live DICENTIS state (WO-018).
import { h, replace, humanize } from '../dom.js';


/**
 * A card that re-renders when any of its topics change.
 * @param {ReturnType<import('../store.js').createStore>} store
 * @param {string} title
 * @param {string[]} topics
 * @param {() => any} body  returns children; called on every change
 * @param {string[]} [watch]  further topics shown in the card (re-render on change, but not required)
 */
function card(store, title, topics, body, watch = []) {
  const content = h('div', { class: 'card-body' });
  const el = h('article', { class: 'card' }, h('h2', null, title), content);
  const render = () => {
    const missing = topics.every(t => store.topic(t) === undefined);
    const reason = topics.map(t => store.unavailable(t)).find(Boolean);
    replace(content, missing ? h('p', { class: 'muted' }, store.live ? (reason ? `Not available (${reason})` : 'Loading…') : 'Not connected') : body());
  };
  render();
  const off = store.subscribe([...topics, ...watch].map(t => `topic:${t}`).concat('connection', 'topic:domain.capabilities'), render);
  return { el, off };
}

const kv = (label, value) => h('div', { class: 'kv' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, value));

export default {
  id: 'overview',
  title: 'Overview',
  mount(el, { store }) {
    const meeting = card(store, 'Meeting', ['meetingInfo'], () => {
      const m = store.topic('meetingInfo')?.meetingInfo;
      if (!m) return h('p', { class: 'muted' }, 'No active meeting');
      const topic = m.agendaList?.find(t => t.state === 'opened');
      return [
        h('p', { class: 'headline' }, m.title || '—'),
        kv('State', h('span', { class: ['state', m.state] }, humanize(m.state))),
        kv('Agenda topic', topic ? topic.subject : 'none open'),
        kv('Agenda items', String(m.agendaList?.length ?? 0)),
      ];
    });

    const discussion = card(store, 'Discussion', ['domain.discussion'], () => {
      const d = store.topic('domain.discussion');
      const speaking = d?.speakers ?? [];
      const waiting = d?.requests ?? [];
      return [
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('strong', null, String(speaking.length)), h('span', null, 'speaking')),
          h('div', { class: 'stat' }, h('strong', null, String(waiting.length)), h('span', null, 'waiting'))),
        speaking.length
          ? h('ul', { class: 'compact' }, speaking.map(e => h('li', null,
            h('span', { class: ['mic', e.micState] }, humanize(e.micState)), ' ', e.name)))
          : h('p', { class: 'muted' }, 'Nobody is speaking'),
      ];
    });

    const voting = card(store, 'Voting', ['domain.voting'], () => {
      const v = store.topic('domain.voting');
      const results = v?.results ?? [];
      return [
        kv('State', h('span', { class: ['state', v?.state] }, humanize(v?.state))),
        kv('Subject', v?.subject || '—'),
        results.length ? h('ul', { class: 'compact' }, results.map(r => h('li', null, `${humanize(r.answer)}: ${r.count}`))) : null,
      ];
    });

    const system = card(store, 'System', ['domain.power'], () => {
      const power = store.topic('domain.power')?.state;
      const volume = store.topic('masterVolume')?.volume;
      const range = store.topic('masterVolumeRange')?.range;
      const presentation = store.topic('presentationState')?.isPresentationEnabled;
      return [
        kv('Power', h('span', { class: ['state', `power-${power}`] }, humanize(power))),
        store.feature('masterVolume') ? kv('Master volume', volume === undefined ? '—'
          : range ? `${volume}${range.minimumVolume < 0 ? ' dB' : ''} (${range.minimumVolume}–${range.maximumVolume})` : String(volume)) : null, // real systems: dB
        store.feature('presentation') ? kv('Presentation', presentation === undefined ? '—' : presentation ? 'On' : 'Off') : null,
      ];
    }, ['masterVolume', 'masterVolumeRange', 'presentationState']);

    // DCN (WO-063): no power or room data; the system card shows the DCN state, the room card the running meeting.
    const dcnSystem = card(store, 'DCN', ['dcnBridge'], () => {
      const volume = store.topic('dcnMasterVolume')?.volume;
      const mute = store.topic('dcnMasterMute')?.mute;
      const ctl = store.topic('dcnBridge')?.status?.control;
      return [
        kv('DCN-SW', ctl?.available ? 'available' : ctl?.initialized ? 'server not reachable' : 'not initialized'),
        kv('Master volume', volume === undefined ? '—' : String(volume)),
        kv('Muted', mute === undefined ? '—' : mute ? 'Yes' : 'No'),
      ];
    }, ['dcnMasterVolume', 'dcnMasterMute']);
    const dcnRoom = card(store, 'Meeting', ['dcnMeetings', 'domain.seats'], () => {
      const meetingId = store.topic('dcnActiveMeeting')?.meetingId;
      const sessionId = store.topic('dcnActiveSession')?.sessionId;
      const m = (store.topic('dcnMeetings') ?? []).find(x => x.id === meetingId);
      const sess = (store.topic('dcnSessions') ?? []).find(x => x.id === sessionId);
      return [
        h('p', { class: 'headline' }, m ? m.Title || `Meeting ${m.id}` : 'No meeting running'),
        kv('Session', sess ? sess.Subject || String(sess.id) : '—'),
        kv('Seats', String(store.topic('domain.seats')?.length ?? '—')),
        kv('Participants', String(store.topic('domain.participants')?.length ?? '—')),
      ];
    }, ['dcnActiveMeeting', 'dcnActiveSession', 'dcnSessions', 'domain.participants']);

    // DCN meeting data stream (WO-067, DEC-018): read-only stream state + the meeting it reports.
    const ago = iso => {
      if (!iso) return '—';
      const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
      return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(iso).toLocaleString();
    };
    const smdSystem = card(store, 'DCN meeting data', ['smdStream'], () => {
      const st = store.topic('smdStream');
      const calls = store.topic('smdServiceCalls')?.open ?? [];
      return [
        kv('Stream', st.state === 'loggedIn' ? (st.origin === 'restored' ? 'connected, waiting for news' : 'live') : humanize(st.state)),
        kv('Last activity', ago(st.lastActivityAt)),
        kv('Usher calls', calls.length ? h('strong', null, String(calls.length)) : '0'),
      ];
    }, ['smdServiceCalls']);
    const smdRoom = card(store, 'Meeting', ['smdMeeting'], () => {
      const { meeting, session, sessions } = store.topic('smdMeeting');
      const sess = sessions.find(x => x.id === session?.id);
      return [
        h('p', { class: 'headline' }, meeting ? meeting.subject || `Meeting ${meeting.id}` : 'No meeting running'),
        kv('Session', sess ? `${sess.subject || sess.id}${session.state === 'suspended' ? ' (suspended)' : ''}` : '—'),
        kv('Seats', String(store.topic('domain.seats')?.length ?? '—')),
        kv('Participants', String(store.topic('domain.participants')?.length ?? '—')),
      ];
    }, ['domain.seats', 'domain.participants']);

    const roomTopic = store.system === 'wireless' ? 'wirelessSystemInfo' : 'roomName';
    const room = card(store, store.system === 'wireless' ? 'Access point' : 'Room', [roomTopic, 'domain.seats'], () => {
      const info = store.topic('wirelessSystemInfo');
      return [
        h('p', { class: 'headline' }, store.system === 'wireless' ? info?.Hostname || info?.['System Type'] || '—' : store.topic('roomName')?.roomName || '—'),
        store.system === 'wireless'
          ? kv('Firmware', info?.Versions?.Firmware ?? '—')
          : kv('Contact', store.topic('roomContactEmail')?.roomContactEmail || '—'),
        kv('Seats', String(store.topic('domain.seats')?.length ?? '—')),
        kv('Participants', String(store.topic('domain.participants')?.length ?? '—')),
      ];
    }, ['roomContactEmail', 'domain.participants']);

    const dcn = store.system === 'dcn';
    const smd = store.system === 'dcn-smd';
    const all = [meeting, discussion, voting, system, room, dcnSystem, dcnRoom, smdSystem, smdRoom];
    const shown = all.filter(c => (c === meeting ? store.feature('meetings')
      : c === system || c === room ? !dcn && !smd
        : c === dcnSystem || c === dcnRoom ? dcn
          : c === smdSystem || c === smdRoom ? smd : true));
    el.append(
      h('h1', { id: 'view-title' }, 'Overview'),
      h('div', { class: 'cards' }, shown.map(c => c.el)),
    );
    return () => all.forEach(c => c.off());
  },
};
