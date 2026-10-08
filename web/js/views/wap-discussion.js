// Settings → Discussion settings on DICENTIS Wireless (WO-086, DEC-024): the WAP web UI's "Prepare → Discussion",
// `GET/PUT /discuss` (undocumented). The whole body is sent back, with the web UI's rules (prepareController, fw 1.73):
// max open microphones 1…25 (DCNM-WAP), waiting list 0…100 (≥ 2 in PTT), "participant mic off" forced on unless Open
// without auto shift.
import { h, replace, toast, toastError } from '../dom.js';
import { undocumentedNote, unavailable, fieldLabel } from '../wap.js';

const MODES = [[0, 'Open'], [1, 'Override'], [2, 'Voice activation'], [3, 'Push to talk']];
const LABELS = {
  autoShift: 'Auto shift (next request gets the floor when a speaker stops)',
  allowCancelRTS: 'Delegates may cancel their request to speak',
  showFirstInWaitingList: 'Seat displays show "first in waiting list"',
  showPossibleToSpeak: 'Seat displays show "possible to speak"',
  participantMicOff: 'Delegates may switch their microphone off',
  priorityToneAudible: 'Priority chime audible',
  ambient: 'Ambient microphone',
  autoMicOff: 'Microphone off automatically after silence',
};
const KNOWN = new Set(['mode', 'maxOpenMics', 'waitingListSize', 'priorityOption', ...Object.keys(LABELS)]);

/** The web UI's adjustments before saving (prepareController.prepareSubmit). */
export function normaliseDiscuss(d) {
  const out = { ...d, mode: Number(d.mode), priorityOption: Number(d.priorityOption ?? 0) };
  if (!(out.mode === 0 && out.autoShift === false)) out.participantMicOff = true;
  out.maxOpenMics = Math.min(25, Math.max(1, Number(out.maxOpenMics)));
  out.waitingListSize = Math.min(100, Math.max(out.mode === 3 ? 2 : 0, Number(out.waitingListSize)));
  return out;
}

export default {
  id: 'discussion-settings',
  title: 'Discussion settings',
  feature: 'wapConfig',
  topics: ['wirelessDiscuss'],
  mount(el, { store, api }) {
    const box = h('div');
    let draft = null; // edited copy; null = show the WAP's values
    let shownKey = null;

    function render(force = false) {
      const d = store.topic('wirelessDiscuss');
      if (!d) return replace(box, unavailable(store, 'wirelessDiscuss'));
      const key = JSON.stringify(d);
      if (!force && (draft || key === shownKey)) return; // keep the operator's edits
      shownKey = key;
      const v = draft ?? d;
      const set = (k, value) => { draft = normaliseDiscuss({ ...(draft ?? d), [k]: value }); render(true); };
      const select = (k, label, options) => h('label', { class: 'field' }, h('span', null, label),
        h('select', { 'aria-label': label, onchange: e => set(k, Number(e.target.value)) },
          options.map(([value, text]) => h('option', { value: String(value), selected: Number(v[k]) === value }, text))));
      const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => [from + i, String(from + i)]);
      const forcedMicOff = !(Number(v.mode) === 0 && v.autoShift === false);
      const checks = Object.keys(v).filter(k => typeof v[k] === 'boolean').map(k => {
        const input = h('input', { type: 'checkbox', checked: v[k], disabled: k === 'participantMicOff' && forcedMicOff, 'aria-label': LABELS[k] ?? fieldLabel(k), onchange: e => set(k, e.target.checked) });
        return h('label', { class: 'check', title: k === 'participantMicOff' && forcedMicOff ? 'Always on except in Open mode without auto shift (WAP rule)' : null }, input, ` ${LABELS[k] ?? fieldLabel(k)}`);
      });
      const others = Object.keys(v).filter(k => !KNOWN.has(k) && typeof v[k] === 'number').map(k => h('label', { class: 'field' }, h('span', null, fieldLabel(k)),
        h('input', { type: 'number', value: String(v[k]), 'aria-label': fieldLabel(k), onchange: e => set(k, Number(e.target.value)) })));
      replace(box,
        h('div', { class: 'row three' },
          select('mode', 'Discussion mode', MODES),
          select('maxOpenMics', 'Max open microphones', range(1, 25)),
          select('waitingListSize', 'Waiting list size', range(Number(v.mode) === 3 ? 2 : 0, 100))),
        h('div', { class: 'row three' }, select('priorityOption', 'Priority option', range(0, Math.max(3, Number(v.priorityOption) || 0)).map(([n]) => [n, `Option ${n}`])), others),
        h('div', { class: 'check-list' }, checks),
        Number(v.mode) !== 0 ? h('p', { class: 'muted hint' }, 'The waiting list (requests to speak) only exists in Open mode.') : null,
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'primary', disabled: !draft, onclick: save }, 'Save'),
          h('button', { type: 'button', class: 'secondary', disabled: !draft, onclick: () => { draft = null; render(true); } }, 'Discard changes')),
        draft ? h('p', { class: 'muted hint' }, 'Not saved yet.') : null);
    }

    async function save() {
      try {
        await api.wireless('PUT', '/discuss', normaliseDiscuss(draft));
        draft = null;
        toast('Discussion settings saved', 'success');
        render(true);
      } catch (err) { toastError(err, 'Discussion settings: '); }
    }

    el.append(h('h1', { id: 'view-title' }, 'Discussion settings'),
      h('article', { class: 'card' }, h('h2', null, 'Prepare discussion'), box, undocumentedNote()));
    render(true);
    return store.subscribe(['topic:wirelessDiscuss'], () => render());
  },
};
