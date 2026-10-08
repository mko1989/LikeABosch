import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutNames, overlaps, shorten, splitTwo } from '../js/labels.js';

const R = 30;
const measure = t => t.length * 7; // ~12 px font
const opts = (seats, extra = {}) => ({ measure, lineHeight: 14, seatR: R, discs: seats.map(s => ({ x: s.x, y: s.y, r: R })), ...extra });
const row = (names, spacing = 100, y = 0) => names.map((text, i) => ({ id: String(i + 1), x: i * spacing, y, text }));

function assertNoCollisions(seats, layout, discs) {
  const boxes = [...layout.values()].filter(Boolean).map(p => p.box);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlaps(boxes[i], boxes[j]), `names ${i} and ${j} overlap`);
    for (const c of discs) {
      const nx = Math.max(boxes[i].x, Math.min(c.x, boxes[i].x + boxes[i].w));
      const ny = Math.max(boxes[i].y, Math.min(c.y, boxes[i].y + boxes[i].h));
      assert.ok((c.x - nx) ** 2 + (c.y - ny) ** 2 >= c.r * c.r, `name ${i} covers a seat`);
    }
  }
}

test('neighbours in a row alternate below / above', () => {
  const seats = row(['Ann', 'Bob', 'Cid', 'Dan']);
  const l = layoutNames(seats, opts(seats));
  assert.deepEqual(seats.map(s => l.get(s.id).side), ['below', 'above', 'below', 'above']);
  assert.ok(l.get('1').dy > R && l.get('2').dy + 14 < -R, 'below starts under the disc, above ends over it');
});

test('a seat on its own keeps its name below; separate rows each start below', () => {
  const seats = [...row(['Ann', 'Bob']), { id: 'x', x: 2000, y: 0, text: 'Zed' }, ...row(['Cid', 'Dan'], 100, 500).map(s => ({ ...s, id: `r${s.id}` }))];
  const l = layoutNames(seats, opts(seats));
  assert.equal(l.get('x').side, 'below');
  assert.equal(l.get('r1').side, 'below');
  assert.equal(l.get('r2').side, 'above');
});

test('dense row of long names: nothing overlaps, long names wrap or are shortened', () => {
  const seats = row(Array.from({ length: 12 }, (_, i) => `Participant Number ${i + 1} Longname`), 70);
  const o = opts(seats);
  const l = layoutNames(seats, o);
  assertNoCollisions(seats, l, o.discs);
  const placedNames = [...l.values()].filter(Boolean);
  assert.ok(placedNames.length >= 10, 'most names are shown');
  assert.ok(placedNames.some(p => p.truncated || p.lines.length === 2), 'some names had to be fitted');
  for (const p of placedNames) if (p.truncated) assert.ok(p.lines[0].endsWith('…'));
});

test('column of seats (U arm): names do not run into the next seat', () => {
  const seats = Array.from({ length: 6 }, (_, i) => ({ id: String(i), x: 0, y: i * 70, text: 'Very Long Participant Name' }));
  const o = opts(seats, { lineHeight: 28 }); // large label size
  const l = layoutNames(seats, o);
  assertNoCollisions(seats, l, o.discs);
});

test('obstacles (cameras) are avoided', () => {
  const seats = row(['Ann Example']);
  const o = opts(seats, { obstacles: [{ x: 0, y: 45, r: 20 }] });
  const l = layoutNames(seats, o);
  assert.equal(l.get('1').side, 'above');
});

test('helpers: splitTwo and shorten', () => {
  assert.deepEqual(splitTwo('Anna Maria Smith'), ['Anna Maria', 'Smith']);
  assert.equal(splitTwo('Single'), null);
  assert.equal(shorten('Abcdefgh', 1000, measure), 'Abcdefgh');
  assert.equal(shorten('Abcdefgh', 35, measure), 'Abcd…');
  assert.equal(shorten('Abcdefgh', 5, measure), null);
});

test('large label size (big gap): a single name still goes below its own seat', () => {
  const seats = row(['Ann Example']);
  const l = layoutNames(seats, opts(seats, { gap: 6, lineHeight: 29 }));
  assert.equal(l.get('1').side, 'below');
  assert.equal(l.get('1').truncated, false);
});

test('long names in a tight row wrap on their own side before giving up the alternation', () => {
  const seats = row(['Anna de Vries', 'Bart Jansen', 'Chloe Bakker'], 110);
  const l = layoutNames(seats, opts(seats, { measure: t => t.length * 12 }));
  assert.deepEqual(seats.map(s => l.get(s.id).side), ['below', 'above', 'below']);
});
