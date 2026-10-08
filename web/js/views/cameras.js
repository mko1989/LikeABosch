// Settings → Cameras & switcher (WO-040, DEC-012): camera list/edit with model templates, PTZ jog, presets,
// video switcher (ATEM) settings and camera → switcher input mapping.
import { ptzPad, ptzHolding, afterPtzHold } from '../ptz.js';
import { h, replace, toast, toastError, actionButton } from '../dom.js';

/** Model templates prefill the protocol fields (Avonic values are assumptions until verified, WO-041). */
const TEMPLATES = [
  { id: 'avonic-visca-udp', label: 'Avonic: VISCA over IP (UDP)', config: { driver: 'visca', transport: 'udp', framing: 'raw', port: 1259, address: 1 }, note: 'Check the VISCA port in the camera web interface (Avonic: often UDP 1259 or TCP 5678).' },
  { id: 'avonic-visca-tcp', label: 'Avonic: VISCA over IP (TCP)', config: { driver: 'visca', transport: 'tcp', framing: 'raw', port: 5678, address: 1 } },
  { id: 'avonic-onvif', label: 'Avonic: ONVIF', config: { driver: 'onvif', port: 80 }, note: 'Uses the ONVIF user/password of the camera. Presets are ONVIF tokens.' },
  { id: 'sony-visca-ip', label: 'Sony: VISCA over IP (UDP 52381)', config: { driver: 'visca', transport: 'udp', framing: 'sony', port: 52381, address: 1 } },
  { id: 'panasonic-aw', label: 'Panasonic AW (HTTP)', config: { driver: 'panasonic', port: 80 }, note: 'Presets 1–100.' },
  { id: 'onvif', label: 'Other ONVIF PTZ camera', config: { driver: 'onvif', port: 80 } },
  { id: 'mock', label: 'Simulated camera (no hardware)', config: { driver: 'mock' } },
];
const DRIVER_FIELDS = {
  visca: ['host', 'port', 'transport', 'framing', 'address'],
  panasonic: ['host', 'port', 'username', 'password'],
  onvif: ['host', 'port', 'username', 'password'],
  mock: [],
};

export default {
  id: 'cameras',
  title: 'Cameras & switcher',
  topics: ['devices.cameras'],
  mount(el, { store, api }) {
    const listBox = h('div', { class: 'list' });
    const formBox = h('div');
    const controlBox = h('div');
    const switcherBox = h('div');
    let editing = null;       // camera being edited (or {} for new)
    let selectedId = null;    // camera shown in the control panel

    const cameras = () => store.topic('devices.cameras')?.cameras ?? [];
    const switcher = () => store.topic('devices.switcher')?.switcher ?? null;
    const statusPill = st => h('span', { class: ['pill', st?.connected ? 'loggedIn' : 'error'], title: st?.lastError ?? '' }, st?.connected ? 'Connected' : 'Offline');

    function renderList() {
      const cams = cameras();
      if (selectedId && !cams.some(c => c.id === selectedId)) selectedId = null;
      replace(listBox, cams.length ? cams.map(c => h('div', { class: ['row-item', 'camera-row', selectedId === c.id && 'current'] },
        statusPill(c.status),
        h('span', { class: 'name' }, c.name, h('small', { class: 'sub' }, describe(c),
          c.switcherInput === null || c.switcherInput === undefined ? ' · no switcher input' : ` · input ${c.switcherInput}`,
          c.status?.lastError && !c.status.connected ? ` · ${c.status.lastError}` : '')),
        automationSwitch(c),
        h('span', { class: 'row-actions' },
          h('button', { type: 'button', class: 'small primary', onclick: () => { selectedId = c.id; renderAll(); } }, 'Control'),
          h('button', { type: 'button', class: 'small secondary', onclick: () => { editing = { ...c }; renderForm(); } }, 'Edit'),
          actionButton('Delete', () => api.del(`/devices/cameras/${c.id}`), { cls: 'small danger-outline', danger: true, confirm: `Delete camera "${c.name}"? Its seat shots are removed from the room.` }))))
        : h('p', { class: 'muted empty' }, 'No cameras yet. Add one below.'));
    }

    /** DEC-015: operator switch, saved immediately (no reconnect). */
    function automationSwitch(c) {
      const on = c.automation !== false;
      return h('label', { class: 'switch', title: on ? 'Used by the camera automation' : 'Not used by the automation (moved and cut only by hand)' },
        h('input', {
          type: 'checkbox', checked: on, 'aria-label': `${c.name}: camera automation`,
          onchange: async e => { try { await api.put(`/devices/cameras/${c.id}`, { automation: e.target.checked }); } catch (err) { toastError(err); e.target.checked = !e.target.checked; } },
        }), h('span', null, on ? 'Auto' : 'Manual'));
    }

    function describe(c) {
      if (c.driver === 'visca') return `VISCA ${c.framing === 'sony' ? 'over IP (Sony)' : 'raw'} ${c.transport?.toUpperCase()} ${c.host}:${c.port}`;
      if (c.driver === 'panasonic') return `Panasonic AW ${c.host}:${c.port ?? 80}`;
      if (c.driver === 'onvif') return `ONVIF ${c.host}:${c.port ?? 80}`;
      return 'Simulated';
    }

    // ---------------------------------------------------------------- add / edit form
    function renderForm() {
      if (!editing) {
        replace(formBox, h('button', { type: 'button', class: 'primary', onclick: () => { editing = { ...TEMPLATES[0].config, name: '', _template: TEMPLATES[0].id, _note: TEMPLATES[0].note }; renderForm(); } }, 'Add camera'));
        return;
      }
      const isNew = !editing.id;
      const field = (name, label, input, hint) => h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', { class: 'muted' }, hint) : null);
      const v = name => editing[name] ?? '';
      const sw = switcher();
      const inputs = sw?.status?.inputs ?? [];
      // The chosen model stays selected after the form is rebuilt for its fields (it used to fall back to "Choose…").
      const template = h('select', { 'aria-label': 'Camera model' },
        h('option', { value: '', selected: !editing._template }, isNew ? 'Choose camera model…' : 'Keep current settings'),
        TEMPLATES.map(t => h('option', { value: t.id, selected: editing._template === t.id }, t.label)));
      template.addEventListener('change', () => {
        const t = TEMPLATES.find(x => x.id === template.value);
        if (!t) return;
        editing = { ...editing, ...formValues(), ...t.config, _template: t.id, _note: t.note }; // keep what was typed (name, host…)
        renderForm();
      });
      const fields = DRIVER_FIELDS[editing.driver] ?? [];
      const inputEl = (name, attrs = {}) => h('input', { name, value: String(v(name)), ...attrs });
      /** Values typed so far that the next model's form also has (not the protocol fields the model sets). */
      const formValues = () => {
        const out = {};
        for (const n of ['name', 'host', 'username', 'switcherInput']) {
          const raw = form.elements.namedItem(n)?.value;
          if (raw === undefined) continue;
          out[n] = n === 'switcherInput' ? (raw === '' ? null : Number(raw)) : raw;
        }
        const auto = form.elements.namedItem('automation');
        if (auto) out.automation = auto.checked;
        return out;
      };
      const form = h('form', { class: 'settings camera-form', novalidate: true },
        h('h2', null, isNew ? 'Add camera' : `Edit ${editing.name}`),
        field('template', 'Camera model / protocol', template, editing._note),
        field('name', 'Name', inputEl('name', { required: true, maxlength: 60, placeholder: 'e.g. Chair camera' })),
        fields.includes('host') ? h('div', { class: 'row' },
          field('host', 'IP address / host', inputEl('host', { spellcheck: 'false', placeholder: '192.168.1.50' })),
          field('port', 'Port', inputEl('port', { type: 'number', min: 1, max: 65535 }))) : null,
        fields.includes('transport') ? h('div', { class: 'row three' },
          field('transport', 'Transport', h('select', { name: 'transport' }, ['udp', 'tcp'].map(x => h('option', { value: x, selected: editing.transport === x }, x.toUpperCase())))),
          field('framing', 'Framing', h('select', { name: 'framing' },
            h('option', { value: 'raw', selected: editing.framing === 'raw' }, 'Raw VISCA'),
            h('option', { value: 'sony', selected: editing.framing === 'sony' }, 'Sony VISCA over IP'))),
          field('address', 'VISCA address', inputEl('address', { type: 'number', min: 1, max: 7 }))) : null,
        fields.includes('username') ? h('div', { class: 'row' },
          field('username', 'User', inputEl('username', { autocomplete: 'off' })),
          field('password', 'Password', h('input', { name: 'password', type: 'password', autocomplete: 'new-password', placeholder: editing.passwordSet ? '•••••• (leave empty to keep)' : '' }))) : null,
        field('switcherInput', 'Switcher input', h('select', { name: 'switcherInput' },
          h('option', { value: '' }, '— not on the switcher —'),
          (inputs.length ? inputs : Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Input ${i + 1}` })))
            .map(i => h('option', { value: String(i.id), selected: editing.switcherInput === i.id }, `${i.id}: ${i.name}`)))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'automation', checked: editing.automation !== false }),
          ' Use in camera automation', h('small', { class: 'muted' }, ' (off = the director never moves or cuts to this camera; can be switched any time)')),
        h('div', { class: 'actions' },
          h('button', { type: 'submit', class: 'primary' }, isNew ? 'Add camera' : 'Save'),
          h('button', { type: 'button', class: 'secondary', onclick: () => { editing = null; renderForm(); } }, 'Cancel')));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const val = n => form.elements.namedItem(n)?.value;
        const body = { name: val('name').trim(), driver: editing.driver };
        for (const f of fields) {
          const raw = val(f);
          if (raw === undefined) continue;
          if (['port', 'address'].includes(f)) { if (raw !== '') body[f] = Number(raw); } else if (f === 'password') { if (raw) body.password = raw; } else body[f] = raw.trim();
        }
        body.switcherInput = val('switcherInput') === '' ? null : Number(val('switcherInput'));
        body.automation = form.elements.namedItem('automation').checked;
        try {
          const saved = isNew ? await api.post('/devices/cameras', body) : await api.put(`/devices/cameras/${editing.id}`, body);
          toast(saved.status?.connected ? `${saved.name} connected` : `${saved.name} saved: ${saved.status?.lastError ?? 'not connected yet'}`, saved.status?.connected ? 'success' : 'error');
          selectedId = saved.id;
          editing = null;
          renderAll();
        } catch (err) { toastError(err); }
      });
      replace(formBox, form);
    }

    // ---------------------------------------------------------------- PTZ control
    function renderControl() {
      const cam = cameras().find(c => c.id === selectedId);
      if (!cam) return replace(controlBox, h('p', { class: 'muted' }, 'Select a camera (“Control”) to move it and manage presets.'));
      const presetInput = h('input', { type: 'text', inputmode: 'numeric', placeholder: cam.driver === 'onvif' ? 'token' : 'number', 'aria-label': 'Preset', class: 'preset-input' });
      const presetValue = () => { const x = presetInput.value.trim(); return /^\d+$/.test(x) ? Number(x) : x; };
      const presetList = h('div');
      if (cam.driver === 'onvif' && cam.status?.connected) {
        api.get(`/devices/cameras/${cam.id}/presets`).then(list => replace(presetList, list?.length
          ? h('ul', { class: 'chips' }, list.map(p => h('li', null, h('button', { type: 'button', class: 'link small', onclick: () => { presetInput.value = p.token; } }, `${p.token}: ${p.name}`))))
          : null)).catch(() => {});
      }
      replace(controlBox,
        h('div', { class: 'card-head' }, h('h2', null, `Control: ${cam.name}`), statusPill(cam.status)),
        ptzPad({ api, cam }),
        cam.currentPreset ? h('p', { class: 'muted small-text' }, `Current preset ${cam.currentPreset.preset}${cam.currentPreset.modified ? ' (adjusted since)' : ''}`) : null,
        h('div', { class: 'row-inline preset-row' }, presetInput,
          actionButton('Recall', () => api.post(`/devices/cameras/${cam.id}/recall`, { preset: presetValue() }), { cls: 'small primary' }),
          actionButton('Store', async () => { const r = await api.post(`/devices/cameras/${cam.id}/store`, { preset: presetValue() === '' ? undefined : presetValue() }); presetInput.value = r.preset; toast(`Stored preset ${r.preset}`, 'success'); }, { cls: 'small secondary' }),
          actionButton('Test connection', async () => { const r = await api.post(`/devices/cameras/${cam.id}/test`, {}); toast(r.status.connected ? `Connected${r.power ? ` (power ${r.power})` : ''}` : `Offline: ${r.status.lastError}`, r.status.connected ? 'success' : 'error'); }, { cls: 'small secondary' })),
        presetList,
        cam.switcherInput !== null && cam.switcherInput !== undefined
          ? h('div', { class: 'actions' },
            actionButton(`Cut to input ${cam.switcherInput}`, () => api.post('/devices/switcher/cut', { input: cam.switcherInput }), { cls: 'small secondary' }),
            actionButton('Preview', () => api.post('/devices/switcher/preview', { input: cam.switcherInput }), { cls: 'small secondary', title: `Put input ${cam.switcherInput} on the preview bus` }))
          : null);
    }

    // ---------------------------------------------------------------- switcher
    // ATEM autodiscovery (WO-090): mDNS browse on the backend's network; "Use" fills in the address.
    let found = null; // null = not searched yet; [] = nothing found
    let finding = false;
    function discoveryBox(driver, host) {
      const find = async () => {
        finding = true; renderSwitcher();
        try { found = await api.get('/devices/switcher/discover?timeoutMs=3000'); } catch (err) { toastError(err, 'Find ATEM: '); found = null; }
        finding = false; renderSwitcher();
      };
      return h('div', { class: 'atem-discovery' },
        h('button', { type: 'button', class: 'secondary small', disabled: finding, onclick: find }, finding ? 'Searching…' : 'Find ATEM on the network'),
        found && !found.length ? h('p', { class: 'muted small-text' }, 'No ATEM answered. It must be on the same network segment as this computer (mDNS does not cross routers); enter the address by hand otherwise.') : null,
        found?.length ? h('ul', { class: 'compact found-list' }, found.map(f => h('li', null,
          h('strong', null, f.name), f.model && f.model !== f.name ? ` · ${f.model}` : '', ` · ${f.address ?? 'no address'} `,
          f.address ? h('button', { type: 'button', class: 'link small', onclick: () => { driver.value = 'atem'; host.value = f.address; host.focus(); toast(`${f.name}: address filled in, now Save switcher`, 'info'); } }, 'Use') : null))) : null);
    }

    function renderSwitcher() {
      const sw = switcher();
      const driver = h('select', { name: 'driver', 'aria-label': 'Switcher type' },
        h('option', { value: '', selected: !sw }, 'None'),
        h('option', { value: 'atem', selected: sw?.driver === 'atem' }, 'Blackmagic ATEM'),
        h('option', { value: 'mock', selected: sw?.driver === 'mock' }, 'Simulated switcher'));
      const host = h('input', { name: 'host', value: sw?.host ?? '', placeholder: '192.168.1.240', spellcheck: 'false' });
      const me = h('input', { name: 'me', type: 'number', min: 1, max: 4, value: String((sw?.me ?? 0) + 1) });
      const save = async () => {
        try {
          await api.put('/devices/switcher', driver.value ? { driver: driver.value, host: host.value.trim(), me: Number(me.value) - 1 } : {});
          toast(driver.value ? 'Switcher saved' : 'Switcher removed', 'success');
        } catch (err) { toastError(err); }
      };
      const st = sw?.status;
      replace(switcherBox,
        h('div', { class: 'card-head' }, h('h2', null, 'Video switcher'), sw ? statusPill(st) : null),
        h('div', { class: 'row three' },
          h('label', { class: 'field' }, h('span', null, 'Type'), driver),
          h('label', { class: 'field' }, h('span', null, 'IP address'), host),
          h('label', { class: 'field' }, h('span', null, 'M/E'), me)),
        discoveryBox(driver, host),
        h('label', { class: 'check' }, h('input', {
          type: 'checkbox', checked: sw ? sw.automation !== false : true, 'aria-label': 'Automatic switcher cuts', disabled: !sw,
          onchange: async e => {
            try { await api.patch('/devices/switcher', { automation: e.target.checked }); toast(e.target.checked ? 'Automatic cuts on' : 'Automatic cuts off: cameras still follow, you cut by hand', 'success'); } catch (err) { toastError(err); e.target.checked = !e.target.checked; }
          },
        }), ' Automatic cuts (camera automation)'),
        h('p', { class: 'muted small-text' }, sw ? 'Off: cameras still follow the speakers, you cut by hand.' : 'Available once the switcher is saved.'),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary', onclick: save }, 'Save switcher')),
        st ? h('div', null,
          h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Model'), h('span', { class: 'v' }, st.model ?? '—')),
          h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Program / preview'), h('span', { class: 'v' }, `${st.program ?? '—'} / ${st.preview ?? '—'}`)),
          st.lastError && !st.connected ? h('p', { class: 'error small-text' }, st.lastError) : null,
          h('p', { class: 'muted small-text' }, 'Automation does a hard program cut on this M/E.'))
          : null);
    }

    // ---------------------------------------------------------------- room view options (WO-053)
    const operateBox = h('div');
    function renderOperate() {
      const on = Boolean(store.topic('room')?.operate?.cogSendsPreview);
      replace(operateBox,
        h('h2', null, 'Room view'),
        h('label', { class: 'check' },
          h('input', {
            type: 'checkbox', checked: on, 'aria-label': 'Camera cog sends to preview',
            onchange: async e => {
              try { await api.put('/room/operate', { cogSendsPreview: e.target.checked }); } catch (err) { toastError(err); e.target.checked = !e.target.checked; }
            },
          }),
          ' Clicking a camera\'s ⚙ on the room plan also sends it to the switcher preview'),
        h('p', { class: 'muted small-text' }, 'Applies to everyone using this LikeABosch server. The camera inspector always has a Preview button.'));
    }

    function renderAll() { renderList(); renderForm(); renderControl(); renderSwitcher(); renderOperate(); }

    el.append(
      h('h1', { id: 'view-title' }, 'Cameras & switcher'),
      h('div', { class: 'split' },
        h('div', { class: 'stack' },
          h('article', { class: 'card' }, h('h2', null, 'Cameras'), listBox, h('div', { class: 'form-slot' }, formBox)),
          h('article', { class: 'card' }, switcherBox),
          h('article', { class: 'card' }, operateBox)),
        h('article', { class: 'card' }, controlBox)),
    );
    renderAll();
    const offOperate = store.subscribe(['topic:room'], renderOperate);
    const offDevices = store.subscribe(['topic:devices.cameras', 'topic:devices.switcher'], () => { renderList(); renderSwitcher(); if (!editing) renderForm(); renderControlIfChanged(); });
    return () => { offOperate(); offDevices(); };

    function renderControlIfChanged() {
      // Re-render the control panel only when the selected camera's connection state changes (keeps inputs stable).
      const cam = cameras().find(c => c.id === selectedId);
      const key = cam ? `${cam.id}:${cam.status?.connected}:${cam.switcherInput}:${JSON.stringify(cam.currentPreset)}` : '';
      if (key === renderControlIfChanged.last) return;
      if (ptzHolding()) return afterPtzHold(renderControlIfChanged); // never rebuild the pad mid-hold
      renderControlIfChanged.last = key;
      renderControl();
    }
  },
};
