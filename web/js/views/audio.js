// Settings → Audio (WO-049, DEC-014 §3): what the Conference Protocol can do for audio: master volume (moved here from
// System), per-seat microphone sensitivity, interpretation routing overview. DICENTIS's own audio/Dante settings (room
// gains, equalisers, level meters, seat mic and languages to Dante) come through the full DICENTIS API (WO-081, DEC-029).
import { h, replace, toast, toastError, actionButton } from '../dom.js';
import { interpreters } from '../interp.js';
import { mountDicentisAudio } from '../dicentis-audio.js';

export default {
  id: 'audio',
  feature: 'masterVolume', // wired only for now (DEC-010)
  title: 'Audio',
  topics: ['masterVolume', 'microphoneSensitivity'],
  mount(el, { store, api }) {
    const volumeBox = h('div');
    const sensBox = h('div');
    const routingBox = h('div');
    const dicentisBox = h('div', { class: 'dicentis-audio' }); // WO-081
    let draggingVolume = false;
    const picked = new Set(); // seats ticked for a bulk change
    let bulkInput = '0';      // kept across re-renders
    const search = h('input', { type: 'search', placeholder: 'Search seat…', 'aria-label': 'Search seats', oninput: () => renderSensitivity() });

    // ---------------------------------------------------------------- master volume
    function renderVolume() {
      if (draggingVolume) return; // don't fight the user's slider
      const volume = store.topic('masterVolume')?.volume;
      const range = store.topic('masterVolumeRange')?.range;
      if (volume === undefined) return replace(volumeBox, h('p', { class: 'muted' }, store.unavailable('masterVolume') ?? 'Not available'));
      const min = range?.minimumVolume ?? 0;
      const max = range?.maximumVolume ?? Math.max(volume, 100);
      const output = h('output', { class: 'volume-value' }, String(volume));
      const slider = h('input', {
        type: 'range', min, max, step: 0.5, value: String(volume), 'aria-label': 'Master volume (dB)',
        disabled: !store.can('canControlMasterVolume'),
      });
      slider.addEventListener('input', () => { draggingVolume = true; output.textContent = slider.value; });
      slider.addEventListener('change', async () => {
        try {
          await api.wired('SetMasterVolume', { volume: Number(slider.value) });
        } catch (err) {
          toastError(err, 'Volume change failed: ');
        } finally {
          draggingVolume = false;
          renderVolume();
        }
      });
      replace(volumeBox,
        h('div', { class: 'volume' }, h('span', { class: 'muted' }, String(min)), slider, h('span', { class: 'muted' }, String(max)), output),
        min < 0 ? h('p', { class: 'muted hint' }, 'Values in dB (0 = maximum).') : null,
        !store.can('canControlMasterVolume') ? h('p', { class: 'muted hint' }, 'This account may not change the volume.') : null);
    }

    // ---------------------------------------------------------------- microphone sensitivity
    async function update(entries) {
      try {
        const res = await api.wired('UpdateMicrophoneSensitivity', { seatMicrophoneSensitivity: entries });
        if (res?.status === false) toast('The system rejected the sensitivity change (devices may not support it)', 'error');
      } catch (err) { toastError(err); }
    }
    async function reset(seatIds) {
      try { await api.wired('ResetMicrophoneSensitivity', { seatIds }); } catch (err) { toastError(err); }
    }

    function renderSensitivity() {
      const list = store.topic('microphoneSensitivity')?.seatMicrophoneSensitivities;
      if (!list) return replace(sensBox, h('p', { class: 'muted' }, store.unavailable('microphoneSensitivity') ?? 'Not available'));
      const desc = store.topic('microphoneSensitivityDescription')?.micSensitivityDescription ?? { minimumMicrophoneSensitivity: -6, maximumMicrophoneSensitivity: 6, microphoneSensitivityStepSize: 0.5 };
      const { minimumMicrophoneSensitivity: lo, maximumMicrophoneSensitivity: hi, microphoneSensitivityStepSize: step } = desc;
      const can = store.can('canControlMicrophoneSensitivity');
      const seatInfo = id => (store.topic('domain.seats') ?? []).find(x => x.id === id);
      const fmt = v => `${v > 0 ? '+' : ''}${v} dB`;
      const q = search.value.trim().toLowerCase();
      const rows = list.filter(x => !q || `${x.seatName} ${seatInfo(x.seatId)?.person ?? ''}`.toLowerCase().includes(q));
      for (const id of [...picked]) if (!list.some(x => x.seatId === id)) picked.delete(id);

      const bulkValue = h('input', { type: 'number', min: lo, max: hi, step, value: bulkInput, 'aria-label': 'Sensitivity for the selected seats (dB)', class: 'narrow',
        oninput: e => { bulkInput = e.target.value; } });
      const bulk = can ? h('div', { class: 'toolbar' },
        h('span', { class: 'muted small-text' }, `${picked.size} selected`),
        bulkValue,
        actionButton('Set selected', () => {
          const v = Number(bulkValue.value);
          if (!(v >= lo && v <= hi) || Math.abs(v / step - Math.round(v / step)) > 1e-9) return toast(`Use ${lo}…${hi} dB in steps of ${step}`, 'error');
          return update([...picked].map(seatId => ({ seatId, sensitivityValue: v })));
        }, { cls: 'small primary', disabled: !picked.size }),
        actionButton('Reset selected', () => reset([...picked]), { cls: 'small secondary', disabled: !picked.size }),
        actionButton('Reset all', () => reset(list.map(x => x.seatId)), { cls: 'small danger-outline', confirm: 'Reset the microphone sensitivity of every seat to 0 dB?' })) : null;

      const all = rows.length > 0 && rows.every(x => picked.has(x.seatId));
      replace(sensBox,
        h('p', { class: 'muted small-text' }, `Range ${fmt(lo)} … ${fmt(hi)}, steps of ${step} dB. Applies to the seat's microphone input.`),
        h('div', { class: 'toolbar' }, search),
        bulk,
        h('div', { class: 'table-wrap' }, h('table', { class: 'data sensitivity' },
          h('thead', null, h('tr', null,
            can ? h('th', { scope: 'col' }, h('input', { type: 'checkbox', checked: all, 'aria-label': 'Select all shown seats',
              onchange: e => { rows.forEach(x => (e.target.checked ? picked.add(x.seatId) : picked.delete(x.seatId))); renderSensitivity(); } })) : null,
            ['Seat', 'Sensitivity', ''].map(t => h('th', { scope: 'col' }, t)))),
          h('tbody', null, rows.map(x => h('tr', { 'data-seat': x.seatId },
            can ? h('td', null, h('input', { type: 'checkbox', checked: picked.has(x.seatId), 'aria-label': `Select ${x.seatName}`,
              onchange: e => { if (e.target.checked) picked.add(x.seatId); else picked.delete(x.seatId); renderSensitivity(); } })) : null,
            h('td', null, h('strong', null, x.seatName), seatInfo(x.seatId)?.person ? h('small', { class: 'sub' }, seatInfo(x.seatId).person) : null),
            h('td', { class: 'num' }, h('span', { class: ['sens-value', x.sensitivityValue !== 0 && 'changed'] }, fmt(x.sensitivityValue))),
            h('td', { class: 'row-actions' }, can ? [
              h('button', { type: 'button', class: 'secondary small', 'aria-label': `Lower ${x.seatName}`, disabled: x.sensitivityValue - step < lo, onclick: () => update([{ seatId: x.seatId, sensitivityValue: +(x.sensitivityValue - step).toFixed(2) }]) }, '−'),
              h('button', { type: 'button', class: 'secondary small', 'aria-label': `Raise ${x.seatName}`, disabled: x.sensitivityValue + step > hi, onclick: () => update([{ seatId: x.seatId, sensitivityValue: +(x.sensitivityValue + step).toFixed(2) }]) }, '+'),
              h('button', { type: 'button', class: 'link small', title: 'Reset to 0 dB', 'aria-label': `Reset ${x.seatName}`, disabled: x.sensitivityValue === 0, onclick: () => reset([x.seatId]) }, '↺'),
            ] : null)))))),
        !can ? h('p', { class: 'muted hint' }, 'Read-only: the account lacks canControlMicrophoneSensitivity.') : null);
    }

    // ---------------------------------------------------------------- interpretation routing
    function renderRouting() {
      const desks = store.topic('interpreterSeats')?.seats;
      if (!desks?.length) return replace(routingBox, h('p', { class: 'muted' }, store.unavailable('interpreterSeats') ?? 'No interpreter desks in the active meeting.'));
      const it = interpreters(store);
      const booth = id => store.topic('interpreterBooths')?.booths?.find(b => b.boothId === id)?.boothNumber ?? '?';
      replace(routingBox, h('ul', { class: 'routing-list' }, desks.slice().sort((a, b) => booth(a.boothId) - booth(b.boothId) || a.deskNumber - b.deskNumber).map(d => {
        const r = it.routing(d.seatId);
        const mic = it.mic(r).toLowerCase();
        return h('li', { class: String(d.status).toLowerCase() === 'disconnected' ? 'absent' : null },
          h('div', { class: 'routing-head' }, h('a', { href: `#/room?desk=${encodeURIComponent(d.seatId)}`, title: 'Open on the room plan' }, h('strong', null, `Booth ${booth(d.boothId)} · Desk ${d.deskNumber}`)),
            mic === 'off' ? h('span', { class: 'tag' }, 'mic off') : h('span', { class: 'tag live-tag' }, `on ${mic.slice(-1).toUpperCase()}`)),
          mic === 'off' ? null : h('small', { class: 'sub' }, `hears ${it.sourceLabel(it.source(r), { short: false })} → produces ${it.name(r?.destinationLanguageId)}`));
      })),
      h('p', { class: 'muted small-text' }, 'Change a desk from the room plan (click the desk) or in Settings → Interpretation.'));
    }

    el.append(
      h('h1', { id: 'view-title' }, 'Audio'),
      h('div', { class: 'split wide-main' },
        h('div', { class: 'stack' },
          h('article', { class: 'card' }, h('h2', null, 'Microphone sensitivity'), sensBox)),
        h('div', { class: 'stack' },
          h('article', { class: 'card' }, h('h2', null, 'Master volume'), volumeBox),
          store.feature('interpretation') ? h('article', { class: 'card' }, h('h2', null, 'Interpretation routing'), routingBox) : null)),
      dicentisBox,
    );
    renderVolume(); renderSensitivity(); renderRouting();
    const offs = [
      mountDicentisAudio(dicentisBox, { store, api }),
      store.subscribe(['topic:masterVolume', 'topic:masterVolumeRange', 'topic:permissions', 'connection'], renderVolume),
      store.subscribe(['topic:microphoneSensitivity', 'topic:microphoneSensitivityDescription', 'topic:domain.seats', 'topic:permissions', 'connection'], renderSensitivity),
      store.subscribe(['topic:interpreterSeats', 'topic:interpretationRoutings', 'topic:interpretationLanguages', 'topic:interpreterBooths', 'connection'], renderRouting),
    ];
    return () => offs.forEach(off => off());
  },
};
