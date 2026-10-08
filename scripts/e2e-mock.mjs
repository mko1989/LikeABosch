#!/usr/bin/env node
// Runs the end-to-end suite (scripts/e2e-wired.mjs) against the wired mock: validates the harness and keeps the
// mock's semantics aligned with the real server (WO-032). Usage: npm run e2e:mock
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMockWiredServer } from '../mock/wired/server.js';

const mock = await createMockWiredServer();
const script = fileURLToPath(new URL('./e2e-wired.mjs', import.meta.url));
const child = spawn(process.execPath, [script, '--out', 'data/e2e-wired-mock.md'], {
  stdio: 'inherit',
  env: { ...process.env, DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(mock.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin' },
});
child.on('exit', async code => { await mock.close(); process.exit(code ?? 1); });
