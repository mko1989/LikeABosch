// Participant names on the room plan (WO-083): pure layout, no DOM. Names sit below or above their seat disc,
// alternate between neighbours in a row, and never overlap another name, a seat disc or another obstacle: a name
// that doesn't fit is wrapped on two lines, moved to the other side, or shortened with "…".
// Coordinates are workspace units; names are always horizontal on screen (counter-rotated with the seat).

const ELLIPSIS = '…';

/**
 * @typedef {{ id: string, x: number, y: number, text: string }} NamedSeat
 * @typedef {{ x: number, y: number, r: number }} Disc
 * @typedef {{ x: number, y: number, w: number, h: number }} Box  top-left corner + size
 * @typedef {{ side: 'below' | 'above', lines: string[], dy: number, box: Box, truncated: boolean }} NamePlacement
 *   `dy` = top of the first line relative to the seat centre.
 */

/**
 * Choose where each name goes.
 * @param {NamedSeat[]} seats  seats that show a name
 * @param {object} o
 * @param {(text: string) => number} o.measure  text width in workspace units at the current label size
 * @param {number} o.lineHeight  one line, workspace units
 * @param {number} o.seatR  seat disc radius
 * @param {Disc[]} [o.discs]  every seat disc on the plan (seats without a name too)
 * @param {Disc[]} [o.obstacles]  other things names must not cover (cameras, desks)
 * @param {number} [o.gap]  minimum free space around a name
 * @returns {Map<string, NamePlacement | null>}  null = no room for even one letter (the tooltip still has the name)
 */
export function layoutNames(seats, { measure, lineHeight, seatR, discs = [], obstacles = [], gap = 3 }) {
  const out = new Map();
  const placed = /** @type {Box[]} */ ([]);
  const circles = [...discs, ...obstacles];
  const widths = new Map();
  const width = t => { let w = widths.get(t); if (w === undefined) { w = measure(t); widths.set(t, w); } return w; };
  // Offsets keep the name clear of its own disc (incl. the gap) and, above, of the facing triangle and shot badge.
  const below = seatR + gap + 2;
  const above = seatR + Math.max(gap, 6) + 3;

  const boxFor = (s, side, w, n) => {
    const h = n * lineHeight;
    const top = side === 'below' ? s.y + below : s.y - above - h;
    return { x: s.x - w / 2, y: top, w, h };
  };
  const hits = b => placed.some(p => overlaps(b, p, gap)) || circles.some(c => circleHits(c, b, gap));

  for (const { seat, prefer } of placementOrder(seats, { width, seatR, gap })) {
    const text = seat.text.trim();
    if (!text) continue;
    const other = prefer === 'below' ? 'above' : 'below';
    const two = splitTwo(text);
    // Keep the alternation as long as possible: wrap on the preferred side before switching sides.
    const candidates = two ? [[prefer, [text]], [prefer, two], [other, [text]], [other, two]] : [[prefer, [text]], [other, [text]]];
    let chosen = null;
    for (const [side, lines] of candidates) {
      const box = boxFor(seat, side, Math.max(...lines.map(width)), lines.length);
      if (!hits(box)) { chosen = { side, lines, box, truncated: false }; break; }
    }
    if (!chosen) {
      // Shorten to the free width on either side (one line), preferred side first.
      for (const side of [prefer, other]) {
        const probe = boxFor(seat, side, 0, 1);
        const room = freeWidth(seat.x, probe, placed, circles, gap);
        const short = room > 0 ? shorten(text, room, width) : null;
        if (!short) continue;
        const box = boxFor(seat, side, width(short), 1);
        if (!hits(box)) { chosen = { side, lines: [short], box, truncated: true }; break; }
      }
    }
    if (!chosen) { out.set(seat.id, null); continue; }
    placed.push(chosen.box);
    out.set(seat.id, { ...chosen, dy: chosen.box.y - seat.y });
  }
  return out;
}

/**
 * Seats in rows (similar y), left to right; neighbours in a row alternate below / above, starting below.
 * Two seats are neighbours when they are close (< 4 radii apart) or their names would touch side by side.
 * @returns {{ seat: NamedSeat, prefer: 'below' | 'above' }[]}
 */
export function placementOrder(seats, { width, seatR, gap = 3 }) {
  const byY = [...seats].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const s of byY) {
    const row = rows.at(-1);
    if (row && Math.abs(s.y - row[0].y) <= seatR * 0.6) row.push(s);
    else rows.push([s]);
  }
  const order = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let prefer = 'below';
    row.forEach((s, i) => {
      const prev = row[i - 1];
      if (prev) {
        const dx = s.x - prev.x;
        const touch = dx < seatR * 4 || dx < (width(prev.text.trim()) + width(s.text.trim())) / 2 + gap;
        prefer = touch ? (prefer === 'below' ? 'above' : 'below') : 'below';
      }
      order.push({ seat: s, prefer });
    });
  }
  return order;
}

/** Two lines split at the space nearest the middle, or null for a single word. */
export function splitTwo(text) {
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  if (best <= 0) return null;
  const a = text.slice(0, best).trim();
  const b = text.slice(best + 1).trim();
  return a && b ? [a, b] : null;
}

/** Longest prefix + "…" not wider than `max`, or null when not even one letter fits. */
export function shorten(text, max, width) {
  if (width(text) <= max) return text;
  let lo = 1, hi = text.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = text.slice(0, mid).trimEnd() + ELLIPSIS;
    if (width(t) <= max) { best = t; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** Width available around x within the vertical band of `probe`, symmetric (names are centred). */
function freeWidth(x, probe, boxes, circles, gap) {
  let left = -Infinity, right = Infinity;
  const top = probe.y - gap, bottom = probe.y + probe.h + gap;
  const limit = (lo, hi) => {
    if (hi <= x) left = Math.max(left, hi + gap);
    else if (lo >= x) right = Math.min(right, lo - gap);
    else { left = Infinity; } // something sits right where the name would be
  };
  for (const b of boxes) if (b.y < bottom && b.y + b.h > top) limit(b.x, b.x + b.w);
  for (const c of circles) {
    // Horizontal extent of the circle within the band.
    const dy = Math.max(0, top - c.y, c.y - bottom);
    if (dy >= c.r) continue;
    const half = Math.sqrt(c.r * c.r - dy * dy);
    limit(c.x - half, c.x + half);
  }
  if (left === Infinity) return 0;
  return 2 * Math.min(x - left, right - x);
}

/** Boxes overlap, keeping `gap` between them. */
export function overlaps(a, b, gap = 0) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/** Circle intersects the box grown by `gap`. */
function circleHits(c, b, gap) {
  const nx = Math.max(b.x - gap, Math.min(c.x, b.x + b.w + gap));
  const ny = Math.max(b.y - gap, Math.min(c.y, b.y + b.h + gap));
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r * c.r;
}
