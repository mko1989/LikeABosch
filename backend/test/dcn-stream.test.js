// DCN bridge + meeting data stream at the same time (WO-073, DEC-020).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBackend } from './helpers/start.js';
import { createMockDcnBridge } from '../../mock/dcn/server.js';
import { createMockSmdServer } from '../../mock/dcn-smd/server.js';
import { dcn } from '../src/domain/mappers.js';

let bridge;
let smd;
before(async () => {
  bridge = await createMockDcnBridge();
  smd = await createMockSmdServer({ seats: 6 });
});
after(async () => { await bridge.close(); await smd.close(); });

const env = extra => ({
  DICENTIS_SYSTEM: 'dcn', DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(bridge.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin',
  DICENTIS_SMD_PORT: String(smd.port), ...extra,
});
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise(r => setTimeout(r, 20));
  }
};

test('dcn: bridge and stream connect together; smd* next to dcn* topics; disconnect closes both', async () => {
  const backend = await startBackend(env());
  try {
    const { manager, cache, dcnEvents } = backend.services;
    await manager.connect();
    await dcnEvents.idle();
    await until(() => manager.status().stream?.state === 'loggedIn' && cache.get('smdInterpretation'));
    const status = manager.status();
    assert.equal(status.state, 'loggedIn');
    assert.deepEqual({ host: status.stream.host, port: status.stream.port }, { host: '127.0.0.1', port: smd.port }); // smdHost '' = bridge host
    assert.ok(cache.get('dcnMicStatus'));
    smd.interpretation(true);
    await until(() => cache.get('domain.interpreterDesks')?.data.some(d => d.live));
    const [desk] = cache.get('domain.interpreterDesks').data;
    assert.deepEqual({ id: desk.id, booth: desk.booth, desk: desk.desk, seatName: desk.seatName, output: desk.output, source: desk.source?.abbreviation },
      { id: 'desk-1-1', booth: 1, desk: 1, seatName: '1:1', output: { output: 'A', language: 'Dutch', abbreviation: 'NLD', channel: 2 }, source: 'FLR' });
    assert.ok(!cache.get('domain.seats').data.some(x => x.id === desk.seatId)); // a desk is not a delegate seat

    await manager.disconnect();
    assert.equal(manager.streamClient, null);
    await until(() => smd.clientCount === 0);
    assert.equal(cache.get('smdInterpretation'), null);
  } finally {
    await backend.close();
  }
});

test('dcn: a stream that cannot connect does not affect the bridge; smdStream false opens no stream', async () => {
  const closed = await createMockSmdServer();
  const deadPort = closed.port;
  await closed.close();
  const backend = await startBackend(env({ DICENTIS_SMD_PORT: String(deadPort) }));
  try {
    const { manager } = backend.services;
    await manager.connect();
    assert.equal(manager.status().state, 'loggedIn');
    await until(() => manager.status().stream?.lastError);
    assert.notEqual(manager.status().stream.state, 'loggedIn');
    assert.equal(manager.status().state, 'loggedIn');
  } finally {
    await backend.close();
  }
  const off = await startBackend(env({ DICENTIS_SMD_STREAM: 'false' }));
  try {
    await off.services.manager.connect();
    assert.equal(off.services.manager.status().stream, null);
  } finally {
    await off.close();
  }
});

test('dcn-smd as the main system has no extra stream', async () => {
  const backend = await startBackend({ DICENTIS_SYSTEM: 'dcn-smd', DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(smd.port) });
  try {
    const { manager } = backend.services;
    await manager.connect();
    assert.equal(manager.status().state, 'loggedIn');
    assert.equal(manager.status().stream, null);
  } finally {
    await backend.close();
  }
});

test('dcn mapper: seats that the stream reports as interpreter desks are not delegate seats (WO-074)', () => {
  const topics = {
    dcnMicStatus: [{ SeatId: 1 }, { SeatId: 2 }, { SeatId: 50 }],
    smdInterpretation: { desks: [{ number: 1, boothNumber: 1, seatId: 50, translating: false, destination: null, source: null }], booths: [{ number: 1, inUse: false }] },
  };
  const get = t => topics[t];
  assert.deepEqual(dcn.seats(get).map(x => x.id), ['1', '2']);
  assert.deepEqual(dcn.interpreterDesks(get).map(d => [d.id, d.seatId, d.live, d.output, d.boothInUse]), [['desk-1-1', '50', false, null, false]]);
  assert.equal(dcn.interpreterDesks(() => undefined), undefined);
});
