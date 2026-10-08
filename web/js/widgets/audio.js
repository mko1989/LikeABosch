// Room widget: audio (WO-104, DEC-030): master volume (Conference Protocol); with the full DICENTIS API also the room
// gains for loudspeakers / sound reinforcement and compact level meters (WO-081).
import { h, toastError } from '../dom.js';
import { gainControls, vuMeters } from '../dicentis-audio.js';

const ROOM_GAINS = ['Loudspeaker', 'SoundReinforcement'];
const SENSORS = ['Loudspeaker', 'Microphone', 'SoundReinforcement'];

export default {
  id: 'audio',
  title: 'Audio',
  settingsHref: '#/settings/audio',
  topics: ['masterVolume', 'masterVolumeRange', 'dicentis.audio', 'domain.capabilities', 'permissions'],
  available: store => store.topic('masterVolume') !== undefined || Boolean(store.topic('domain.capabilities')?.dicentis?.audio),
  /** Mounted once: holds the level meters (their own fast updates) across re-renders. */
  setup(store, api) {
    const meters = vuMeters(store, api, { sensors: SENSORS });
    const off = store.subscribe(['topic:dicentis.vu'], () => meters.update());
    return { meters, destroy: () => { off(); meters.destroy(); } };
  },
  render(store, api, ctx) {
    const parts = [];
    const volume = store.topic('masterVolume')?.volume;
    if (volume !== undefined) {
      const range = store.topic('masterVolumeRange')?.range;
      const out = h('output', { class: 'gain-value' }, `${volume} dB`);
      const slider = h('input', { type: 'range', min: range?.minimumVolume ?? 0, max: range?.maximumVolume ?? Math.max(volume, 100), step: 0.5, value: String(volume),
        'aria-label': 'Master volume (dB)', disabled: !store.can('canControlMasterVolume') });
      slider.addEventListener('input', () => { out.textContent = `${slider.value} dB`; });
      slider.addEventListener('change', () => api.wired('SetMasterVolume', { volume: Number(slider.value) }).catch(err => toastError(err, 'Volume: ')));
      parts.push(h('div', { class: 'gain-list compact' }, h('div', { class: 'gain-row' }, h('span', { class: 'gain-name' }, 'Master'), slider, out, h('span'))));
    }
    if (store.topic('domain.capabilities')?.dicentis?.audio) {
      parts.push(gainControls(store, api, { types: ROOM_GAINS, compact: true }).el, ctx.meters.el);
    }
    return parts.length ? parts : [h('p', { class: 'muted small-text' }, 'No audio controls on this system.')];
  },
};
