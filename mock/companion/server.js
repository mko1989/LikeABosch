// Mock Bitfocus Companion HTTP remote-control API (WO-099, DEC-027), as observed on Companion 5.0.6:
//   POST /api/location/<page>/<row>/<column>/press|down|up → 200 "ok"; no button there (empty / outside the grid) → 204
//   GET  /api/connections → []   ·   GET /tablet → a small page that draws the grid (same geometry as Companion's)
//   anything else → 404. CORS "*" like Companion.
import { createServer } from 'node:http';

/**
 * @param {object} [options]
 * @param {number} [options.port=0]
 * @param {string} [options.host='127.0.0.1']
 * @param {number} [options.pages=99]
 * @param {number} [options.rows=4]
 * @param {number} [options.cols=8]
 * @param {Record<string, string>} [options.labels]  "page/row/column" → button text shown on /tablet; when given, only
 *        these buttons exist (others answer 204 like empty buttons); without it every button in the grid exists
 */
export async function createMockCompanion(options = {}) {
  const { port = 0, host = '127.0.0.1', pages = 99, rows = 4, cols = 8, labels = {} } = options;
  /** @type {{ at: number, page: number, row: number, column: number, action: string }[]} */
  const requests = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (status, body = '', type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'access-control-allow-origin': '*', ...(body ? { 'content-type': type } : {}) });
      res.end(body);
    };
    if (req.method === 'OPTIONS') return send(204);
    const m = /^\/api\/location\/([^/]+)\/([^/]+)\/([^/]+)\/(press|down|up)$/.exec(url.pathname);
    if (m) {
      if (req.method !== 'POST') return send(404, 'Not found');
      const [page, row, column] = m.slice(1, 4).map(Number);
      const inGrid = [page, row, column].every(Number.isInteger) && page >= 1 && page <= pages && row >= 0 && row < rows && column >= 0 && column < cols;
      const exists = inGrid && (!Object.keys(labels).length || Boolean(labels[`${page}/${row}/${column}`]));
      if (!exists) return send(204);
      requests.push({ at: Date.now(), page, row, column, action: m[4] });
      return send(200, 'ok');
    }
    if (req.method === 'GET' && url.pathname === '/api/connections') return send(200, '[]', 'application/json');
    if (req.method === 'GET' && url.pathname === '/tablet') return send(200, tabletPage(url, { rows, cols, labels }), 'text/html; charset=utf-8');
    return send(404, 'Not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return {
    port: /** @type {import('node:net').AddressInfo} */ (server.address()).port,
    requests,
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve(undefined)); }),
  };
}

/** Companion's web buttons for one page: 12 px side padding, 20 px top, square buttons of (width − 24) / columns. */
function tabletPage(url, { rows, cols, labels }) {
  const page = Number(url.searchParams.get('pages')) || 1;
  const c = Number(url.searchParams.get('display_cols')) || cols;
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < c; k++) {
      const label = labels[`${page}/${r}/${k}`];
      cells.push(`<div class="b${label ? ' set' : ''}"><small>${page}/${r}/${k}</small>${label ? `<span>${esc(label)}</span>` : ''}</div>`);
    }
  }
  return `<!doctype html><meta charset="utf-8"><title>Mock Companion</title><style>
  html,body{margin:0;background:#1a1a1a;font:12px sans-serif;color:#ccc;overflow:hidden}
  .g{position:absolute;left:12px;right:12px;top:20px;display:grid;grid-template-columns:repeat(${c},1fr)}
  .b{aspect-ratio:1;margin:5px;border:1px solid #333;border-radius:6px;background:#000;position:relative;overflow:hidden}
  .b small{position:absolute;left:4px;top:2px;color:#555}.b.set{background:#2a4d8f}
  .b span{position:absolute;inset:16px 4px 4px;display:grid;place-items:center;text-align:center;color:#fff;font-weight:600}
  </style><div class="g">${cells.join('')}</div>`;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const mock = await createMockCompanion({ port: Number(process.env.PORT ?? 8000), labels: { '1/0/0': 'Seat 1 on', '1/0/1': 'Seat 1 off' } });
  console.log(`Mock Companion on http://127.0.0.1:${mock.port}`);
}
