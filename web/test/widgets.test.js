// WO-104: voting controls per system (shared by Settings → Voting and the Room widget).
// WO-127: widget preferences on the plan (placed, positions, collapsed, settings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlsFor, resultRows } from '../js/voting-controls.js';
import { parsePrefs, addWidget, removeWidget, toggleCollapsed, toFront, moveTo, clampPos, defaultPos, setSetting, CARD_W, HEAD_H } from '../js/widgets/prefs.js';

test('controlsFor: lifecycle per system', () => {
  const labels = (sys, st) => controlsFor(sys, st).map(([l]) => l);
  assert.deepEqual(labels('wired', 'opened'), ['Hold', 'Close voting', 'Abort']);
  assert.deepEqual(labels('wired', 'done'), ['Accept result', 'Reject result']);
  assert.deepEqual(labels('wireless', 'closed'), ['Open voting']);
  assert.deepEqual(labels('wireless', 'done'), []);
  assert.deepEqual(labels('dcn', 'opened'), ['Hold', 'Close voting']);
  assert.deepEqual(labels('dcn-smd', 'opened'), [], 'read-only stream');
  assert.deepEqual(labels('wired', 'accepted'), []);
});

test('resultRows: shares of votes cast; not voted against everyone', () => {
  const { total, rows } = resultRows([{ answer: 'yes', count: 3 }, { answer: 'no', count: 1 }, { answer: 'notVoted', count: 4 }]);
  assert.equal(total, 4);
  assert.deepEqual(rows.map(r => r.pct), [75, 25, 50]);
  assert.deepEqual(rows.map(r => r.width), [75, 25, 100]);
  assert.deepEqual(resultRows([]).rows, []);
  assert.equal(resultRows([{ answer: 'yes', count: 0 }]).rows[0].pct, 0);
});

const known = ['voting', 'audio', 'presentation', 'ptz'];
const empty = { placed: [], collapsed: [], pos: {}, settings: {} };
const stage = { w: 1000, h: 600 };

test('parsePrefs: nothing placed by default; junk, unknown ids and bad positions dropped', () => {
  assert.deepEqual(parsePrefs(null, known), empty);
  assert.deepEqual(parsePrefs('{not json', known), empty);
  assert.deepEqual(parsePrefs('[1,2]', known).placed, []);
  const p = parsePrefs(JSON.stringify({
    placed: ['ptz', 'nope', 3, 'voting', 'ptz'], collapsed: 'x',
    pos: { ptz: { x: 10.4, y: 20 }, voting: { x: 'a', y: 1 }, nope: { x: 1, y: 1 } },
    settings: { ptz: { cameraId: 'cam-1' }, audio: [1], nope: {} },
  }), known);
  assert.deepEqual(p, { placed: ['ptz', 'voting'], collapsed: [], pos: { ptz: { x: 10, y: 20 } }, settings: { ptz: { cameraId: 'cam-1' } } });
});

test('clampPos keeps the header inside the stage', () => {
  assert.deepEqual(clampPos({ x: -50, y: -5 }, stage), { x: 0, y: 0 });
  assert.deepEqual(clampPos({ x: 5000, y: 5000 }, stage), { x: 1000 - CARD_W, y: 600 - HEAD_H });
  assert.deepEqual(clampPos({ x: 100, y: 50 }, { w: 200, h: 30 }), { x: 0, y: 0 }, 'stage narrower than a card');
});

test('addWidget: top right, cascading; re-adding keeps the old position; remove forgets collapse', () => {
  let p = addWidget(empty, 'voting', stage);
  assert.deepEqual(p.placed, ['voting']);
  assert.deepEqual(p.pos.voting, defaultPos(0, stage));
  assert.equal(p.pos.voting.x, 1000 - CARD_W - 12);
  p = addWidget(p, 'ptz', stage);
  assert.deepEqual(p.pos.ptz, { x: 1000 - 2 * (CARD_W + 12), y: 12 }, 'second card left of the first');
  assert.deepEqual(defaultPos(3, stage), { x: 1000 - CARD_W - 12 - 28, y: 12 + 28 }, 'row of 3 full: cascade');
  assert.deepEqual(defaultPos(1, { w: 320, h: 600 }), { x: 0, y: 40 }, 'one per row on a narrow stage (clamped)');
  p = moveTo(p, 'voting', { x: 40, y: 9999 }, stage);
  assert.deepEqual(p.pos.voting, { x: 40, y: 600 - HEAD_H });
  p = toggleCollapsed(p, 'voting');
  p = removeWidget(p, 'voting');
  assert.deepEqual(p.placed, ['ptz']);
  assert.deepEqual(p.collapsed, []);
  p = addWidget(p, 'voting', stage);
  assert.deepEqual(p.pos.voting, { x: 40, y: 600 - HEAD_H }, 'remembered');
  assert.deepEqual(p.placed, ['ptz', 'voting']);
});

test('toFront and settings', () => {
  let p = { ...empty, placed: ['voting', 'audio', 'ptz'] };
  assert.deepEqual(toFront(p, 'voting').placed, ['audio', 'ptz', 'voting']);
  assert.equal(toFront(p, 'ptz'), p, 'already in front: unchanged');
  assert.equal(toFront(p, 'presentation'), p, 'not placed: unchanged');
  assert.deepEqual(addWidget(p, 'audio', stage).placed, ['voting', 'ptz', 'audio'], 'adding a placed widget brings it forward');
  p = setSetting(p, 'ptz', 'cameraId', 'cam-2');
  assert.deepEqual(setSetting(p, 'ptz', 'other', 1).settings.ptz, { cameraId: 'cam-2', other: 1 });
});
