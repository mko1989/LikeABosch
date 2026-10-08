// Meeting: activate / open / close meetings (WO-020); the agenda has its own view in the Meeting area (WO-046).
// The PDF lists no permissions for these operations; controls are gated on canManageMeeting (inferred, WO-020 decision).
import { h, replace, humanize, actionButton } from '../dom.js';

const ACTIVE_STATES = new Set(['activated', 'opened', 'closed']);

export default {
  id: 'meetings',
  feature: 'meetings', // wired only (DEC-010)
  title: 'Meeting',
  topics: ['meetings', 'meetingInfo'],
  mount(el, { store, api }) {
    const listBox = h('div', { class: 'list' });
    const detailBox = h('div');
    const canManage = () => store.can('canManageMeeting');

    const meetings = () => store.topic('meetings')?.meetings ?? [];
    const info = () => store.topic('meetingInfo')?.meetingInfo ?? null;
    /** Built-in "Default" meeting: active when no prepared meeting is (real 6.50 server); not in GetMeetings. */
    const isBuiltIn = m => Boolean(m) && !meetings().some(x => x.meetingId === m.meetingId);
    /** The active *prepared* meeting, or null (the Default meeting doesn't count). */
    const active = () => {
      const m = info() ?? meetings().find(x => ACTIVE_STATES.has(x.state)) ?? null;
      return m && !isBuiltIn(m) ? m : null;
    };

    const formatDate = iso => {
      if (!iso) return '';
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    };

    function renderList() {
      const list = meetings();
      const current = active();
      if (!list.length) {
        replace(listBox, h('p', { class: 'muted empty' }, store.unavailable('meetings') ? `Meeting list not available: ${store.unavailable('meetings')}` : 'No meetings prepared'));
        return;
      }
      replace(listBox, list.map(m => {
        const isActive = current?.meetingId === m.meetingId;
        return h('div', { class: ['row-item', 'meeting-row', isActive && 'current'] },
          h('span', { class: ['state-dot', m.state], title: humanize(m.state) }),
          h('span', { class: 'name' }, m.title || m.meetingId,
            m.isDefault ? h('small', { class: 'tag' }, 'default') : null,
            h('small', { class: 'sub' }, [formatDate(m.meetingStartDate), humanize(m.state)].filter(Boolean).join(' · '))),
          h('span'),
          h('span', { class: 'row-actions' },
            canManage() && !current && m.state === 'deactivated'
              ? actionButton('Activate', () => api.wired('ActivateMeeting', { meetingId: m.meetingId }), { cls: 'small primary' })
              : null));
      }));
    }

    function renderDetail() {
      const m = active();
      if (!m) {
        const builtIn = info();
        replace(detailBox,
          h('p', { class: 'muted' }, 'No prepared meeting is active. Activate one from the list to start.'),
          builtIn ? h('p', { class: 'muted hint' }, `The system runs its built-in "${builtIn.title}" meeting (${humanize(builtIn.state).toLowerCase()}).`) : null);
        return;
      }
      const topics = store.topic('agendaTopics')?.agendaTopics ?? m.agendaList ?? [];
      const openTopic = topics.find(t => t.state === 'opened');
      const manage = canManage();
      replace(detailBox,
        h('p', { class: 'headline' }, m.title),
        m.description ? h('p', { class: 'muted' }, m.description) : null,
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'State'), h('span', { class: ['v', 'state', m.state] }, humanize(m.state))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Scheduled'), h('span', { class: 'v' }, [formatDate(m.meetingStartDate), formatDate(m.meetingEndDate)].filter(Boolean).join(' – ') || '—')),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Identification'), h('span', { class: 'v' }, `${humanize(m.identificationMethod)} / ${humanize(m.verificationMethod)}`)),
        manage ? h('div', { class: 'actions' },
          m.state !== 'opened' ? actionButton('Open meeting', () => api.wired('OpenMeeting'), { cls: 'primary' }) : null,
          m.state === 'opened' ? actionButton('Close meeting', () => api.wired('CloseMeeting'), { confirm: `Close "${m.title}"?` }) : null,
          actionButton('Deactivate', () => api.wired('DeactivateMeeting'), {
            cls: 'danger-outline', danger: true, confirm: `Deactivate "${m.title}"? The discussion list will be cleared.`,
          })) : null,
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Agenda'), h('span', { class: 'v' },
          `${topics.length} topic${topics.length === 1 ? '' : 's'}${openTopic ? ` · open: ${openTopic.subject}` : ''} `,
          h('a', { href: '#/meeting/agenda' }, 'Agenda →'))),
      );
    }

    const render = () => { renderList(); renderDetail(); };
    el.append(
      h('h1', { id: 'view-title' }, 'Meeting'),
      h('div', { class: 'split' },
        h('article', { class: 'card' }, h('h2', null, 'Meetings'), listBox),
        h('article', { class: 'card' }, h('h2', null, 'Active meeting'), detailBox)),
    );
    render();
    return store.subscribe(['topic:meetings', 'topic:meetingInfo', 'topic:agendaTopics', 'connection'], render);
  },
};
