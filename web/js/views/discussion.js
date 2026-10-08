// Seats & discussion: speakers, requests, seat grid and microphone control (WO-019; on the domain layer since WO-027).
// Works on wired and wireless systems; extras depend on domain capabilities (DEC-010).
import { h, replace, humanize, toastError, formatDuration, actionButton } from '../dom.js';
import { remainingSpeechMs } from '../speech-timer.js';

export default {
  id: 'discussion',
  title: 'Seats & discussion',
  topics: ['domain.discussion', 'domain.seats'],
  mount(el, { store, api }) {
    const speakersBox = h('div', { class: 'list' });
    const requestsBox = h('div', { class: 'list' });
    const grid = h('div', { class: 'seat-grid', role: 'list' });
    const filter = h('input', { type: 'search', placeholder: 'Filter seats or names…', 'aria-label': 'Filter seats', oninput: renderGrid });
    const speakersCount = h('span', { class: 'count' });
    const requestsCount = h('span', { class: 'count' });
    const headerActions = h('span', { class: 'row-actions' });
    const showHidden = h('input', { type: 'checkbox', onchange: () => renderGrid() });
    const hiddenToggle = h('label', { class: 'check hidden-toggle', hidden: true }, showHidden, h('span'));

    let lastDiscussion = null;
    let localReference = Date.now();
    const busy = new Set(); // seatIds with a request in flight

    const discussion = () => store.topic('domain.discussion');
    const canManage = () => store.action('manageDiscussion');
    const canMute = () => store.action('muteMicrophones');

    async function act(seatId, method, path, body) {
      busy.add(seatId);
      renderAll();
      try {
        await api.domain(method, path, body);
      } catch (err) {
        toastError(err);
      } finally {
        busy.delete(seatId);
        renderAll();
      }
    }

    const button = (label, seatId, method, path, body, cls = 'secondary') => h('button', {
      type: 'button', class: ['small', cls], disabled: busy.has(seatId),
      onclick: e => { e.stopPropagation(); act(seatId, method, path, body); },
    }, label);

    const enc = encodeURIComponent;
    const add = id => button('Add', id, 'POST', '/discussion/speakers', { seatId: id });
    const giveFloor = id => button('Give floor', id, 'POST', '/discussion/speakers', { seatId: id }, 'primary');
    const removeSpeaker = id => button('Remove', id, 'DELETE', `/discussion/speakers/${enc(id)}`, undefined, 'danger-outline');
    const removeRequest = id => button('Remove', id, 'DELETE', `/discussion/requests/${enc(id)}`, undefined, 'danger-outline');

    /** Timer entry in the shape the PDF formula expects. */
    const timerEntry = e => ({ microphoneState: e.micState, remainingSpeechDuration: e.timer?.remainingSpeechDuration, speechStartTime: e.timer?.speechStartTime, showSpeechTimer: e.timer?.show });
    const timerText = e => {
      if (!e.timer || !store.feature('speechTimers')) return '';
      const ms = remainingSpeechMs(timerEntry(e), discussion()?.referenceTime ?? 0, localReference);
      return ms === null ? '' : formatDuration(ms);
    };

    function row(entry, actions, { timer = false } = {}) {
      return h('div', { class: ['row-item', entry.priority && 'isPrioritySpeaker', `mic-${entry.micState}`] },
        h('span', { class: ['mic', entry.micState], title: `Microphone ${entry.micState}` }, humanize(entry.micState)),
        h('span', { class: 'name' }, entry.name,
          entry.kind !== 'speaker' && entry.kind !== 'request' ? h('small', { class: 'tag' }, humanize(entry.kind)) : null,
          entry.first ? h('small', { class: 'tag' }, 'next') : null,
          entry.name !== entry.seatName ? h('small', { class: 'sub' }, entry.seatName) : null),
        timer ? h('span', { class: 'timer', dataset: { seat: entry.seatId } }, timerText(entry)) : h('span'),
        h('span', { class: 'row-actions' }, actions(entry)));
    }

    function renderLists() {
      const d = discussion();
      const speakers = d?.speakers ?? [];
      const requests = d?.requests ?? [];
      speakersCount.textContent = String(speakers.length);
      requestsCount.textContent = String(requests.length);
      const canTime = canManage() && store.feature('speechTimeAdjust');
      replace(speakersBox, speakers.length ? speakers.map(e => row(e, entry => [
        canTime ? h('span', { class: 'time-adjust', role: 'group', 'aria-label': 'Speech time' },
          button('−1′', entry.seatId, 'POST', `/discussion/speakers/${enc(entry.seatId)}/time/decrease`),
          button('+1′', entry.seatId, 'POST', `/discussion/speakers/${enc(entry.seatId)}/time/increase`),
          button('↺', entry.seatId, 'POST', `/discussion/speakers/${enc(entry.seatId)}/time/reset`)) : null,
        canMute() && entry.micState === 'on' ? button('Mute', entry.seatId, 'POST', `/discussion/speakers/${enc(entry.seatId)}/mute`) : null,
        canMute() && entry.micState === 'mute' ? button('Unmute', entry.seatId, 'POST', `/discussion/speakers/${enc(entry.seatId)}/unmute`) : null,
        canManage() ? removeSpeaker(entry.seatId) : null,
      ], { timer: true })) : h('p', { class: 'muted empty' }, 'Nobody is speaking'));
      replace(requestsBox, requests.length ? requests.map((e, i) => row(e, entry => [
        h('span', { class: 'position' }, `#${i + 1}`),
        canManage() ? giveFloor(entry.seatId) : null,
        canManage() ? removeRequest(entry.seatId) : null,
      ])) : h('p', { class: 'muted empty' }, 'No requests'));
      const opts = store.topic('discussionOptions');
      speakersCount.title = opts ? `Discussion mode ${opts.discussionMode} · max ${opts.maxRequests} requests · max ${opts.maxResponses} responses` : '';
      replace(headerActions, canManage() && store.feature('clearDiscussion') && (speakers.length || requests.length)
        ? actionButton('Clear all', () => api.domain('DELETE', '/discussion'), {
          cls: 'small danger-outline', danger: true, confirm: 'Remove all speakers and requests? Priority calls stay, with the microphone off.',
        })
        : null);
    }

    function seatAction(seat, state, entry) {
      if (!canManage()) return null;
      const actions = [];
      if (state === 'idle') {
        actions.push(add(seat.id));
        if (store.feature('requestQueueAdd')) actions.push(button('Request', seat.id, 'POST', '/discussion/requests', { seatId: seat.id }));
      } else if (state === 'waiting') {
        actions.push(giveFloor(seat.id));
      } else {
        actions.push(removeSpeaker(seat.id));
      }
      if (store.feature('priorityCalls') && seat.canPrio) {
        actions.push(entry?.priority
          ? button('End priority', seat.id, 'DELETE', `/discussion/priority/${enc(seat.id)}`)
          : button('Priority', seat.id, 'POST', `/discussion/priority/${enc(seat.id)}`));
      }
      return actions;
    }

    function renderGrid() {
      const seats = store.topic('domain.seats') ?? [];
      const d = discussion();
      const bySeat = new Map([...(d?.requests ?? []).map(e => [e.seatId, { ...e, waiting: true }]), ...(d?.speakers ?? []).map(e => [e.seatId, e])]);
      const q = filter.value.trim().toLowerCase();
      const hiddenCount = seats.filter(s => s.hidden).length;
      hiddenToggle.hidden = hiddenCount === 0;
      hiddenToggle.lastChild.textContent = ` Show hidden seats (${hiddenCount})`;
      const visible = showHidden.checked ? seats : seats.filter(s => !s.hidden);
      const shown = q ? visible.filter(s => `${s.name} ${s.person} ${s.id}`.toLowerCase().includes(q)) : visible;
      const diag = store.feature('seatDiagnostics');
      replace(grid, shown.length ? shown.map(seat => {
        const entry = bySeat.get(seat.id);
        const state = !entry ? 'idle' : entry.waiting ? 'waiting' : entry.micState === 'on' ? 'speaking' : 'muted';
        return h('div', {
          class: ['seat', state, !seat.connected && 'offline', seat.hidden && 'hidden-seat'], role: 'listitem', dataset: { seat: seat.id },
          title: `${seat.name} · ${seat.connected ? 'connected' : 'disconnected'}${seat.remote ? ' · remote' : ''}`,
        },
        h('div', { class: 'seat-name' }, seat.name, seat.hidden ? h('small', { class: 'tag' }, 'hidden') : null),
        h('div', { class: 'seat-person' }, seat.person || ' '),
        diag && seat.diagnostics ? h('div', { class: 'seat-diag', title: 'Battery hours left · signal level' },
          `🔋 ${seat.diagnostics.batteryHours ?? '–'} h · ${seat.diagnostics.signalDbm ?? '–'} dBm`) : null,
        h('div', { class: 'seat-foot' },
          h('span', { class: 'seat-state' }, state === 'idle' ? (seat.connected ? '' : 'Disconnected') : humanize(state)),
          h('span', { class: 'seat-actions' }, seatAction(seat, state, entry))));
      }) : h('p', { class: 'muted' }, q ? 'No seats match the filter' : 'No seats'));
    }

    function renderAll() {
      const d = discussion();
      if (d !== lastDiscussion) {
        lastDiscussion = d;
        localReference = Date.now(); // the timer formula needs the local time the list arrived (PDF p.68)
      }
      renderLists();
      renderGrid();
    }

    const timer = setInterval(() => {
      const d = discussion();
      if (!d) return;
      const byId = new Map(d.speakers.map(e => [e.seatId, e]));
      for (const span of el.querySelectorAll('.timer')) {
        const entry = byId.get(span.dataset.seat);
        if (!entry) continue;
        const text = timerText(entry);
        span.textContent = text;
        span.classList.toggle('overtime', text.startsWith('-'));
      }
    }, 1000);

    el.append(
      h('h1', { id: 'view-title' }, 'Seats & discussion'),
      h('div', { class: 'discussion-layout' },
        h('div', { class: 'discussion-lists' },
          h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Speakers ', speakersCount), headerActions), speakersBox),
          h('article', { class: 'card' }, h('h2', null, 'Requests ', requestsCount), requestsBox)),
        h('article', { class: 'card seats-card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Seats'), hiddenToggle, filter),
          grid)),
    );

    renderAll();
    const off = store.subscribe(['topic:domain.discussion', 'topic:domain.seats', 'topic:domain.capabilities', 'topic:discussionOptions', 'connection'], renderAll);
    return () => { off(); clearInterval(timer); };
  },
};
