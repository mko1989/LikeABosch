// DICENTIS audio & Dante (WO-081, DEC-029): room gains, level meters, equalisers, audio selection settings, seat Dante
// out and languages to Dante, through the full DICENTIS API (dicentis-bridge). Data: topics dicentis.*; writes:
// api.dicentis('/audio/…'). Used by Settings → Audio; gains + meters also by the Room audio widget (WO-104).
import { h, replace, humanize, toast, toastError, actionButton } from './dom.js';

const GAIN_LABEL = {
  Master: 'Master volume', Loudspeaker: 'Delegate loudspeakers', SoundReinforcement: 'Sound reinforcement',
  AnalogIn0: 'Analog in 1', AnalogIn1: 'Analog in 2', AnalogOut0: 'Analog out 1', AnalogOut1: 'Analog out 2',
  DanteDigitalIn0: 'Dante in 1', DanteDigitalIn1: 'Dante in 2', DanteDigitalOut0: 'Dante out 1', DanteDigitalOut1: 'Dante out 2',
  OmneoDigitalIn0: 'OMNEO in 1', OmneoDigitalIn1: 'OMNEO in 2', OmneoDigitalOut0: 'OMNEO out 1', OmneoDigitalOut1: 'OMNEO out 2',
};
export const gainLabel = type => GAIN_LABEL[type] ?? humanize(type);
const SENSOR_LABEL = {
  Loudspeaker: 'Loudspeakers', Microphone: 'Microphones', SoundReinforcement: 'Sound reinf.', AnalogIn0: 'Analog in 1', AnalogIn1: 'Analog in 2',
  AnalogOut0: 'Analog out 1', AnalogOut1: 'Analog out 2', DanteIn0: 'Dante in 1', DanteIn1: 'Dante in 2', DanteOut0: 'Dante out 1', DanteOut1: 'Dante out 2',
  OmneoIn0: 'OMNEO in 1', OmneoIn1: 'OMNEO in 2', OmneoOut0: 'OMNEO out 1', OmneoOut1: 'OMNEO out 2',
};
const sensorLabel = type => SENSOR_LABEL[type] ?? humanize(type);
/** Selection settings that are on/off switches (the others are numbers or modes). */
const SWITCHES = new Set(['LoudspeakerActiveWhenSpeaking', 'HeadphoneAttenuationWhenSpeaking', 'AcousticFeedbackSuppression', 'ChimesOnHeadphones']);
const DANTE_OUT = [['Disabled', 'Off'], ['DanteOutEnabledWhenMicOn', 'When the mic is on'], ['DanteOutEnabledAlways', 'Always']];
const FILTERS = [['LowShelving', 'Low shelf'], ['Notch', 'Peak / notch'], ['HighShelving', 'High shelf']];
const fmtDb = v => `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10} dB`;

/** Short "how to enable" text when the full API is not there. */
export function dicentisHint(store) {
  const st = store.topic('dicentis.status');
  return [
    h('p', { class: 'muted small-text' }, 'These settings need the full DICENTIS API (dicentis-bridge). Switch it on in the launcher (Windows PC with the DICENTIS software), or simulate a wired system with “Full DICENTIS API” in ',
      h('a', { href: '#/settings/connection?simulate' }, 'Settings → Connection'), '.'),
    st?.reason && st.state !== 'off' ? h('p', { class: 'muted small-text' }, st.reason) : null,
  ];
}

/**
 * Gain sliders (+ mute / test tone). `types` limits which gains are shown (the widget shows a few).
 * The caller re-renders on topic changes; `busy()` tells it a slider is being dragged.
 */
export function gainControls(store, api, { types = null, compact = false, onIdle = null } = {}) {
  const a = store.topic('dicentis.audio');
  let dragging = false;
  const el = h('div', { class: ['gain-list', compact && 'compact'] });
  if (!a) return { el, busy: () => false };
  const gains = a.gains.filter(g => !types || types.includes(g.type));
  for (const g of gains) {
    const out = h('output', { class: 'gain-value' }, fmtDb(g.value));
    const slider = h('input', { type: 'range', min: g.min, max: g.max, step: g.step, value: String(g.value), 'aria-label': `${gainLabel(g.type)} (dB)`, disabled: !a.canControl });
    slider.addEventListener('input', () => { dragging = true; out.textContent = fmtDb(Number(slider.value)); });
    slider.addEventListener('change', async () => {
      try { await api.dicentis('/audio/gain', { type: g.type, value: Number(slider.value) }); } catch (err) { toastError(err, `${gainLabel(g.type)}: `); } finally {
        dragging = false;
        onIdle?.(); // updates skipped while dragging: show the current state now
      }
    });
    const toggle = (key, label, on) => h('button', {
      type: 'button', class: ['small', on ? 'primary' : 'secondary', key === 'muted' && on && 'danger'], 'aria-pressed': String(on), disabled: !a.canControl,
      title: label, onclick: () => api.dicentis('/audio/gain', { type: g.type, [key]: !on }).catch(err => toastError(err)),
    }, label);
    el.append(h('div', { class: ['gain-row', g.muted && 'muted-gain'], 'data-gain': g.type },
      h('span', { class: 'gain-name' }, gainLabel(g.type)), slider, out,
      h('span', { class: 'row-actions' }, toggle('muted', g.muted ? 'Muted' : 'Mute', g.muted), compact ? null : toggle('testTone', 'Test tone', g.testTone))));
  }
  return { el, busy: () => dragging };
}

/**
 * Level meters: leases the readings while mounted and switched on (POST /audio/vu, renewed every 20 s); bars are
 * updated in place at the topic's rate. Returns { el, update(), destroy() }.
 */
export function vuMeters(store, api, { sensors = null, startOn = false } = {}) {
  let on = false;
  let renew = null;
  const bars = new Map();
  const list = h('div', { class: 'vu-list' });
  const btn = h('button', { type: 'button', class: 'secondary small', onclick: () => setOn(!on) }, 'Show level meters');
  const el = h('div', { class: 'vu' }, h('div', { class: 'toolbar' }, btn), list);
  async function setOn(v) {
    on = v;
    btn.textContent = on ? 'Hide level meters' : 'Show level meters';
    btn.setAttribute('aria-pressed', String(on));
    clearInterval(renew);
    try {
      await api.dicentis('/audio/vu', { on });
      if (on) renew = setInterval(() => api.dicentis('/audio/vu', { on: true }).catch(() => {}), 20_000);
    } catch (err) { toastError(err, 'Level meters: '); on = false; }
    update();
  }
  function update() {
    const r = on ? store.topic('dicentis.vu')?.readings : null;
    if (!r) { bars.clear(); replace(list, on ? h('p', { class: 'muted small-text' }, 'Waiting for readings…') : null); return; }
    for (const [type, db] of Object.entries(r)) {
      if (sensors && !sensors.includes(type)) continue;
      let b = bars.get(type);
      if (!b) {
        const fill = h('span', { class: 'vu-fill' });
        const val = h('span', { class: 'vu-db' });
        b = { fill, val, row: h('div', { class: 'vu-row', 'data-sensor': type }, h('span', { class: 'vu-name' }, sensorLabel(type)), h('span', { class: 'vu-bar' }, fill), val) };
        bars.set(type, b);
        list.querySelector('p')?.remove();
        list.append(b.row);
      }
      const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
      b.fill.style.width = `${pct}%`;
      b.fill.classList.toggle('warm', db > -18 && db <= -6);
      b.fill.classList.toggle('hot', db > -6);
      b.val.textContent = `${Math.round(db)} dB`;
    }
  }
  if (startOn) setOn(true);
  return { el, update, destroy: () => { clearInterval(renew); if (on) api.dicentis('/audio/vu', { on: false }).catch(() => {}); } };
}

/** Settings → Audio: every DICENTIS audio card into `box`. Returns an unsubscribe function. */
export function mountDicentisAudio(box, { store, api }) {
  const gainsBox = h('div');
  const eqBox = h('div');
  const selBox = h('div');
  const seatBox = h('div');
  const langBox = h('div');
  const meters = vuMeters(store, api);
  const picked = new Set();
  let gains = { busy: () => false };
  let bulkDante = 'DanteOutEnabledAlways';
  const seatSearch = h('input', { type: 'search', placeholder: 'Search seat…', 'aria-label': 'Search seats for Dante out', oninput: () => renderSeats() });
  const can = () => Boolean(store.topic('domain.capabilities')?.dicentis?.audio);
  const audio = () => store.topic('dicentis.audio');
  const unavailable = t => h('p', { class: 'muted' }, store.unavailable(t) ?? 'Not available');

  function renderGains() {
    if (gains.busy()) return;
    if (!audio()) return replace(gainsBox, unavailable('dicentis.audio'));
    gains = gainControls(store, api, { onIdle: () => renderGains() });
    replace(gainsBox, gains.el,
      audio().routing !== null ? h('p', { class: 'muted small-text' }, `Room audio routing: ${audio().routing ? 'on' : 'off'}.`) : null,
      audio().canControl ? null : h('p', { class: 'muted hint' }, 'Read-only: the DICENTIS user / seat may not control the system audio.'));
  }

  function renderEq() {
    const a = audio();
    if (!a) return replace(eqBox, unavailable('dicentis.audio'));
    const send = (equalizer, band, patch) => api.dicentis('/audio/equalizer', { equalizer, band, ...patch }).catch(err => toastError(err, 'Equaliser: '));
    const numberCell = (eq, b, key, opts, label) => {
      const input = h('input', { type: 'number', ...opts, value: String(b[key]), class: key === 'frequency' ? 'eq-freq' : 'eq-num', 'aria-label': `${label} band ${b.band + 1} ${key}`, disabled: !a.canConfigure });
      input.addEventListener('change', () => send(eq, b.band, { [key]: Number(input.value) }));
      return h('td', { class: 'num' }, input);
    };
    replace(eqBox, Object.entries(a.equalizers).map(([eq, bands]) => {
      const label = eq === 'Loudspeaker' ? 'Delegate loudspeakers' : 'Sound reinforcement';
      return h('div', { class: 'eq' }, h('h3', null, label), h('div', { class: 'table-wrap' }, h('table', { class: 'data eq-table' },
        h('thead', null, h('tr', null, ['Band', 'On', 'Filter', 'Frequency (Hz)', 'Gain (dB)', 'Q'].map(t => h('th', { scope: 'col' }, t)))),
        h('tbody', null, bands.map(b => h('tr', { class: b.enabled ? null : 'absent' },
          h('td', null, String(b.band + 1)),
          h('td', null, h('input', { type: 'checkbox', checked: b.enabled, disabled: !a.canConfigure, 'aria-label': `${label} band ${b.band + 1} on`, onchange: e => send(eq, b.band, { enabled: e.target.checked }) })),
          h('td', null, h('select', { 'aria-label': `${label} band ${b.band + 1} filter`, disabled: !a.canConfigure, onchange: e => send(eq, b.band, { filter: e.target.value }) },
            FILTERS.map(([v, t]) => h('option', { value: v, selected: v === b.filter }, t)))),
          numberCell(eq, b, 'frequency', { min: 20, max: 20000, step: 1 }, label),
          numberCell(eq, b, 'gain', { min: -12, max: 12, step: 0.5 }, label),
          numberCell(eq, b, 'q', { min: 0.1, max: 10, step: 0.1 }, label)))))));
    }));
  }

  function renderSelection() {
    const a = audio();
    if (!a) return replace(selBox, unavailable('dicentis.audio'));
    const set = (type, value) => api.dicentis('/audio/selection', { type, value }).catch(err => toastError(err));
    replace(selBox, h('ul', { class: 'compact settings-list' }, a.selections.map(s => h('li', null,
      SWITCHES.has(s.type)
        ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.value !== 0, disabled: !a.canConfigure, onchange: e => set(s.type, e.target.checked ? 1 : 0) }), ' ', humanize(s.type))
        : h('label', { class: 'row-inline' }, h('span', null, humanize(s.type)),
          h('input', { type: 'number', step: 1, value: String(s.value), class: 'narrow', disabled: !a.canConfigure, 'aria-label': humanize(s.type), onchange: e => set(s.type, Number(e.target.value)) }))))));
  }

  function renderSeats() {
    const seats = store.topic('dicentis.seatAudio');
    if (!seats) return replace(seatBox, unavailable('dicentis.seatAudio'));
    const q = seatSearch.value.trim().toLowerCase();
    const rows = seats.filter(s => !q || s.name.toLowerCase().includes(q));
    for (const id of [...picked]) if (!seats.some(s => s.id === id)) picked.delete(id);
    const update = body => api.dicentis('/audio/seat-dante', body);
    const bulkSel = h('select', { 'aria-label': 'Dante out for the selected seats', onchange: e => { bulkDante = e.target.value; } }, DANTE_OUT.map(([v, t]) => h('option', { value: v, selected: v === bulkDante }, t)));
    const all = rows.length > 0 && rows.every(s => picked.has(s.id));
    replace(seatBox,
      h('p', { class: 'muted small-text' }, 'Send a seat’s microphone to its own Dante channel (e.g. for recording or a mixing desk).'),
      h('div', { class: 'toolbar' }, seatSearch, h('span', { class: 'muted small-text' }, `${picked.size} selected`), bulkSel,
        actionButton('Set selected', () => update({ seatIds: [...picked], danteOut: bulkDante }).then(() => toast('Dante out changed', 'success')), { cls: 'small primary', disabled: !picked.size })),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, h('input', { type: 'checkbox', checked: all, 'aria-label': 'Select all shown seats', onchange: e => { rows.forEach(s => (e.target.checked ? picked.add(s.id) : picked.delete(s.id))); renderSeats(); } })),
          ['Seat', 'Dante out', 'Headroom'].map(t => h('th', { scope: 'col' }, t)))),
        h('tbody', null, rows.map(s => h('tr', { 'data-seat': s.id },
          h('td', null, h('input', { type: 'checkbox', checked: picked.has(s.id), 'aria-label': `Select ${s.name}`, onchange: e => { if (e.target.checked) picked.add(s.id); else picked.delete(s.id); renderSeats(); } })),
          h('td', null, h('strong', null, s.name), s.kind === 'interpreter' ? h('small', { class: 'sub' }, 'interpreter desk') : null),
          h('td', null, h('select', { 'aria-label': `Dante out of ${s.name}`, onchange: e => update({ seatIds: [s.id], danteOut: e.target.value }).catch(err => toastError(err)) },
            DANTE_OUT.map(([v, t]) => h('option', { value: v, selected: v === s.danteOut }, t)))),
          h('td', { class: 'num' }, h('input', { type: 'number', min: -30, max: 0, step: 1, value: String(s.headroom), class: 'narrow', 'aria-label': `Headroom of ${s.name} (dB)`,
            onchange: e => update({ seatIds: [s.id], headroom: Number(e.target.value) }).catch(err => toastError(err)) }))))))));
  }

  function renderLanguages() {
    const m = store.topic('dicentis.meetingLanguages');
    if (!m) return replace(langBox, unavailable('dicentis.meetingLanguages'));
    const name = id => store.topic('dicentis.languages')?.find(l => l.id === id);
    const set = (languageId, body) => api.dicentis('/meeting-languages/update', { languageId, ...body }).catch(err => toastError(err));
    replace(langBox,
      h('ul', { class: 'compact settings-list' }, m.languages.map(l => h('li', null,
        h('span', { class: 'tag' }, name(l.id)?.abbreviation ?? '?'), ' ', name(l.id)?.label ?? l.id, ' ',
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: l.danteOut, disabled: !m.canDante, 'aria-label': `${name(l.id)?.label ?? l.id} to Dante`, onchange: e => set(l.id, { danteOut: e.target.checked }) }), ' Dante'),
        l.stream2.enabled ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: l.stream2.danteOut, disabled: !m.canDante, 'aria-label': `${name(l.id)?.label ?? l.id} second stream to Dante`, onchange: e => set(l.id, { stream2: { danteOut: e.target.checked } }) }), ' 2nd stream to Dante') : null))),
      h('p', { class: 'muted small-text' }, 'Add languages and assign them to desks in ', h('a', { href: '#/settings/interpretation' }, 'Settings → Interpretation'), '.'));
  }

  function render() {
    if (!can()) { meters.destroy(); return replace(box, h('article', { class: 'card' }, h('h2', null, 'DICENTIS audio & Dante'), dicentisHint(store))); }
    if (!box.firstChild || box.firstChild.dataset.dicentis !== 'on') {
      replace(box, h('div', { class: 'stack', 'data-dicentis': 'on' },
        h('article', { class: 'card' }, h('h2', null, 'Room audio (DICENTIS)'), gainsBox, meters.el),
        h('article', { class: 'card eq-card' }, h('h2', null, 'Equalisers'), eqBox),
        h('article', { class: 'card' }, h('h2', null, 'Audio behaviour'), selBox),
        h('article', { class: 'card' }, h('h2', null, 'Seat microphones to Dante'), seatBox),
        h('article', { class: 'card' }, h('h2', null, 'Interpretation languages to Dante'), langBox)));
    }
    renderGains(); renderEq(); renderSelection(); renderSeats(); renderLanguages();
  }

  render();
  const offs = [
    store.subscribe(['topic:domain.capabilities', 'topic:dicentis.status', 'connection'], render),
    store.subscribe(['topic:dicentis.audio'], () => { if (can()) { renderGains(); renderEq(); renderSelection(); } }),
    store.subscribe(['topic:dicentis.seatAudio'], () => { if (can()) renderSeats(); }),
    store.subscribe(['topic:dicentis.meetingLanguages', 'topic:dicentis.languages'], () => { if (can()) renderLanguages(); }),
    store.subscribe(['topic:dicentis.vu'], () => meters.update()),
  ];
  return () => { offs.forEach(off => off()); meters.destroy(); };
}
