// Seating: which participant is assigned to / sitting at which seat (WO-046, DEC-014).
// Editable when the system allows participant editing (capability editParticipants): wireless (WO-084/085) and wired
// with the full DICENTIS API (dicentis-bridge, DEC-034); each seat row then has a participant picker (WO-124).
// Otherwise read-only. "Show on plan" opens the room with the seat selected.
import { h, replace, toast, toastError } from '../dom.js';
import { participantIoButtons } from '../participants-io.js';

const FILTERS = [['all', 'All seats'], ['assigned', 'With participant'], ['free', 'Without participant'], ['seated', 'Seated now']];

export default {
  id: 'seating',
  title: 'Seating',
  feature: 'participants',
  topics: ['domain.seats', 'domain.participants'],
  mount(el, { store, api }) {
    const wireless = store.system === 'wireless'; // seats are assigned in Participants (WAP database)
    const dcn = store.system === 'dcn' || store.system === 'dcn-smd';
    const smd = store.system === 'dcn-smd';
    const noSeated = wireless || dcn; // neither reports who is sitting where right now
    const noDevice = dcn; // the DCN-SW API reports no seat/unit connection state
    const tableBody = h('tbody');
    const summary = h('p', { class: 'muted small-text' });
    const unassignedBox = h('div');
    const helpBox = h('div');
    let filter = 'all';
    let pickerOpen = false; // the user is choosing in a seat picker: the table waits (rebuilding it would close the list)
    let deferred = false; // a rebuild was skipped because of that
    const canEdit = () => Boolean(store.topic('domain.capabilities')?.actions?.editParticipants);
    const search = h('input', { type: 'search', placeholder: 'Search seat or name…', 'aria-label': 'Search seats and participants', oninput: render });
    const filterSelect = h('select', { 'aria-label': 'Filter seats', onchange: e => { filter = e.target.value; render(); } },
      FILTERS.filter(([v]) => !noSeated || v !== 'seated').map(([v, label]) => h('option', { value: v }, label)));

    const seats = () => store.topic('domain.seats') ?? [];
    const participants = () => store.topic('domain.participants') ?? [];
    const onPlan = id => `#/room?seat=${encodeURIComponent(id)}`;

    /** Give `seat` to a participant (id) or clear it (null): PUT /seats/:id/participant frees the previous holder. */
    async function assign(seat, participantId, select) {
      const who = participants().find(p => p.id === participantId);
      select.disabled = true;
      try {
        await api.domain('PUT', `/seats/${encodeURIComponent(seat.id)}/participant`, { participantId });
        toast(who ? `${who.name} → ${seat.name}${who.assignedSeatId && who.assignedSeatId !== seat.id ? ` (moved from ${seatName(who.assignedSeatId)})` : ''}` : `${seat.name} cleared`, 'success');
      } catch (err) {
        toastError(err, 'Seating: ');
      }
      render(true);
      if (!document.activeElement || document.activeElement === document.body) seatPicker(seat.id)?.focus();
    }
    const seatPicker = id => tableBody.querySelector(`tr[data-seat="${CSS.escape(id)}"] select.seat-picker`);
    const seatName = id => seats().find(s => s.id === id)?.name ?? id;

    function picker(seat, assigned, people) {
      const select = h('select', {
        class: 'seat-picker', 'aria-label': `Participant on ${seat.name}`,
        onpointerdown: () => { pickerOpen = true; },
        onkeydown: e => { pickerOpen = !['Escape', 'Tab'].includes(e.key); },
        onchange: e => { pickerOpen = false; assign(seat, e.target.value || null, e.target); },
        onblur: () => { pickerOpen = false; if (deferred) setTimeout(render); },
      },
        h('option', { value: '' }, '— nobody —'),
        people.map(p => h('option', { value: p.id, selected: p.id === assigned?.id },
          p.assignedSeatId && p.assignedSeatId !== seat.id ? `${p.name} (now ${seatName(p.assignedSeatId)})` : p.name)));
      return [select, assigned?.group ? h('small', { class: 'sub' }, assigned.group) : null];
    }

    /** @param {boolean} [force] rebuild the table even under a focused picker (after its own change) */
    function render(force) {
      const people = participants();
      const assignedTo = id => people.find(p => p.assignedSeatId === id) ?? null;
      const seatedAt = id => people.find(p => p.seatedSeatId === id) ?? null;
      const q = search.value.trim().toLowerCase();
      const rows = seats().map(seat => ({ seat, assigned: assignedTo(seat.id), seated: seatedAt(seat.id) }))
        .filter(({ assigned, seated }) => filter === 'all' || (filter === 'assigned' && (assigned || seated)) || (filter === 'free' && !assigned && !seated) || (filter === 'seated' && seated))
        .filter(({ seat, assigned, seated }) => !q || [seat.name, seat.person, assigned?.name, seated?.name].filter(Boolean).join(' ').toLowerCase().includes(q));
      const person = p => (p ? [h('strong', null, p.name), p.group ? h('small', { class: 'sub' }, p.group) : null] : h('span', { class: 'muted' }, '—'));
      const editable = canEdit();
      const sorted = editable ? [...people].sort((a, b) => a.sortName.localeCompare(b.sortName)) : [];
      const focused = tableBody.contains(document.activeElement) && document.activeElement.matches('select.seat-picker') ? document.activeElement.closest('tr')?.dataset.seat : null;
      deferred = force !== true && pickerOpen && Boolean(focused);
      if (!deferred) replace(tableBody, rows.length ? rows.map(({ seat, assigned, seated }) => h('tr', { class: [!seat.connected && 'absent'], 'data-seat': seat.id },
        h('td', null, h('strong', null, seat.name), seat.hidden ? h('small', { class: 'sub' }, 'hidden in synoptic') : null),
        h('td', null, editable ? picker(seat, assigned, sorted) : person(assigned)),
        noSeated ? null : h('td', null, seated ? person(seated) : h('span', { class: 'muted' }, assigned ? 'not logged in' : '—')),
        noDevice ? null : h('td', null, h('span', { class: ['pill', seat.connected ? 'loggedIn' : 'disconnected'] }, seat.connected ? 'connected' : 'offline')),
        h('td', { class: 'row-actions' }, h('a', { class: 'button-like secondary small', href: onPlan(seat.id) }, 'Show on plan')),
      )) : h('tr', null, h('td', { colspan: 5 - (noSeated ? 1 : 0) - (noDevice ? 1 : 0), class: 'muted' }, seats().length ? 'No seats match' : store.unavailable('domain.seats') ?? 'No seats')));
      if (!deferred && focused) seatPicker(focused)?.focus({ preventScroll: true }); // keyboard users keep their place across live updates

      const withSeat = people.filter(p => p.assignedSeatId || p.seatedSeatId).length;
      replace(summary, `${seats().length} seats · ${people.length} participants · ${withSeat} with a seat${noSeated ? '' : ` · ${people.filter(p => p.seatedSeatId).length} seated now`}`);
      const unassigned = people.filter(p => !p.assignedSeatId && !p.seatedSeatId).sort((a, b) => a.sortName.localeCompare(b.sortName));
      replace(unassignedBox, unassigned.length
        ? h('ul', { class: 'chips' }, unassigned.map(p => h('li', { title: p.group ?? '' }, p.name)))
        : h('p', { class: 'muted small-text' }, people.length ? 'Every participant has a seat.' : 'No participants in the active meeting.'));
    }

    el.append(
      h('h1', { id: 'view-title' }, 'Seating'),
      h('div', { class: 'split wide-main' },
        h('article', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Seats and participants'), h('div', { class: 'row-inline' }, search, filterSelect)),
          h('div', { class: 'summary-row' }, summary, participantIoButtons({ store, api })),
          h('div', { class: 'table-wrap' }, h('table', { class: 'data seating' },
            h('thead', null, h('tr', null, ['Seat', 'Assigned participant', noSeated ? null : 'Seated now', noDevice ? null : 'Device', ''].filter(t => t !== null).map(t => h('th', { scope: 'col' }, t)))), tableBody))),
        h('div', { class: 'stack' },
          h('article', { class: 'card' }, h('h2', null, 'Participants without a seat'), unassignedBox),
          h('article', { class: 'card' }, h('h2', null, 'Changing assignments'), helpBox)),
      ),
    );
    function renderHelp() {
      const elsewhere = [' Also in ', h('a', { href: '#/meeting/participants' }, 'Participants'), ' (Edit), in ', h('a', { href: '#/room' }, 'Room'),
        ' → Edit layout (select a seat), or with Import… from an Excel file (Export Excel gives the template).'];
      replace(helpBox, canEdit()
        ? h('p', { class: 'muted small-text' }, 'Pick a participant in the "Assigned participant" column to give them that seat. Someone who already has a seat moves; the seat\'s previous participant is left without one. "— nobody —" clears the seat.',
          wireless ? null : ' Changes the active meeting through the full DICENTIS API.', ...elsewhere)
        : smd
          ? h('p', { class: 'muted small-text' }, 'On DCN seats are assigned in the DCN Conference Software. LikeABosch reads them from the meeting data stream (when a meeting starts) and cannot change them.')
        : dcn
          ? h('p', { class: 'muted small-text' }, 'On DCN the seat is part of a delegate\'s registration for the meeting, prepared in the DCN Conference Software. LikeABosch shows it but does not edit it yet.')
        : wireless
          ? h('p', { class: 'muted small-text' }, 'The connected DICENTIS Wireless system does not let this user edit participants.')
          : h('p', { class: 'muted small-text' }, 'Read-only: the Conference Protocol can read seat assignments (Export Excel) but not change them. To assign seats here, turn on the full DICENTIS API (dicentis-bridge on a Windows PC with the DICENTIS software) in ',
            h('a', { href: '#/settings/connection' }, 'Settings → Connection'), '; until then use the DICENTIS Meeting Application.'));
    }
    const refresh = () => { renderHelp(); render(); };
    refresh();
    return store.subscribe(['topic:domain.seats', 'topic:domain.participants', 'topic:domain.capabilities', 'connection'], refresh);
  },
};
