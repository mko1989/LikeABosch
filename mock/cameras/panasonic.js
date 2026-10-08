// Mock Panasonic AW integrated camera HTTP CGI interface.
import { createServer } from 'node:http';

/**
 * @param {object} [options]
 * @param {number} [options.port=0]
 * @param {string} [options.host='127.0.0.1']
 * @param {string} [options.username]
 * @param {string} [options.password]
 */
export async function createMockPanasonicCamera(options = {}) {
  const {
    port = 0,
    host = '127.0.0.1',
    username,
    password,
  } = options;

  const state = {
    currentPreset: null,
    presets: new Set(),
    lastPanTilt: null,
    lastZoom: null,
    commands: [], // array of command strings
  };

  const server = createServer((req, res) => {
    // Check basic auth if configured
    if (username && password) {
      const auth = req.headers.authorization;
      if (!auth) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Panasonic Camera"' });
        res.end();
        return;
      }
      const [scheme, credentials] = auth.split(' ');
      if (scheme !== 'Basic') {
        res.writeHead(401);
        res.end();
        return;
      }
      const decoded = Buffer.from(credentials, 'base64').toString('utf8');
      const [user, pass] = decoded.split(':');
      if (user !== username || pass !== password) {
        res.writeHead(401);
        res.end();
        return;
      }
    }

    // Parse CGI path and query
    if (!req.url.startsWith('/cgi-bin/aw_ptz')) {
      res.writeHead(404);
      res.end();
      return;
    }

    const queryStart = req.url.indexOf('?');
    const queryString = queryStart >= 0 ? req.url.substring(queryStart + 1) : '';
    const cmdMatch = queryString.match(/cmd=([^&]+)/);
    const cmd = cmdMatch ? decodeURIComponent(cmdMatch[1]) : null;

    if (!cmd) {
      res.writeHead(400);
      res.end('Missing cmd parameter');
      return;
    }

    state.commands.push(cmd);

    // Parse command
    let response = 'er1'; // default: unsupported command

    // Preset recall: #R00..#R99 (preset 1-100)
    if (cmd.match(/^#R\d{2}$/)) {
      const presetNum = parseInt(cmd.substring(2), 10);
      state.currentPreset = presetNum + 1; // store as 1-based
      response = `s${String(presetNum).padStart(2, '0')}`;
    }
    // Preset store: #M00..#M99
    else if (cmd.match(/^#M\d{2}$/)) {
      const presetNum = parseInt(cmd.substring(2), 10);
      state.presets.add(presetNum + 1); // store as 1-based
      response = `s${String(presetNum).padStart(2, '0')}`;
    }
    // Pan/tilt speed: #PTSxxyy
    else if (cmd.match(/^#PTS\d{4}$/)) {
      state.lastPanTilt = cmd.substring(4);
      response = `pTS${cmd.substring(4)}`;
    }
    // Zoom speed: #Zxx
    else if (cmd.match(/^#Z\d{2}$/)) {
      state.lastZoom = cmd.substring(2);
      response = `zS${cmd.substring(2)}`;
    }
    // Power query: #O
    else if (cmd === '#O') {
      response = 'p1'; // on
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(response);
  });

  await new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      resolve();
    });
    server.on('error', reject);
  });

  const actualPort = server.address().port;

  return {
    port: actualPort,
    state,
    async close() {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(() => resolve()));
    },
  };
}
