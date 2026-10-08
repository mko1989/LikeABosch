// WO-104: voting controls per system (shared by Settings → Voting and the Room widget) and widget preferences.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlsFor, resultRows } from '../js/voting-controls.js';
import { parsePrefs, togglePref } from '../js/widgets/prefs.js';

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

test('parsePrefs tolerates junk and unknown ids; togglePref flips', () => {
  const known = ['voting', 'audio', 'presentation'];
  assert.deepEqual(parsePrefs(null, known), { hidden: [], collapsed: [] });
  assert.deepEqual(parsePrefs('{not json', known), { hidden: [], collapsed: [] });
  assert.deepEqual(parsePrefs(JSON.stringify({ hidden: ['audio', 'nope', 3], collapsed: 'x' }), known), { hidden: ['audio'], collapsed: [] });
  const p = togglePref({ hidden: [], collapsed: ['voting'] }, 'collapsed', 'voting');
  assert.deepEqual(p.collapsed, []);
  assert.deepEqual(togglePref(p, 'hidden', 'audio').hidden, ['audio']);
});
