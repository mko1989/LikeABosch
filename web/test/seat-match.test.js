import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeMatch, seatToken, unmatchedSeats } from '../js/seat-match.js';

test('tokens: numbers and the chairman', () => {
  assert.equal(seatToken('Seat 12'), 'n12');
  assert.equal(seatToken('seat-012'), 'n12');
  assert.equal(seatToken('Chairman'), 'chair');
  assert.equal(seatToken('Row 2 seat 7'), 'n7');
  assert.equal(seatToken('Guest'), null);
});

test('simulated wired project → real wireless WAP: by name, then number, then order; extra plan seats go off the plan', () => {
  const plan = [
    { id: 'seat-1', name: 'Chairman' }, { id: 'seat-2', name: 'Seat 2' }, { id: 'seat-3', name: 'Seat 3' },
    { id: 'seat-4', name: 'Guest A' }, { id: 'seat-5', name: 'Guest B' }, { id: 'seat-6', name: 'Guest C' },
  ];
  const system = [{ id: '1', name: 'Voorzitter' }, { id: '2', name: 'Seat 2' }, { id: '3', name: 'Delegate 3' }, { id: '9', name: 'Spare 1' }, { id: '10', name: 'Spare 2' }];
  const { map, how } = proposeMatch(plan, system);
  assert.deepEqual(map, { 'seat-1': '1', 'seat-2': '2', 'seat-3': '3', 'seat-4': '9', 'seat-5': '10', 'seat-6': null });
  assert.deepEqual(how, { 'seat-2': 'name', 'seat-1': 'number', 'seat-3': 'number', 'seat-4': 'order', 'seat-5': 'order', 'seat-6': null });
});

test('same ids stay; unmatchedSeats', () => {
  const { map, how } = proposeMatch([{ id: 'a', name: 'X' }], [{ id: 'a', name: 'Y' }]);
  assert.deepEqual([map, how], [{ a: 'a' }, { a: 'id' }]);
  assert.deepEqual(unmatchedSeats(['a', 'b', 'c'], ['a', 'c']), ['b']);
});
