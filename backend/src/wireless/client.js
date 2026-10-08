// DICENTIS Wireless (WAP) REST client (WO-014). Same state/event model as WiredClient so the connection
// manager and UI can treat both systems alike. Protocol notes: docs/protocol/wireless-rest/README.md
import { EventEmitter } from 'node:events';
import { AppError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';

/**
 * @typedef {'disconnected' | 'connecting' | 'connected' | 'loggedIn' | 'reconnecting'} ClientState
 * @typedef {object} WirelessClientOptions
 * @property {string} host
 * @property {number} [port]              default 80
 * @property {'http' | 'https'} [scheme]  default http (the spec only lists http)
 * @property {string} user
 * @property {string} password
 * @property {boolean} [override]         take over an existing session of the same user (login 409)
 * @property {number} [requestTimeoutMs]  default 10000 for GETs (retried once on timeout, see request())
 * @property {number} [writeTimeoutMs]    default 60000 for POST/PUT/DELETE
 * @property {number} [loginTimeoutMs]    default 60000: the WAP answers a login only after the long-polls of the user's
 *                                        previous session have timed out (~48 s, WO-075)
 * @property {{ enabled?: boolean, minDelayMs?: number, maxDelayMs?: number }} [reconnect]
 * @property {ReturnType<createLogger>} [log]
 */

/** Events: `state` (state, { error? }), `loggedIn` () after every successful login. */
export class WirelessClient extends EventEmitter {
  /** @param {WirelessClientOptions} options */
  constructor(options) {
    super();
    this.options = {
      port: 80, scheme: 'http', override: false, requestTimeoutMs: 10_000, writeTimeoutMs: 60_000, loginTimeoutMs: 60_000,
      ...options,
      reconnect: { enabled: true, minDelayMs: 1_000, maxDelayMs: 30_000, ...options.reconnect },
    };
    this.log = options.log ?? createLogger({ name: 'wireless' });
    /** @type {ClientState} */
    this.state = 'disconnected';
    /** @type {AppError | null} */
    this.lastError = null;
    this.sid = null;
    this.closing = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.loginPromise = null;
  }

  get baseUrl() {
    return `${this.options.scheme}://${this.options.host}:${this.options.port}/api`;
  }

  #setState(state, info = {}) {
    if (this.state === state && !info.error) return;
    this.state = state;
    this.emit('state', state, info);
  }

  /** Log in. Rejects with UPSTREAM_AUTH (credentials / already logged in) or NOT_CONNECTED. */
  async connect() {
    this.closing = false;
    clearTimeout(this.reconnectTimer);
    this.#setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    try {
      await this.#login();
      this.reconnectAttempt = 0;
    } catch (err) {
      this.lastError = err;
      if (err.code === 'UPSTREAM_AUTH') {
        this.closing = true;
        this.#setState('disconnected', { error: err });
      } else {
        this.#scheduleReconnect(err);
      }
      throw err;
    }
  }

  async #login() {
    const { user, password, override } = this.options;
    let res;
    try {
      res = await fetch(`${this.baseUrl}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: user, password, ...(override ? { override: true } : {}) }),
        signal: AbortSignal.timeout(this.options.loginTimeoutMs),
      });
    } catch (err) {
      throw new AppError('NOT_CONNECTED', `Cannot reach ${this.baseUrl}: ${err.cause?.code ?? err.message}`);
    }
    if (res.status === 401) throw new AppError('UPSTREAM_AUTH', `DICENTIS Wireless login failed for user '${user}'`);
    if (res.status === 409) {
      throw new AppError('UPSTREAM_AUTH', `User '${user}' is already logged in elsewhere (connect with "take over session" to override)`, { reason: 'alreadyLoggedIn' });
    }
    if (!res.ok) throw new AppError('UPSTREAM_ERROR', `Login failed with HTTP ${res.status}`, { upstream: await errorDetails(res) });
    // Session id: cookie `sid`, also in the body on firmware 1.73 (WO-075). We send it as cookie and as header
    // `Bosch-Sid` (both accepted by the WAP; the swagger's header name `sid` is not).
    const cookie = res.headers.getSetCookie?.().find(c => c.startsWith('sid=')) ?? res.headers.get('set-cookie') ?? '';
    const body = await res.json().catch(() => null);
    const sid = /sid=([^;,\s]+)/.exec(cookie)?.[1] ?? (typeof body?.sid === 'string' ? body.sid : undefined);
    if (!sid) throw new AppError('UPSTREAM_ERROR', 'Login response did not contain a session id (sid cookie)');
    this.sid = sid;
    this.lastError = null;
    this.#setState('loggedIn');
    this.log.info(`logged in to ${this.options.host} as ${user}`);
    this.emit('loggedIn');
  }

  /**
   * Call an endpoint. Returns parsed JSON, or null for an empty body.
   * A 401 (expired session) triggers one transparent re-login and retry.
   * With several requests in flight the WAP sometimes parks one until its long-polls time out (~50 s, WO-075). A GET
   * that times out is therefore sent once more (harmless: GETs have no effect). Writes are not repeated; they get the
   * longer `writeTimeoutMs`, so a parked write still reports its real outcome instead of a false timeout.
   * @param {string} method
   * @param {string} path   e.g. "/speakers/12" (without /api)
   * @param {{ query?: Record<string, string | number | boolean>, body?: unknown, timeoutMs?: number }} [opts]
   *   `body` as FormData is sent as multipart (file upload, DEC-024), anything else as JSON.
   */
  async request(method, path, { query, body, timeoutMs } = {}) {
    if (this.state !== 'loggedIn') {
      throw new AppError('NOT_CONNECTED', `Not connected to DICENTIS Wireless (state: ${this.state})`);
    }
    const isGet = method === 'GET';
    const retryOnTimeout = isGet && timeoutMs === undefined && !query?.isPolling;
    for (let relogged = false, timedOut = 0; ;) {
      const url = new URL(`${this.baseUrl}${path}`);
      for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: {
            'bosch-sid': this.sid,
            cookie: `sid=${this.sid}`,
            ...(body === undefined || body instanceof FormData ? {} : { 'content-type': 'application/json' }),
          },
          body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs ?? (isGet ? this.options.requestTimeoutMs : this.options.writeTimeoutMs)),
        });
      } catch (err) {
        if (err.name === 'TimeoutError') {
          if (retryOnTimeout && timedOut++ === 0) {
            this.log.debug(`${method} ${path} timed out, retrying once`);
            continue;
          }
          throw new AppError('UPSTREAM_TIMEOUT', `${method} ${path} timed out`);
        }
        const appErr = new AppError('NOT_CONNECTED', `Connection to ${this.options.host} lost: ${err.cause?.code ?? err.message}`);
        this.lastError = appErr;
        this.#scheduleReconnect(appErr);
        throw appErr;
      }
      if (res.status === 401 && !relogged) {
        relogged = true;
        this.log.info('session expired, logging in again');
        try {
          await this.#relogin();
        } catch (err) {
          // 409: another client took our session over (one session per user). Retrying would only fight it.
          if (err.code === 'UPSTREAM_AUTH') {
            this.lastError = err;
            this.closing = true;
            this.sid = null;
            this.#setState('disconnected', { error: err });
          }
          throw err;
        }
        continue;
      }
      if (!res.ok) {
        const upstream = await errorDetails(res);
        const code = res.status === 401 || res.status === 403 ? 'UPSTREAM_AUTH' : 'UPSTREAM_ERROR';
        throw new AppError(code, `${method} ${path} failed (HTTP ${res.status}): ${upstream}`, { upstream, status: res.status });
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
  }

  /** Re-login once; concurrent callers share the same attempt. */
  #relogin() {
    this.loginPromise ??= this.#login().finally(() => { this.loginPromise = null; });
    return this.loginPromise;
  }

  #scheduleReconnect(error) {
    const { enabled, minDelayMs, maxDelayMs } = this.options.reconnect;
    if (this.closing || !enabled) {
      this.#setState('disconnected', { error });
      return;
    }
    if (this.reconnectTimer && this.state === 'reconnecting') return;
    const delay = Math.min(maxDelayMs, minDelayMs * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.#setState('reconnecting', { error });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(err => this.log.debug(`reconnect failed: ${err.message}`));
    }, delay);
    this.reconnectTimer.unref?.();
  }

  /**
   * Log out (best effort); no reconnect afterwards. The WAP only completes a logout once the session's held long-polls
   * time out (~48 s), so we don't wait for it: the short timeout keeps shutdown fast and the WAP finishes it later.
   */
  async close() {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.state === 'loggedIn') await this.request('POST', '/logout', { timeoutMs: 2_000 }).catch(() => {});
    this.sid = null;
    this.#setState('disconnected');
  }
}

async function errorDetails(res) {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text);
    return body?.error?.details ?? body?.error?.description ?? text;
  } catch {
    return text || res.statusText;
  }
}
