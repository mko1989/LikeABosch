import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { openLiveStream } from '../js/live-stream.js';

/** Minimal EventSource stand-in: the test drives open/error/messages. */
class FakeSource {
  static all = [];
  constructor(url) {
    Object.assign(this, { url, readyState: 0, listeners: {}, closed: false });
    FakeSource.all.push(this);
  }
  addEventListener(event, fn) { (this.listeners[event] ??= []).push(fn); }
  close() { this.closed = true; this.readyState = 2; }
  open() { this.readyState = 1; this.onopen?.(); }
  fail(readyState) { this.readyState = readyState; this.onerror?.(); }
  emit(event, data) { this.listeners[event]?.forEach(fn => fn({ data: JSON.stringify(data) })); }
}

let statuses;
let topics;
let stream;
const latest = () => FakeSource.all.at(-1);
const start = (o = {}) => {
  stream = openLiveStream({
    url: '/api/events', create: u => new FakeSource(u), onStatus: s => statuses.push(s),
    handlers: { topic: d => topics.push(d) }, staleMs: 40_000, checkMs: 5_000, minRetryMs: 1_000, maxRetryMs: 4_000, ...o,
  });
};

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  FakeSource.all = [];
  statuses = [];
  topics = [];
});
afterEach(() => { stream?.close(); mock.timers.reset(); });

test('messages reach the handlers; open and lost are reported', () => {
  start();
  latest().open();
  latest().emit('topic', { topic: 'seats' });
  assert.deepEqual(topics, [{ topic: 'seats' }]);
  latest().fail(0); // network error: the browser retries by itself
  assert.deepEqual(statuses, ['open', 'lost']);
  mock.timers.tick(10_000);
  assert.equal(FakeSource.all.length, 1, 'no own reconnect while the browser is retrying');
});

test('the browser gave up (CLOSED) → reopened with backoff, backoff resets after an open', () => {
  start();
  latest().open();
  latest().fail(2);
  mock.timers.tick(999);
  assert.equal(FakeSource.all.length, 1);
  mock.timers.tick(1);
  assert.equal(FakeSource.all.length, 2, 'reopened after 1 s');
  latest().fail(2);
  mock.timers.tick(1_999);
  assert.equal(FakeSource.all.length, 2);
  mock.timers.tick(1);
  assert.equal(FakeSource.all.length, 3, 'then after 2 s');
  latest().fail(2);
  mock.timers.tick(4_000);
  latest().fail(2);
  mock.timers.tick(4_000);
  assert.equal(FakeSource.all.length, 5, 'capped at maxRetryMs');
  latest().open();
  latest().fail(2);
  mock.timers.tick(1_000);
  assert.equal(FakeSource.all.length, 6, 'back to 1 s after a successful open');
  assert.ok(FakeSource.all.slice(0, -1).every(s => s.closed), 'old sources closed');
});

test('a silent stream (dead connection) is reopened; pings keep it alive', () => {
  start();
  latest().open();
  for (let i = 0; i < 6; i += 1) { mock.timers.tick(15_000); latest().emit('ping', {}); }
  assert.equal(FakeSource.all.length, 1, 'pings keep the stream');
  mock.timers.tick(45_000);
  assert.equal(FakeSource.all.length, 2, 'reopened after staleMs without any event');
  assert.equal(statuses.at(-1), 'lost');
  assert.ok(FakeSource.all[0].closed);
  FakeSource.all[0].emit('topic', { topic: 'old' });
  assert.deepEqual(topics, [], 'events of a replaced source are ignored');
});

test('reconnect() reopens now; close() stops everything', () => {
  start();
  latest().open();
  stream.reconnect();
  assert.equal(FakeSource.all.length, 2);
  stream.close();
  assert.ok(latest().closed);
  mock.timers.tick(120_000);
  assert.equal(FakeSource.all.length, 2, 'no reopen after close');
});
