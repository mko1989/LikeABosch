#!/usr/bin/env node
// UI check (WO-018): starts the wired mock + backend, opens the web UI in headless Electron, visits views,
// saves screenshots (light + dark), fails on console errors or if a live update doesn't arrive.
// Usage: node scripts/ui-check.mjs [outDir] [route...]   (requires `npm install` in launcher/ for Electron)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createLinkedDcnmBridge } from '../mock/dcnm/wired-link.js';
import { createMockWiredServer } from '../mock/wired/server.js';
import { createMockCompanion } from '../mock/companion/server.js';
import { createMockWirelessServer } from '../mock/wireless/server.js';
import { createMockDcnBridge } from '../mock/dcn/server.js';
import { createMockSmdServer } from '../mock/dcn-smd/server.js';
import { start } from '../backend/src/server.js';
import { loadConfig } from '../backend/src/config.js';

// Never hang silently (e.g. a stuck event bridge): hard limit for the whole check.
setTimeout(() => { console.log('UI CHECK FAILED: timed out after 5 minutes'); process.exit(1); }, 300_000).unref();

const root = fileURLToPath(new URL('..', import.meta.url));
const electron = createRequire(join(root, 'launcher/package.json'))('electron');
// Options: --system wired|wireless|dcn|both|all (default all; both = wired + wireless), anywhere. Positional: outDir, routes.
const sysArg = process.argv.indexOf('--system');
const args = process.argv.slice(2).filter((a, i, arr) => a !== '--system' && arr[i - 1] !== '--system');
const outDir = args[0] ?? join(root, 'data/ui-check');
const SYSTEM_SETS = { both: ['wired', 'wireless'], all: ['wired', 'wireless', 'dcn', 'dcn-smd'] };
const systems = sysArg > -1 ? SYSTEM_SETS[process.argv[sysArg + 1]] ?? [process.argv[sysArg + 1]] : SYSTEM_SETS.all;
const positional = args.slice(1);
const routes = positional.length ? positional : ['overview', 'discussion', 'meetings', 'agenda', 'voting', 'participants', 'seating', 'interpretation', 'audio', 'system', 'files', 'room', 'companion', 'connection'];
const WIRELESS_ROUTES = ['overview', 'discussion', 'voting', 'participants', 'seating', 'system', 'room', 'discussion-settings', 'wap-audio', 'wap-seats', 'seat-displays', 'connection'];
const DCN_ROUTES = ['overview', 'discussion', 'voting', 'participants', 'seating', 'system', 'dcn', 'room', 'connection'];
const SMD_ROUTES = ['overview', 'discussion', 'voting', 'participants', 'seating', 'system', 'dcn-stream', 'room', 'connection'];
mkdirSync(outDir, { recursive: true });

const mock = await createMockWiredServer();
// WO-101: the full DICENTIS API next to it (linked mock dicentis-bridge), as in a simulated wired system
const dcnmMock = await createLinkedDcnmBridge(mock);
// WO-099: a mock Companion for the Companion scenario (button labels show up in the picker's frame)
const companionMock = await createMockCompanion({ labels: { '1/0/0': 'Cam 1', '1/0/1': 'Cam 2', '1/0/2': 'Seat 3 live', '1/1/0': 'Lights' } });
const dataDir = mkdtempSync(join(tmpdir(), 'ui-check-'));
const backend = await start(loadConfig({
  PORT: '0', LOG_LEVEL: process.env.UI_CHECK_DEBUG ? 'debug' : 'silent', DATA_DIR: dataDir,
  DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(mock.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin',
  DICENTIS_DCNM_BRIDGE: 'true', DICENTIS_DCNM_HOST: '127.0.0.1', DICENTIS_DCNM_PORT: String(dcnmMock.port), DICENTIS_DCNM_DEVICE: 'LikeABosch',
}));
if (backend.services.manager.client?.state !== 'loggedIn') await once(backend.services.manager.client, 'loggedIn');
await backend.services.bridge.idle();

let failed = false;

// While a voting is open on the mock, cast a fixed set of votes (the UI can't vote: delegates do).
const voter = setInterval(() => {
  const v = mock.state.votings.find(x => x.votingId === mock.state.activeVotingId);
  if (v?.state === 'opened' && mock.state.votes.size === 0) {
    [['seat-1', 'yes'], ['seat-2', 'yes'], ['seat-3', 'no'], ['seat-4', 'abstain'], ['seat-5', 'yes']].forEach(([seat, answer]) => mock.castVote(seat, answer));
  }
}, 200);

/** Run one headless Electron pass; resolves to true if it passed. */
async function runElectron(theme, passRoutes, system = 'wired', target = { backend, mock }) {
  const env = { ...process.env, UI_CHECK_COMPANION_PORT: process.env.UI_CHECK_COMPANION_PORT ?? String(companionMock.port) }; // a real Companion: set it
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [join(root, 'scripts/ui-check-electron.cjs'), target.backend.url, outDir, theme, system, ...passRoutes], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '';
  child.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'mock') target.mock[msg.fn](...(msg.args ?? [])); // scenario asks for a server-side change
        const tag = `${system}/${theme}`;
        if (msg.type === 'console') console.log(`  [${tag}] console ${msg.level}: ${msg.message}`);
        if (msg.type === 'route') console.log(`  [${tag}] ${msg.route}: ${msg.file}`);
        if (msg.type === 'live') console.log(`  [${tag}] live update: ${msg.ok ? 'ok' : 'FAILED'}`);
        if (msg.type === 'scenario') console.log(`  [${tag}] scenario ${msg.name}: ${msg.ok ? 'ok' : 'FAILED'}`);
        if (msg.type === 'buttons') console.log(`  [${tag}] disconnect/connect buttons: ${msg.ok ? 'ok' : 'FAILED'}`);
        if (msg.type === 'done' && msg.error) console.log(`  [${tag}] error: ${msg.error}`);
      } catch { /* non-JSON noise */ }
    }
  });
  const [code] = await once(child, 'exit');
  return code === 0;
}

const step = msg => { if (process.env.UI_CHECK_DEBUG) console.log(`  · ${new Date().toISOString().slice(11, 23)} ${msg}`); };
for (const theme of systems.includes('wired') ? ['light', 'dark'] : []) {
  step(`prepare ${theme}: client state ${backend.services.manager.client?.state}`);
  if (backend.services.manager.client?.state !== 'loggedIn') await backend.services.manager.connect();
  step('bridge idle…');
  await backend.services.bridge.idle();
  step('reset volume…');
  await backend.services.manager.client.request('SetMasterVolume', { volume: 10 });
  step('spawn electron');
  if (!(await runElectron(theme, routes))) failed = true;
}

// Permission-dependent controls (WO-019): restrict the mock account, let the backend pick it up via permissionsChanged.
if (systems.includes('wired') && routes.includes('discussion')) {
  for (const [scenario, permissions] of [
    ['perm-view-only', ['canViewSynoptic']],
    ['perm-no-mute', ['canViewSynoptic', 'canManageMeeting']],
  ]) {
    mock.state.userPermissions.admin = permissions;
    mock.fire('permissionsChanged');
    await new Promise(r => setTimeout(r, 300));
    await backend.services.bridge.idle();
    if (!(await runElectron('light', [scenario]))) failed = true;
  }
  delete mock.state.userPermissions.admin;
}

// Wireless pass (WO-027): same UI against the wireless mock.
if (systems.includes('wireless')) {
  const wmock = await createMockWirelessServer({ longPollMs: 1000 });
  const wDataDir = mkdtempSync(join(tmpdir(), 'ui-check-wireless-'));
  const wbackend = await start(loadConfig({
    PORT: '0', LOG_LEVEL: 'silent', DATA_DIR: wDataDir, DICENTIS_SYSTEM: 'wireless',
    DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(wmock.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin',
  }));
  if (wbackend.services.manager.client?.state !== 'loggedIn') await once(wbackend.services.manager.client, 'loggedIn');
  await wbackend.services.poller.idle();
  for (const theme of ['light', 'dark']) {
    if (wbackend.services.manager.client?.state !== 'loggedIn') await wbackend.services.manager.connect();
    await wbackend.services.poller.idle();
    if (!(await runElectron(theme, positional.length ? routes.filter(r => WIRELESS_ROUTES.includes(r)) : WIRELESS_ROUTES, 'wireless', { backend: wbackend, mock: wmock }))) failed = true;
  }
  await wbackend.close();
  await wmock.close();
  rmSync(wDataDir, { recursive: true, force: true });
}

// DCN pass (WO-063): same UI against the mock dcn-bridge, plus the mock meeting data stream next to it (DEC-020).
if (systems.includes('dcn')) {
  const dmock = await createMockDcnBridge({ authDelayMs: 20 });
  const dsmd = await createMockSmdServer();
  dsmd.interpretation(true); // a live interpreter desk (WO-074)
  const dDataDir = mkdtempSync(join(tmpdir(), 'ui-check-dcn-'));
  const dbackend = await start(loadConfig({
    PORT: '0', LOG_LEVEL: 'silent', DATA_DIR: dDataDir, DICENTIS_SYSTEM: 'dcn', DICENTIS_BRIDGE_TOKEN: dmock.token,
    DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(dmock.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin',
    DICENTIS_SMD_PORT: String(dsmd.port),
  }));
  if (dbackend.services.manager.client?.state !== 'loggedIn') await once(dbackend.services.manager.client, 'loggedIn');
  await dbackend.services.dcnEvents.idle();
  while (dbackend.services.manager.streamClient?.state !== 'loggedIn') await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 300)); // queued activities replayed
  const dcnRoutes = positional.length ? routes.filter(r => DCN_ROUTES.includes(r)) : DCN_ROUTES;
  for (const theme of ['light', 'dark']) {
    dmock.reset();
    if (dbackend.services.manager.client?.state !== 'loggedIn') await dbackend.services.manager.connect();
    await dbackend.services.dcnEvents.resync();
    if (!(await runElectron(theme, dcnRoutes, 'dcn', { backend: dbackend, mock: dmock }))) failed = true;
  }
  await dbackend.close();
  await dmock.close();
  await dsmd.close();
  rmSync(dDataDir, { recursive: true, force: true });
}

// DCN meeting data stream pass (WO-067): read-only UI against the mock SWSMD server.
if (systems.includes('dcn-smd')) {
  for (const theme of ['light', 'dark']) {
    const smock = await createMockSmdServer(); // fresh per theme: its queue replays the running meeting to the backend
    const sDataDir = mkdtempSync(join(tmpdir(), 'ui-check-smd-'));
    const sbackend = await start(loadConfig({
      PORT: '0', LOG_LEVEL: 'silent', DATA_DIR: sDataDir, DICENTIS_SYSTEM: 'dcn-smd', DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(smock.port),
    }));
    if (sbackend.services.manager.client?.state !== 'loggedIn') await once(sbackend.services.manager.client, 'loggedIn');
    await new Promise(r => setTimeout(r, 300));
    const smdRoutes = positional.length ? routes.filter(r => SMD_ROUTES.includes(r)) : SMD_ROUTES;
    if (!(await runElectron(theme, smdRoutes, 'dcn-smd', { backend: sbackend, mock: smock }))) failed = true;
    await sbackend.close();
    await smock.close();
    rmSync(sDataDir, { recursive: true, force: true });
  }
}

clearInterval(voter);
await backend.close();
await dcnmMock.close();
await mock.close();
await companionMock.close();
rmSync(dataDir, { recursive: true, force: true });
console.log(failed ? 'UI CHECK FAILED' : 'UI CHECK OK');
process.exit(failed ? 1 : 0);
