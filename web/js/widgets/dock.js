// Room widget dock (WO-104, DEC-030): compact live widgets (voting, audio, presentation) in the Room's operate-mode side
// panel. A widget = { id, title, settingsHref, topics, available(store), render(store, api, ctx) → nodes, setup?() }.
// A widget's body is rebuilt only when one of its topics changes, and never while the user is typing in it or
// dragging one of its sliders. Shown / collapsed widgets are a per-browser preference.
import { h, replace } from '../dom.js';
import { PREFS_KEY, parsePrefs, togglePref } from './prefs.js';
import voting from './voting.js';
import audio from './audio.js';
import presentation from './presentation.js';

export const WIDGETS = [voting, audio, presentation];
const IDS = WIDGETS.map(w => w.id);

function loadPrefs() {
  try { return parsePrefs(localStorage.getItem(PREFS_KEY), IDS); } catch { return parsePrefs(null, IDS); }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode: keep for this page only */ }
}

/** @returns {{ el: HTMLElement, destroy: () => void }} */
export function createWidgetDock(store, api) {
  let prefs = loadPrefs();
  const el = h('section', { class: 'widget-dock', 'aria-label': 'Widgets' });
  const menu = h('div', { class: 'widget-menu', hidden: true });
  const menuBtn = h('button', { type: 'button', class: 'link small', 'aria-expanded': 'false', onclick: () => toggleMenu() }, 'Choose widgets ▾');
  const head = h('div', { class: 'widget-dock-head' }, menuBtn);
  const list = h('div', { class: 'widget-list' });
  el.append(head, menu, list);

  /** id → { card, body, ctx, key, busy } */
  const cards = new Map();
  function card(w) {
    let c = cards.get(w.id);
    if (c) return c;
    const body = h('div', { class: 'widget-body' });
    const toggle = h('button', { type: 'button', class: 'link small widget-toggle', onclick: () => { prefs = togglePref(prefs, 'collapsed', w.id); savePrefs(prefs); render(true); } });
    const cardEl = h('article', { class: 'side-card widget', 'data-widget': w.id },
      h('div', { class: 'card-head' }, h('h2', null, w.title), h('span', { class: 'widget-tools' },
        h('a', { href: w.settingsHref, class: 'small', title: `Open ${w.title} in full` }, 'More'), toggle)),
      body);
    c = { card: cardEl, body, toggle, ctx: w.setup?.(store, api) ?? {}, key: undefined, dragging: false };
    // Keep the body while a slider is held (rebuild on release).
    body.addEventListener('pointerdown', e => { if (e.target.matches?.('input[type=range]')) c.dragging = true; });
    window.addEventListener('pointerup', c.onUp = () => { if (c.dragging) { c.dragging = false; render(); } });
    cards.set(w.id, c);
    return c;
  }

  function toggleMenu(open = menu.hidden) {
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) renderMenu();
  }
  function renderMenu() {
    replace(menu, WIDGETS.map(w => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: !prefs.hidden.includes(w.id), disabled: !w.available(store),
        onchange: () => { prefs = togglePref(prefs, 'hidden', w.id); savePrefs(prefs); render(true); } }),
      ` ${w.title}`, w.available(store) ? null : h('small', { class: 'sub' }, ' not on this system'))));
  }

  function render(force = false) {
    const shown = WIDGETS.filter(w => w.available(store) && !prefs.hidden.includes(w.id));
    el.hidden = !WIDGETS.some(w => w.available(store));
    const nodes = shown.map(w => {
      const c = card(w);
      const collapsed = prefs.collapsed.includes(w.id);
      c.card.classList.toggle('collapsed', collapsed);
      c.toggle.textContent = collapsed ? '▸' : '▾';
      c.toggle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${w.title}`);
      c.toggle.setAttribute('aria-expanded', String(!collapsed));
      c.body.hidden = collapsed;
      const key = JSON.stringify([w.topics.map(t => store.topic(t)), store.state.connection?.state, store.system]);
      const typing = c.body.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'range';
      if (!collapsed && (force || key !== c.key) && !c.dragging && !typing) {
        replace(c.body, w.render(store, api, c.ctx));
        c.key = key;
      }
      return c.card;
    });
    if (list.children.length !== nodes.length || nodes.some((n, i) => list.children[i] !== n)) replace(list, nodes);
    if (!menu.hidden) renderMenu();
  }

  render();
  const off = store.subscribe([...new Set(WIDGETS.flatMap(w => w.topics))].map(t => `topic:${t}`).concat('connection'), () => render());
  return {
    el,
    destroy() {
      off();
      for (const c of cards.values()) { c.ctx.destroy?.(); window.removeEventListener('pointerup', c.onUp); }
    },
  };
}
