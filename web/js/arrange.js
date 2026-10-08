// Seat arrangements for the room editor (WO-055): pure geometry, no DOM.
// Units: workspace units (1 ≈ 1 cm). Rotation: degrees, 0 = facing up (−y), clockwise positive (SVG rotate()).
// Every shape is built around (0, 0), centred on its bounding box, rotated, then moved to `center`.

export const SHAPES = {
  line: { label: 'Line', segments: null },
  u: { label: 'U-shape', segments: ['Left arm', 'Base', 'Right arm'] },
  rect: { label: 'Rectangle', segments: ['Top', 'Right', 'Bottom', 'Left'] },
  grid: { label: 'Grid', segments: null },
};

/** Default seats per segment for `n` seats (sums to n). */
export function defaultCounts(shape, n) {
  if (shape === 'u') {
    const arm = Math.floor(n / 3);
    return [arm, n - 2 * arm, arm];
  }
  if (shape === 'rect') {
    const q = Math.floor(n / 4);
    const c = [q, q, q, q];
    for (let i = 0; i < n - 4 * q; i += 1) c[[0, 2, 1, 3][i]] += 1; // remainder: top, bottom, right
    return c;
  }
  return [n];
}

/**
 * Problem with the per-segment counts, or null. Fewer places than selected seats is fine (WO-094): the first seats
 * are arranged, the rest stay where they are ("overflow"); more places than seats is an error.
 */
export function countsError(shape, counts, n) {
  if (!SHAPES[shape]?.segments) return null;
  if (counts.some(c => !Number.isInteger(c) || c < 0)) return 'Counts must be whole numbers ≥ 0';
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum === 0) return 'The segments hold no seats';
  return sum > n ? `Segments hold ${sum} seats, only ${n} selected` : null;
}

/** How many of `n` selected seats the shape takes (the rest overflow, WO-094). */
export function placesFor(shape, counts, n) {
  return SHAPES[shape]?.segments ? Math.min(n, counts.reduce((a, b) => a + b, 0)) : n;
}

const norm = deg => ((Math.round(deg) % 360) + 360) % 360;
const round = v => Math.round(v) || 0; // no -0
/** Positions of `k` seats in a row centred on 0. */
const row = (k, gap) => Array.from({ length: k }, (_, i) => (i - (k - 1) / 2) * gap);

/**
 * Target positions in seat order (index 0 = seat 1, the start).
 * @param {{ shape: 'line'|'u'|'rect'|'grid', n: number, counts?: number[], spacing?: number, rotation?: number,
 *   center?: {x:number,y:number}, start?: string, direction?: 'cw'|'ccw', facing?: 'in'|'out', columns?: number }} o
 *   start: line/u 'left'|'right'; rect/grid 'tl'|'tr'|'br'|'bl'.
 * @returns {{x:number,y:number,rotation:number}[]}
 */
export function arrange(o) {
  const gap = o.spacing ?? 100;
  const flip = o.facing === 'out' ? 180 : 0;
  let pts;
  if (o.shape === 'line') {
    pts = row(o.n, gap).map(x => ({ x, y: 0, rotation: 0 }));
    if (o.start === 'right') pts.reverse();
  } else if (o.shape === 'u') {
    // Open side at the top (−y), base row at the bottom; arms start one spacing above the base (corners stay empty).
    const [l, b, r] = o.counts;
    const hw = b > 0 ? ((b - 1) / 2 + 1) * gap : gap;
    const arm = (k, x, rot) => Array.from({ length: k }, (_, i) => ({ x, y: -(i + 1) * gap, rotation: rot + flip }));
    const left = arm(l, -hw, 90).reverse();              // from the open end down to the base
    const base = row(b, gap).map(x => ({ x, y: 0, rotation: 0 + flip }));
    const right = arm(r, hw, 270);                         // from the base up to the open end
    pts = [...left, ...base, ...right];
    if (o.start === 'right') pts.reverse();
  } else if (o.shape === 'rect') {
    const [t, r, b, l] = o.counts;
    const hw = ((Math.max(t, b, 1) - 1) / 2 + 1) * gap;
    const hh = ((Math.max(l, r, 1) - 1) / 2 + 1) * gap;
    // Clockwise from the top-left corner: top L→R, right T→B, bottom R→L, left B→T.
    const sides = [
      row(t, gap).map(x => ({ x, y: -hh, rotation: 180 + flip })),
      row(r, gap).map(y => ({ x: hw, y, rotation: 270 + flip })),
      row(b, gap).reverse().map(x => ({ x, y: hh, rotation: 0 + flip })),
      row(l, gap).reverse().map(y => ({ x: -hw, y, rotation: 90 + flip })),
    ];
    const first = { tl: 0, tr: 1, br: 2, bl: 3 }[o.start ?? 'tl'] ?? 0;
    pts = [...sides.slice(first), ...sides.slice(0, first)].flat();
    if (o.direction === 'ccw') pts.reverse();
  } else if (o.shape === 'grid') {
    const cols = Math.max(1, Math.min(o.columns ?? Math.ceil(Math.sqrt(o.n)), o.n || 1));
    const start = o.start ?? 'tl';
    pts = Array.from({ length: o.n }, (_, i) => {
      const c = i % cols, rIdx = Math.floor(i / cols);
      return { x: (start.endsWith('r') ? cols - 1 - c : c) * gap, y: (start.startsWith('b') ? -rIdx : rIdx) * gap, rotation: 0 };
    });
  } else throw new Error(`unknown shape ${o.shape}`);

  // Centre on the bounding box, rotate, move to the target centre.
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
  const a = (o.rotation ?? 0) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  const cx = o.center?.x ?? 0, cy = o.center?.y ?? 0;
  return pts.map(p => {
    const x = p.x - mx, y = p.y - my;
    return { x: round(cx + x * cos - y * sin), y: round(cy + x * sin + y * cos), rotation: norm(p.rotation + (o.rotation ?? 0)) };
  });
}

/** Rotate placements by `deg` around `center` (group rotate). */
export function rotateAround(items, center, deg) {
  const a = deg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  return items.map(p => {
    const x = p.x - center.x, y = p.y - center.y;
    return { ...p, x: round(center.x + x * cos - y * sin), y: round(center.y + x * sin + y * cos), rotation: norm((p.rotation ?? 0) + deg) };
  });
}

/** Centre of the bounding box of the points. */
export function boxCenter(points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2) };
}

/** Natural order by seat name ("Seat 2" before "Seat 10"). */
export const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });

/** "Count from" options for numbering seats, e.g. camera presets (WO-056). */
export const COUNT_FROM = [
  ['name', 'Seat name, ascending'],
  ['name-desc', 'Seat name, descending'],
  ['ltr', 'Left → right on the plan'],
  ['rtl', 'Right → left on the plan'],
  ['ttb', 'Top → bottom on the plan'],
  ['btt', 'Bottom → top on the plan'],
  ['selection', 'In the order selected'],
];

/**
 * Seats in counting order.
 * @param {{id: string, name: string}[]} list   in selection order
 * @param {string} by                           a COUNT_FROM key
 * @param {Record<string, {x: number, y: number}>} pos
 */
export function orderSeats(list, by, pos) {
  const p = id => pos[id] ?? { x: 0, y: 0 };
  const cmp = {
    name: byName,
    'name-desc': (a, b) => byName(b, a),
    ltr: (a, b) => p(a.id).x - p(b.id).x || p(a.id).y - p(b.id).y,
    rtl: (a, b) => p(b.id).x - p(a.id).x || p(a.id).y - p(b.id).y,
    ttb: (a, b) => p(a.id).y - p(b.id).y || p(a.id).x - p(b.id).x,
    btt: (a, b) => p(b.id).y - p(a.id).y || p(a.id).x - p(b.id).x,
  }[by];
  return cmp ? [...list].sort(cmp) : [...list];
}
