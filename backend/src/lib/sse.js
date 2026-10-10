// Server-Sent Events hub: keeps browser connections and broadcasts named events (DEC-005).

/**
 * @param {object} [options]
 * @param {number} [options.heartbeatMs]  `ping` event interval: keeps proxies from timing out and lets the browser notice a
 *                                        dead stream (comment lines are invisible to page scripts; WO-109)
 */
export function createSseHub({ heartbeatMs = 15_000 } = {}) {
  /** @type {Set<import('express').Response>} */
  const clients = new Set();
  let nextId = 1;

  const write = (res, event, data) => {
    res.write(`id: ${nextId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write('event: ping\ndata: {}\n\n');
  }, heartbeatMs);
  heartbeat.unref();

  return {
    /**
     * Register a request as an SSE stream. `initial` events are sent to this client only.
     * @param {import('express').Request} req
     * @param {import('express').Response} res
     * @param {{ event: string, data: unknown }[]} [initial]
     */
    add(req, res, initial = []) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      initial.forEach(m => write(res, m.event, m.data));
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    /** @param {string} event @param {unknown} data */
    broadcast(event, data) {
      for (const res of clients) write(res, event, data);
      nextId += 1;
    },
    get clientCount() { return clients.size; },
    close() {
      clearInterval(heartbeat);
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}
