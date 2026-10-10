// SSE stream to the backend that heals itself (WO-109). A plain EventSource retries only after network errors: an HTTP
// error on a reconnect (backend restarting) closes it for good, and a dead connection (computer slept, network change)
// is never noticed. The backend sends a `ping` event every 15 s; when the browser gave up, or nothing arrived for
// `staleMs`, the stream is reopened (a fresh snapshot follows on every open, DEC-005). No DOM: unit-tested in web/test.

const CLOSED = 2; // EventSource.CLOSED

/**
 * @param {object} o
 * @param {string} o.url
 * @param {Record<string, (data: any) => void>} o.handlers  named SSE event → callback with the parsed data
 * @param {(status: 'open' | 'lost') => void} o.onStatus
 * @param {(url: string) => EventSource} [o.create]
 * @param {number} [o.staleMs]   reopen when no event (incl. ping) arrived for this long
 * @param {number} [o.checkMs]   watchdog interval
 * @param {number} [o.minRetryMs]
 * @param {number} [o.maxRetryMs]
 * @returns {{ check(): void, reconnect(): void, close(): void }}
 */
export function openLiveStream({ url, handlers, onStatus, create = u => new EventSource(u), staleMs = 40_000, checkMs = 5_000, minRetryMs = 1_000, maxRetryMs = 10_000 }) {
  /** @type {EventSource | null} */
  let es = null;
  let lastSeen = Date.now();
  let attempt = 0;
  let retryTimer = null;
  let closed = false;

  function open() {
    clearTimeout(retryTimer);
    retryTimer = null;
    es?.close();
    const source = create(url);
    es = source;
    lastSeen = Date.now();
    const current = () => es === source;
    source.onopen = () => {
      if (!current()) return;
      lastSeen = Date.now();
      attempt = 0;
      onStatus('open');
    };
    source.onerror = () => {
      if (!current()) return;
      onStatus('lost');
      if (source.readyState === CLOSED) retry(); // the browser gave up: reopen ourselves
    };
    for (const [event, fn] of Object.entries({ ...handlers, ping: () => {} })) {
      source.addEventListener(event, e => {
        if (!current()) return;
        lastSeen = Date.now();
        fn(JSON.parse(/** @type {MessageEvent} */ (e).data));
      });
    }
  }

  function retry() {
    if (closed || retryTimer) return;
    es?.close();
    retryTimer = setTimeout(open, Math.min(maxRetryMs, minRetryMs * 2 ** attempt++));
  }

  /** Reopen at once when the stream is closed or has been silent for too long (also right after the computer wakes). */
  function check() {
    if (closed || retryTimer || !es) return;
    if (es.readyState === CLOSED || Date.now() - lastSeen > staleMs) {
      onStatus('lost');
      open();
    }
  }

  const watchdog = setInterval(check, checkMs);
  open();

  return {
    check,
    /** Reopen now (e.g. the network came back: the old connection may be dead without anyone knowing). */
    reconnect() { if (!closed) { attempt = 0; open(); } },
    close() {
      closed = true;
      clearInterval(watchdog);
      clearTimeout(retryTimer);
      es?.close();
    },
  };
}
