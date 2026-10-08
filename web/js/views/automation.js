// Settings → Camera automation (WO-040, DEC-012 §4): director settings, overview shot, per-seat shots, log.
// WO-092: delete one seat's preset, all presets of a camera, or all saved presets.
import { h, replace, toast, toastError, actionButton } from '../dom.js';

export default {
  id: 'automation',
  title: 'Camera automation',
  topics: ['room'],
  mount(el, { store, api }) {
    const settingsBox = h('div');
    const overviewBox = h('div');
    const tableBody = h('tbody');
    const logBox = h('div');

    const room = () => store.topic('room');
    const cameras = () => store.topic('devices.cameras')?.cameras ?? [];
    const seats = () => store.topic('domain.seats') ?? [];
    const presetOf = input => { const v = input.value.trim(); return /^\d+$/.test(v) ? Number(v) : v; };
    const camSelect = (selected, label) => h('select', { 'aria-label': label },
      h('option', { value: '' }, '— none —'), cameras().map(c => h('option', { value: c.id, selected: selected === c.id }, c.name)));

    function renderSettings() {
      const d = room()?.director;
      if (!d) return;
      const num = (name, label, value, max, hint) => h('label', { class: 'field' }, h('span', null, label),
        h('input', { name, type: 'number', min: 0, max, step: 100, value: String(value) }), hint ? h('small', { class: 'muted' }, hint) : null);
      const form = h('form', { class: 'settings', novalidate: true },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'enabled', checked: d.enabled }), ' Automatic camera control (follow the active microphone)'),
        h('fieldset', { class: 'radio-group' }, h('legend', null, 'Moving a camera that is on air'),
          h('label', { class: 'check' }, h('input', { type: 'radio', name: 'strategy', value: 'safe', checked: d.strategy === 'safe' }),
            h('span', null, h('strong', null, 'Safe: '), 'never move the camera that is on air. Cut to the overview camera first, move, then cut back.')),
          h('label', { class: 'check' }, h('input', { type: 'radio', name: 'strategy', value: 'live', checked: d.strategy === 'live' }),
            h('span', null, h('strong', null, 'Live: '), 'recall the preset and cut immediately (camera movement may be visible).'))),
        h('div', { class: 'row three' },
          num('delayMs', 'Delay after mic on (ms)', d.delayMs, 10000, 'Ignore very short mic activations.'),
          num('minShotMs', 'Minimum shot (ms)', d.minShotMs, 60000, 'Hold each shot at least this long.'),
          num('settleMs', 'Camera travel time (ms)', d.settleMs ?? 2500, 15000, 'Wait before cutting when the camera cannot report arrival.')),
        h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary' }, 'Save')));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const f = n => form.elements.namedItem(n);
        try {
          await api.put('/room/director', {
            enabled: f('enabled').checked, strategy: form.querySelector('input[name=strategy]:checked').value,
            delayMs: Number(f('delayMs').value), minShotMs: Number(f('minShotMs').value), settleMs: Number(f('settleMs').value),
          });
          toast('Automation settings saved', 'success');
        } catch (err) { toastError(err); }
      });
      replace(settingsBox, form);
    }

    function renderOverview() {
      const o = room()?.overview;
      const cam = camSelect(o?.cameraId, 'Overview camera');
      const preset = h('input', { type: 'text', value: o?.preset ?? '', placeholder: 'Preset', 'aria-label': 'Overview preset', class: 'preset-input' });
      replace(overviewBox,
        h('p', { class: 'muted small-text' }, 'Used when nobody is speaking, for seats without a shot, and as the safe cut-away.'),
        h('div', { class: 'row-inline' }, cam, preset,
          actionButton('Save', () => api.put('/room/overview', cam.value ? { cameraId: cam.value, preset: presetOf(preset) } : {}), { cls: 'small primary' }),
          actionButton('Test', () => api.post(`/devices/cameras/${cam.value}/recall`, { preset: presetOf(preset) }), { cls: 'small secondary', disabled: !cam.value }),
          actionButton('Take', () => api.post('/director/shot', {}), { cls: 'small secondary', disabled: !o })));
    }

    function renderTable() {
      const r = room();
      if (!r) return;
      const list = seats();
      replace(tableBody, list.length ? list.map(seat => {
        const shot = r.shots[seat.id];
        const cam = camSelect(shot?.cameraId, `Camera for ${seat.name}`);
        const preset = h('input', { type: 'text', value: shot?.preset ?? '', placeholder: 'Preset', 'aria-label': `Preset for ${seat.name}`, class: 'preset-input' });
        return h('tr', { class: seat.hidden ? 'absent' : null },
          h('td', null, h('strong', null, seat.name), seat.person ? h('small', { class: 'sub' }, seat.person) : null),
          h('td', null, cam), h('td', null, preset),
          h('td', { class: 'row-actions' },
            actionButton('Save', () => (cam.value ? api.put(`/room/shots/${encodeURIComponent(seat.id)}`, { cameraId: cam.value, preset: presetOf(preset) }) : api.del(`/room/shots/${encodeURIComponent(seat.id)}`)), { cls: 'small primary' }),
            actionButton('Test', () => api.post(`/devices/cameras/${cam.value}/recall`, { preset: presetOf(preset) }), { cls: 'small secondary', disabled: !cam.value }),
            actionButton('Store', async () => {
              const res = await api.post(`/devices/cameras/${cam.value}/store`, { preset: preset.value.trim() === '' ? undefined : presetOf(preset), name: seat.name });
              preset.value = res.preset;
              await api.put(`/room/shots/${encodeURIComponent(seat.id)}`, { cameraId: cam.value, preset: res.preset });
              toast(`${seat.name}: stored as preset ${res.preset}`, 'success');
            }, { cls: 'small secondary', disabled: !cam.value, title: 'Store the camera\'s current position as this seat\'s preset' }),
            actionButton('Take', () => api.post('/director/shot', { seatId: seat.id }), { cls: 'small secondary', disabled: !shot }),
            shot ? Object.assign(actionButton('✕', () => api.del(`/room/shots/${encodeURIComponent(seat.id)}`), { cls: 'small danger-outline icon-only', title: `Delete the saved preset of ${seat.name}` }),
              { ariaLabel: `Delete the saved preset of ${seat.name}` }) : null));
      }) : h('tr', null, h('td', { colspan: 4, class: 'muted' }, 'No seats (connect to DICENTIS first).')));
    }

    const clearBox = h('div');
    function renderClear() {
      const r = room();
      const shots = Object.values(r?.shots ?? {});
      const count = id => shots.filter(s => s.cameraId === id).length;
      const pick = h('select', { 'aria-label': 'Presets to delete' },
        h('option', { value: '' }, `All cameras (${shots.length})`),
        cameras().filter(c => count(c.id)).map(c => h('option', { value: c.id }, `${c.name} (${count(c.id)})`)));
      replace(clearBox, h('div', { class: 'row-inline' }, pick,
        actionButton('Delete presets', () => {
          const cam = cameras().find(c => c.id === pick.value);
          return api.del(`/room/shots${pick.value ? `?cameraId=${encodeURIComponent(pick.value)}` : ''}`)
            .then(() => toast(cam ? `${cam.name}: presets deleted` : 'All saved presets deleted', 'success'));
        }, { cls: 'small danger-outline', danger: true, disabled: !shots.length && !r?.overview,
          confirm: 'Delete the saved seat presets (and the overview shot when it uses that camera)? The positions stored in the cameras themselves are not touched.' })));
    }

    function renderLog() {
      const d = store.topic('director');
      replace(logBox, d?.log?.length
        ? h('ul', { class: 'log' }, d.log.slice(0, 15).map(l => h('li', { class: l.error ? 'error' : null }, h('time', null, new Date(l.at).toLocaleTimeString()), ' ', l.message)))
        : h('p', { class: 'muted small-text' }, 'No camera actions yet.'));
    }

    el.append(
      h('h1', { id: 'view-title' }, 'Camera automation'),
      h('div', { class: 'split asym' },
        h('div', { class: 'stack' },
          h('article', { class: 'card' }, h('h2', null, 'Behaviour'), settingsBox),
          h('article', { class: 'card' }, h('h2', null, 'Overview shot'), overviewBox),
          h('article', { class: 'card' }, h('h2', null, 'Recent actions'), logBox)),
        h('article', { class: 'card' }, h('h2', null, 'Seat shots'),
          h('p', { class: 'muted small-text' }, 'Point the camera at the seat (Settings → Cameras jog pad), then “Store”. When the seat\'s microphone becomes active, this preset is recalled and the switcher cuts to the camera.'),
          clearBox,
          h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
            h('thead', null, h('tr', null, ['Seat', 'Camera', 'Preset', ''].map(t => h('th', { scope: 'col' }, t)))), tableBody)))),
    );
    renderSettings(); renderOverview(); renderTable(); renderClear(); renderLog();
    let lastRoomKey = '';
    return store.subscribe(['topic:room', 'topic:devices.cameras', 'topic:domain.seats', 'topic:director'], () => {
      // Avoid wiping half-typed inputs: only rebuild forms when settings/shots/cameras actually change.
      const r = room();
      const key = JSON.stringify([r?.director, r?.overview, r?.shots, cameras().map(c => [c.id, c.name]), seats().map(x => x.id)]);
      if (key !== lastRoomKey) { lastRoomKey = key; renderSettings(); renderOverview(); renderTable(); renderClear(); }
      renderLog();
    });
  },
};
