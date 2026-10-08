// WO-076 / DEC-024: the WAP web UI's undocumented endpoints through the passthrough, poller topics, upload route.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createMockWirelessServer } from '../../mock/wireless/server.js';
import { startBackend } from './helpers/start.js';

describe('undocumented WAP endpoints (wireless mock)', () => {
  let mock;
  let backend;
  const api = async (method, path, body) => {
    const res = await fetch(`${backend.url}/api${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const topic = name => backend.services.cache.get(name)?.data;
  /** Writes refresh the topics in the background: wait for the expected value. */
  const until = async (fn, ms = 3000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 25))) if (fn()) return true;
    return fn();
  };
  before(async () => {
    mock = await createMockWirelessServer({ longPollMs: 500 });
    backend = await startBackend({
      DICENTIS_SYSTEM: 'wireless', DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(mock.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin', DICENTIS_AUTOCONNECT: 'true',
    });
    if (backend.services.manager.client?.state !== 'loggedIn') await once(backend.services.manager.client, 'loggedIn');
    await backend.services.poller.idle();
  });
  after(async () => { await backend.close(); await mock.close(); });

  test('topics fill on login; ops list marks them undocumented; capability wapConfig', async () => {
    for (const t of ['wirelessDiscuss', 'wirelessAudio', 'wirelessMasterVolume', 'wirelessEqualizer', 'wirelessSeatsStatus', 'wirelessRangeTest', 'wirelessSystemSettings', 'wirelessUpgrades']) {
      assert.ok(topic(t) !== undefined, t);
    }
    const ops = (await api('GET', '/wireless/ops')).body.data;
    assert.equal(ops.find(o => o.id === 'PUT /discuss').undocumented, true);
    assert.equal(ops.find(o => o.id === 'GET /seats').undocumented, false);
    assert.ok(!ops.some(o => /cameras|network|users|licensing|resettofactory/.test(o.path)), 'secret / destructive endpoints are not exposed');
    assert.equal(topic('domain.capabilities').features.wapConfig, true);
    assert.equal((await api('GET', '/wireless/cameras')).status, 404);
  });

  test('writes go through and the topics follow (discuss, audio, master, EQ, seat, modes, settings)', async () => {
    assert.equal((await api('PUT', '/wireless/discuss', { ...topic('wirelessDiscuss'), maxOpenMics: 2 })).status, 200);
    assert.ok(await until(() => topic('wirelessDiscuss').maxOpenMics === 2));
    assert.equal((await api('PUT', '/wireless/audio', { lsp: 5 })).status, 200);
    assert.ok(await until(() => topic('wirelessAudio').lsp === 5));
    await api('PUT', '/wireless/audio/master', { master: 20 });
    assert.ok(await until(() => topic('wirelessMasterVolume').master === 20));
    assert.equal((await api('PUT', '/wireless/audio/master', {})).status, 400, 'body validated against undocumented.json');
    await api('PUT', '/wireless/audio/equalizer/delegate-loudspeaker', [{ id: 2, gain: -3 }]);
    assert.ok(await until(() => topic('wirelessEqualizer').find(b => b.id === 2).gain === -3));
    await api('PUT', '/wireless/seats/3', { id: 3, name: 'Mayor', prio: true });
    assert.ok(await until(() => topic('wirelessSeats').find(s => s.id === 3).name === 'Mayor'));
    await api('PUT', '/wireless/seats/3/selected', { selected: true });
    assert.ok(await until(() => topic('wirelessSeats').find(s => s.id === 3).selected === true));
    await api('PUT', '/wireless/seats/status', { isConfigurationModeOn: true });
    assert.ok(await until(() => topic('wirelessSeatsStatus').isConfigurationModeOn === true));
    await api('PUT', '/wireless/system/settings', { showCompanyLogo: true });
    assert.ok(await until(() => topic('wirelessSystemSettings').showCompanyLogo === true));
  });

  test('seat display image upload → multipart "firmware" on the WAP, then upgrade progress', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const res = await fetch(`${backend.url}/api/wireless/upgrades/file?name=logo.png`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
    assert.equal(res.status, 200, await res.clone().text());
    assert.deepEqual(mock.state.upload, { field: 'firmware', filename: 'logo.png', size: png.length, type: 'DCNM-WDE' });
    const wde = topic('wirelessUpgrades').find(d => d.deviceType === 'DCNM-WDE');
    assert.equal((await api('POST', '/wireless/upgrades', [wde.deviceID])).status, 200);
    assert.ok(await until(() => topic('wirelessUpgrades').find(d => d.deviceType === 'DCNM-WDE').state === 6, 12_000), 'done (interval poll)');
    assert.equal((await fetch(`${backend.url}/api/wireless/upgrades/file`, { method: 'POST', body: png })).status, 400, 'name required');
  });

  test('de-init and remove disconnected seats', async () => {
    const before = topic('wirelessSeats').length;
    await api('PUT', '/wireless/seats/deinit', { deinit: true });
    assert.ok(await until(() => topic('wirelessSeats').every(s => !s.connected)));
    await api('PUT', '/wireless/seats/remove', { remove: true });
    assert.ok(await until(() => topic('wirelessSeats').length === 0));
    assert.ok(before > 0);
  });
});
