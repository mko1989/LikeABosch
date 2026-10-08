// Settings → Audio on DICENTIS Wireless (WO-087, DEC-024): the WAP web UI's audio page (`/audio`, `/audio/master`) and
// delegate loudspeaker equaliser (`/audio/equalizer/delegate-loudspeaker`), undocumented endpoints.
// Levels are steps: dB = start + step × value; for levels with "mute", 0 = mute and dB = start + step × (value − 1).
// Scales from the web UI (configAudioController, DCNM-WAP values, fw 1.73). The web UI sends one field per PUT /audio.
import { h, replace, toastError } from '../dom.js';
import { undocumentedNote, unavailable, fieldLabel } from '../wap.js';

/** field → [label, max, start dB, step dB, has mute] */
export const LEVELS = {
  pa: ['PA (room loudspeakers)', 24, -11, 1, true],
  lsp: ['Delegate loudspeakers', 24, -11, 1, true],
  lineIn1: ['Line in 1', 16, -18, 1.5, false],
  lineIn2: ['Line in 2', 8, -6, 1.5, false],
  lineOut1: ['Line out 1', 22, -24, 1.5, false],
  lineOut2: ['Line out 2', 20, -24, 1.5, false],
  lineOut3: ['Line out 3', 31, -24, 1, true],
  lineOut4: ['Line out 4', 31, -24, 1, true],
  lineOut5: ['Line out 5', 31, -24, 1, true],
  lineOut6: ['Line out 6', 31, -24, 1, true],
  micInLvl: ['Microphone input level', 6, -6, 2, false],
};
const MASTER = ['Master volume', 24, -11, 1, true];

/** Level step → "−5.0 dB" / "Mute". */
export function levelDb(value, [, , start, step, mute]) {
  if (mute && value === 0) return 'Mute';
  return `${(start + step * (mute ? value - 1 : value)).toFixed(1).replace('-', '−')} dB`;
}

const BOOLS = {
  lspOffWhenMicOn: 'Delegate loudspeaker off while the microphone is on',
  attenuate: 'Attenuate',
  ambientInput: 'Ambient input',
  microphoneInput: 'Line in 1 is a microphone input',
};

export default {
  id: 'wap-audio',
  title: 'Audio',
  feature: 'wapConfig',
  topics: ['wirelessAudio', 'wirelessMasterVolume'],
  mount(el, { store, api }) {
    const masterBox = h('div');
    const levelsBox = h('div');
    const optionsBox = h('div');
    const eqBox = h('div');
    const put = (path, body) => api.wireless('PUT', path, body);

    function stepper(label, value, scale, write) {
      const [, max] = scale;
      const go = async next => { try { await write(next); } catch (err) { toastError(err, `${label}: `); } };
      return h('div', { class: 'level-row' },
        h('span', { class: 'level-name' }, label),
        h('button', { type: 'button', class: 'secondary small', 'aria-label': `${label} down`, disabled: value <= 0, onclick: () => go(value - 1) }, '−'),
        h('meter', { min: 0, max, value, 'aria-hidden': 'true' }),
        h('button', { type: 'button', class: 'secondary small', 'aria-label': `${label} up`, disabled: value >= max, onclick: () => go(value + 1) }, '+'),
        h('span', { class: 'level-db', 'aria-label': `${label} level` }, levelDb(value, scale)));
    }

    function renderMaster() {
      const m = store.topic('wirelessMasterVolume')?.master;
      if (m === undefined) return replace(masterBox, unavailable(store, 'wirelessMasterVolume'));
      replace(masterBox, stepper(MASTER[0], m, MASTER, v => put('/audio/master', { master: v })));
    }

    function renderAudio() {
      const a = store.topic('wirelessAudio');
      if (!a) { replace(levelsBox, unavailable(store, 'wirelessAudio')); return replace(optionsBox); }
      replace(levelsBox, Object.entries(LEVELS).filter(([k]) => typeof a[k] === 'number')
        .map(([k, scale]) => stepper(scale[0], a[k], a.microphoneInput && k === 'lineIn1' ? [scale[0], 6, -6, 2, false] : scale, v => put('/audio', { [k]: v }))));
      const seats = store.topic('wirelessSeats') ?? [];
      const rest = Object.keys(a).filter(k => !(k in LEVELS) && k !== 'master');
      replace(optionsBox, rest.map(k => {
        const label = BOOLS[k] ?? fieldLabel(k);
        if (typeof a[k] === 'boolean') {
          return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a[k], 'aria-label': label,
            onchange: e => put('/audio', { [k]: e.target.checked }).catch(err => { toastError(err, `${label}: `); renderAudio(); }) }), ` ${label}`);
        }
        if (/^lineOut\dSeatId$/.test(k)) {
          return h('label', { class: 'field' }, h('span', null, `${label.replace(' seat id', '')}: seat`),
            h('select', { 'aria-label': label, onchange: e => put('/audio', { [k]: Number(e.target.value) }).catch(toastError) },
              h('option', { value: '-1' }, '— none —'), seats.map(s => h('option', { value: String(s.id), selected: s.id === a[k] }, s.name))));
        }
        if (typeof a[k] === 'number') {
          return h('label', { class: 'field' }, h('span', null, label),
            h('input', { type: 'number', min: 0, step: 1, value: String(a[k]), 'aria-label': label, class: 'narrow',
              onchange: e => put('/audio', { [k]: Number(e.target.value) }).catch(err => { toastError(err, `${label}: `); renderAudio(); }) }));
        }
        return h('div', { class: 'kv' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, String(a[k])));
      }));
    }

    function renderEq() {
      const bands = store.topic('wirelessEqualizer');
      if (!Array.isArray(bands)) return replace(eqBox, unavailable(store, 'wirelessEqualizer'));
      if (!bands.length) return replace(eqBox, h('p', { class: 'muted' }, 'No equaliser bands reported.'));
      const cols = [...new Set(bands.flatMap(Object.keys))].filter(k => k !== 'id');
      const save = (band, patch) => put('/audio/equalizer/delegate-loudspeaker', [{ ...band, ...patch }]).catch(err => { toastError(err, 'Equaliser: '); renderEq(); });
      replace(eqBox, h('div', { class: 'table-wrap' }, h('table', { class: 'data eq' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Band'), cols.map(k => h('th', { scope: 'col' }, k === 'gain' ? 'Gain (dB)' : fieldLabel(k))))),
        h('tbody', null, bands.map((b, i) => h('tr', null,
          h('td', null, String(b.id ?? i + 1)),
          cols.map(k => h('td', null, typeof b[k] === 'boolean'
            ? h('input', { type: 'checkbox', checked: b[k], 'aria-label': `Band ${b.id ?? i + 1} ${fieldLabel(k)}`, onchange: e => save(b, { [k]: e.target.checked }) })
            : typeof b[k] === 'number'
              ? h('input', { type: 'number', class: 'narrow', value: String(b[k]), step: k === 'gain' ? 0.5 : 'any', ...(k === 'gain' ? { min: -12, max: 12 } : {}),
                'aria-label': `Band ${b.id ?? i + 1} ${fieldLabel(k)}`, onchange: e => save(b, { [k]: k === 'gain' ? Math.max(-12, Math.min(12, Number(e.target.value))) : Number(e.target.value) }) })
              : String(b[k] ?? '')))))))),
      h('p', { class: 'muted hint' }, 'Gain −12…+12 dB. The WAP\'s web UI shows "enabled" inverted; check the effect on the real WAP.'));
    }

    el.append(h('h1', { id: 'view-title' }, 'Audio'),
      h('div', { class: 'split' },
        h('article', { class: 'card' }, h('h2', null, 'Levels'), masterBox, levelsBox),
        h('div', { class: 'stack' },
          h('article', { class: 'card' }, h('h2', null, 'Routing and options'), optionsBox),
          h('article', { class: 'card' }, h('h2', null, 'Delegate loudspeaker equaliser'), eqBox))),
      undocumentedNote());
    // Rebuild a card only when its data changed (the seats topic updates often; keeps a focused input).
    const keyed = (render, key) => { let last; return () => { const k = JSON.stringify(key()); if (k !== last) { last = k; render(); } }; };
    const parts = [
      keyed(renderMaster, () => [store.topic('wirelessMasterVolume'), store.unavailable('wirelessMasterVolume')]),
      keyed(renderAudio, () => [store.topic('wirelessAudio'), store.unavailable('wirelessAudio'), (store.topic('wirelessSeats') ?? []).map(x => [x.id, x.name])]),
      keyed(renderEq, () => [store.topic('wirelessEqualizer'), store.unavailable('wirelessEqualizer')]),
    ];
    parts.forEach(p => p());
    return store.subscribe(['topic:wirelessMasterVolume', 'topic:wirelessAudio', 'topic:wirelessEqualizer', 'topic:wirelessSeats'], () => parts.forEach(p => p()));
  },
};
