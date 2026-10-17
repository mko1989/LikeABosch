// Settings → Camera automation (WO-040, DEC-012 §4): which camera preset each seat gets.
// WO-092: delete one seat's preset, all presets of a camera, or all saved presets.
// WO-129: behaviour, overview shot and the action log moved to Settings → Cameras & switcher.
import { h, replace, toast, toastError, actionButton } from '../dom.js';

export default {
  id: 'automation',
  title: 'Camera automation',
  topics: ['room'],
  mount(el, { store, api }) {
    const tableBody = h('tbody');

    const room = () => store.topic('room');
    const cameras = () => store.topic('devices.cameras')?.cameras ?? [];
    const seats = () => store.topic('domain.seats') ?? [];
    const presetOf = input => { const v = input.value.trim(); return /^\d+$/.test(v) ? Number(v) : v; };
    const camSelect = (selected, label) => h('select', { 'aria-label': label },
      h('option', { value: '' }, '— none —'), cameras().map(c => h('option', { value: c.id, selected: selected === c.id }, c.name)));

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

    el.append(
      h('h1', { id: 'view-title' }, 'Camera automation'),
      h('article', { class: 'card' }, h('h2', null, 'Seat presets'),
        h('p', { class: 'muted small-text' }, 'Point the camera at the seat (jog pad in ', h('a', { href: '#/settings/cameras' }, 'Settings → Cameras & switcher'), '), then “Store”. When the seat\'s microphone becomes active, this preset is recalled and the switcher cuts to the camera. Automatic on/off, timings and the overview shot are set there too.'),
        clearBox,
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, ['Seat', 'Camera', 'Preset', ''].map(t => h('th', { scope: 'col' }, t)))), tableBody))),
    );
    renderTable(); renderClear();
    let lastRoomKey = '';
    return store.subscribe(['topic:room', 'topic:devices.cameras', 'topic:domain.seats'], () => {
      // Avoid wiping half-typed inputs: only rebuild when shots/cameras/seats actually change.
      const r = room();
      const key = JSON.stringify([r?.overview, r?.shots, cameras().map(c => [c.id, c.name]), seats().map(x => x.id)]);
      if (key !== lastRoomKey) { lastRoomKey = key; renderTable(); renderClear(); }
    });
  },
};
