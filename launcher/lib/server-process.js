// Backend child process lifecycle for the launcher (DEC-008). Pure Node: testable without Electron.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

const MAX_LOG_LINES = 500;

/**
 * Events: `state` ({ state, error? }), `log` (line: string)
 * States: stopped | starting | running | stopping | crashed
 */
export class ServerProcess extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.execPath   Node-compatible executable (Electron binary with ELECTRON_RUN_AS_NODE=1, or node)
   * @param {string} options.entry      backend/src/server.js
   * @param {string} options.cwd
   * @param {number} [options.readyTimeoutMs]
   */
  constructor({ execPath, entry, cwd, readyTimeoutMs = 15_000 }) {
    super();
    Object.assign(this, { execPath, entry, cwd, readyTimeoutMs });
    this.state = 'stopped';
    this.error = null;
    this.child = null;
    this.port = null;
    /** @type {string[]} */
    this.logLines = [];
  }

  get url() { return this.port ? `http://127.0.0.1:${this.port}` : null; }

  #setState(state, error = null) {
    this.state = state;
    this.error = error;
    this.emit('state', { state, error });
  }

  #log(line) {
    this.logLines.push(line);
    if (this.logLines.length > MAX_LOG_LINES) this.logLines.shift();
    this.emit('log', line);
  }

  /**
   * Spawn the backend and resolve once /api/health answers.
   * @param {Record<string, string>} env  backend environment (see backendEnv)
   */
  async start(env) {
    if (this.child) throw new Error('Server is already running');
    this.port = Number(env.PORT);
    this.#setState('starting');
    const child = spawn(this.execPath, [this.entry], {
      cwd: this.cwd,
      env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    let stderr = '';
    const onData = (stream, isErr) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        if (isErr) stderr = (stderr + chunk).slice(-4000);
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.filter(Boolean).forEach(l => this.#log(l));
      });
    };
    onData(child.stdout, false);
    onData(child.stderr, true);

    const exited = new Promise(resolve => {
      child.once('exit', (code, signal) => {
        this.child = null;
        if (this.state === 'stopping') this.#setState('stopped');
        else {
          const reason = /EADDRINUSE/.test(stderr) ? `Port ${this.port} is already in use` : `Server exited (code ${code ?? signal})`;
          this.#setState('crashed', reason);
        }
        resolve();
      });
    });

    const deadline = Date.now() + this.readyTimeoutMs;
    while (Date.now() < deadline) {
      if (!this.child) throw new Error(this.error ?? 'Server exited during start');
      try {
        const res = await fetch(`${this.url}/api/health`, { signal: AbortSignal.timeout(1_000) });
        if (res.ok) {
          this.#setState('running');
          return;
        }
      } catch { /* not up yet */ }
      await new Promise(r => setTimeout(r, 250));
    }
    await this.stop();
    await exited;
    this.#setState('crashed', `Server did not become ready within ${this.readyTimeoutMs / 1000} s`);
    throw new Error(this.error);
  }

  /** Stop gracefully (SIGTERM), force-kill after a timeout. */
  async stop({ timeoutMs = 5_000 } = {}) {
    const child = this.child;
    if (!child) return;
    this.#setState('stopping');
    const done = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    await done;
    clearTimeout(timer);
  }

  /** GET a backend API path; returns `data` from the envelope or null. */
  async api(path) {
    if (this.state !== 'running') return null;
    try {
      const body = await (await fetch(`${this.url}${path}`, { signal: AbortSignal.timeout(3_000) })).json();
      return body.ok ? body.data : null;
    } catch {
      return null;
    }
  }
}
