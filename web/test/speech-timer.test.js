import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remainingSpeechMs } from '../js/speech-timer.js';
import { formatDuration } from '../js/dom.js';

const entry = { microphoneState: 'on', remainingSpeechDuration: 300_000, speechStartTime: 10_000, showSpeechTimer: true };

test('counts down while the microphone is on (PDF p.68 formula)', () => {
  // server tick 70 s at reception, mic started at 10 s → 60 s used; 5 s later locally → 65 s used.
  assert.equal(remainingSpeechMs(entry, 70_000, 1_000_000, 1_005_000), 235_000);
});

test('frozen when muted or off', () => {
  assert.equal(remainingSpeechMs({ ...entry, microphoneState: 'mute' }, 70_000, 0, 999_999), 300_000);
});

test('overtime is negative and formatted with a minus', () => {
  const ms = remainingSpeechMs(entry, 400_000, 0, 0);
  assert.equal(ms, -90_000);
  assert.equal(formatDuration(ms), '-01:30');
  assert.equal(formatDuration(235_000), '03:55');
});

test('hidden when showSpeechTimer is false or duration missing', () => {
  assert.equal(remainingSpeechMs({ ...entry, showSpeechTimer: false }, 0, 0), null);
  assert.equal(remainingSpeechMs({ ...entry, remainingSpeechDuration: undefined }, 0, 0), null);
});
