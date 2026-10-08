// Launcher renderer: settings form, server control, status. Talks to main only via window.launcher (preload).
const api = window.launcher;
const $ = id => document.getElementById(id);
const form = $('settings');
const field = name => form.elements.namedItem(name);

const DEFAULT_PORTS = { wired: 31416, wireless: 80, dcn: 9480, 'dcn-smd': 20000 };
const SERVER_LABELS = { stopped: 'stopped', starting: 'starting…', running: 'running', stopping: 'stopping…', crashed: 'crashed' };
const BRIDGE_LABELS = { starting: 'starting…', running: 'running', crashed: 'crashed', stopping: 'stopping…', stopped: 'stopped', missing: 'not found' };
const DICENTIS_LABELS = {
  disconnected: 'not connected', connecting: 'connecting…', connected: 'logging in…', loggedIn: 'connected', reconnecting: 'reconnecting…',
};

let serverState = 'stopped';
let dirtySinceStart = false;
let shownSystem = 'wired'; // system the port field was last shown for

function show(el, text) { el.textContent = text ?? ''; el.hidden = !text; }

function fill({ settings, passwordSet, bridgeTokenSet, encryptionAvailable }) {
  for (const [k, v] of Object.entries(settings)) {
    const el = field(k);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = v;
    else el.value = v ?? '';
  }
  field('password').value = '';
  field('password').placeholder = passwordSet ? '•••••••• (saved, leave empty to keep)' : '';
  field('bridgeToken').value = '';
  field('bridgeToken').placeholder = bridgeTokenSet ? '•••••••• (saved, leave empty to keep)' : 'only if the bridge runs with --token';
  $('token-hint').textContent = encryptionAvailable ? 'Stored encrypted, like the password.' : 'Secure storage is unavailable: the token cannot be remembered.';
  $('password-hint').textContent = encryptionAvailable
    ? 'Stored encrypted with your operating system’s secure storage.'
    : 'Secure storage is unavailable on this system: the password cannot be remembered.';
  updatePortPlaceholder();
  $('lan-hint').hidden = !field('lanAccess').checked;
}

function readForm() {
  const port = field('port').value.trim();
  return {
    system: field('system').value,
    host: field('host').value.trim(),
    port: port === '' ? null : Number(port),
    user: field('user').value.trim(),
    dcnServer: field('dcnServer').value.trim(),
    smdStream: field('smdStream').checked,
    smdHost: field('smdHost').value.trim(),
    smdPort: field('smdPort').value.trim() === '' ? null : Number(field('smdPort').value),
    dcnmBridge: field('dcnmBridge').checked,
    dcnmHost: field('dcnmHost').value.trim(),
    dcnmPort: field('dcnmPort').value.trim() === '' ? null : Number(field('dcnmPort').value),
    dcnmDevice: field('dcnmDevice').value.trim(),
    dcnmServer: field('dcnmServer').value.trim(),
    dcnmDllDir: field('dcnmDllDir').value.trim(),
    dcnBridgeDllDir: field('dcnBridgeDllDir').value.trim(),
    manageBridges: field('manageBridges').checked,
    dcnmExe: field('dcnmExe').value.trim(),
    dcnBridgeExe: field('dcnBridgeExe').value.trim(),
    simulate: field('simulate').value,
    simulateSeats: Number(field('simulateSeats').value),
    tlsInsecure: field('tlsInsecure').checked,
    autoConnect: field('autoConnect').checked,
    webPort: Number(field('webPort').value),
    lanAccess: field('lanAccess').checked,
  };
}

function updatePortPlaceholder() {
  const system = field('system').value;
  shownSystem = system;
  field('port').placeholder = String(DEFAULT_PORTS[system]);
  $('dcn-fields').hidden = system !== 'dcn';
  $('dcn-stream-fields').hidden = system !== 'dcn';
  $('dcnm-fields').hidden = system !== 'wired';
  $('dcnm-detail').hidden = !field('dcnmBridge').checked;
  $('token-row').hidden = !(system === 'dcn' || (system === 'wired' && field('dcnmBridge').checked));
  $('tls-row').hidden = system === 'dcn' || system === 'dcn-smd'; // plain TCP (DEC-017, DEC-018)
  $('smd-hint').hidden = system !== 'dcn-smd';
  $('login-fields').hidden = system === 'dcn-smd'; // the meeting data stream has no login
  $('smd-stream-fields').hidden = !field('smdStream').checked;
  const simulating = field('simulate').value !== '';
  $('sim-seats').hidden = !simulating;
  $('sim-hint').hidden = !simulating;
  $('real-fields').classList.toggle('dimmed', simulating);
  $('login-fields').classList.toggle('dimmed', simulating);
}

async function save() {
  show($('form-error'));
  const pw = field('password').value;
  const token = field('bridgeToken').value;
  const { errors } = await api.saveSettings(readForm(), pw === '' ? undefined : pw, token === '' ? undefined : token);
  if (errors.length) {
    show($('form-error'), errors.join('\n'));
    return false;
  }
  fill(await api.getSettings());
  if (serverState === 'running') {
    dirtySinceStart = true;
    show($('form-notice'), 'Saved. Restart the server to apply the changes.');
  } else {
    show($('form-notice'), 'Saved.');
    setTimeout(() => { if (!dirtySinceStart) show($('form-notice')); }, 2_500);
  }
  return true;
}

function renderServer({ state, error }) {
  serverState = state;
  const pill = $('server-pill');
  pill.dataset.state = state;
  pill.textContent = `Server: ${SERVER_LABELS[state] ?? state}`;
  show($('status-error'), state === 'crashed' ? error : '');
  const busy = state === 'starting' || state === 'stopping';
  const running = state === 'running';
  $('start-stop').textContent = running ? (dirtySinceStart ? 'Restart server' : 'Stop server') : 'Start server';
  $('start-stop').disabled = busy;
  $('launch-gui').disabled = !running;
  if (!running) renderDicentis(null);
}

function renderDicentis(status) {
  const pill = $('dicentis-pill');
  if (!status) {
    pill.dataset.state = 'disconnected';
    pill.textContent = 'DICENTIS: not connected';
    pill.title = '';
    return;
  }
  const failed = status.state === 'disconnected' && status.lastError;
  pill.dataset.state = failed ? 'error' : status.state;
  const who = status.simulated ? ` (simulated: ${status.simulated.name})` : status.user && status.host ? ` (${status.user}@${status.host})` : '';
  pill.textContent = `${status.simulated ? 'Simulation' : 'DICENTIS'}: ${failed ? 'connection failed' : DICENTIS_LABELS[status.state] ?? status.state}${status.state === 'loggedIn' ? who : ''}`;
  pill.title = status.lastError?.message ?? '';
}

/** One pill per bridge the launcher started (or could not start). */
function renderBridges(list) {
  const box = $('bridge-pills');
  box.replaceChildren(...list.map(b => {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.dataset.state = b.state === 'running' ? 'loggedIn' : b.state === 'crashed' || b.state === 'missing' ? 'error' : b.state === 'starting' ? 'connecting' : 'disconnected';
    pill.textContent = `${b.name}: ${BRIDGE_LABELS[b.state] ?? b.state}`;
    pill.title = b.error ?? (b.port ? `127.0.0.1:${b.port}` : '');
    return pill;
  }));
}

function appendLog(line) {
  const log = $('log');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
  log.textContent += `${line}\n`;
  const lines = log.textContent.split('\n');
  if (lines.length > 500) log.textContent = lines.slice(-500).join('\n');
  if (atBottom) log.scrollTop = log.scrollHeight;
}

async function startStop() {
  show($('form-error'));
  try {
    if (serverState === 'running') {
      const restart = dirtySinceStart;
      await api.stopServer();
      if (!restart) return;
    }
    if (!(await save())) return;
    dirtySinceStart = false;
    show($('form-notice'));
    await api.startServer();
  } catch (err) {
    show($('form-error'), err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

form.addEventListener('submit', e => { e.preventDefault(); save(); });
field('system').addEventListener('change', () => {
  // A port that is just the previous system's default would pin the wrong port for the new one (WO-069): empty = default.
  if (Number(field('port').value) === DEFAULT_PORTS[shownSystem]) field('port').value = '';
  updatePortPlaceholder();
});
field('smdStream').addEventListener('change', updatePortPlaceholder);
field('simulate').addEventListener('change', updatePortPlaceholder);
field('dcnmBridge').addEventListener('change', updatePortPlaceholder);
field('lanAccess').addEventListener('change', () => { $('lan-hint').hidden = !field('lanAccess').checked; });
$('start-stop').addEventListener('click', startStop);
$('launch-gui').addEventListener('click', () => api.launchGui().catch(err => show($('form-error'), err.message)));
$('toggle-password').addEventListener('click', () => {
  const pw = field('password');
  const visible = pw.type === 'text';
  pw.type = visible ? 'password' : 'text';
  $('toggle-password').textContent = visible ? 'Show' : 'Hide';
  $('toggle-password').setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
});

api.onServerState(renderServer);
api.onLog(appendLog);
api.onDicentisStatus(renderDicentis);
api.onBridges(renderBridges);

fill(await api.getSettings());
const status = await api.serverStatus();
renderServer(status);
status.log.forEach(appendLog);
renderBridges(await api.bridgesStatus());
