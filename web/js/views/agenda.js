// Agenda of the active meeting: open / close / switch topics (WO-020, split into its own view in WO-046).
// Topics are prepared in Bosch's Meeting Application: the Conference Protocol cannot create or edit them (DEC-014).
import { h, replace, humanize, actionButton } from '../dom.js';

const ACTIVE_STATES = new Set(['activated', 'opened', 'closed']);

export default {
  id: 'agenda',
  feature: 'agenda', // wired only (DEC-010)
  title: 'Agenda',
  topics: ['meetings', 'meetingInfo'],
  mount(el, { store, api }) {
    const box = h('div');
    const canManage = () => store.can('canManageMeeting');
    const meetings = () => store.topic('meetings')?.meetings ?? [];
    /** The active prepared meeting (the built-in Default meeting is not in GetMeetings and has no agenda). */
    const active = () => {
      const info = store.topic('meetingInfo')?.meetingInfo;
      const m = info ?? meetings().find(x => ACTIVE_STATES.has(x.state)) ?? null;
      return m && meetings().some(x => x.meetingId === m.meetingId) ? m : null;
    };

    function render() {
      const m = active();
      if (!m) {
        replace(box, h('p', { class: 'muted' }, 'No prepared meeting is active. ', h('a', { href: '#/meeting/meetings' }, 'Activate a meeting'), ' to see its agenda.'));
        return;
      }
      const topics = store.topic('agendaTopics')?.agendaTopics ?? m.agendaList ?? [];
      const openTopic = topics.find(t => t.state === 'opened');
      const manage = canManage();
      replace(box,
        h('p', { class: 'headline' }, m.title, h('small', { class: ['state', m.state] }, ` ${humanize(m.state)}`)),
        topics.length ? h('ol', { class: 'agenda' }, topics.map(t => h('li', { class: ['agenda-item', t.state] },
          h('div', { class: 'agenda-text' },
            h('strong', null, t.subject || t.agendaTopicId),
            t.description ? h('small', { class: 'muted' }, t.description) : null),
          t.state === 'opened'
            ? h('span', { class: 'agenda-actions' }, h('span', { class: 'state opened' }, 'Open'),
              manage ? actionButton('Close', () => api.wired('CloseAgenda'), { cls: 'small' }) : null)
            : manage && m.state === 'opened'
              ? actionButton(openTopic ? 'Switch to' : 'Open', () => api.wired('OpenAgenda', { agendaTopicId: t.agendaTopicId }), { cls: 'small' })
              : null)))
          : h('p', { class: 'muted' }, 'No agenda topics'),
        manage && m.state !== 'opened' && topics.length ? h('p', { class: 'muted hint' }, 'Open the meeting to open agenda topics.') : null,
        h('p', { class: 'muted hint' }, 'Agenda topics are prepared in the DICENTIS Meeting Application; the protocol used here can only open and close them.'));
    }

    el.append(h('h1', { id: 'view-title' }, 'Agenda'), h('article', { class: 'card' }, box));
    render();
    return store.subscribe(['topic:meetings', 'topic:meetingInfo', 'topic:agendaTopics', 'connection'], render);
  },
};
