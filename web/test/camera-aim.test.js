import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraColors, CAMERA_COLORS, normalize, bearing, relativeAim, turnTo, aimedSeat } from '../js/camera-aim.js';

test('normalize keeps angles in (-180, 180]', () => {
  assert.equal(normalize(0), 0);
  assert.equal(normalize(180), 180);
  assert.equal(normalize(-180), 180);
  assert.equal(normalize(270), -90);
  assert.equal(normalize(-450), -90);
  assert.equal(normalize(725), 5);
});

test('bearing: 0 = +x, 90 = down the screen', () => {
  assert.equal(bearing({ x: 0, y: 0 }, { x: 10, y: 0 }), 0);
  assert.equal(bearing({ x: 0, y: 0 }, { x: 0, y: 10 }), 90);
  assert.equal(Math.abs(bearing({ x: 0, y: 0 }, { x: -10, y: 0 })), 180);
});

test('relativeAim subtracts the placed rotation', () => {
  assert.equal(relativeAim({ x: 0, y: 0, rotation: 90 }, { x: 0, y: 100 }), 0);
  assert.equal(relativeAim({ x: 0, y: 0, rotation: 90 }, { x: 100, y: 0 }), -90);
  assert.equal(relativeAim({ x: 0, y: 0, rotation: 350 }, { x: 100, y: 0 }), 10);
  assert.equal(relativeAim({ x: 0, y: 0 }, null), 0);
  assert.equal(relativeAim({ x: 5, y: 5 }, { x: 5, y: 5 }), 0);
});

test('turnTo takes the short way round', () => {
  assert.equal(turnTo(170, -170), 190);
  assert.equal(turnTo(-170, 170), -190);
  assert.equal(turnTo(10, 30), 30);
  assert.equal(turnTo(370, 0), 360);
});

test('cameraColors are stable by list position and wrap', () => {
  const cams = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}` }));
  const m = cameraColors(cams);
  assert.equal(m.get('c0'), CAMERA_COLORS[0]);
  assert.equal(m.get('c8'), CAMERA_COLORS[0]);
  assert.equal(cameraColors(cams.slice(0, 3)).get('c2'), m.get('c2'));
});

test('aimedSeat matches camera + preset (numbers and strings), prefers the director target', () => {
  const shots = { a: { cameraId: 'cam1', preset: 3 }, b: { cameraId: 'cam1', preset: '3' }, c: { cameraId: 'cam2', preset: 3 } };
  assert.equal(aimedSeat({ id: 'cam1', currentPreset: { preset: '3' } }, shots), 'a');
  assert.equal(aimedSeat({ id: 'cam1', currentPreset: { preset: 3 } }, shots, 'b'), 'b');
  assert.equal(aimedSeat({ id: 'cam1', currentPreset: { preset: 3 } }, shots, 'c'), 'a');
  assert.equal(aimedSeat({ id: 'cam2', currentPreset: { preset: 4 } }, shots), null);
  assert.equal(aimedSeat({ id: 'cam2', currentPreset: null }, shots), null);
});
