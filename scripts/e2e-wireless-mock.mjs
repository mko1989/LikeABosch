#!/usr/bin/env node
// Runs the wireless end-to-end suite (scripts/e2e-wireless.mjs) against the wireless mock: validates the harness and
// keeps the mock's semantics aligned with the real WAP (WO-075). The mock starts in discussion mode Override, like the
// WAP it was verified on, so the suite's mode switch is exercised too. Usage: npm run e2e:wireless:mock
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMockWirelessServer } from '../mock/wireless/server.js';

const mock = await createMockWirelessServer({ longPollMs: 3_000 });
mock.setDiscuss({ mode: 1 });
const script = fileURLToPath(new URL('./e2e-wireless.mjs', import.meta.url));
const child = spawn(process.execPath, [script, '--out', 'data/e2e-wireless-mock.md'], {
  stdio: 'inherit',
  env: { ...process.env, DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(mock.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin' },
});
child.on('exit', async code => { await mock.close(); process.exit(code ?? 1); });
