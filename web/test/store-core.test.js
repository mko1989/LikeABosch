import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, topicData, can, isLive } from '../js/store-core.js';

test('snapshot replaces topics and reports every affected topic', () => {
  let s = reduce(initialState(), 'snapshot', { topics: { a: { data: 1, updatedAt: 't' } }, unavailable: { b: 'no permission' } }).state;
  const r = reduce(s, 'snapshot', { topics: { c: { data: 3, updatedAt: 't' } }, unavailable: {} });
  assert.deepEqual(r.changed.sort(), ['topic:a', 'topic:b', 'topic:c']);
  s = r.state;
  assert.equal(topicData(s, 'a'), undefined);
  assert.equal(topicData(s, 'c'), 3);
  assert.deepEqual(s.unavailable, {});
});

test('topic update sets data and clears unavailable; null removes', () => {
  let s = reduce(initialState(), 'snapshot', { topics: {}, unavailable: { seats: 'x' } }).state;
  let r = reduce(s, 'topic', { topic: 'seats', data: { seats: [] }, updatedAt: 't1' });
  assert.deepEqual(r.changed, ['topic:seats']);
  s = r.state;
  assert.deepEqual(topicData(s, 'seats'), { seats: [] });
  assert.equal(s.unavailable.seats, undefined);
  r = reduce(s, 'topic', { topic: 'seats', data: null, updatedAt: 't2' });
  assert.equal(topicData(r.state, 'seats'), undefined);
});

test('reducer does not mutate the previous state', () => {
  const s0 = initialState();
  const s1 = reduce(s0, 'topic', { topic: 'x', data: 1, updatedAt: 't' }).state;
  assert.deepEqual(s0.topics, {});
  assert.notEqual(s0, s1);
});

test('connection, stream, permissions and liveness', () => {
  let s = initialState();
  assert.equal(isLive(s), false);
  s = reduce(s, 'connection', { state: 'loggedIn', permissions: ['canManageMeeting'] }).state;
  assert.equal(can(s, 'canManageMeeting'), true);
  assert.equal(can(s, 'canViewVoting'), false);
  assert.equal(isLive(s), false, 'stream not open yet');
  const r = reduce(s, 'stream', 'open');
  assert.deepEqual(r.changed, ['stream']);
  assert.equal(isLive(r.state), true);
  assert.deepEqual(reduce(r.state, 'stream', 'open').changed, [], 'no change → no notification');
});
