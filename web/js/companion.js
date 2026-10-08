// Bitfocus Companion in the UI (WO-099, DEC-027): the "Companion" section of the seat / interpreter desk inspector and
// the button picker ("page viewer"). Config + log come from topic `devices.companion`; triggers from topic `room`.
import { h, replace, toast, toastError } from './dom.js';

export const ACTION_LABEL = { press: 'Press', down: 'Hold (down)', up: 'Release (up)' };
const EDGE_LABEL = { on: 'Mic on', off: 'Mic off' };
const KIND_NOUN = { seats: 'seat', desks: 'desk' };

/** "page/row/column" as Companion shows it. */
export const loc = a => `${a.page}/${a.row}/${a.column}`;

/** Companion's own web-buttons page for one page of the grid (its layout: 12 px sides, 20 px top, square buttons). */
export function tabletUrl(cfg, page) {
  const host = cfg.host.includes(':') && !cfg.host.startsWith('[') ? `[${cfg.host}]` : cfg.host;
  const q = new URLSearchParams({ pages: String(page), min_row: '0', max_row: String(cfg.rows - 1), min_col: '0', max_col: String(cfg.cols - 1), display_cols: String(cfg.cols), noconfigure: '1', nofullscreen: '1' });
  return `http://${host}:${cfg.port || 8000}/tablet?${q}`;
}

/**
 * Pick a Companion button: page ◀ ▶, Companion's buttons in a frame with a click grid on top, action, test.
 * Resolves { page, row, column, action } or null.
 * @param {{ api: any, cfg: { host: string, port: number, rows: number, cols: number }, initial?: any, title?: string }} opts
 */
export function pickCompanionButton({ api, cfg, initial = null, title = 'Pick a Companion button' }) {
  return new Promise(resolve => {
    let page = initial?.page ?? 1;
    let chosen = initial ? { row: initial.row, column: initial.column } : null;
    let showFrame = true;
    const W = Math.min(640, window.innerWidth - 80);
    const cell = (W - 24) / cfg.cols;
    const H = 20 + cell * cfg.rows + 20;
    const pageInput = h('input', { type: 'number', min: 1, max: 999, value: String(page), class: 'narrow', 'aria-label': 'Companion page' });
    const action = h('select', { 'aria-label': 'What to do with the button' },
      Object.entries(ACTION_LABEL).map(([v, t]) => h('option', { value: v, selected: v === (initial?.action ?? 'press') }, t)));
    const frameBox = h('div', { class: 'companion-frame', style: { width: `${W}px`, height: `${H}px` } });
    const status = h('p', { class: 'muted small-text companion-chosen' });
    const okButton = h('button', { value: 'ok', class: 'primary' }, 'Use this button');
    const frameToggle = h('input', { type: 'checkbox', checked: true, onchange: e => { showFrame = e.target.checked; render(true); } });

    function render(reloadFrame = false) {
      const grid = h('div', { class: 'companion-grid', style: { left: '12px', top: '20px', width: `${W - 24}px`, gridTemplateColumns: `repeat(${cfg.cols}, 1fr)` } });
      for (let row = 0; row < cfg.rows; row++) {
        for (let column = 0; column < cfg.cols; column++) {
          const isSel = chosen && chosen.row === row && chosen.column === column;
          grid.append(h('button', {
            type: 'button', class: ['companion-cell', isSel && 'selected'], style: { height: `${cell}px` }, 'aria-pressed': String(Boolean(isSel)),
            'aria-label': `Button ${page}/${row}/${column}`, title: `${page}/${row}/${column}`,
            onclick: () => { chosen = { row, column }; render(); },
          }, showFrame ? null : h('small', null, `${page}/${row}/${column}`)));
        }
      }
      const frame = frameBox.querySelector('iframe');
      const wantSrc = showFrame ? tabletUrl(cfg, page) : null;
      if (reloadFrame || (frame?.dataset.src ?? null) !== wantSrc) {
        replace(frameBox, wantSrc ? h('iframe', {
          src: wantSrc, 'data-src': wantSrc, title: `Companion page ${page}`, sandbox: 'allow-scripts allow-same-origin', referrerpolicy: 'no-referrer',
          tabindex: -1, 'aria-hidden': 'true', style: { width: `${W}px`, height: `${H}px` },
        }) : null, grid);
      } else {
        frameBox.querySelector('.companion-grid')?.replaceWith(grid);
      }
      frameBox.classList.toggle('plain', !showFrame);
      replace(status, chosen ? ['Chosen: ', h('strong', null, `${page}/${chosen.row}/${chosen.column}`)] : 'Click a button on the page.');
      okButton.disabled = !chosen;
    }
    const setPage = p => {
      page = Math.min(999, Math.max(1, p || 1));
      pageInput.value = String(page);
      if (initial?.page !== page) chosen = null;
      render();
    };
    pageInput.addEventListener('change', () => setPage(Number(pageInput.value)));

    const test = async () => {
      if (!chosen) return;
      try {
        await api.post('/companion/press', { page, row: chosen.row, column: chosen.column, action: action.value });
        toast(`Companion: ${action.value} ${page}/${chosen.row}/${chosen.column}`, 'success');
      } catch (err) { toastError(err, 'Companion: '); }
    };

    const dialog = h('dialog', { class: 'companion-dialog' },
      h('form', { method: 'dialog', style: { width: `${W}px` } },
        h('h2', null, title),
        h('div', { class: 'row-inline companion-toolbar' },
          h('button', { type: 'button', class: 'secondary small', 'aria-label': 'Previous page', onclick: () => setPage(page - 1) }, '◀'),
          h('label', { class: 'row-inline page-field' }, 'Page', pageInput),
          h('button', { type: 'button', class: 'secondary small', 'aria-label': 'Next page', onclick: () => setPage(page + 1) }, '▶'),
          h('label', { class: 'check' }, frameToggle, " Show Companion's buttons")),
        frameBox,
        h('p', { class: 'muted small-text' }, `Companion at ${cfg.host}:${cfg.port}, grid ${cfg.rows} × ${cfg.cols} (Settings → Companion). Looking does not press anything; "Test" does.`),
        status,
        h('div', { class: 'row-inline companion-test' }, h('label', { class: 'row-inline' }, 'Action', action),
          h('button', { type: 'button', class: 'secondary small', onclick: test }, 'Test')),
        h('div', { class: 'actions' }, h('button', { value: 'cancel', class: 'secondary', formnovalidate: true }, 'Cancel'), okButton)));
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok' && chosen ? { page, row: chosen.row, column: chosen.column, action: action.value } : null);
      dialog.remove();
    });
    render();
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Inspector section: the Companion buttons of one seat or desk for mic on / mic off.
 * @param {{ store: any, api: any, kind: 'seats' | 'desks', id: string, label: string }} opts
 */
export function companionSection({ store, api, kind, id, label }) {
  const cfg = store.topic('devices.companion')?.config;
  const head = h('h3', null, 'Companion');
  if (!cfg) {
    return [head, h('p', { class: 'muted small-text' }, `Press Bitfocus Companion buttons when this ${KIND_NOUN[kind]}'s microphone turns on or off: `,
      h('a', { href: '#/settings/companion' }, 'set up Companion'), '.')];
  }
  const t = store.topic('room')?.triggers?.[kind]?.[id] ?? { on: [], off: [] };
  const save = async next => {
    try { await api.put(`/room/triggers/${kind}/${encodeURIComponent(id)}`, next); } catch (err) { toastError(err, 'Companion: '); }
  };
  const add = async edge => {
    const a = await pickCompanionButton({ api, cfg, title: `${label}: ${EDGE_LABEL[edge].toLowerCase()}` });
    if (a) await save({ ...t, [edge]: [...(t[edge] ?? []), a] });
  };
  const remove = (edge, i) => save({ ...t, [edge]: t[edge].filter((_, k) => k !== i) });
  const test = async a => {
    try { await api.post('/companion/press', a); toast(`Companion: ${a.action} ${loc(a)}`, 'success'); } catch (err) { toastError(err, 'Companion: '); }
  };
  const row = edge => h('div', { class: 'companion-row', 'data-edge': edge },
    h('span', { class: 'k' }, EDGE_LABEL[edge]),
    h('span', { class: 'companion-actions' },
      (t[edge] ?? []).map((a, i) => h('span', { class: 'chip companion-chip' },
        h('button', { type: 'button', class: 'link small', title: 'Press it now (test)', onclick: () => test(a) }, `${a.action} ${loc(a)}`),
        h('button', { type: 'button', class: 'link small', 'aria-label': `Remove ${a.action} ${loc(a)}`, onclick: () => remove(edge, i) }, '✕'))),
      (t[edge] ?? []).length < 8 ? h('button', { type: 'button', class: 'secondary small', onclick: () => add(edge) }, '+ Button…') : null));
  return [head,
    cfg.enabled ? null : h('p', { class: 'small-text warn-text' }, 'Companion triggers are switched off (Settings → Companion).'),
    row('on'), row('off')];
}
