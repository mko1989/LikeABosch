import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { AtemSwitcher } from '../src/devices/switchers/atem.js';
import { MockSwitcher, createSwitcher } from '../src/devices/switchers/index.js';

/** Stub with the atem-connection surface the driver uses. */
class StubAtem extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.state = { info: { productIdentifier: 'ATEM Mini Pro' }, video: { mixEffects: [{ programInput: 1, previewInput: 2 }] }, inputs: { 1: { inputId: 1, longName: 'Camera 1', shortName: 'CAM1' }, 2: { inputId: 2, longName: 'Camera 2', shortName: 'CAM2' } } };
  }
  async connect(host, port) { this.calls.push(['connect', host, port]); setTimeout(() => this.emit('connected'), 5); }
  async changeProgramInput(input, me) {
    this.calls.push(['changeProgramInput', input, me]);
    this.state.video.mixEffects[me].programInput = input;
    this.emit('stateChanged', this.state, [`video.mixEffects.${me}.programInput`]);
  }
  async changePreviewInput(input, me) {
    this.calls.push(['changePreviewInput', input, me]);
    this.state.video.mixEffects[me].previewInput = input;
    this.emit('stateChanged', this.state, [`video.mixEffects.${me}.previewInput`]);
  }
  async destroy() { this.calls.push(['destroy']); }
}

test('ATEM driver: connect, status, program cut on the configured M/E, program events', async () => {
  const sw = new AtemSwitcher({ host: '10.0.0.5', me: 0, AtemClass: StubAtem });
  const programs = [];
  sw.on('program', p => programs.push(p.input));
  await sw.connect();
  assert.equal(sw.status().connected, true);
  assert.equal(sw.status().model, 'ATEM Mini Pro');
  assert.deepEqual(sw.state().inputs.map(i => i.short), ['CAM1', 'CAM2']);
  await sw.programCut(2);
  assert.deepEqual(sw.atem.calls.find(c => c[0] === 'changeProgramInput'), ['changeProgramInput', 2, 0]);
  assert.equal(sw.state().program, 2);
  assert.deepEqual(programs, [1, 2]);
  await sw.previewInput(1); // WO-053
  assert.deepEqual(sw.atem.calls.find(c => c[0] === 'changePreviewInput'), ['changePreviewInput', 1, 0]);
  assert.equal(sw.status().preview, 1);
  await assert.rejects(sw.previewInput(-1), { code: 'VALIDATION' });
  await assert.rejects(sw.programCut('x'), { code: 'VALIDATION' });
  await sw.close();
  await assert.rejects(sw.programCut(1), { code: 'NOT_CONNECTED' });
});

test('ATEM driver: connect timeout → NOT_CONNECTED', async () => {
  class Silent extends StubAtem { async connect() { /* never connects */ } }
  const sw = new AtemSwitcher({ host: '10.0.0.6', AtemClass: Silent, connectTimeoutMs: 50 });
  await assert.rejects(sw.connect(), { code: 'NOT_CONNECTED' });
  await sw.close();
});

test('mock switcher behaves like a driver', async () => {
  const sw = createSwitcher({ driver: 'mock' });
  assert.ok(sw instanceof MockSwitcher);
  await sw.connect();
  await sw.programCut(5);
  assert.equal(sw.state().program, 5);
  assert.deepEqual(sw.cuts, [5]);
  await sw.previewInput(3);
  assert.equal(sw.state().preview, 3);
});

test('the real atem-connection module loads', async () => {
  const { Atem } = await import('atem-connection');
  assert.equal(typeof Atem.prototype.changeProgramInput, 'function');
  assert.equal(typeof Atem.prototype.changePreviewInput, 'function');
});
