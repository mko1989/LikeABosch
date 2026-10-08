#!/usr/bin/env node
// READ-ONLY look at a (real) system through our backend + UI (WO-016/028): starts the backend with the DICENTIS_*
// environment, waits for the initial sync, prints topic availability, then screenshots every view in headless
// Electron WITHOUT clicking anything. Safe on a live conference system.
// Usage: DICENTIS_HOST=… DICENTIS_USER=… DICENTIS_PASSWORD=… node scripts/ui-snapshot.mjs [outDir] [route…]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { start } from '../backend/src/server.js';
import { loadConfig } from '../backend/src/config.js';

setTimeout(() => { console.log('SNAPSHOT FAILED: timed out'); process.exit(1); }, 180_000).unref();
const root = fileURLToPath(new URL('..', import.meta.url));
const electron = createRequire(join(root, 'launcher/package.json'))('electron');
const outDir = process.argv[2] ?? join(root, 'data/ui-snapshot');
const routes = process.argv.slice(3).length ? process.argv.slice(3)
  : ['overview', 'discussion', 'meetings', 'voting', 'participants', 'interpretation', 'system', 'files', 'connection'];
mkdirSync(outDir, { recursive: true });

const dataDir = mkdtempSync(join(tmpdir(), 'ui-snapshot-'));
const backend = await start(loadConfig({ ...process.env, PORT: '0', LOG_LEVEL: 'warn', DATA_DIR: dataDir, DICENTIS_AUTOCONNECT: 'true' }));
const { manager, bridge, poller, cache } = backend.services;
if (!manager.client) { console.log('No DICENTIS_HOST/USER configured'); process.exit(2); }
if (manager.client.state !== 'loggedIn') await once(manager.client, 'loggedIn');
await (manager.settings.system === 'wireless' ? poller.idle() : bridge.idle());
await new Promise(r => setTimeout(r, 500));
console.log(`Connected to ${manager.settings.system} ${manager.settings.host}: ${cache.topics.size} topics cached`);
for (const [t, reason] of cache.unavailable) console.log(`  unavailable ${t}: ${reason}`);

let failed = false;
for (const theme of ['light']) {
  const env = { ...process.env, UI_CHECK_READONLY: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [join(root, 'scripts/ui-check-electron.cjs'), backend.url, outDir, theme, manager.settings.system, ...routes], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.on('data', d => String(d).split('\n').filter(Boolean).forEach(line => {
    try {
      const m = JSON.parse(line);
      if (m.type === 'console') console.log(`  console ${m.level}: ${m.message}`);
      if (m.type === 'route') console.log(`  ${m.route}: ${m.file}`);
      if (m.type === 'done' && m.error) console.log(`  error: ${m.error}`);
    } catch { /* noise */ }
  }));
  const [code] = await once(child, 'exit');
  if (code !== 0) failed = true;
}
await backend.close();
rmSync(dataDir, { recursive: true, force: true });
console.log(failed ? 'SNAPSHOT: console errors (see above)' : 'SNAPSHOT OK');
process.exit(failed ? 1 : 0);
