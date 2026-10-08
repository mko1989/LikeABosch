// Hash router + navigation (DEC-009, DEC-011, DEC-014). Areas:
//   #/room                 the operator's room view (home, full width); #/room?seat=<id> selects a seat
//   #/meeting/<view>       meeting, agenda, participants, seating
//   #/settings/<view>      everything else, with a side navigation
// Legacy links #/<view> and views that moved area (e.g. #/settings/meetings) redirect to their area.
// Views: { id, title, topics?, permissions?, feature?, comingSoon?, mount(el, ctx) }.
// `feature`: domain capability (DEC-010) the connected system must have, else the view is hidden (e.g. 'meetings').
import { h, replace } from './dom.js';

/**
 * @param {object} opts
 * @param {any} opts.home              the room view
 * @param {{ id: string, title: string, views: any[] }[]} opts.areas  areas with a side navigation, in tab order
 * @param {HTMLElement} opts.nav       side navigation of the current area
 * @param {HTMLElement} opts.tabs      top-level tabs (Room / Meeting / Settings)
 * @param {HTMLElement} opts.outlet
 * @param {ReturnType<import('./store.js').createStore>} opts.store
 * @param {object} opts.ctx  passed to view.mount
 */
export function createRouter({ home, areas, nav, tabs, outlet, store, ctx }) {
  let current = null;
  let currentArea = null;
  let unmount = null;
  /** Last view per area, so a tab returns to where the operator was. */
  const lastView = new Map();
  const areaOf = view => areas.find(a => a.views.includes(view));
  const findView = id => areas.flatMap(a => a.views).find(v => v.id === id);
  const href = view => (view === home ? '#/room' : `#/${areaOf(view).id}/${view.id}`);

  /** Resolve the hash to { area, view }; redirects legacy links. */
  function resolve() {
    const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
    if (!parts.length || parts[0] === home.id) return { area: 'room', view: home };
    const area = areas.find(a => a.id === parts[0]);
    const inArea = area?.views.find(v => v.id === parts[1]);
    if (area && (inArea || !parts[1])) return { area: area.id, view: inArea ?? lastView.get(area.id) ?? area.views[0] };
    const moved = findView(area ? parts[1] : parts[0]); // #/<view> or #/<otherArea>/<view>
    if (moved) {
      history.replaceState(null, '', href(moved));
      return { area: areaOf(moved).id, view: moved };
    }
    return area ? { area: area.id, view: area.views[0] } : { area: 'room', view: home };
  }

  /** Why a view is not usable right now, or null. */
  const hidden = view => Boolean(view.feature) && !store.feature(view.feature);

  function blocker(view) {
    if (view.comingSoon) return 'Coming soon';
    if (hidden(view)) return 'Not available on this system';
    const missing = (view.permissions ?? []).filter(p => !store.can(p));
    if (store.live && missing.length) return `Requires permission: ${missing.join(', ')}`;
    if (store.live && view.topics?.length && view.topics.every(t => store.topic(t) === undefined)) {
      return store.unavailable(view.topics[0]) ?? 'Not available on this system';
    }
    return null;
  }

  function renderNav() {
    const area = areas.find(a => a.id === currentArea);
    if (!area) return replace(nav);
    replace(nav, h('ul', null, area.views.filter(v => !hidden(v)).map(view => {
      const reason = blocker(view);
      return h('li', null, h('a', {
        href: href(view),
        class: ['nav-link', current?.id === view.id && 'active', reason && 'muted'],
        'aria-current': current?.id === view.id ? 'page' : null,
        title: reason ?? view.title,
      }, view.title, view.comingSoon ? h('span', { class: 'badge' }, 'soon') : null));
    })));
  }

  function renderTabs() {
    const tab = (id, title, link) => h('a', { href: link, class: ['tab', currentArea === id && 'active'], 'aria-current': currentArea === id ? 'page' : null }, title);
    replace(tabs,
      tab('room', 'Room', '#/room'),
      areas.filter(a => a.views.some(v => !hidden(v)))
        .map(a => tab(a.id, a.title, href(lastView.get(a.id) ?? a.views.find(v => !hidden(v))))));
  }

  function show() {
    const { area, view } = resolve();
    document.body.dataset.area = area;
    if (current === view) return; // same view, new query (e.g. #/room?seat=…): the view watches hashchange itself
    unmount?.();
    current = view;
    currentArea = area;
    if (area !== 'room') lastView.set(area, view);
    renderTabs();
    document.title = `${view.title} · LikeABosch`;
    const el = h('section', { class: 'view', 'aria-labelledby': 'view-title' });
    replace(outlet, el);
    if (hidden(view)) {
      el.append(h('h1', { id: 'view-title' }, view.title), h('div', { class: 'card placeholder' }, h('p', null, 'This function is not available on the connected system.')));
      unmount = null;
    } else {
      unmount = view.mount(el, ctx) ?? null;
    }
    renderNav();
    outlet.focus({ preventScroll: true });
  }

  return {
    start() {
      window.addEventListener('hashchange', show);
      store.subscribe(['connection', 'stream', '*'], () => { renderNav(); renderTabs(); });
      // Re-mount the current view when the system changes (wired ↔ wireless): views pick their data source on mount.
      let system = store.system;
      store.subscribe(['topic:domain.capabilities'], () => {
        if (store.system !== system) { system = store.system; current = null; show(); }
      });
      show();
    },
    navigate: id => { location.hash = id === home.id ? '#/room' : href(findView(id) ?? areas[0].views[0]); },
  };
}
