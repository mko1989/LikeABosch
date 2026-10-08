import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, defaultCounts, countsError, placesFor, rotateAround, boxCenter, byName } from '../js/arrange.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('line: evenly spaced, centred, start end selectable', () => {
  const p = arrange({ shape: 'line', n: 3, spacing: 100, center: { x: 500, y: 200 } });
  assert.deepEqual(p, [{ x: 400, y: 200, rotation: 0 }, { x: 500, y: 200, rotation: 0 }, { x: 600, y: 200, rotation: 0 }]);
  assert.equal(arrange({ shape: 'line', n: 3, start: 'right' })[0].x, 100, 'seat 1 at the right end');
});

test('U-shape: per-segment counts, path from the left arm open end, seats face inward', () => {
  const p = arrange({ shape: 'u', n: 7, counts: [2, 3, 2], spacing: 100 });
  assert.equal(p.length, 7);
  // seat 1 = top of the left arm (open end), then down, base left→right, right arm up to the open end
  assert.ok(p[0].y < p[1].y && p[0].x === p[1].x, 'left arm goes down');
  assert.equal(p[0].rotation, 90, 'left arm faces right (inward)');
  assert.deepEqual([p[2].rotation, p[3].rotation, p[4].rotation], [0, 0, 0], 'base faces up (into the U)');
  assert.ok(p[2].x < p[3].x && p[3].x < p[4].x && p[2].y === p[4].y, 'base runs left → right');
  assert.equal(p[5].rotation, 270, 'right arm faces left');
  assert.ok(p[6].y < p[5].y, 'right arm goes up to the open end');
  assert.equal(p[0].y, p[6].y, 'arms end level');
  assert.equal(dist(p[2], p[3]), 100, 'spacing');
  assert.equal(Math.round(dist(p[1], p[2])), 141, 'corner left empty (diagonal one spacing each way)');
  const rev = arrange({ shape: 'u', n: 7, counts: [2, 3, 2], spacing: 100, start: 'right' });
  assert.deepEqual(rev[0], p[6], 'start at the right arm');
  const out = arrange({ shape: 'u', n: 7, counts: [2, 3, 2], facing: 'out' });
  assert.equal(out[0].rotation, 270, 'outward');
});

test('U-shape with unequal arms (15 / 10 / 5)', () => {
  const p = arrange({ shape: 'u', n: 30, counts: [15, 10, 5], spacing: 80 });
  assert.equal(p.length, 30);
  assert.equal(p.filter(x => x.rotation === 90).length, 15);
  assert.equal(p.filter(x => x.rotation === 0).length, 10);
  assert.equal(p.filter(x => x.rotation === 270).length, 5);
});

test('rectangle: start corner and direction; faces inward', () => {
  const cw = arrange({ shape: 'rect', n: 8, counts: [2, 2, 2, 2], spacing: 100, start: 'tl' });
  assert.equal(cw[0].rotation, 180, 'top row faces down');
  assert.ok(cw[0].x < cw[1].x, 'clockwise: top row left → right');
  assert.equal(cw[2].rotation, 270, 'then the right side');
  const ccw = arrange({ shape: 'rect', n: 8, counts: [2, 2, 2, 2], spacing: 100, start: 'tl', direction: 'ccw' });
  assert.equal(ccw[0].rotation, 90, 'counter-clockwise from top-left: left side first');
  assert.ok(ccw[0].y < ccw[1].y, 'going down');
  const br = arrange({ shape: 'rect', n: 8, counts: [2, 2, 2, 2], spacing: 100, start: 'br' });
  assert.equal(br[0].rotation, 0, 'from bottom-right clockwise: bottom row first');
  assert.ok(br[0].x > br[1].x, 'right → left');
});

test('grid: columns and start corner', () => {
  const p = arrange({ shape: 'grid', n: 5, columns: 3, spacing: 100 });
  assert.ok(p[0].x < p[1].x && p[0].y === p[1].y && p[3].y > p[0].y);
  const tr = arrange({ shape: 'grid', n: 6, columns: 3, start: 'tr' });
  assert.ok(tr[0].x > tr[1].x);
});

test('rotation turns positions and seat facing; centred on the target', () => {
  const p = arrange({ shape: 'line', n: 2, spacing: 100, rotation: 90, center: { x: 0, y: 0 } });
  assert.deepEqual(p, [{ x: 0, y: -50, rotation: 90 }, { x: 0, y: 50, rotation: 90 }]);
  const u = arrange({ shape: 'u', n: 9, counts: [3, 3, 3], center: { x: 1000, y: 500 } });
  assert.deepEqual(boxCenter(u), { x: 1000, y: 500 });
});

test('default counts sum to n; countsError', () => {
  for (const n of [0, 1, 2, 7, 30, 41]) {
    for (const s of ['u', 'rect']) assert.equal(defaultCounts(s, n).reduce((a, b) => a + b, 0), n, `${s} ${n}`);
  }
  assert.deepEqual(defaultCounts('u', 40), [13, 14, 13]);
  assert.equal(countsError('u', [15, 10, 5], 30), null);
  assert.equal(countsError('u', [15, 10, 4], 30), null, 'fewer places than seats: overflow allowed (WO-094)');
  assert.match(countsError('u', [15, 10, 6], 30), /31 seats, only 30/);
  assert.match(countsError('u', [0, 0, 0], 30), /no seats/);
  assert.equal(countsError('line', [], 3), null);
});

test('rotateAround and natural name order', () => {
  const r = rotateAround([{ id: 'a', x: 100, y: 0, rotation: 0 }], { x: 0, y: 0 }, 90);
  assert.deepEqual(r, [{ id: 'a', x: 0, y: 100, rotation: 90 }]);
  assert.deepEqual(['Seat 10', 'Seat 2', 'Seat 1'].map(name => ({ name })).sort(byName).map(x => x.name), ['Seat 1', 'Seat 2', 'Seat 10']);
});

test('orderSeats: count from a side or by name (WO-056)', async () => {
  const { orderSeats } = await import('../js/arrange.js');
  const list = [{ id: 'a', name: 'Seat 13' }, { id: 'b', name: 'Seat 12' }, { id: 'c', name: 'Seat 24' }];
  const pos = { a: { x: 200, y: 0 }, b: { x: 100, y: 0 }, c: { x: 300, y: -50 } };
  const ids = by => orderSeats(list, by, pos).map(x => x.id);
  assert.deepEqual(ids('name'), ['b', 'a', 'c']);
  assert.deepEqual(ids('name-desc'), ['c', 'a', 'b']);
  assert.deepEqual(ids('ltr'), ['b', 'a', 'c']);
  assert.deepEqual(ids('rtl'), ['c', 'a', 'b']);
  assert.deepEqual(ids('ttb'), ['c', 'b', 'a']);
  assert.deepEqual(ids('btt'), ['b', 'a', 'c']);
  assert.deepEqual(ids('selection'), ['a', 'b', 'c']);
});

test('overflow (WO-094): a U with 10 per side takes 30 of 40 selected seats; line/grid take all', () => {
  assert.equal(placesFor('u', [10, 10, 10], 40), 30);
  assert.equal(placesFor('u', [10, 10, 10], 25), 25, 'never more than selected');
  assert.equal(placesFor('line', [], 40), 40);
  assert.equal(arrange({ shape: 'u', n: placesFor('u', [10, 10, 10], 40), counts: [10, 10, 10] }).length, 30);
});
