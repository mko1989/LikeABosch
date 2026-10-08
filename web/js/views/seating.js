// Seating: which participant is assigned to / sitting at which seat (WO-046, DEC-014).
// Read-only: the Conference Protocol cannot change assignments (that is done in Bosch's Meeting Application, or later
// through the dicentis-bridge, WO-081). Wireless: editable (WO-084/085). "Show on plan" opens the room with the seat selected.
import { h, replace } from '../dom.js';
import { participantIoButtons } from '../participants-io.js';

const FILTERS = [['all', 'All seats'], ['assigned', 'With participant'], ['free', 'Without participant'], ['seated', 'Seated now']];

export default {
  id: 'seating',
  title: 'Seating',
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
    let filter = 'all';
    const search = h('input', { type: 'search', placeholder: 'Search seat or name…', 'aria-label': 'Search seats and participants', oninput: render });
    const filterSelect = h('select', { 'aria-label': 'Filter seats', onchange: e => { filter = e.target.value; render(); } },
      FILTERS.filter(([v]) => !noSeated || v !== 'seated').map(([v, label]) => h('option', { value: v }, label)));

    const seats = () => store.topic('domain.seats') ?? [];
    const participants = () => store.topic('domain.participants') ?? [];
    const onPlan = id => `#/room?seat=${encodeURIComponent(id)}`;

    function render() {
      const people = participants();
      const assignedTo = id => people.find(p => p.assignedSeatId === id) ?? null;
      const seatedAt = id => people.find(p => p.seatedSeatId === id) ?? null;
      const q = search.value.trim().toLowerCase();
      const rows = seats().map(seat => ({ seat, assigned: assignedTo(seat.id), seated: seatedAt(seat.id) }))
        .filter(({ assigned, seated }) => filter === 'all' || (filter === 'assigned' && (assigned || seated)) || (filter === 'free' && !assigned && !seated) || (filter === 'seated' && seated))
        .filter(({ seat, assigned, seated }) => !q || [seat.name, seat.person, assigned?.name, seated?.name].filter(Boolean).join(' ').toLowerCase().includes(q));
      const person = p => (p ? [h('strong', null, p.name), p.group ? h('small', { class: 'sub' }, p.group) : null] : h('span', { class: 'muted' }, '—'));
      replace(tableBody, rows.length ? rows.map(({ seat, assigned, seated }) => h('tr', { class: [!seat.connected && 'absent'], 'data-seat': seat.id },
        h('td', null, h('strong', null, seat.name), seat.hidden ? h('small', { class: 'sub' }, 'hidden in synoptic') : null),
        h('td', null, person(assigned)),
        noSeated ? null : h('td', null, seated ? person(seated) : h('span', { class: 'muted' }, assigned ? 'not logged in' : '—')),
        noDevice ? null : h('td', null, h('span', { class: ['pill', seat.connected ? 'loggedIn' : 'disconnected'] }, seat.connected ? 'connected' : 'offline')),
        h('td', { class: 'row-actions' }, h('a', { class: 'button-like secondary small', href: onPlan(seat.id) }, 'Show on plan')),
      )) : h('tr', null, h('td', { colspan: 5 - (noSeated ? 1 : 0) - (noDevice ? 1 : 0), class: 'muted' }, seats().length ? 'No seats match' : store.unavailable('domain.seats') ?? 'No seats')));

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
          h('article', { class: 'card' }, h('h2', null, 'Changing assignments'),
            wireless
              ? h('p', { class: 'muted small-text' }, 'On DICENTIS Wireless a participant\'s seat is set in ', h('a', { href: '#/meeting/participants' }, 'Participants'),
                ' (Edit), in ', h('a', { href: '#/room' }, 'Room'), ' → Edit layout (select a seat), or with Import… from an Excel file (Export Excel gives the template).')
              : smd
                ? h('p', { class: 'muted small-text' }, 'On DCN seats are assigned in the DCN Conference Software. LikeABosch reads them from the meeting data stream (when a meeting starts) and cannot change them.')
              : dcn
                ? h('p', { class: 'muted small-text' }, 'On DCN the seat is part of a delegate\'s registration for the meeting, prepared in the DCN Conference Software. LikeABosch shows it but does not edit it yet.')
                : h('p', { class: 'muted small-text' }, 'Seat assignments are prepared in the DICENTIS Meeting Application. The DICENTIS protocol used by LikeABosch can read them (Export Excel) but not change them; editing here needs the dicentis-bridge (planned, WO-081).'))),
      ),
    );
    render();
    return store.subscribe(['topic:domain.seats', 'topic:domain.participants', 'connection'], render);
  },
};
