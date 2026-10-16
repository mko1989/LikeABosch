// Room widgets on the plan (WO-127, DEC-039; widgets from WO-104, DEC-030): a layer over the Room stage holds the
// widgets the operator added from the toolbar's "Widgets" menu, as floating cards (drag the header to move, collapse,
// ✕ to remove). They stay where they are whatever is selected, in operate and edit mode.
// A widget = { id, title, settingsHref, topics, available(store), render(store, api, ctx) → nodes, setup?() }.
// A widget's body is rebuilt only when one of its topics changes, never while the user is typing in it, dragging one of
// its sliders or holding a PTZ button. ctx.setting(key) / ctx.set(key, value) keep per-widget settings (per browser).
import { h, replace } from '../dom.js';
import { ptzHolding, afterPtzHold } from '../ptz.js';
import { PREFS_KEY, CARD_W, parsePrefs, addWidget, removeWidget, toggleCollapsed, toFront, moveTo, clampPos, setSetting } from './prefs.js';
import voting from './voting.js';
import audio from './audio.js';
import presentation from './presentation.js';
import ptz from './ptz.js';

export const WIDGETS = [voting, audio, presentation, ptz];
const IDS = WIDGETS.map(w => w.id);

function loadPrefs() {
  try { return parsePrefs(localStorage.getItem(PREFS_KEY), IDS); } catch { return parsePrefs(null, IDS); }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode: keep for this page only */ }
}

/**
 * @param {any} store
 * @param {any} api
 * @param {HTMLElement} stage  the Room stage the cards float over
 * @returns {{ el: HTMLElement, picker: HTMLElement, destroy: () => void }}
 */
export function createWidgetLayer(store, api, stage) {
  let prefs = loadPrefs();
  const el = h('div', { class: 'widget-layer', 'aria-label': 'Widgets' });
  const stageSize = () => ({ w: Math.max(stage.clientWidth, 1), h: Math.max(stage.clientHeight, 1) });
  const update = (next, force = false) => { prefs = next; savePrefs(prefs); render(force); };

  // ---------------------------------------------------------------- toolbar menu: add / remove widgets
  const menu = h('div', { class: 'widget-menu', hidden: true, role: 'group', 'aria-label': 'Widgets on the plan' });
  const menuBtn = h('button', { type: 'button', class: 'secondary small', 'aria-expanded': 'false', title: 'Add widgets to the plan', onclick: () => toggleMenu() }, 'Widgets ▾');
  const picker = h('span', { class: 'widget-picker' }, menuBtn, menu);
  function toggleMenu(open = menu.hidden) {
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) renderMenu();
  }
  function renderMenu() {
    replace(menu, WIDGETS.map(w => h('label', { class: 'check' },
      h('input', { type: 'checkbox', 'data-widget-add': w.id, checked: prefs.placed.includes(w.id), disabled: !w.available(store),
        onchange: e => update(e.target.checked ? addWidget(prefs, w.id, stageSize()) : removeWidget(prefs, w.id)) }),
      ` ${w.title}`, w.available(store) ? null : h('small', { class: 'sub' }, ' not on this system'))));
  }
  const onDocDown = e => { if (!menu.hidden && !picker.contains(e.target)) toggleMenu(false); };
  document.addEventListener('pointerdown', onDocDown);

  // ---------------------------------------------------------------- cards
  /** id → { card, body, toggle, ctx, key, dragging } */
  const cards = new Map();
  function card(w) {
    let c = cards.get(w.id);
    if (c) return c;
    const body = h('div', { class: 'widget-body' });
    const toggle = h('button', { type: 'button', class: 'link small widget-toggle', onclick: () => update(toggleCollapsed(prefs, w.id), true) });
    const head = h('div', { class: 'card-head widget-head', title: 'Drag to move' }, h('h2', null, w.title), h('span', { class: 'widget-tools' },
      h('a', { href: w.settingsHref, class: 'small', title: `Open ${w.title} in full` }, 'More'), toggle,
      h('button', { type: 'button', class: 'link small widget-close', title: `Remove ${w.title} from the plan`, 'aria-label': `Remove ${w.title} from the plan`, onclick: () => update(removeWidget(prefs, w.id)) }, '✕')));
    const cardEl = h('article', { class: 'side-card widget floating', 'data-widget': w.id }, head, body);
    c = { card: cardEl, body, toggle, ctx: null, key: undefined, dragging: false };
    const self = c;
    c.ctx = {
      setting: key => prefs.settings[w.id]?.[key],
      set: (key, value) => { prefs = setSetting(prefs, w.id, key, value); savePrefs(prefs); self.key = undefined; render(); },
    };
    Object.assign(c.ctx, w.setup?.(store, api, c.ctx) ?? {});
    // Keep the body while a slider is held (rebuild on release).
    body.addEventListener('pointerdown', e => { if (e.target.matches?.('input[type=range]')) c.dragging = true; });
    window.addEventListener('pointerup', c.onUp = () => { if (c.dragging) { c.dragging = false; render(); } });
    // Touching a card brings it to the front; dragging its header moves it.
    cardEl.addEventListener('pointerdown', () => { if (prefs.placed.at(-1) !== w.id) { prefs = toFront(prefs, w.id); savePrefs(prefs); stack(); } });
    head.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('a, button, input, select')) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY, pos: clampPos(prefs.pos[w.id] ?? { x: 0, y: 0 }, stageSize()) };
      let to = start.pos;
      try { head.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
      cardEl.classList.add('moving');
      const move = ev => {
        to = clampPos({ x: start.pos.x + ev.clientX - start.x, y: start.pos.y + ev.clientY - start.y }, stageSize());
        place(cardEl, to);
      };
      const end = () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', end);
        head.removeEventListener('pointercancel', end);
        cardEl.classList.remove('moving');
        prefs = moveTo(prefs, w.id, to, stageSize());
        savePrefs(prefs);
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', end);
      head.addEventListener('pointercancel', end);
    });
    cards.set(w.id, c);
    return c;
  }

  /** Position a card; it may grow down to the stage's bottom edge, then its body scrolls. */
  function place(cardEl, pos) {
    const st = stageSize();
    cardEl.style.left = `${pos.x}px`;
    cardEl.style.top = `${pos.y}px`;
    cardEl.style.width = `${Math.min(CARD_W, st.w)}px`;
    cardEl.style.maxHeight = `${Math.max(st.h - pos.y - 8, 40)}px`;
  }
  /** Front-to-back order = DOM order. */
  function stack() {
    const nodes = shownWidgets().map(w => cards.get(w.id)?.card).filter(Boolean);
    if (el.children.length !== nodes.length || nodes.some((n, i) => el.children[i] !== n)) replace(el, nodes);
  }
  const shownWidgets = () => prefs.placed.map(id => WIDGETS.find(w => w.id === id)).filter(w => w?.available(store));

  function render(force = false) {
    if (ptzHolding()) return afterPtzHold(() => render(force));
    const st = stageSize();
    for (const w of shownWidgets()) {
      const c = card(w);
      const collapsed = prefs.collapsed.includes(w.id);
      c.card.classList.toggle('collapsed', collapsed);
      c.toggle.textContent = collapsed ? '▸' : '▾';
      c.toggle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${w.title}`);
      c.toggle.setAttribute('aria-expanded', String(!collapsed));
      c.body.hidden = collapsed;
      place(c.card, clampPos(prefs.pos[w.id] ?? { x: 0, y: 0 }, st));
      const key = JSON.stringify([w.topics.map(t => store.topic(t)), store.state.connection?.state, store.system, prefs.settings[w.id]]);
      const typing = c.body.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'range';
      if (!collapsed && (force || key !== c.key) && !c.dragging && !typing) {
        replace(c.body, w.render(store, api, c.ctx));
        c.key = key;
      }
    }
    stack();
    if (!menu.hidden) renderMenu();
  }

  render();
  const off = store.subscribe([...new Set(WIDGETS.flatMap(w => w.topics))].map(t => `topic:${t}`).concat('connection'), () => render());
  // A smaller stage (window, side panel) pulls the cards back inside.
  const resizeObserver = new ResizeObserver(() => { const st = stageSize(); for (const w of shownWidgets()) { const c = cards.get(w.id); if (c) place(c.card, clampPos(prefs.pos[w.id] ?? { x: 0, y: 0 }, st)); } });
  resizeObserver.observe(stage);
  return {
    el,
    picker,
    destroy() {
      off();
      resizeObserver.disconnect();
      document.removeEventListener('pointerdown', onDocDown);
      for (const c of cards.values()) { c.ctx.destroy?.(); window.removeEventListener('pointerup', c.onUp); }
    },
  };
}
