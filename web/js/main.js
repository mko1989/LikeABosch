// Web UI bootstrap (WO-018, DEC-009).
import { createStore } from './store.js';
import { createRouter } from './router.js';
import { api } from './api.js';
import { h, replace, toast, humanize } from './dom.js';
import { mountProjectBar } from './project-bar.js';
import overview from './views/overview.js';
import connection from './views/connection.js';
import discussion from './views/discussion.js';
import meetings from './views/meetings.js';
import voting from './views/voting.js';
import system from './views/system.js';
import participants from './views/participants.js';
import interpretation from './views/interpretation.js';
import files from './views/files.js';
import roomView from './views/room.js';
import cameras from './views/cameras.js';
import automation from './views/automation.js';
import companionView from './views/companion.js';
import agenda from './views/agenda.js';
import seating from './views/seating.js';
import audio from './views/audio.js';
import dcnView from './views/dcn.js';
import dcnStream from './views/dcn-stream.js';
import wapDiscussion from './views/wap-discussion.js';
import wapAudio from './views/wap-audio.js';
import wapSeats from './views/wap-seats.js';
import wapDisplays from './views/wap-displays.js';

/** Placeholder entries for views built in later WOs. */
const soon = (id, title, wo, text) => ({
  id, title, comingSoon: true,
  mount(el) {
    el.append(h('h1', { id: 'view-title' }, title), h('div', { class: 'card placeholder' }, h('p', null, text), h('p', { class: 'muted' }, `Planned in ${wo}.`)));
  },
});

/** The room view (WO-035) is the home screen; meeting views form their own area (DEC-014); the rest is Settings. */
const room = roomView;

const areas = [
  { id: 'meeting', title: 'Meeting', views: [meetings, agenda, participants, seating] },
  {
    id: 'settings',
    title: 'Settings',
    views: [
      overview,
      cameras,
      automation,
      companionView,
      discussion,
      wapDiscussion,
      voting,
      interpretation,
      audio,
      wapAudio,
      wapSeats,
      wapDisplays,
      system,
      dcnView,
      dcnStream,
      files,
      { ...soon('plugins', 'Plugins', 'WO-026', 'Third-party plugins: commands and events.'), feature: 'plugins' },
      connection,
    ],
  },
];

const store = createStore();
const router = createRouter({
  home: room,
  areas,
  nav: document.getElementById('nav'),
  tabs: document.getElementById('tabs'),
  outlet: document.getElementById('outlet'),
  store,
  ctx: { store, api, navigate: id => router.navigate(id) },
});

const CONNECTION_LABEL = {
  disconnected: 'Not connected', connecting: 'Connecting…', connected: 'Logging in…', loggedIn: 'Connected', reconnecting: 'Reconnecting…',
};

function renderHeader() {
  const { stream, connection: c } = store.state;
  const pill = document.getElementById('connection-pill');
  const failed = c?.state === 'disconnected' && c?.lastError;
  pill.dataset.state = stream === 'lost' ? 'lost' : failed ? 'error' : c?.state ?? 'disconnected';
  pill.textContent = stream === 'lost' ? 'Backend unreachable' : failed ? 'Connection failed' : CONNECTION_LABEL[c?.state] ?? '…';
  pill.title = c?.lastError?.message ?? '';

  const room = store.topic('roomName')?.roomName ?? store.topic('wirelessSystemInfo')?.Hostname;
  const meeting = store.topic('meetingInfo')?.meetingInfo;
  replace(document.getElementById('header-context'),
    c?.simulated ? h('span', { class: 'tag sim-tag', title: 'A simulated system inside LikeABosch (Settings → Connection → Simulation)' }, 'SIMULATED') : null,
    room ? h('strong', null, room) : null,
    room && meeting ? ' · ' : null,
    meeting ? `${meeting.title} (${humanize(meeting.state).toLowerCase()})` : null);

  const banner = document.getElementById('banner');
  if (stream === 'lost') {
    replace(banner, 'Lost connection to the backend, retrying…');
    banner.hidden = false;
  } else if (c && c.state !== 'loggedIn') {
    replace(banner, `Not connected to DICENTIS (${CONNECTION_LABEL[c.state].toLowerCase()}). `, h('a', { href: '#/settings/connection' }, 'Connection settings'),
      c.simulated ? null : [' · No hardware? ', h('a', { href: '#/settings/connection?simulate' }, 'Simulate a system')]); // WO-098
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

store.subscribe(['stream', 'connection', 'topic:roomName', 'topic:wirelessSystemInfo', 'topic:meetingInfo'], renderHeader);
store.subscribe(['notification'], n => {
  if (n.topic === 'participantAccessDenied') {
    const reasons = n.data?.participantAccessDeniedReasonsInfo?.accessDeniedReasons ?? [];
    toast(`Participant access denied${reasons.length ? `: ${reasons.map(humanize).join(', ')}` : ''}`, 'error');
  }
});

const toggle = document.getElementById('nav-toggle');
toggle.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  toggle.setAttribute('aria-expanded', String(open));
});
window.addEventListener('hashchange', () => document.body.classList.remove('nav-open'));

mountProjectBar(document.getElementById('project-bar'), { store, api });
store.start();
router.start();
renderHeader();
