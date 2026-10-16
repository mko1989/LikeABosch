// Room widget: PTZ (WO-127, DEC-039): pick a camera, jog it, recall / save presets and overwrite the current one.
// Same calls as the camera inspector (WO-054); the camera choice is remembered per browser.
import { h, actionButton, toast, toastError } from '../dom.js';
import { ptzPad } from '../ptz.js';

const cameras = store => store.topic('devices.cameras')?.cameras ?? [];

export default {
  id: 'ptz',
  title: 'PTZ',
  settingsHref: '#/settings/cameras',
  topics: ['devices.cameras', 'devices.switcher', 'room', 'domain.seats'],
  available: store => store.topic('devices.cameras') !== undefined,
  render(store, api, ctx) {
    const list = cameras(store);
    if (!list.length) return [h('p', { class: 'muted small-text' }, 'No cameras yet: add one in ', h('a', { href: '#/settings/cameras' }, 'Settings → Cameras'), '.')];
    const cam = list.find(c => c.id === ctx.setting('cameraId')) ?? list[0];
    const st = cam.status ?? {};
    const cur = cam.currentPreset;
    const camUrl = `/devices/cameras/${encodeURIComponent(cam.id)}`;
    const recallPreset = p => api.post(`${camUrl}/recall`, { preset: p });

    const sw = store.topic('devices.switcher')?.switcher?.status;
    const tallyOf = c => (c.switcherInput === null || c.switcherInput === undefined || !sw?.connected ? null
      : sw.program === c.switcherInput ? 'program' : sw.preview === c.switcherInput ? 'preview' : null);
    const tally = tallyOf(cam);

    // One button per camera (user, 2026-10-16: buttons instead of a drop-down); red edge = on air, dashed = offline.
    const picker = h('div', { class: 'ptz-cameras', role: 'group', 'aria-label': 'Camera' }, list.map(c => h('button', {
      type: 'button', 'data-camera': c.id, 'aria-pressed': String(c.id === cam.id),
      class: ['ptz-cam', c.id === cam.id && 'on', !c.status?.connected && 'offline', tallyOf(c) === 'program' && 'live'],
      title: `${c.name}${c.status?.connected ? '' : ' (offline)'}${tallyOf(c) === 'program' ? ' · on air' : ''}`,
      onclick: () => ctx.set('cameraId', c.id),
    }, c.name)));

    const presetInput = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'Preset', 'aria-label': `Preset for ${cam.name}`, class: 'preset-input' });
    const typed = () => { const v = presetInput.value.trim(); return /^\d+$/.test(v) ? Number(v) : v; };
    const recall = () => (typed() === '' ? toast('Enter a preset', 'error') : recallPreset(typed()));
    const save = async () => {
      if (typed() === '') return toast('Enter the preset number to save to', 'error');
      const r = await api.post(`${camUrl}/store`, { preset: typed(), name: cam.name });
      toast(`${cam.name}: saved as preset ${r.preset}`, 'success');
    };

    // Quick recall: the presets the room uses with this camera (seat shots, overview).
    const r = store.topic('room');
    const seatName = id => (store.topic('domain.seats') ?? []).find(x => x.id === id)?.name ?? id;
    const used = [
      ...(r?.overview?.cameraId === cam.id ? [['Overview', r.overview.preset]] : []),
      ...Object.entries(r?.shots ?? {}).filter(([, sh]) => sh.cameraId === cam.id).map(([seatId, sh]) => [seatName(seatId), sh.preset]),
    ];

    return [
      h('div', { class: 'widget-form' },
        picker,
        h('div', { class: 'seat-badges' },
          h('span', { class: ['pill', st.connected ? 'loggedIn' : 'disconnected'] }, st.connected ? 'Connected' : 'Offline'),
          tally === 'program' ? h('span', { class: 'tag live-tag' }, 'Program (on air)') : tally === 'preview' ? h('span', { class: 'tag ok-tag' }, 'Preview') : null)),
      st.connected ? ptzPad({ api, cam, compact: true }) : h('p', { class: 'muted small-text' }, st.lastError ? `Camera offline: ${st.lastError}` : 'Camera offline.'),
      h('div', { class: 'current-preset' },
        cur ? [h('span', null, 'Current preset ', h('strong', null, String(cur.preset)), cur.modified ? h('span', { class: 'tag warn-tag' }, 'adjusted') : null),
          actionButton(`Overwrite preset ${cur.preset}`, async () => {
            await api.post(`${camUrl}/store`, { preset: cur.preset, name: cam.name });
            toast(`${cam.name}: preset ${cur.preset} overwritten with the current position`, 'success');
          }, { cls: cur.modified ? 'small primary' : 'small secondary', disabled: !st.connected, title: 'Store the current position into the preset that was recalled last' })]
          : h('span', { class: 'muted small-text' }, 'No current preset: recall one to be able to overwrite it.')),
      h('div', { class: 'row-inline preset-row' }, presetInput,
        actionButton('Recall', recall, { cls: 'small secondary', disabled: !st.connected }),
        actionButton('Save', save, { cls: 'small secondary', disabled: !st.connected, title: 'Store the current position as this preset number' })),
      used.length ? h('div', { class: 'tray preset-chips' }, used.map(([label, p]) => h('button', {
        type: 'button', class: ['chip-button', cur && String(cur.preset) === String(p) && 'on'], disabled: !st.connected,
        title: `Recall preset ${p}`, onclick: () => recallPreset(p).catch(toastError),
      }, `${label} · ${p}`))) : null,
    ];
  },
};
