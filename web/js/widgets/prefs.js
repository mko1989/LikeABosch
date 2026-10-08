// Room widget preferences (WO-104, DEC-030): which widgets are hidden / collapsed, per browser. Pure: no DOM.
export const PREFS_KEY = 'likeabosch.room.widgets';

/** Parse stored preferences; anything malformed → defaults (everything shown, expanded). */
export function parsePrefs(raw, known) {
  let v = null;
  try { v = JSON.parse(raw ?? 'null'); } catch { v = null; }
  const list = x => (Array.isArray(x) ? x.filter(id => typeof id === 'string' && known.includes(id)) : []);
  return { hidden: list(v?.hidden), collapsed: list(v?.collapsed) };
}

/** Toggle an id in one of the lists; returns new prefs. */
export function togglePref(prefs, list, id) {
  const set = new Set(prefs[list]);
  if (set.has(id)) set.delete(id); else set.add(id);
  return { ...prefs, [list]: [...set] };
}
