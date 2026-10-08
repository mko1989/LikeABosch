// Languages card for Settings → Interpretation (WO-102, DEC-029): system languages (the DICENTIS language catalogue),
// the meeting's languages in channel order (with Dante and second-stream output), and interpreter desk outputs.
// Writes go through api.dicentis(); the store updates via SSE, so nothing here changes local data (DEC-009).
import { h, replace, toast, toastError, actionButton } from './dom.js';

const KEYS = [
  'topic:dicentis.languages', 'topic:dicentis.meetingLanguages', 'topic:dicentis.desks',
  'topic:dicentis.status', 'topic:domain.capabilities', 'connection',
];

let editingId = null; // system language row currently being edited (kept across re-renders)
let editValues = {};  // { abbreviation, label, native } of that row while editing

/**
 * Render the languages card into `box`. Re-renders on store changes.
 * @param {HTMLElement} box
 * @param {{ store: any, api: { dicentis: (path: string, body?: object) => Promise<any> } }} deps
 * @returns {() => void} unsubscribe
 */
export function mountDicentisLanguages(box, { store, api }) {
  let addPick = ''; // meeting-language "add" select choice, kept across re-renders

  async function call(path, body, what) {
    try {
      await api.dicentis(path, body);
    } catch (err) {
      toastError(err, `${what} failed: `);
      render(); // restore the checkbox/select to the stored value
    }
  }

  const canSystem = () => Boolean(store.topic('dicentis.meetingLanguages')?.canSystemLanguages);

  // Add-language form: built once so a re-render does not clear what the user typed.
  const addForm = (() => {
    const abbr = h('input', { type: 'text', maxlength: 8, placeholder: 'SV', required: true, 'aria-label': 'New language abbreviation' });
    const label = h('input', { type: 'text', maxlength: 60, placeholder: 'Swedish', required: true, 'aria-label': 'New language name' });
    const native = h('input', { type: 'text', maxlength: 60, placeholder: 'Svenska', 'aria-label': 'New language native name' });
    const submit = h('button', { type: 'submit', class: 'small primary' }, 'Add language');
    const form = h('form', { class: 'row-inline' }, abbr, label, native, submit);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const body = { abbreviation: abbr.value.trim(), label: label.value.trim() };
        if (native.value.trim()) body.native = native.value.trim();
        await api.dicentis('/languages/create', body);
        form.reset();
        toast('Language added', 'success');
      } catch (err) {
        toastError(err, 'Add language failed: ');
      } finally {
        submit.disabled = !canSystem();
      }
    });
    return { form, abbr, label, native, submit };
  })();

  // Collapsible system-language list; kept as persistent nodes so the open state survives re-renders.
  const sumEl = h('summary', null, 'System languages');
  const sysBody = h('div', null);
  const sysDetails = h('details', null, sumEl, sysBody);

  function render() {
    const caps = store.topic('domain.capabilities');
    const status = store.topic('dicentis.status');

    if (caps?.dicentis?.languages !== true) {
      return replace(box,
        h('p', { class: 'muted small-text' },
          'Adding languages and assigning them to interpreter desks needs the full DICENTIS API (dicentis-bridge). '
          + 'Switch it on in the launcher (Windows PC with the DICENTIS software), or simulate a wired system with “Full DICENTIS API” in ',
          h('a', { href: '#/settings/connection?simulate' }, 'Settings → Connection'), '.'),
        status?.reason ? h('p', { class: 'muted small-text' }, String(status.reason)) : null);
    }

    const ml = store.topic('dicentis.meetingLanguages');
    const langs = store.topic('dicentis.languages') ?? [];
    const canConfigure = Boolean(ml?.canConfigure);
    const canDante = Boolean(ml?.canDante);
    const canDesks = Boolean(ml?.canDesks);
    const sysAllowed = canSystem();

    const findLang = id => langs.find(l => l.id === id);
    const labelOf = id => findLang(id)?.label ?? String(id);
    const abbrOf = id => findLang(id)?.abbreviation ?? String(id);
    const nativeOf = id => findLang(id)?.native ?? '';

    // ------------------------------------------------------------ 1. meeting languages (channel order)
    const meetingList = [...(ml?.languages ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const inMeeting = new Set(meetingList.map(m => String(m.id)));

    function meetingRow(m, i) {
      const label = labelOf(m.id);
      const ids = meetingList.map(x => x.id);
      const moveTo = delta => {
        const next = [...ids];
        const j = i + delta;
        [next[i], next[j]] = [next[j], next[i]];
        return () => api.dicentis('/meeting-languages/order', { languageIds: next });
      };
      const up = actionButton('↑', moveTo(-1), { cls: 'small secondary', disabled: !canConfigure || i === 0 });
      up.setAttribute('aria-label', `Move ${label} up`);
      const down = actionButton('↓', moveTo(1), { cls: 'small secondary', disabled: !canConfigure || i === meetingList.length - 1 });
      down.setAttribute('aria-label', `Move ${label} down`);
      const remove = actionButton('Remove', () => api.dicentis('/meeting-languages/remove', { languageId: m.id }), {
        cls: 'small danger-outline', disabled: !canConfigure,
        confirm: `Remove ${label} from the meeting? Desks using it lose it.`, danger: true,
      });
      remove.setAttribute('aria-label', `Remove ${label}`);
      const dante = h('input', {
        type: 'checkbox', checked: Boolean(m.danteOut), disabled: !canConfigure || !canDante, 'aria-label': `${label} to Dante`,
        onchange: e => call('/meeting-languages/update', { languageId: m.id, danteOut: e.target.checked }, 'Dante output'),
      });
      const stream2 = h('input', {
        type: 'checkbox', checked: Boolean(m.stream2?.enabled), disabled: !canConfigure, 'aria-label': `${label} second stream`,
        onchange: e => call('/meeting-languages/update', { languageId: m.id, stream2: { enabled: e.target.checked } }, '2nd stream'),
      });
      return h('li', { class: 'lang-row' },
        h('span', { class: 'tag' }, abbrOf(m.id)),
        h('strong', null, label),
        nativeOf(m.id) ? h('small', { class: 'sub' }, nativeOf(m.id)) : null,
        h('span', { class: 'checks' }, h('label', null, dante, 'Dante'), h('label', null, stream2, '2nd stream')),
        h('span', { class: 'actions' }, up, down, remove));
    }

    let meetingSection;
    if (!ml) {
      meetingSection = h('p', { class: 'muted' }, store.unavailable('dicentis.meetingLanguages') ?? 'No active meeting');
    } else {
      const candidates = langs.filter(l => !inMeeting.has(String(l.id))).sort((a, b) => String(a.label).localeCompare(String(b.label)));
      const select = h('select', {
        'aria-label': 'Language to add', disabled: !canConfigure || !candidates.length,
        onchange: e => { addPick = e.target.value; },
      }, candidates.map(l => h('option', { value: String(l.id), selected: String(l.id) === addPick }, `${l.label} (${l.abbreviation})`)));
      const addButton = actionButton('Add to meeting', () => {
        const lang = candidates.find(l => String(l.id) === select.value);
        if (!lang) return undefined;
        return api.dicentis('/meeting-languages/add', { languageId: lang.id }).then(() => { addPick = ''; });
      }, { cls: 'small primary', disabled: !canConfigure || !candidates.length });
      meetingSection = [
        meetingList.length
          ? h('ol', { class: 'lang-list' }, meetingList.map((m, i) => meetingRow(m, i)))
          : h('p', { class: 'muted small-text' }, 'No languages in the meeting yet.'),
        h('div', { class: 'row-inline' }, select, addButton),
      ];
    }

    // ------------------------------------------------------------ 2. interpreter desks
    const desks = store.topic('dicentis.desks');
    const outputSelect = (desk, key, outLabel) => {
      const current = desk[key] ?? '';
      const known = meetingList.some(m => String(m.id) === String(current));
      return h('select', {
        'aria-label': `${deskName(desk)} output ${outLabel}`, disabled: !canDesks,
        onchange: e => call('/desks/update', { seatId: desk.seatId, [key]: e.target.value || null }, 'Desk output'),
      },
      h('option', { value: '', selected: current === '' }, '—'),
      meetingList.map(m => h('option', { value: String(m.id), selected: String(m.id) === String(current) }, abbrOf(m.id))),
      current !== '' && !known ? h('option', { value: String(current), selected: true }, String(current)) : null);
    };
    const chooser = (desk, key) => {
      if (!meetingList.length) return h('span', { class: 'muted' }, '—');
      const chosen = new Set((desk[key] ?? []).map(String));
      const items = meetingList.map(m => {
        const input = h('input', {
          type: 'checkbox', checked: chosen.has(String(m.id)), disabled: !canDesks,
          'aria-label': `${deskName(desk)} ${key === 'setB' ? 'B' : 'C'} can choose ${abbrOf(m.id)}`,
        });
        return { id: m.id, input, el: h('label', null, input, abbrOf(m.id)) };
      });
      for (const item of items) {
        item.input.addEventListener('change', () => call('/desks/update',
          { seatId: desk.seatId, [key]: items.filter(x => x.input.checked).map(x => x.id) }, 'Desk language choice'));
      }
      return h('div', { class: 'checks' }, items.map(x => x.el));
    };
    const deskName = desk => desk.name ?? `Seat ${desk.seatId}`;

    let deskSection;
    if (!desks) {
      deskSection = h('p', { class: 'muted' }, store.unavailable('dicentis.desks') ?? 'No active meeting');
    } else if (!desks.length) {
      deskSection = h('p', { class: 'muted' }, 'No interpreter desks in the active meeting.');
    } else {
      deskSection = h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, ['Desk', 'Output A', 'Output B', 'Output C', 'B can choose', 'C can choose']
          .map(t => h('th', { scope: 'col' }, t)))),
        h('tbody', null, desks.map(d => h('tr', { 'data-seat': d.seatId },
          h('td', null, h('strong', null, deskName(d))),
          h('td', null, outputSelect(d, 'outA', 'A')),
          h('td', null, outputSelect(d, 'outB', 'B')),
          h('td', null, outputSelect(d, 'outC', 'C')),
          h('td', null, chooser(d, 'setB')),
          h('td', null, chooser(d, 'setC')))))));
    }

    // ------------------------------------------------------------ 3. system languages
    const sysLangs = store.topic('dicentis.languages');
    sumEl.textContent = `System languages (${sysLangs?.length ?? 0})`;
    const editRow = l => {
      const abbrInput = h('input', {
        type: 'text', maxlength: 8, value: editValues.abbreviation, 'aria-label': `Abbreviation for ${l.label}`, disabled: !sysAllowed,
        oninput: e => { editValues.abbreviation = e.target.value; },
      });
      const labelInput = h('input', {
        type: 'text', maxlength: 60, value: editValues.label, 'aria-label': `Name for ${l.label}`, disabled: !sysAllowed,
        oninput: e => { editValues.label = e.target.value; },
      });
      const nativeInput = h('input', {
        type: 'text', maxlength: 60, value: editValues.native, 'aria-label': `Native name for ${l.label}`, disabled: !sysAllowed,
        oninput: e => { editValues.native = e.target.value; },
      });
      const save = actionButton('Save', async () => {
        const abbreviation = editValues.abbreviation.trim();
        const label = editValues.label.trim();
        const native = editValues.native.trim();
        if (!abbreviation || !label) throw new Error('Abbreviation and name are required');
        await api.dicentis('/languages/update', { id: l.id, abbreviation, label, native });
        editingId = null;
        render();
      }, { cls: 'small primary', disabled: !sysAllowed });
      const cancel = h('button', { type: 'button', class: 'secondary small', onclick: () => { editingId = null; render(); } }, 'Cancel');
      return h('tr', { 'data-lang': l.id },
        h('td', null, abbrInput), h('td', null, labelInput), h('td', null, nativeInput),
        h('td', { class: 'actions' }, save, cancel));
    };
    const viewRow = l => {
      const edit = h('button', {
        type: 'button', class: 'secondary small', disabled: !sysAllowed, 'aria-label': `Edit ${l.label}`,
        onclick: () => {
          editingId = l.id;
          editValues = { abbreviation: l.abbreviation ?? '', label: l.label ?? '', native: l.native ?? '' };
          render();
        },
      }, 'Edit');
      const del = actionButton('Delete', () => api.dicentis('/languages/delete', { id: l.id }), {
        cls: 'small danger-outline', disabled: !sysAllowed,
        confirm: `Delete ${l.label}? Meeting languages and desks using it are affected.`, danger: true,
      });
      del.setAttribute('aria-label', `Delete ${l.label}`);
      return h('tr', { 'data-lang': l.id },
        h('td', null, l.abbreviation),
        h('td', null, l.label),
        h('td', null, l.native ?? ''),
        h('td', { class: 'actions' }, l.userDefined ? [edit, del] : h('span', { class: 'muted small-text' }, 'built-in')));
    };

    replace(sysBody,
      sysLangs
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, ['Abbreviation', 'Language', 'Native name', ''].map(t => h('th', { scope: 'col' }, t)))),
          h('tbody', null, [...sysLangs]
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map(l => (editingId === l.id && l.userDefined ? editRow(l) : viewRow(l))))))
        : h('p', { class: 'muted' }, store.unavailable('dicentis.languages') ?? 'Not available'),
      addForm.form);
    addForm.abbr.disabled = !sysAllowed;
    addForm.label.disabled = !sysAllowed;
    addForm.native.disabled = !sysAllowed;
    addForm.submit.disabled = !sysAllowed;

    replace(box,
      h('h3', null, 'Meeting languages'),
      meetingSection,
      h('h3', null, 'Interpreter desks'),
      deskSection,
      sysDetails);
  }

  render();
  return store.subscribe(KEYS, render);
}
