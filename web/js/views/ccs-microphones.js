// Settings → Microphones on a CCS 1000 D (WO-111, DEC-032): microphone sensitivity per seat through the documented
// CCSD-CU endpoints GET/PUT /seats/microphonesensitivity/{id} ({ sensitivity: 0..15 } = −6…+9 dB, 6 = 0 dB) and
// POST /seats/resetmicrophonesensitivities. The values are not a live topic: they are read when the view opens
// (a few requests at a time, the device does not like many in flight) and after each change.
import { h, replace, toast, toastError, actionButton } from '../dom.js';

const DEFAULT = 6;
const MODE = { 0: 'Normal', 2: 'Button', 3: 'Push to talk' };
/** Sensitivity step → label, e.g. 9 → "+3 dB". */
export const sensitivityLabel = v => (Number.isInteger(v) ? `${v - DEFAULT > 0 ? '+' : ''}${v - DEFAULT} dB` : '—');

export default {
  id: 'ccs-microphones',
  title: 'Microphones',
  feature: 'micSensitivity',
  topics: ['wirelessSeats'],
  mount(el, { store, api }) {
    const tableBody = h('tbody');
    const note = h('p', { class: 'muted hint' });
    /** seat id → sensitivity step (undefined = not read yet, null = could not be read) */
    const values = new Map();
    let alive = true;

    async function load(ids) {
      const queue = [...ids];
      const worker = async () => {
        while (alive && queue.length) {
          const id = queue.shift();
          try { values.set(id, (await api.ccs1000('GET', `/seats/microphonesensitivity/${id}`))?.sensitivity ?? null); } catch { values.set(id, null); }
        }
      };
      await Promise.all(Array.from({ length: 3 }, worker));
      if (alive) renderSeats();
    }

    async function set(id, v) {
      await api.ccs1000('PUT', `/seats/microphonesensitivity/${id}`, { sensitivity: v });
      values.set(id, v);
    }

    function renderSeats() {
      const seats = store.topic('wirelessSeats');
      if (!seats) return replace(tableBody, h('tr', null, h('td', { colspan: 5, class: 'muted' }, store.unavailable('wirelessSeats') ?? 'Loading…')));
      const unread = seats.map(s => s.id).filter(id => !values.has(id));
      if (unread.length) { for (const id of unread) values.set(id, undefined); load(unread); }
      replace(tableBody, [...seats].sort((a, b) => a.id - b.id).map(s => {
        const v = values.get(s.id);
        const out = h('output', { class: 'num' }, v === undefined ? '…' : sensitivityLabel(v));
        const slider = h('input', { type: 'range', min: 0, max: 15, step: 1, value: String(Number.isInteger(v) ? v : DEFAULT), disabled: !Number.isInteger(v), 'aria-label': `Microphone sensitivity of ${s.name}` });
        slider.addEventListener('input', () => { out.textContent = sensitivityLabel(Number(slider.value)); });
        slider.addEventListener('change', async () => {
          const next = Number(slider.value);
          try { await set(s.id, next); toast(`${s.name}: ${sensitivityLabel(next)}`, 'success'); } catch (err) {
            toastError(err, 'Sensitivity: ');
            slider.value = String(values.get(s.id) ?? DEFAULT);
            out.textContent = sensitivityLabel(values.get(s.id));
          }
        });
        return h('tr', { class: s.connected ? null : 'absent', 'data-seat': String(s.id) },
          h('td', { class: 'num' }, String(s.id)),
          h('td', null, s.name),
          h('td', null, h('span', { class: ['pill', s.connected ? 'loggedIn' : 'disconnected'] }, s.connected ? 'connected' : 'offline')),
          h('td', null, MODE[s.mode] ?? '—'),
          h('td', { class: 'sensitivity' }, slider, ' ', out));
      }));
      note.textContent = values.size && [...values.values()].some(x => x === null)
        ? 'Some values could not be read (seat offline, or the user lacks the "can manage" right).'
        : '0 dB is the default. The range is −6 dB to +9 dB in 1 dB steps.';
    }

    el.append(
      h('h1', { id: 'view-title' }, 'Microphones'),
      h('article', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Microphone sensitivity'),
          actionButton('Reset all to 0 dB', async () => {
            await api.ccs1000('POST', '/seats/resetmicrophonesensitivities');
            values.clear();
            renderSeats();
            toast('All microphones back to 0 dB', 'success');
          }, { cls: 'danger-outline', danger: true, confirm: 'Set the microphone sensitivity of every seat back to 0 dB?' })),
        note,
        h('table', { class: 'table' },
          h('thead', null, h('tr', null, ['Seat', 'Name', 'Status', 'Microphone', 'Sensitivity'].map(t => h('th', null, t)))),
          tableBody)));
    renderSeats();
    const off = store.subscribe(['topic:wirelessSeats'], renderSeats);
    return () => { alive = false; off(); };
  },
};
