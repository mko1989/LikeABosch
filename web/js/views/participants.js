// Participants: list with seat assignment, presence and voting rights (WO-022). On the wired system the Conference
// Protocol only reads them; with the full DICENTIS API (dicentis-bridge) they can be added, renamed, grouped, seated and
// removed from the active meeting (WO-106, DEC-034). On wireless (WO-027) the WAP's participant database can be
// edited: name, seat, NFC tag. Both through the domain participant actions (DEC-023, WO-084).
import { h, replace, humanize, actionButton, toast, toastError } from '../dom.js';
import { participantIoButtons } from '../participants-io.js';

/** Wireless participant editor (raw `wirelessParticipants` topic + domain participant actions). */
function mountWireless(el, { store, api }) {
  const tableBody = h('tbody');
  const search = h('input', { type: 'search', placeholder: 'Search name or NFC…', 'aria-label': 'Search participants', oninput: render });
  const formBox = h('div');
  let editing = null; // participant being edited, or {} for a new one

  const seats = () => store.topic('wirelessSeats') ?? [];
  const seatName = id => (id >= 0 ? seats().find(s => s.id === id)?.name ?? String(id) : '—');

  function renderForm() {
    if (!editing) return replace(formBox);
    const p = editing;
    const form = h('form', { class: 'settings participant-form', novalidate: true },
      h('h2', null, p.id ? `Edit ${p.name}` : 'New participant'),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, h('span', null, 'Name'), h('input', { name: 'name', value: p.name ?? '', required: true, maxlength: 32 })),
        h('label', { class: 'field' }, h('span', null, 'Seat'), h('select', { name: 'seatId' },
          h('option', { value: '-1' }, '— none —'),
          seats().map(s => h('option', { value: String(s.id), selected: s.id === p.seatId }, s.name))))),
      h('label', { class: 'field' }, h('span', null, 'NFC tag'), h('input', { name: 'nfc', value: p.nfc ?? '', placeholder: '00:11:22:33:44:55:66', spellcheck: 'false' })),
      h('div', { class: 'actions' },
        h('button', { type: 'submit', class: 'primary' }, p.id ? 'Save' : 'Add participant'),
        h('button', { type: 'button', class: 'secondary', onclick: () => { editing = null; renderForm(); } }, 'Cancel')));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const name = form.elements.namedItem('name').value.trim();
      if (!name) return form.elements.namedItem('name').focus();
      const seat = form.elements.namedItem('seatId').value;
      const body = { name, seatId: seat === '-1' ? null : seat, nfc: form.elements.namedItem('nfc').value.trim() };
      try {
        if (p.id) await api.domain('PUT', `/participants/${p.id}`, body);
        else await api.domain('POST', '/participants', body);
        editing = null;
        renderForm();
      } catch (err) {
        toastError(err, 'Participant: ');
      }
    });
    replace(formBox, form);
    form.elements.namedItem('name').focus();
  }

  function render() {
    const list = store.topic('wirelessParticipants');
    if (!list) {
      replace(tableBody, h('tr', null, h('td', { colspan: 4, class: 'muted' }, store.unavailable('wirelessParticipants') ?? 'Loading…')));
      return;
    }
    const q = search.value.trim().toLowerCase();
    const rows = list.filter(p => !q || `${p.name} ${p.nfc}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    replace(tableBody, rows.length ? rows.map(p => h('tr', null,
      h('td', null, h('strong', null, p.name)),
      h('td', null, seatName(p.seatId)),
      h('td', null, h('code', null, p.nfc || '—')),
      h('td', { class: 'row-actions' },
        h('button', { type: 'button', class: 'small secondary', onclick: () => { editing = { ...p }; renderForm(); } }, 'Edit'),
        actionButton('Delete', () => api.domain('DELETE', `/participants/${p.id}`), { cls: 'small danger-outline', danger: true, confirm: `Delete participant "${p.name}"?` }))))
      : h('tr', null, h('td', { colspan: 4, class: 'muted' }, 'No participants')));
  }

  el.append(
    h('h1', { id: 'view-title' }, 'Participants'),
    h('article', { class: 'card' },
      h('div', { class: 'toolbar' }, search,
        h('button', { type: 'button', class: 'primary', onclick: () => { editing = { seatId: -1 }; renderForm(); } }, 'Add participant'),
        participantIoButtons({ store, api })),
      formBox,
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, ['Name', 'Seat', 'NFC tag', ''].map(t => h('th', { scope: 'col' }, t)))), tableBody)),
      h('p', { class: 'muted hint' }, 'Participant database of the wireless access point. Requires the "prepare meeting" right on the WAP.')),
  );
  render();
  return store.subscribe(['topic:wirelessParticipants', 'topic:wirelessSeats'], render);
}

export default {
  id: 'participants',
  title: 'Participants',
  feature: 'participants', // not on a CCS 1000 D (DEC-032)
  topics: ['domain.participants'],
  mount(el, ctx) {
    if (ctx.store.system === 'wireless') return mountWireless(el, ctx);
    const { store, api } = ctx;
    const summary = h('div', { class: 'stats' });
    const tableBody = h('tbody');
    const notesBox = h('div');
    const hintBox = h('p', { class: 'muted hint' });
    const search = h('input', { type: 'search', placeholder: 'Search name, group, country…', 'aria-label': 'Search participants', oninput: render });
    const groupSelect = h('select', { 'aria-label': 'Group', onchange: render });
    const presentOnly = h('input', { type: 'checkbox', onchange: render });
    const formBox = h('div');
    const editBox = h('div');
    let editing = null; // participant being edited ({ id, name, group, seatId }), or {} for a new one
    const canEdit = () => Boolean(store.topic('domain.capabilities')?.actions?.editParticipants);
    let sortKey = 'name';
    let sortDir = 1;

    const fullName = p => [p.title, p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
    const seatName = id => (id ? store.topic('seats')?.seats?.find(s => s.seatId === id)?.seatName ?? id : '');

    const ps = p => (store.topic('participantSeats')?.participantSeats ?? []).find(x => x.participantId === p.participantId);

    function rows() {
      const seatsByParticipant = new Map((store.topic('participantSeats')?.participantSeats ?? []).map(ps => [ps.participantId, ps]));
      return (store.topic('participants')?.participants ?? []).map(p => {
        const ps = seatsByParticipant.get(p.participantId);
        return {
          ...p,
          name: fullName(p),
          sortName: `${p.lastName} ${p.firstName}`.toLowerCase(), // surname order; titles don't affect sorting
          assigned: seatName(ps?.assignedSeatId),
          seated: seatName(ps?.seatedSeatId),
        };
      });
    }

    const columns = [
      ['name', 'Name'], ['group', 'Group'], ['country', 'Country'], ['assigned', 'Assigned seat'], ['seated', 'Seated at'],
      ['isAuthenticated', 'Present'], ['canVote', 'Vote'], ['voteWeight', 'Weight'], ['canPrio', 'Priority'], ['participantType', 'Type'],
    ];
    const headRow = h('tr', null, columns.map(([key, label]) => h('th', { scope: 'col' },
      h('button', { type: 'button', class: 'th-sort', onclick: () => { sortDir = sortKey === key ? -sortDir : 1; sortKey = key; render(); } }, label))),
      h('th', { scope: 'col', class: 'row-actions' }, h('span', { class: 'visually-hidden' }, 'Actions')));

    const yes = v => (v ? h('span', { class: 'yes' }, 'Yes') : h('span', { class: 'muted' }, 'No'));

    /** Add / edit form (DEC-034): name, group (affiliation), assigned seat. */
    function renderForm() {
      if (!editing || !canEdit()) return replace(formBox);
      const p = editing;
      const seats = [...(store.topic('domain.seats') ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const form = h('form', { class: 'settings participant-form', novalidate: true },
        h('h2', null, p.id ? `Edit ${p.name}` : 'New participant'),
        h('div', { class: 'row three' },
          h('label', { class: 'field' }, h('span', null, 'Name'), h('input', { name: 'name', value: p.name ?? '', required: true, maxlength: 100, placeholder: 'First and last name' })),
          h('label', { class: 'field' }, h('span', null, 'Group / affiliation'), h('input', { name: 'group', value: p.group ?? '', maxlength: 100 })),
          h('label', { class: 'field' }, h('span', null, 'Seat'), h('select', { name: 'seatId' },
            h('option', { value: '' }, '— none —'),
            seats.map(st => h('option', { value: st.id, selected: st.id === p.seatId }, st.person && st.id !== p.seatId ? `${st.name} (${st.person})` : st.name))))),
        h('div', { class: 'actions' },
          h('button', { type: 'submit', class: 'primary' }, p.id ? 'Save' : 'Add participant'),
          h('button', { type: 'button', class: 'secondary', onclick: () => { editing = null; renderForm(); } }, 'Cancel')),
        h('p', { class: 'muted hint' }, 'Changes the active meeting. A new participant is also a new person in the DICENTIS database (user name from the name). A seat held by someone else moves to this participant.'));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const name = form.elements.namedItem('name').value.trim();
        if (!name) return form.elements.namedItem('name').focus();
        const body = { name, group: form.elements.namedItem('group').value.trim(), seatId: form.elements.namedItem('seatId').value || null };
        const button = form.querySelector('button[type=submit]');
        button.disabled = true;
        try {
          if (p.id) await api.domain('PUT', `/participants/${encodeURIComponent(p.id)}`, body);
          else await api.domain('POST', '/participants', body);
          toast(p.id ? `${name} saved` : `${name} added`, 'success');
          editing = null;
          renderForm();
        } catch (err) {
          toastError(err, 'Participant: ');
          button.disabled = false;
        }
      });
      replace(formBox, form);
      form.elements.namedItem('name').focus();
    }

    function renderEditBox() {
      replace(editBox, canEdit()
        ? h('button', { type: 'button', class: 'primary', onclick: () => { editing = {}; renderForm(); } }, 'Add participant')
        : null);
    }

    function render() {
      const all = rows();
      const groups = [...new Set(all.map(p => p.group).filter(Boolean))].sort();
      const selected = groupSelect.value;
      replace(groupSelect, h('option', { value: '' }, 'All groups'), groups.map(g => h('option', { value: g, selected: g === selected }, g)));
      const q = search.value.trim().toLowerCase();
      const list = all
        .filter(p => !selected || p.group === selected)
        .filter(p => !presentOnly.checked || p.isAuthenticated)
        .filter(p => !q || `${p.name} ${p.group} ${p.country} ${p.region} ${p.email} ${p.userName ?? ''}`.toLowerCase().includes(q))
        .sort((a, b) => {
          const key = sortKey === 'name' ? 'sortName' : sortKey;
          const va = a[key];
          const vb = b[key];
          return (typeof va === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''))) * sortDir;
        });

      replace(summary,
        h('div', { class: 'stat' }, h('strong', null, String(all.length)), h('span', null, 'participants')),
        h('div', { class: 'stat' }, h('strong', null, String(all.filter(p => p.isAuthenticated).length)), h('span', null, 'present')),
        h('div', { class: 'stat' }, h('strong', null, String(all.filter(p => p.canVote).length)), h('span', null, 'may vote')));

      for (const [i, th] of [...headRow.children].slice(0, columns.length).entries()) {
        const key = columns[i][0];
        th.setAttribute('aria-sort', key === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none');
      }
      replace(tableBody, list.length ? list.map(p => h('tr', { class: p.isAuthenticated ? null : 'absent' },
        h('td', null, h('strong', null, p.name || p.participantId),
          [p.userName && `user ${p.userName}`, p.screenLine && p.screenLine !== p.name && `screen “${p.screenLine}”`, p.email].filter(Boolean).length
            ? h('small', { class: 'sub' }, [p.userName && `user ${p.userName}`, p.screenLine && p.screenLine !== p.name && `screen “${p.screenLine}”`, p.email].filter(Boolean).join(' · ')) : null),
        h('td', null, p.group), h('td', null, p.country),
        h('td', null, p.assigned), h('td', null, p.seated),
        h('td', null, yes(p.isAuthenticated)), h('td', null, yes(p.canVote)), h('td', { class: 'num' }, String(p.voteWeight ?? '')),
        h('td', null, yes(p.canPrio)), h('td', null, humanize(p.participantType)),
        canEdit() ? h('td', { class: 'row-actions' },
          h('button', { type: 'button', class: 'small secondary', onclick: () => { editing = { id: p.participantId, name: p.name, group: p.group, seatId: ps(p)?.assignedSeatId || '' }; renderForm(); } }, 'Edit'),
          actionButton('Remove', () => api.domain('DELETE', `/participants/${encodeURIComponent(p.participantId)}`), {
            cls: 'small danger-outline', danger: true, confirm: `Remove "${p.name}" from the meeting? The person stays in the DICENTIS database.`,
          })) : h('td'))) : h('tr', null, h('td', { colspan: columns.length + 1, class: 'muted' }, 'No participants match')));

      const notes = store.notifications.filter(n => n.topic === 'participantAccessDenied');
      replace(notesBox, notes.length ? [
        h('h2', { class: 'section-title' }, 'Access denied (this session)'),
        h('ul', { class: 'compact' }, notes.map(n => h('li', null, new Date(n.receivedAt).toLocaleTimeString(), ': ',
          (n.data?.participantAccessDeniedReasonsInfo?.accessDeniedReasons ?? []).map(humanize).join(', ') || 'no reason given'))),
      ] : null);
    }

    el.append(
      h('h1', { id: 'view-title' }, 'Participants'),
      h('article', { class: 'card' },
        summary,
        h('div', { class: 'toolbar' }, search, groupSelect, h('label', { class: 'check' }, presentOnly, ' Present only'), editBox, participantIoButtons(ctx)),
        formBox,
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, headRow), tableBody)),
        notesBox,
        hintBox),
    );
    function renderHint() {
      replace(hintBox, canEdit()
        ? ['Add, edit and remove participants of the active meeting here or in the room (seat inspector, Edit layout). ', h('a', { href: '#/meeting/seating' }, 'Seating overview →')]
        : ['Read-only: the Conference Protocol cannot change participants. To add and edit them here, turn on the full DICENTIS API (dicentis-bridge on a Windows PC with the DICENTIS software) in ',
          h('a', { href: '#/settings/connection' }, 'Settings → Connection'), '; until then use the DICENTIS Meeting Application. ', h('a', { href: '#/meeting/seating' }, 'Seating overview →')]);
    }
    const refresh = () => { renderEditBox(); renderHint(); render(); };
    refresh();
    return store.subscribe(['topic:participants', 'topic:participantSeats', 'topic:seats', 'topic:domain.capabilities', 'notification'], refresh);
  },
};
