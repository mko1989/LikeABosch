// Kramer MV-6 and tvONE CORIO drivers against their TCP mocks (WO-112, DEC-033).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { KramerSwitcher, parseP3000 } from '../src/devices/switchers/kramer.js';
import { TvOneSwitcher, corioInputs, DEFAULT_CORIO_INPUTS } from '../src/devices/switchers/tvone.js';
import { createSwitcher } from '../src/devices/switchers/index.js';
import { DeviceManager } from '../src/devices/manager.js';
import { StateCache } from '../src/state/cache.js';
import { createMockKramerMv6 } from '../../mock/switchers/kramer-mv6.js';
import { createMockTvOneCorio } from '../../mock/switchers/tvone-corio.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error('condition not reached'); await new Promise(r => setTimeout(r, 10)); }
};

test('Protocol 3000 reply parser', () => {
  assert.deepEqual(parseP3000('~01@SRC-VID 1,3'), { cmd: 'SRC-VID', params: ['1', '3'], error: false });
  assert.deepEqual(parseP3000('~01@SRC-VID 1,3 OK'), { cmd: 'SRC-VID', params: ['1', '3'], error: false });
  assert.equal(parseP3000('~01@SRC-VID ERR 003').error, true);
  assert.equal(parseP3000('~01@ERR 002').error, true);
  assert.equal(parseP3000('~01@ OK').error, false);
  assert.equal(parseP3000('garbage'), null);
});

test('Kramer MV-6: handshake, layout preset, current input, cut, front-panel follow, errors', async () => {
  const mock = await createMockKramerMv6();
  mock.state.windows[0] = 2;
  const sw = createSwitcher({ driver: 'kramer-mv6', host: '127.0.0.1', port: mock.port, layoutPreset: 3 });
  assert.ok(sw instanceof KramerSwitcher);
  const programs = [];
  sw.on('program', p => programs.push(p.input));
  try {
    await sw.connect();
    assert.deepEqual(mock.state.received.slice(0, 4), ['#', '#MODEL?', '#PRST-RCL 3', '#SRC-VID? 1']);
    assert.equal(mock.state.preset, 3);
    const st = sw.status();
    assert.equal(st.connected, true);
    assert.equal(st.driver, 'kramer-mv6');
    assert.equal(st.model, 'MV-6');
    assert.equal(st.program, 2);
    assert.equal(st.preview, null);
    assert.equal(st.inputs.length, 6);

    await sw.programCut(5);
    assert.equal(mock.state.windows[0], 5);
    assert.equal(sw.status().program, 5);
    mock.frontPanel(1, 4); // someone presses a button on the MV-6
    await until(() => sw.status().program === 4);
    mock.frontPanel(2, 6); // another window: not the program
    await new Promise(r => setTimeout(r, 30));
    assert.equal(sw.status().program, 4);
    assert.deepEqual(programs, [2, 5, 4]);

    await assert.rejects(sw.programCut(7), { code: 'VALIDATION' });
    await assert.rejects(sw.previewInput(1), { code: 'NOT_SUPPORTED' });
  } finally { await sw.close(); await mock.close(); }
});

test('Kramer MV-6: an error reply rejects; reconnects after the device drops the connection', async () => {
  const mock = await createMockKramerMv6({ windows: 1 });
  const sw = new KramerSwitcher({ host: '127.0.0.1', port: mock.port, window: 2, retryMs: 50 });
  try {
    await assert.rejects(sw.connect(), { code: 'UPSTREAM_ERROR' }); // window 2 does not exist: "SRC-VID ERR 003"
    assert.equal(sw.connected, false);
    sw.options.window = 1;
    await sw.connect();
    mock.dropClients();
    await until(() => !sw.connected);
    await until(() => sw.connected, 3000);
    await sw.programCut(3);
    assert.equal(mock.state.windows[0], 3);
  } finally { await sw.close(); await mock.close(); }
});

test('Kramer MV-6: nothing listening → NOT_CONNECTED', async () => {
  const mock = await createMockKramerMv6();
  const port = mock.port;
  await mock.close();
  await assert.rejects(new KramerSwitcher({ host: '127.0.0.1', port }).connect(), { code: 'NOT_CONNECTED' });
});

test('tvONE inputs list', () => {
  assert.deepEqual(corioInputs('Slot3.In1, Slot3.In2'), ['Slot3.In1', 'Slot3.In2']);
  assert.deepEqual(corioInputs(''), DEFAULT_CORIO_INPUTS);
  assert.deepEqual(corioInputs('bad name,Slot1.In2'), ['Slot1.In2']);
});

test('tvONE CORIO: login, read, cut by input name, preview window, follow outside changes, errors', async () => {
  const mock = await createMockTvOneCorio();
  const sw = createSwitcher({ driver: 'tvone-corio', host: '127.0.0.1', port: mock.port, inputs: 'Slot1.In1,Slot1.In2,Slot2.In1', previewWindow: 'Window2', pollMs: 30 });
  assert.ok(sw instanceof TvOneSwitcher);
  const programs = [];
  sw.on('program', p => programs.push(p.input));
  try {
    await sw.connect();
    assert.equal(mock.state.received[0], 'login(admin,adminpw)');
    let st = sw.status();
    assert.equal(st.connected, true);
    assert.equal(st.model, 'CORIOmatrix (mock)');
    assert.equal(st.window, 'Window1');
    assert.equal(st.program, 1); // Window1 = Slot1.In1 = input 1
    assert.equal(st.preview, 2); // Window2 = Slot1.In2
    assert.deepEqual(st.inputs.map(i => i.name), ['Slot1.In1', 'Slot1.In2', 'Slot2.In1']);

    await sw.programCut(3);
    assert.equal(mock.state.windows.Window1, 'Slot2.In1');
    assert.ok(mock.state.received.includes('Window1.Input = Slot2.In1'));
    await sw.previewInput(1);
    assert.equal(mock.state.windows.Window2, 'Slot1.In1');

    mock.setWindow('Window1', 'Slot1.In2'); // changed in CORIOgrapher
    await until(() => sw.status().program === 2);
    mock.setWindow('Window1', 'Slot2.In4'); // an input that is not in our list
    await until(() => sw.status().program === null);
    st = sw.status();
    assert.equal(st.programName, 'Slot2.In4');
    assert.deepEqual(programs, [1, 3, 2]);

    await assert.rejects(sw.programCut(4), { code: 'VALIDATION' });
  } finally { await sw.close(); await mock.close(); }
});

test('tvONE CORIO: wrong password → the read fails → connect rejects; without previewWindow no preview', async () => {
  const mock = await createMockTvOneCorio();
  try {
    await assert.rejects(new TvOneSwitcher({ host: '127.0.0.1', port: mock.port, password: 'nope' }).connect(), { code: 'UPSTREAM_ERROR' });
    const sw = new TvOneSwitcher({ host: '127.0.0.1', port: mock.port, window: 2, pollMs: 0 });
    await sw.connect();
    assert.equal(sw.status().window, 'Window2');
    await assert.rejects(sw.previewInput(1), { code: 'NOT_SUPPORTED' });
    await sw.close();
  } finally { await mock.close(); }
});

test('tvONE CORIO without security: the login error is ignored when commands work', async () => {
  const mock = await createMockTvOneCorio({ requireLogin: false, password: 'other' });
  const sw = new TvOneSwitcher({ host: '127.0.0.1', port: mock.port, pollMs: 0 });
  try {
    await sw.connect();
    assert.equal(sw.connected, true);
    assert.equal(sw.status().lastError, null);
  } finally { await sw.close(); await mock.close(); }
});

test('device manager: tvONE password stored but never published; changing the type drops the old fields', async () => {
  const mock = await createMockTvOneCorio({ password: 'secret' });
  const dataDir = mkdtempSync(join(tmpdir(), 'sw-'));
  const cache = new StateCache();
  const devices = new DeviceManager({ dataDir, cache, log: { info() {}, warn() {}, debug() {}, child() { return this; } }, retryMs: 50 });
  try {
    await devices.load?.();
    const pub = await devices.setSwitcher({ driver: 'tvone-corio', host: '127.0.0.1', port: mock.port, username: 'admin', password: 'secret', inputs: 'Slot1.In1,Slot2.In1' });
    assert.equal(pub.password, undefined);
    assert.equal(pub.passwordSet, true);
    assert.equal(pub.status.connected, true);
    assert.equal(cache.get('devices.switcher').data.switcher.password, undefined);
    assert.match(readFileSync(join(dataDir, 'devices.json'), 'utf8'), /"password": "secret"/);
    await devices.cut(2);
    assert.equal(mock.state.windows.Window1, 'Slot2.In1');
    // update without the password keeps it
    await devices.updateSwitcher({ inputs: 'Slot1.In1,Slot1.In2' });
    assert.equal(devices.switcher.config.password, 'secret');
    // switch type: tvONE fields go
    await devices.setSwitcher({ driver: 'mock' });
    assert.equal(devices.switcher.config.inputs, undefined);
    assert.equal(devices.switcher.config.password, undefined);
    await assert.rejects(devices.setSwitcher({ driver: 'kramer-mv6', host: 'x', layoutPreset: 9 }), { code: 'VALIDATION' });
  } finally {
    await devices.close?.();
    await mock.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('mocks answer on their default protocol shapes', async () => {
  const k = await createMockKramerMv6();
  const t = await createMockTvOneCorio();
  try {
    const net = await import('node:net');
    const talk = (port, lines) => new Promise(resolve => {
      const s = net.connect({ port, host: '127.0.0.1' });
      let out = '';
      s.on('data', d => { out += d; });
      s.on('connect', () => { for (const l of lines) s.write(`${l}\r\n`); setTimeout(() => { s.destroy(); resolve(out); }, 80); });
    });
    assert.match(await talk(k.port, ['#', '#SRC-VID? 1']), /~01@ OK\r\n~01@SRC-VID 1,1\r\n/);
    assert.match(await talk(t.port, ['Window1.Input']), /!Error/); // not logged in
    assert.match(await talk(t.port, ['login(admin,adminpw)', 'Window1.Input']), /!Info : User admin Logged In\r\nWindow1.Input = Slot1.In1\r\n!Done Window1.Input/);
  } finally { await k.close(); await t.close(); }
  void once;
});
