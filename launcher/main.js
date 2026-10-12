// Electron main process for the launcher (WO-030, DEC-008).
// Owns settings (password via safeStorage), the backend child process, and the GUI window.
import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createSettingsStore, backendEnv } from './lib/settings-store.js';
import { ServerProcess } from './lib/server-process.js';
import { BridgeProcess } from './lib/bridge-process.js';
import { neededBridges, resolveExe, bridgeArgs } from './lib/bridges.js';
import { detectBoschApis } from './lib/bosch-apis.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(here, '..');
const smokeTest = process.argv.includes('--smoke-test');

const store = createSettingsStore({
  dir: app.getPath('userData'),
  encryptor: {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: text => safeStorage.encryptString(text),
    decrypt: buf => safeStorage.decryptString(buf),
  },
});
const server = new ServerProcess({ execPath: process.execPath, entry: join(repoRoot, 'backend/src/server.js'), cwd: repoRoot });
/** Windows bridges started for the current settings (DEC-022), by name. */
/** @type {Map<string, BridgeProcess>} */
const bridges = new Map();
/** Last state per bridge, also for bridges that could not be started (exe missing). */
const bridgeStates = new Map();

/** @type {BrowserWindow | null} */
let launcherWindow = null;
let statusTimer = null;

const send = (channel, payload) => launcherWindow?.webContents.send(channel, payload);

server.on('state', s => send('server:state', s));
server.on('log', line => send('server:log', line));

/** Poll DICENTIS connection status from the backend while it runs. */
function pollStatus() {
  clearInterval(statusTimer);
  statusTimer = setInterval(async () => send('dicentis:status', await server.api('/api/connection')), 2_000);
}

function setBridgeState(st) {
  bridgeStates.set(st.name, st);
  send('bridges:state', [...bridgeStates.values()]);
}

/** Installed Bosch software (DEC-037), found at app start and before each server start. */
let found = { dicentis: null, dcn: null };
/** Command line of each running bridge, so an unchanged one keeps running. */
const bridgeCommands = new Map();

/**
 * Start the bridges these settings need on this PC (Windows only, DEC-022), plus the ones whose Bosch software is
 * installed (`autoBridges`, DEC-037). Running bridges with the same command line keep running. A bridge that cannot
 * start is reported; the backend starts anyway and keeps trying to reach it. Returns the bridges wanted.
 */
async function startBridges(settings, token) {
  found = detectBoschApis({ configured: { dicentis: settings.dcnmDllDir, dcn: settings.dcnBridgeDllDir } });
  send('bosch:found', found);
  const wanted = neededBridges(settings, { bridgeToken: token, found });
  const key = b => JSON.stringify([b.exe, bridgeArgs(b)]);
  for (const [name, p] of [...bridges]) {
    const w = wanted.find(b => b.name === name);
    if (w && bridgeCommands.get(name) === key(w) && p.state !== 'stopped' && p.state !== 'failed') continue;
    await p.stop();
    bridges.delete(name);
    bridgeCommands.delete(name);
  }
  for (const name of [...bridgeStates.keys()]) if (!wanted.some(b => b.name === name)) bridgeStates.delete(name);
  for (const b of wanted.filter(x => !bridges.has(x.name))) {
    const exe = resolveExe(b, { repoRoot, launcherDir: here, resourcesPath: process.resourcesPath });
    if (!exe) {
      const error = `${b.name}.exe not found: build it (dotnet build bridge/${b.dir} -c Release) or set its path under "Bridges"`;
      setBridgeState({ name: b.name, state: 'missing', error });
      send('server:log', `[${b.name}] ${error}`);
      continue;
    }
    const p = new BridgeProcess({ name: b.name, command: exe, args: bridgeArgs(b), cwd: dirname(exe) });
    p.on('state', st => setBridgeState({ ...st, auto: Boolean(b.auto), dllDir: b.dllDir }));
    p.on('log', line => send('server:log', line));
    bridges.set(b.name, p);
    bridgeCommands.set(b.name, key(b));
    send('server:log', `[${b.name}] starting ${exe} on 127.0.0.1:${b.port}${b.auto ? ` (found ${b.dllDir})` : ''}`);
    try { await p.start(); } catch (err) { send('server:log', `[${b.name}] ${err.message}`); }
  }
  return wanted;
}

async function stopBridges() {
  await Promise.all([...bridges.values()].map(b => b.stop()));
  bridges.clear();
  bridgeCommands.clear();
}

async function startServer() {
  const settings = await store.load();
  const token = await store.loadBridgeToken();
  // A simulation needs no Windows bridge (WO-098).
  const wanted = !smokeTest && !settings.simulate ? await startBridges(settings, token) : [];
  // No DATA_DIR: the backend uses the same per-user data folder as a direct start (DEC-016).
  const dcnmAuto = wanted.some(b => b.name === 'dicentis-bridge' && b.auto); // DICENTIS software found here (DEC-037)
  const env = backendEnv(settings, await store.loadPassword(), undefined, token, { dcnmAuto });
  if (smokeTest) Object.assign(env, { PORT: process.env.LAUNCHER_SMOKE_PORT ?? '39880', DICENTIS_AUTOCONNECT: 'false' });
  await server.start(env);
  pollStatus();
  return { url: server.url };
}

/** Open the web UI in the system's default browser (user request 2026-10-03: no extra Electron window). */
async function openGui() {
  if (server.state !== 'running') throw new Error('Start the server first');
  await shell.openExternal(server.url);
}

function registerIpc() {
  ipcMain.handle('settings:get', () => store.describe());
  ipcMain.handle('settings:save', (_e, { settings, password, bridgeToken }) => store.save(settings, password, bridgeToken));
  ipcMain.handle('server:start', () => startServer());
  // The bridges keep running (DEC-037: they start with the app); the next server start reuses unchanged ones.
  ipcMain.handle('server:stop', async () => { clearInterval(statusTimer); await server.stop(); });
  ipcMain.handle('bosch:found', () => found);
  ipcMain.handle('bridges:status', () => [...bridgeStates.values()]);
  ipcMain.handle('server:status', () => ({ state: server.state, error: server.error, url: server.url, log: server.logLines }));
  ipcMain.handle('gui:launch', () => openGui());
}

function createLauncherWindow() {
  launcherWindow = new BrowserWindow({
    width: 620,
    height: 820,
    minWidth: 480,
    title: 'LikeABosch',
    show: !smokeTest,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  launcherWindow.removeMenu();
  launcherWindow.loadFile(join(here, 'renderer/index.html'));
  launcherWindow.on('closed', () => { launcherWindow = null; });
}

/** --smoke-test: load the UI hidden, start the backend, check health, stop, exit 0/1. */
async function runSmokeTest() {
  try {
    await new Promise(resolve => launcherWindow.webContents.once('did-finish-load', resolve));
    const bridgeOk = await launcherWindow.webContents.executeJavaScript('typeof window.launcher?.getSettings === "function"');
    if (!bridgeOk) throw new Error('preload bridge missing');
    const shot = process.env.LAUNCHER_SCREENSHOT; // optional: save a PNG of the launcher window for visual review
    if (shot) {
      await new Promise(r => setTimeout(r, 300));
      const { writeFile } = await import('node:fs/promises');
      await writeFile(shot, (await launcherWindow.webContents.capturePage()).toPNG());
    }
    await startServer();
    const health = await server.api('/api/health');
    if (health?.status !== 'up') throw new Error('health check failed');
    // Launch GUI opens the system browser; in the smoke test just check the page it would open.
    const page = await (await fetch(server.url)).text();
    if (!/LikeABosch/.test(page)) throw new Error('web UI page not served');
    await server.stop();
    console.log('SMOKE TEST OK');
    app.exit(0);
  } catch (err) {
    console.error(`SMOKE TEST FAILED: ${err.message}`);
    await server.stop();
    app.exit(1);
  }
}

app.whenReady().then(async () => {
  registerIpc();
  createLauncherWindow();
  if (smokeTest) return runSmokeTest();
  // DEC-037: on Windows, bridges whose Bosch software is installed start with the app.
  const settings = await store.load();
  if (process.platform === 'win32' && !settings.simulate) {
    await startBridges(settings, await store.loadBridgeToken()).catch(err => send('server:log', `[bridges] ${err.message}`));
  }
});

app.on('window-all-closed', () => app.quit());

// Never leave an orphaned backend or bridge behind.
let quitting = false;
app.on('before-quit', async e => {
  if (quitting || (!server.child && !bridges.size)) return;
  e.preventDefault();
  quitting = true;
  clearInterval(statusTimer);
  await server.stop();
  await stopBridges();
  app.quit();
});
