// One Windows bridge (dcn-bridge / dicentis-bridge) as a child process of the launcher (DEC-022, WO-080).
// Pure Node: testable without Electron or Windows (tests use a Node script as the "exe").
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

const MAX_LOG_LINES = 300;

/**
 * Events: `state` ({ name, state, error?, port? }), `log` (line).
 * States: stopped | starting | running | crashed | stopping. A crash while running restarts it with backoff.
 */
export class BridgeProcess extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.name          dcn-bridge | dicentis-bridge
   * @param {string} options.command       the exe (or node in tests)
   * @param {string[]} options.args
   * @param {number} [options.readyTimeoutMs]  wait for the "READY port=<n>" line
   * @param {{ minDelayMs?: number, maxDelayMs?: number }} [options.restart]
   * @param {string} [options.cwd]
   */
  constructor({ name, command, args, readyTimeoutMs = 30_000, restart = {}, cwd }) {
    super();
    Object.assign(this, { name, command, args, readyTimeoutMs, cwd });
    this.restart = { minDelayMs: 1_000, maxDelayMs: 30_000, ...restart };
    this.state = 'stopped';
    this.error = null;
    this.port = null;
    this.child = null;
    this.attempt = 0;
    this.restartTimer = null;
    this.wanted = false;
    /** @type {string[]} */
    this.logLines = [];
  }

  #setState(state, error = null) {
    this.state = state;
    this.error = error;
    this.emit('state', { name: this.name, state, error, port: this.port });
  }

  #log(line) {
    const l = `[${this.name}] ${line}`;
    this.logLines.push(l);
    if (this.logLines.length > MAX_LOG_LINES) this.logLines.shift();
    this.emit('log', l);
  }

  /** Start and resolve when the bridge printed READY; rejects (and stays stopped/crashed) otherwise. */
  async start() {
    if (this.child) return;
    this.wanted = true;
    clearTimeout(this.restartTimer);
    this.#setState('starting');
    let child;
    try {
      child = spawn(this.command, this.args, { cwd: this.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      this.#setState('crashed', `Cannot start ${this.name}: ${err.message}`);
      throw new Error(this.error);
    }
    this.child = child;
    let stderr = '';
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name} did not report READY within ${this.readyTimeoutMs / 1000} s`)), this.readyTimeoutMs);
      const lines = (stream, isErr) => {
        let buf = '';
        stream.setEncoding('utf8');
        stream.on('data', chunk => {
          if (isErr) stderr = (stderr + chunk).slice(-2000);
          buf += chunk;
          const parts = buf.split(/\r?\n/);
          buf = parts.pop();
          for (const line of parts.filter(Boolean)) {
            const m = /^READY port=(\d+)/.exec(line);
            if (m) { this.port = Number(m[1]); clearTimeout(timer); resolve(); } else this.#log(line);
          }
        });
      };
      lines(child.stdout, false);
      lines(child.stderr, true);
      child.once('error', err => { clearTimeout(timer); reject(new Error(`Cannot start ${this.name}: ${err.message}`)); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`${this.name} exited (code ${code})${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`)); });
    });
    child.once('exit', code => this.#onExit(child, code, stderr));
    try {
      await ready;
      this.attempt = 0;
      this.#setState('running');
    } catch (err) {
      if (this.child === child) { child.kill(); }
      this.#setState('crashed', err.message);
      throw err;
    }
  }

  #onExit(child, code, stderr) {
    if (this.child !== child) return;
    this.child = null;
    if (this.state === 'stopping' || !this.wanted) { this.#setState('stopped'); return; }
    if (this.state === 'starting') return; // start() reports it
    this.#log(`exited (code ${code})${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`);
    this.#setState('crashed', `${this.name} exited (code ${code})`);
    const delay = Math.min(this.restart.maxDelayMs, this.restart.minDelayMs * 2 ** this.attempt);
    this.attempt += 1;
    this.restartTimer = setTimeout(() => this.start().catch(() => {}), delay); // kept referenced: a pending restart is real work
  }

  /** Stop (no restart). Kills after a timeout. */
  async stop({ timeoutMs = 3_000 } = {}) {
    this.wanted = false;
    clearTimeout(this.restartTimer);
    const child = this.child;
    if (!child) { if (this.state !== 'stopped') this.#setState('stopped'); return; }
    this.#setState('stopping');
    const done = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    await done;
    clearTimeout(timer);
  }
}
