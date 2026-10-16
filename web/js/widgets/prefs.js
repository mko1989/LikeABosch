// Room widget preferences (WO-127, DEC-039): which widgets are placed on the plan (in front-to-back order: last =
// front), where, which are collapsed, and per-widget settings (the PTZ camera). Per browser. Pure: no DOM.
export const PREFS_KEY = 'likeabosch.room.widgets.v2';

/** Card width and the part of a card that must stay inside the stage (its header). */
export const CARD_W = 300;
export const HEAD_H = 40;
const MARGIN = 12;
const CASCADE = 28;

const empty = () => ({ placed: [], collapsed: [], pos: {}, settings: {} });

/** Parse stored preferences; anything malformed → defaults (nothing placed). */
export function parsePrefs(raw, known) {
  let v = null;
  try { v = JSON.parse(raw ?? 'null'); } catch { v = null; }
  if (!v || typeof v !== 'object') return empty();
  const list = x => (Array.isArray(x) ? [...new Set(x.filter(id => typeof id === 'string' && known.includes(id)))] : []);
  const pos = {};
  for (const [id, p] of Object.entries(v.pos ?? {})) {
    if (known.includes(id) && Number.isFinite(p?.x) && Number.isFinite(p?.y)) pos[id] = { x: Math.round(p.x), y: Math.round(p.y) };
  }
  const settings = {};
  for (const [id, s] of Object.entries(v.settings ?? {})) {
    if (known.includes(id) && s && typeof s === 'object' && !Array.isArray(s)) settings[id] = { ...s };
  }
  return { placed: list(v.placed), collapsed: list(v.collapsed), pos, settings };
}

/**
 * Keep a card's header inside the stage. A card wider than the stage sticks to the left edge.
 * @param {{ x: number, y: number }} p
 * @param {{ w: number, h: number }} stage
 * @param {number} [cardW]
 */
export function clampPos(p, stage, cardW = CARD_W) {
  const w = Math.min(cardW, stage.w);
  return {
    x: Math.round(Math.min(Math.max(0, p.x), Math.max(0, stage.w - w))),
    y: Math.round(Math.min(Math.max(0, p.y), Math.max(0, stage.h - HEAD_H))),
  };
}

/** Where the n-th card goes: side by side from the top right; when the row is full, cascading from the top right. */
export function defaultPos(n, stage, cardW = CARD_W) {
  const w = Math.min(cardW, stage.w);
  const perRow = Math.max(1, Math.floor((stage.w - MARGIN) / (w + MARGIN)));
  if (n < perRow) return clampPos({ x: stage.w - (n + 1) * (w + MARGIN), y: MARGIN }, stage, cardW);
  const k = n - perRow + 1;
  return clampPos({ x: stage.w - w - MARGIN - k * CASCADE, y: MARGIN + k * CASCADE }, stage, cardW);
}

/** Place a widget on the plan (at the front); a known position is kept. */
export function addWidget(prefs, id, stage) {
  if (prefs.placed.includes(id)) return toFront(prefs, id);
  const pos = prefs.pos[id] ?? defaultPos(prefs.placed.length, stage);
  return { ...prefs, placed: [...prefs.placed, id], pos: { ...prefs.pos, [id]: pos } };
}

/** Take a widget off the plan; its position is remembered for the next time it is added. */
export function removeWidget(prefs, id) {
  return { ...prefs, placed: prefs.placed.filter(x => x !== id), collapsed: prefs.collapsed.filter(x => x !== id) };
}

export function toggleCollapsed(prefs, id) {
  const set = new Set(prefs.collapsed);
  if (set.has(id)) set.delete(id); else set.add(id);
  return { ...prefs, collapsed: [...set] };
}

/** Bring a placed widget to the front (end of the list). */
export function toFront(prefs, id) {
  if (!prefs.placed.includes(id) || prefs.placed.at(-1) === id) return prefs;
  return { ...prefs, placed: [...prefs.placed.filter(x => x !== id), id] };
}

export function moveTo(prefs, id, pos, stage) {
  return { ...prefs, pos: { ...prefs.pos, [id]: clampPos(pos, stage) } };
}

export function setSetting(prefs, id, key, value) {
  return { ...prefs, settings: { ...prefs.settings, [id]: { ...prefs.settings[id], [key]: value } } };
}
