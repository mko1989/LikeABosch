// Bitfocus Companion HTTP remote control (WO-099, DEC-027). Stateless: one request per call, Node's fetch.
//   POST /api/location/<page>/<row>/<column>/<press|down|up> → 200 "ok"; 204 = no button there (empty or outside the grid)
//   GET  /api/connections → reachability check

export const COMPANION_ACTIONS = ['press', 'down', 'up'];
export const DEFAULT_COMPANION_PORT = 8000;
const TIMEOUT_MS = 3000;

/**
 * @typedef {{ page: number, row: number, column: number, action: 'press' | 'down' | 'up' }} CompanionAction
 * @typedef {{ host: string, port?: number | null }} CompanionTarget
 */

/** @param {unknown} a */
export function validAction(a) {
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  return Boolean(a) && typeof a === 'object' && int(a.page, 1, 999) && int(a.row, -99, 99) && int(a.column, -99, 99)
    && COMPANION_ACTIONS.includes(a.action);
}

/** "page/row/column" as Companion shows it. @param {CompanionAction} a */
export const locationLabel = a => `${a.page}/${a.row}/${a.column}`;

const baseUrl = t => `http://${t.host.includes(':') && !t.host.startsWith('[') ? `[${t.host}]` : t.host}:${t.port || DEFAULT_COMPANION_PORT}`;

async function request(target, method, path, timeoutMs = TIMEOUT_MS) {
  if (!target?.host) throw new Error('Companion host is not configured');
  try {
    return await fetch(`${baseUrl(target)}${path}`, { method, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const cause = err.name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000} s` : err.cause?.code ?? err.cause?.errors?.[0]?.code ?? err.cause?.message ?? err.message;
    throw new Error(`Companion at ${target.host}:${target.port || DEFAULT_COMPANION_PORT} not reachable (${cause})`);
  }
}

/**
 * Press / hold / release one button.
 * @param {CompanionTarget} target
 * @param {CompanionAction} a
 */
export async function sendAction(target, a) {
  if (!validAction(a)) throw new Error('Invalid Companion button action');
  const res = await request(target, 'POST', `/api/location/${a.page}/${a.row}/${a.column}/${a.action}`);
  await res.body?.cancel().catch(() => {});
  if (res.status === 204) throw new Error(`Companion has no button at ${locationLabel(a)} (empty in Companion, or outside its grid)`);
  if (res.status === 404) throw new Error('Companion did not accept the request: is its HTTP API enabled (Settings → Protocols)?');
  if (!res.ok) throw new Error(`Companion answered ${res.status} for ${locationLabel(a)}`);
}

/**
 * Is Companion's HTTP API there?
 * @param {CompanionTarget} target
 * @returns {Promise<{ connections: number | null }>}
 */
export async function ping(target) {
  const res = await request(target, 'GET', '/api/connections');
  if (res.status === 404) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`${target.host} answers, but not like Companion's HTTP API (404 on /api/connections)`);
  }
  if (!res.ok) throw new Error(`Companion answered ${res.status}`);
  const list = await res.json().catch(() => null);
  return { connections: Array.isArray(list) ? list.length : null };
}
