// Settings → Seats on DICENTIS Wireless (WO-088, DEC-024): the WAP web UI's seat configuration, undocumented endpoints:
// PUT /seats/{id} {id, <one field>} (name ≤ 32 bytes, no quotes), PUT /seats/{id}/selected, GET/PUT /seats/status
// (configuration = seat selection mode, subscription mode), PUT /seats/deinit, PUT /seats/remove, /seats/range-test.
// Like the web UI, configuration mode is switched off again when the operator leaves this view.
import { h, replace, toast, toastError, actionButton } from '../dom.js';
import { undocumentedNote, unavailable, checkField } from '../wap.js';

const RIGHTS = [['prio', 'Priority'], ['dual', 'Dual use'], ['identification', 'Identification'], ['voting', 'Voting']];

/** The web UI's name rule: quotes removed, cut to 32 UTF-8 bytes. */
export function seatName(name) {
  let n = String(name).replace(/"+/g, '').trim();
  while (new TextEncoder().encode(n).length > 32) n = n.slice(0, -1);
  return n;
}

export default {
  id: 'wap-seats',
  title: 'Seats',
  feature: 'wapConfig',
  topics: ['wirelessSeats', 'wirelessSeatsStatus'],
  mount(el, { store, api }) {
    const modesBox = h('div');
    const toolsBox = h('div');
    const tableBody = h('tbody');
    const put = (path, body) => api.wireless('PUT', path, body);
    let switchedConfigOn = false;

    function renderModes() {
      const st = store.topic('wirelessSeatsStatus');
      if (!st) return replace(modesBox, unavailable(store, 'wirelessSeatsStatus'));
      replace(modesBox,
        checkField('Configuration mode (select seats by pressing their buttons)', st.isConfigurationModeOn, async v => {
          await put('/seats/status', { isConfigurationModeOn: v });
          switchedConfigOn = v;
        }),
        checkField('Subscription mode (new devices may subscribe to this WAP)', st.isSubscriptionModeOn, v => put('/seats/status', { isSubscriptionModeOn: v })),
        st.subscriptionStatus ? h('p', { class: 'muted hint' }, `Subscription: ${st.subscriptionStatus}${st.subscriptionStatus === 'overlap' ? ' (another WAP is subscribing too: wait 2 minutes)' : ''}`) : null);
    }

    function renderTools() {
      const rt = store.topic('wirelessRangeTest');
      const seats = store.topic('wirelessSeats') ?? [];
      const offline = seats.filter(s => !s.connected).length;
      replace(toolsBox,
        h('div', { class: 'actions' },
          actionButton('Start range test', () => api.wireless('POST', '/seats/range-test'), { disabled: Boolean(rt?.running) }),
          actionButton(`Remove disconnected seats (${offline})`, () => put('/seats/remove', { remove: true }), {
            cls: 'danger-outline', danger: true, disabled: !offline,
            confirm: `Remove the ${offline} disconnected seat${offline === 1 ? '' : 's'} from the WAP? They have to subscribe again to come back.`,
          }),
          actionButton('De-initialise all seats', () => put('/seats/deinit', { deinit: true }), {
            cls: 'danger-outline', danger: true,
            confirm: 'De-initialise ALL seats? Every device loses its subscription and must subscribe to the WAP again.',
          })),
        rt ? h('p', { class: 'muted hint' }, rt.running ? 'Range test running…' : rt.results?.length ? `Range test: ${rt.results.length} seats answered.` : 'No range test results.') : null);
    }

    function renderSeats() {
      const seats = store.topic('wirelessSeats');
      if (!seats) return replace(tableBody, h('tr', null, h('td', { colspan: 8, class: 'muted' }, store.unavailable('wirelessSeats') ?? 'Loading…')));
      const save = (s, field, value) => put(`/seats/${s.id}`, { id: s.id, [field]: value });
      replace(tableBody, [...seats].sort((a, b) => a.id - b.id).map(s => {
        const name = h('input', { type: 'text', value: s.name, maxlength: 32, 'aria-label': `Name of seat ${s.id}` });
        name.addEventListener('change', async () => {
          const n = seatName(name.value);
          if (!n) { name.value = s.name; return; }
          try { await save(s, 'name', n); toast(`Seat ${s.id} renamed`, 'success'); } catch (err) { name.value = s.name; toastError(err, 'Seat name: '); }
        });
        return h('tr', { class: s.connected ? null : 'absent', 'data-seat': String(s.id) },
          h('td', { class: 'num' }, String(s.id)),
          h('td', null, name),
          h('td', null, h('span', { class: ['pill', s.connected ? 'loggedIn' : 'disconnected'] }, s.connected ? 'connected' : 'offline')),
          RIGHTS.map(([k, label]) => h('td', null, k in s
            ? h('input', { type: 'checkbox', checked: Boolean(s[k]), 'aria-label': `${label} for seat ${s.id}`,
              onchange: e => save(s, k, e.target.checked).catch(err => { e.target.checked = !e.target.checked; toastError(err, `${label}: `); }) })
            : '—')),
          h('td', { class: 'row-actions' }, h('button', {
            type: 'button', class: s.selected ? 'primary small' : 'secondary small', 'aria-pressed': String(Boolean(s.selected)),
            title: 'Select the seat on the WAP (the device identifies itself)', onclick: () => put(`/seats/${s.id}/selected`, { selected: !s.selected }).catch(toastError),
          }, s.selected ? 'Selected' : 'Select')));
      }));
    }

    el.append(h('h1', { id: 'view-title' }, 'Seats'),
      h('div', { class: 'split' },
        h('article', { class: 'card' }, h('h2', null, 'Modes'), modesBox),
        h('article', { class: 'card' }, h('h2', null, 'Maintenance'), toolsBox)),
      h('article', { class: 'card' }, h('h2', null, 'Seat configuration'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data wap-seats' },
          h('thead', null, h('tr', null, ['#', 'Name', 'Device', ...RIGHTS.map(r => r[1]), ''].map(t => h('th', { scope: 'col' }, t)))), tableBody)),
        h('p', { class: 'muted hint' }, 'Rights need free licences on the WAP (dual use, identification, voting). Changes apply at once.')),
      undocumentedNote());
    const keyed = (render, key) => { let last; return () => { const k = JSON.stringify(key()); if (k !== last) { last = k; render(); } }; };
    // The table ignores battery/signal updates so a name being typed is not replaced.
    const parts = [
      keyed(renderModes, () => [store.topic('wirelessSeatsStatus'), store.unavailable('wirelessSeatsStatus')]),
      keyed(renderTools, () => [store.topic('wirelessRangeTest'), (store.topic('wirelessSeats') ?? []).map(s => s.connected)]),
      keyed(renderSeats, () => [(store.topic('wirelessSeats') ?? []).map(s => [s.id, s.name, s.connected, s.selected, ...RIGHTS.map(([k]) => s[k])]), store.unavailable('wirelessSeats')]),
    ];
    parts.forEach(p => p());
    const off = store.subscribe(['topic:wirelessSeats', 'topic:wirelessSeatsStatus', 'topic:wirelessRangeTest'], () => parts.forEach(p => p()));
    return () => {
      off();
      if (switchedConfigOn) put('/seats/status', { isConfigurationModeOn: false }).catch(() => {});
    };
  },
};
