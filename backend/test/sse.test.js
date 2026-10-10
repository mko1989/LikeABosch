import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createSseHub } from '../src/lib/sse.js';

test('SSE hub sends a named ping event the browser can see (WO-109)', async () => {
  const hub = createSseHub({ heartbeatMs: 20 });
  const server = http.createServer((req, res) => hub.add(req, res, [{ event: 'snapshot', data: { topics: {} } }]));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const ac = new AbortController();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`, { signal: ac.signal });
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const decoder = new TextDecoder();
    let text = '';
    for await (const chunk of res.body) {
      text += decoder.decode(chunk, { stream: true });
      if (text.includes('event: ping\n')) break;
    }
    assert.match(text, /event: snapshot\n/);
    assert.match(text, /event: ping\ndata: \{\}\n\n/);
  } finally {
    ac.abort();
    hub.close();
    await new Promise(r => server.close(r));
  }
});
