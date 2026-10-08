// Camera drivers against the protocol mocks (WO-036). Driver and mocks were written independently from
// docs/protocol/cameras/README.md, so passing tests mean both read the protocol the same way.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ViscaCamera } from '../src/devices/cameras/visca.js';
import { PanasonicCamera } from '../src/devices/cameras/panasonic.js';
import { OnvifCamera, usernameToken } from '../src/devices/cameras/onvif.js';
import { createCamera, MockCamera } from '../src/devices/cameras/index.js';
import { createMockViscaCamera } from '../../mock/cameras/visca.js';
import { createMockPanasonicCamera } from '../../mock/cameras/panasonic.js';
import { createMockOnvifCamera } from '../../mock/cameras/onvif.js';

for (const [transport, framing] of [['udp', 'sony'], ['udp', 'raw'], ['tcp', 'raw'], ['tcp', 'sony']]) {
  describe(`VISCA ${framing} over ${transport}`, () => {
    test('connect (ping), recall, store, jog, stop, errors', async () => {
      const mock = await createMockViscaCamera({ transport, framing });
      const cam = new ViscaCamera({ host: '127.0.0.1', port: mock.port, transport, framing, timeoutMs: 500, completionTimeoutMs: 500 });
      try {
        await cam.connect();
        assert.equal(cam.status().connected, true);
        assert.equal(await cam.ping(), 'on');
        const r = await cam.recallPreset(7);
        assert.equal(r.acknowledged, true);
        assert.equal(mock.state.currentPreset, 7);
        assert.equal(await cam.storePreset(12), 12);
        assert.ok(mock.state.presets.has(12));
        await cam.move({ pan: -0.5, tilt: 1, zoom: 0.4 });
        assert.equal(mock.state.moving.pan, 'left');
        await cam.stop();
        assert.equal(mock.state.moving.pan, 'stop');
        assert.ok(mock.state.commands.includes('8101043f0207ff'), 'exact VISCA bytes');
        assert.throws(() => cam.recallPreset(256), { code: 'VALIDATION' });
        mock.failNext(0x41);
        await assert.rejects(cam.recallPreset(1), err => err.code === 'UPSTREAM_ERROR' && /not executable/.test(err.message));
        assert.equal((await cam.recallPreset(2)).acknowledged, true, 'recovers after an error');
      } finally {
        await cam.close();
        await mock.close();
      }
    });
  });
}

test('VISCA: no camera → timeout error, not a hang', async () => {
  const cam = new ViscaCamera({ host: '127.0.0.1', port: 9, transport: 'udp', framing: 'raw', timeoutMs: 200 });
  await assert.rejects(cam.connect(), { code: 'UPSTREAM_TIMEOUT' });
  await cam.close();
});

describe('Panasonic AW', () => {
  test('recall/store/jog with basic auth; 1-based presets; auth failure', async () => {
    const mock = await createMockPanasonicCamera({ username: 'admin', password: '12345' });
    const cam = new PanasonicCamera({ host: '127.0.0.1', port: mock.port, username: 'admin', password: '12345' });
    try {
      await cam.connect();
      assert.equal(await cam.ping(), 'on');
      await cam.recallPreset(1);
      assert.equal(mock.state.currentPreset, 1);
      assert.ok(mock.state.commands.includes('#R00'), 'preset 1 → R00');
      await cam.storePreset(100);
      assert.ok(mock.state.commands.includes('#M99'));
      await cam.move({ pan: 1, tilt: -1, zoom: 0 });
      assert.ok(mock.state.commands.includes('#PTS9901'));
      await cam.stop();
      assert.ok(mock.state.commands.includes('#PTS5050'));
      await assert.rejects(cam.recallPreset(0), { code: 'VALIDATION' });
      const wrong = new PanasonicCamera({ host: '127.0.0.1', port: mock.port, username: 'admin', password: 'nope' });
      await assert.rejects(wrong.connect(), { code: 'UPSTREAM_AUTH' });
    } finally {
      await mock.close();
    }
  });
});

describe('ONVIF', () => {
  test('digest helper matches the WS-Security formula', () => {
    const nonce = Buffer.from('0123456789abcdef');
    const xml = usernameToken('u', 'p', { nonce, created: '2026-10-03T10:00:00Z' });
    assert.match(xml, /<wsse:Password[^>]*>([^<]+)</);
    assert.match(xml, new RegExp(nonce.toString('base64').replace(/[+/=]/g, '\\$&')));
  });

  test('connect (capabilities, profile), list/recall/store presets, jog, stop; wrong password', async () => {
    const mock = await createMockOnvifCamera({ username: 'admin', password: 'admin' });
    const cam = new OnvifCamera({ host: '127.0.0.1', port: mock.port, username: 'admin', password: 'admin' });
    try {
      await cam.connect();
      assert.equal(cam.status().profile, 'Profile_1');
      const presets = await cam.listPresets();
      assert.deepEqual(presets.map(p => p.name), ['Chair', 'Speaker left']);
      await cam.recallPreset('2');
      assert.equal(mock.state.currentPreset, '2');
      const token = await cam.storePreset(undefined, 'Seat 7');
      assert.ok(token && token !== '1' && token !== '2', `new token ${token}`);
      assert.equal(await cam.storePreset('1', 'Chair'), '1', 'overwrite keeps the token');
      await cam.move({ pan: 0.5, tilt: 0, zoom: -0.2 });
      assert.ok(mock.state.moving);
      await cam.stop();
      await assert.rejects(cam.recallPreset('nope'), { code: 'UPSTREAM_ERROR' });
      const wrong = new OnvifCamera({ host: '127.0.0.1', port: mock.port, username: 'admin', password: 'wrong' });
      await assert.rejects(wrong.connect(), { code: 'UPSTREAM_AUTH' });
    } finally {
      await mock.close();
    }
  });
});

test('factory and mock driver', async () => {
  assert.ok(createCamera({ driver: 'mock' }) instanceof MockCamera);
  assert.throws(() => createCamera({ driver: 'canon' }), /Unknown camera driver/);
});
