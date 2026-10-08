// Settings → Companion (WO-099, DEC-027): where Bitfocus Companion runs, the master switch, the picker grid size,
// every seat / desk that presses Companion buttons, and what was sent recently. Triggers are added in the Room inspector.
import { h, replace, toast, toastError, confirmAction } from '../dom.js';
import { pickCompanionButton, loc } from '../companion.js';

export default {
  id: 'companion',
  title: 'Companion',
  topics: ['devices.companion', 'room'],
  mount(el, { store, api }) {
    const formBox = h('div');
    const triggersBox = h('div');
    const logBox = h('div');
    const state = () => store.topic('devices.companion');

    function renderForm() {
      const st = state();
      const c = st?.config;
      const num = (name, label, value, min, max, hint) => h('label', { class: 'field' }, h('span', null, label),
        h('input', { name, type: 'number', min, max, value: value === null || value === undefined ? '' : String(value), class: 'narrow' }), hint ? h('small', { class: 'muted' }, hint) : null);
      const form = h('form', { class: 'settings companion-form', novalidate: true },
        h('p', { class: 'muted small-text' }, 'LikeABosch presses Companion buttons through Companion\'s HTTP API (Companion 3 or newer; Settings → Protocols → HTTP must be on). Which buttons: Room → select a seat or interpreter desk → Companion.'),
        h('div', { class: 'row' },
          h('label', { class: 'field grow' }, h('span', null, 'Companion host / IP address'), h('input', { name: 'host', value: c?.host ?? '', spellcheck: 'false', placeholder: 'e.g. 192.168.1.20 or companion.local', required: true })),
          num('port', 'Port', c?.port ?? 8000, 1, 65535, 'Companion\'s web port (default 8000)')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'enabled', checked: c ? c.enabled : true }), ' Press the buttons when microphones turn on or off'),
        h('div', { class: 'row-inline grid-size' }, num('rows', 'Rows', c?.rows ?? 4, 1, 32), num('cols', 'Columns', c?.cols ?? 8, 1, 32)),
        h('small', { class: 'muted' }, 'Size of a Companion page (Companion: Settings → Buttons → grid size); only used by the button picker.'),
        st?.status?.lastError ? h('p', { class: 'error' }, st.status.lastError) : st?.status?.lastOkAt ? h('p', { class: 'muted small-text' }, `Last successful request: ${new Date(st.status.lastOkAt).toLocaleString()}`) : null,
        h('div', { class: 'actions' },
          h('button', { type: 'submit', class: 'primary' }, 'Save'),
          h('button', { type: 'button', class: 'secondary', onclick: test }, 'Test connection'),
          c ? h('button', { type: 'button', class: 'secondary', onclick: () => pickCompanionButton({ api, cfg: c, title: 'Companion pages' }) }, 'Open page viewer…') : null,
          c ? h('button', { type: 'button', class: 'danger-outline', onclick: remove }, 'Remove') : null));
      const values = () => {
        const f = n => form.elements.namedItem(n);
        const int = n => (f(n).value.trim() === '' ? null : Number(f(n).value));
        return { host: f('host').value.trim(), port: int('port') ?? 8000, enabled: f('enabled').checked, rows: int('rows') ?? 4, cols: int('cols') ?? 8 };
      };
      async function test() {
        const v = values();
        if (!v.host) return form.elements.namedItem('host').focus();
        try {
          const r = await api.post('/companion/test', { host: v.host, port: v.port });
          toast(`Companion answers${r.connections !== null ? ` (${r.connections} connections)` : ''}`, 'success');
        } catch (err) { toastError(err, 'Companion: '); }
      }
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const v = values();
        if (!v.host) return form.elements.namedItem('host').focus();
        try {
          await api.put('/companion', v);
          toast('Companion settings saved', 'success');
        } catch (err) { toastError(err, 'Companion: '); }
      });
      replace(formBox, form);
    }

    async function remove() {
      if (!(await confirmAction('Remove the Companion connection from this project? The buttons set on seats and desks stay, but nothing is sent.', { confirmLabel: 'Remove', danger: true }))) return;
      try { await api.del('/companion'); } catch (err) { toastError(err); }
    }

    function renderTriggers() {
      const t = store.topic('room')?.triggers ?? {};
      const seats = new Map((store.topic('domain.seats') ?? []).map(s => [s.id, s.name]));
      const names = store.topic('room')?.seatNames ?? {};
      const rows = [
        ...Object.entries(t.seats ?? {}).map(([id, x]) => ({ kind: 'seats', id, label: seats.get(id) ?? names[id] ?? id, href: `#/room?seat=${encodeURIComponent(id)}`, ...x })),
        ...Object.entries(t.desks ?? {}).map(([id, x]) => ({ kind: 'desks', id, label: `Interpreter desk ${id}`, href: `#/room?desk=${encodeURIComponent(id)}`, ...x })),
      ];
      const list = acts => (acts ?? []).length ? acts.map(a => `${a.action} ${loc(a)}`).join(', ') : '—';
      replace(triggersBox, rows.length
        ? h('table', { class: 'data companion-triggers' },
          h('thead', null, h('tr', null, h('th', null, 'Seat / desk'), h('th', null, 'Mic on'), h('th', null, 'Mic off'), h('th', null, ''))),
          h('tbody', null, rows.map(r => h('tr', { 'data-trigger': `${r.kind}:${r.id}` },
            h('td', null, h('a', { href: r.href }, r.label)), h('td', null, list(r.on)), h('td', null, list(r.off)),
            h('td', null, h('button', { type: 'button', class: 'link small', onclick: () => api.del(`/room/triggers/${r.kind}/${encodeURIComponent(r.id)}`).catch(toastError) }, 'Remove'))))))
        : h('p', { class: 'muted' }, 'No seat or desk presses Companion buttons yet. Room → select a seat or interpreter desk → Companion → "+ Button…".'));
    }

    function renderLog() {
      const log = state()?.log ?? [];
      replace(logBox, log.length
        ? h('ul', { class: 'log' }, log.map(e => h('li', { class: e.error ? 'error' : e.skipped ? 'muted' : null }, h('time', null, new Date(e.at).toLocaleTimeString()), ' ', e.message)))
        : h('p', { class: 'muted' }, 'Nothing sent yet.'));
    }

    el.append(
      h('h1', { id: 'view-title' }, 'Companion'),
      h('div', { class: 'cards two' },
        h('article', { class: 'card' }, h('h2', null, 'Bitfocus Companion'), formBox),
        h('article', { class: 'card' }, h('h2', null, 'Recently sent'), logBox)),
      h('article', { class: 'card' }, h('h2', null, 'Seats and desks with Companion buttons'), triggersBox));

    let formKey = null;
    const render = () => {
      // Rebuild the form only when the saved config / status changes, not on every log line (keeps typing intact).
      const st = state();
      const key = JSON.stringify([st?.config, st?.status?.lastError, Boolean(st?.status?.lastOkAt)]);
      if (key !== formKey) { formKey = key; renderForm(); }
      renderTriggers();
      renderLog();
    };
    render();
    return store.subscribe(['topic:devices.companion', 'topic:room', 'topic:domain.seats'], render);
  },
};
