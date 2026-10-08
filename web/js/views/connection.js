// Connection: DICENTIS connection status and settings (WO-018, backend WO-013).
// Simulation (WO-095, DEC-026): simulated systems (type + seats) that run inside LikeABosch; connecting to one uses it
// instead of the configured system, and each simulated system has its own project (DEC-025).
import { h, replace, humanize, toast, toastError, confirmAction } from '../dom.js';

const SYSTEM_NAME = { wired: 'DICENTIS', wireless: 'DICENTIS Wireless', dcn: 'DCN', 'dcn-smd': 'DCN (meeting data)' };
const DEFAULT_PORTS = { wired: 31416, wireless: 80, dcn: 9480, 'dcn-smd': 20000 };
const STATE_LABEL = {
  disconnected: 'Disconnected', connecting: 'Connecting…', connected: 'Logging in…', loggedIn: 'Connected', reconnecting: 'Reconnecting…',
};

export default {
  id: 'connection',
  title: 'Connection',
  mount(el, { store, api }) {
    const statusBox = h('div', { class: 'card-body' });
    const form = h('form', { class: 'settings', novalidate: true });
    const formError = h('p', { class: 'error', hidden: true });
    let settings = null;

    function renderStatus() {
      const c = store.state.connection;
      if (!c) return replace(statusBox, h('p', { class: 'muted' }, 'Waiting for backend…'));
      replace(statusBox,
        h('p', { class: 'headline' }, h('span', { class: ['pill', c.state] }, STATE_LABEL[c.state] ?? c.state),
          c.simulated ? h('span', { class: 'tag sim-tag' }, `Simulated: ${c.simulated.name}`) : null),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'System'), h('span', { class: 'v' }, SYSTEM_NAME[c.system] ?? humanize(c.system))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, { dcn: 'Bridge', 'dcn-smd': 'DCN-SW server' }[c.system] ?? 'Server'), h('span', { class: 'v' }, c.host ? `${c.host}:${c.port}` : '—')),
        c.system === 'dcn-smd' ? null : h('div', { class: 'kv' }, h('span', { class: 'k' }, 'User'), h('span', { class: 'v' }, c.user || '—')),
        c.connectedSince ? h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Since'), h('span', { class: 'v' }, new Date(c.connectedSince).toLocaleString())) : null,
        c.stream ? h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Meeting data stream'),
          h('span', { class: 'v' }, `${c.stream.host}:${c.stream.port} · `, h('span', { class: ['pill', c.stream.state] }, STATE_LABEL[c.stream.state] ?? c.stream.state))) : null,
        c.stream?.lastError && c.stream.state !== 'loggedIn' ? h('p', { class: 'muted small-text' }, `Stream: ${c.stream.lastError.message} (the bridge is not affected; check AllowedClients and the DCN-SWSMD licence)`) : null,
        c.dcnm ? h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Full DICENTIS API'),
          h('span', { class: 'v' }, `dicentis-bridge ${c.dcnm.host}:${c.dcnm.port}${c.dcnm.bridge?.fake ? ' (simulated)' : ''} · `, h('span', { class: ['pill', c.dcnm.state] }, STATE_LABEL[c.dcnm.state] ?? c.dcnm.state))) : null,
        c.dcnm?.lastError && c.dcnm.state !== 'loggedIn' ? h('p', { class: 'muted small-text' }, `dicentis-bridge: ${c.dcnm.lastError.message} (the Conference Protocol connection is not affected)`) : null,
        c.lastError ? h('p', { class: 'error' }, `${c.lastError.code}: ${c.lastError.message}`) : null,
        c.lastError?.reason === 'alreadyLoggedIn'
          ? h('p', null, h('button', { type: 'button', class: 'secondary', onclick: () => connect({ override: true }) }, 'Take over session'),
            h('small', { class: 'muted' }, ' Logs out the other session of this user on the WAP.'))
          : null,
        c.permissions?.length
          ? h('details', null, h('summary', null, `Permissions (${c.permissions.length})`),
            h('ul', { class: 'chips' }, c.permissions.map(p => h('li', null, p))))
          : null,
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'primary', onclick: () => connect(), disabled: c.state === 'connecting' }, c.state === 'disconnected' ? 'Connect' : 'Reconnect'),
          h('button', { type: 'button', class: 'secondary', onclick: disconnect, disabled: c.state === 'disconnected' }, 'Disconnect'),
          c.simulated ? null : h('button', { type: 'button', class: 'secondary', onclick: showSimulation }, 'Simulate a system…')),
      );
    }

    const field = (name, label, input, hint) => {
      const pinned = settings.pinned.includes(name);
      if (pinned) input.disabled = true;
      return h('label', { class: 'field' }, h('span', null, label), input,
        pinned ? h('small', { class: 'muted' }, 'Set by the launcher / .env') : hint ? h('small', { class: 'muted' }, hint) : null);
    };

    function renderForm() {
      const s = settings;
      const dcnFields = h('div', { class: 'dcn-fields', hidden: s.system !== 'dcn' },
        h('p', { class: 'muted hint' }, 'Host and port are the dcn-bridge on the DCN-SW PC; username and password are the DCN-SW user.'),
        field('dcnServer', 'DCN-SW server (as seen from the bridge)', h('input', { name: 'dcnServer', value: s.dcnServer ?? '', spellcheck: 'false', placeholder: 'tcp://localhost:9461' })),
        field('bridgeToken', 'Bridge token (optional)', h('input', { name: 'bridgeToken', type: 'password', autocomplete: 'new-password', placeholder: s.bridgeTokenSet ? '•••••••• (set, leave empty to keep)' : 'only if dcn-bridge runs with --token' }),
          'Kept in memory by the backend only, like the password.'),
        // Meeting data stream next to the bridge (DEC-020): live interpreter desks.
        field('smdStream', 'Meeting data stream', h('span', { class: 'check' }, h('input', { type: 'checkbox', name: 'smdStream', checked: s.smdStream }), ' Also read the DCN-SW meeting data stream (live interpreter desks)')),
        h('div', { class: 'row' },
          field('smdHost', 'Stream host', h('input', { name: 'smdHost', value: s.smdHost ?? '', spellcheck: 'false', placeholder: 'same as the bridge' })),
          field('smdPort', 'Stream port', h('input', { name: 'smdPort', type: 'number', min: 1, max: 65535, value: String(s.smdPort ?? 20000) }))));
      const tlsField = field('tlsInsecure', 'Security', h('span', { class: 'check' }, h('input', { type: 'checkbox', name: 'tlsInsecure', checked: s.tlsInsecure }), ' Accept self-signed server certificate'));
      tlsField.hidden = s.system === 'dcn' || s.system === 'dcn-smd'; // plain TCP (DEC-017, DEC-018)
      const smdHint = h('p', { class: 'muted hint smd-hint', hidden: s.system !== 'dcn-smd' },
        'Host = the PC running the DCN-SW server (default port 20000). Read-only, no login: the DCN-SW server accepts clients by IP address (AllowedClients in Server.exe.config) and needs DCN-SWSMD in the CCU licence.');
      const userField = field('user', 'Username', h('input', { name: 'user', value: s.user, autocomplete: 'off' }));
      const passwordField = field('password', 'Password', h('input', { name: 'password', type: 'password', autocomplete: 'new-password', placeholder: s.passwordSet ? '•••••••• (set, leave empty to keep)' : '' }),
        'Kept in memory by the backend only; re-enter after a backend restart.');
      const loginHidden = system => system === 'dcn-smd';
      userField.hidden = passwordField.hidden = loginHidden(s.system);
      replace(form,
        field('system', 'System', h('select', { name: 'system' },
          h('option', { value: 'wired', selected: s.system === 'wired' }, 'DICENTIS (wired server)'),
          h('option', { value: 'wireless', selected: s.system === 'wireless' }, 'DICENTIS Wireless (WAP)'),
          h('option', { value: 'dcn-smd', selected: s.system === 'dcn-smd' }, 'DCN Next Generation: meeting data stream (read-only)'),
          h('option', { value: 'dcn', selected: s.system === 'dcn' }, 'DCN Next Generation: full control (via dcn-bridge)'))),
        smdHint,
        h('div', { class: 'row' },
          field('host', 'Host / IP address', h('input', { name: 'host', value: s.host, spellcheck: 'false', placeholder: 'dicentis-server.local' })),
          field('port', 'Port', h('input', { name: 'port', type: 'number', min: 1, max: 65535, value: String(s.port) }))),
        userField,
        passwordField,
        dcnFields,
        tlsField,
        field('autoConnect', 'Startup', h('span', { class: 'check' }, h('input', { type: 'checkbox', name: 'autoConnect', checked: s.autoConnect }), ' Connect automatically when the backend starts')),
        formError,
        h('div', { class: 'actions' },
          h('button', { type: 'submit', class: 'secondary' }, 'Save'),
          h('button', { type: 'button', class: 'primary', onclick: saveAndConnect }, 'Save & connect')),
      );
      const systemSelect = form.elements.namedItem('system');
      systemSelect.addEventListener('change', () => {
        const port = form.elements.namedItem('port');
        if (!port.disabled) port.value = String(DEFAULT_PORTS[systemSelect.value]);
        const tls = form.elements.namedItem('tlsInsecure');
        if (!settings.pinned.includes('tlsInsecure')) tls.disabled = systemSelect.value === 'wireless'; // HTTP API: no TLS
        dcnFields.hidden = systemSelect.value !== 'dcn';
        tlsField.hidden = systemSelect.value === 'dcn' || systemSelect.value === 'dcn-smd';
        smdHint.hidden = systemSelect.value !== 'dcn-smd';
        userField.hidden = passwordField.hidden = loginHidden(systemSelect.value);
      });
      // Pinned checkboxes live inside a span; disable them too.
      for (const name of settings.pinned) {
        const input = form.elements.namedItem(name);
        if (input) input.disabled = true;
      }
    }

    function readForm() {
      const patch = {};
      const val = name => form.elements.namedItem(name);
      for (const name of ['system', 'host', 'user']) if (!val(name).disabled) patch[name] = val(name).value.trim();
      if (!val('dcnServer').disabled && val('dcnServer').value.trim() !== '') patch.dcnServer = val('dcnServer').value.trim();
      if (!val('bridgeToken').disabled && val('bridgeToken').value !== '') patch.bridgeToken = val('bridgeToken').value;
      if (!val('smdHost').disabled) patch.smdHost = val('smdHost').value.trim();
      if (!val('smdPort').disabled && val('smdPort').value !== '') patch.smdPort = Number(val('smdPort').value);
      if (!val('port').disabled && val('port').value !== '') patch.port = Number(val('port').value);
      for (const name of ['tlsInsecure', 'autoConnect', 'smdStream']) if (!val(name).disabled) patch[name] = val(name).checked;
      if (!val('password').disabled && val('password').value !== '') patch.password = val('password').value;
      return patch;
    }

    async function save() {
      formError.hidden = true;
      try {
        settings = await api.connection.saveSettings(readForm());
        renderForm();
        return true;
      } catch (err) {
        formError.textContent = [err.message, ...(err.details ?? [])].join(' · ');
        formError.hidden = false;
        return false;
      }
    }

    async function connect(options = {}) {
      try {
        const status = await api.connection.connect(options);
        toast(`Connected to ${SYSTEM_NAME[status?.system] ?? 'the system'}`, 'success');
      } catch (err) {
        toastError(err, 'Connect failed: ');
      }
    }

    async function disconnect() {
      try { await api.connection.disconnect(); } catch (err) { toastError(err); }
    }

    async function saveAndConnect() {
      if (await save()) await connect();
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (await save()) toast('Settings saved', 'success');
    });

    // ---------------------------------------------------------------- simulation (WO-095)
    const simBox = h('div');
    let simEdit = null; // profile being edited, or {} for a new one
    const SIM_TYPES = [['wired', 'DICENTIS (wired)'], ['wireless', 'DICENTIS Wireless'], ['dcn', 'DCN NG (control)'], ['dcn-smd', 'DCN NG (meeting data)']];
    const newId = () => `sim-${Math.random().toString(16).slice(2, 10)}`;

    async function saveSims(simulators, extra = {}) {
      settings = await api.connection.saveSettings({ simulators, ...extra });
      renderSim();
      renderForm();
    }

    function renderSim() {
      if (!settings) return replace(simBox, h('p', { class: 'muted' }, 'Loading…'));
      const sims = settings.simulators ?? [];
      const active = store.state.connection?.simulated?.id;
      const form = simEdit ? (() => {
        const f = h('form', { class: 'sim-form row-inline', novalidate: true },
          h('label', { class: 'field' }, h('span', null, 'Name'), h('input', { name: 'name', value: simEdit.name ?? '', maxlength: 80, required: true, placeholder: 'Council chamber' })),
          h('label', { class: 'field' }, h('span', null, 'Type'), h('select', { name: 'type' }, SIM_TYPES.map(([v, t]) => h('option', { value: v, selected: v === (simEdit.type ?? 'wired') }, t)))),
          h('label', { class: 'field' }, h('span', null, 'Seats'), h('input', { name: 'seats', type: 'number', min: 1, max: 500, value: String(simEdit.seats ?? 20), class: 'narrow' })),
          // WO-101: wired simulations include the full DICENTIS API (simulated dicentis-bridge) unless switched off.
          h('label', { class: 'check', title: 'Only for DICENTIS (wired): audio & Dante, languages … through a simulated dicentis-bridge' },
            h('input', { type: 'checkbox', name: 'fullApi', checked: simEdit.fullApi !== false }), ' Full DICENTIS API'),
          h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary small' }, simEdit.id ? 'Save' : 'Add'),
            h('button', { type: 'button', class: 'secondary small', onclick: () => { simEdit = null; renderSim(); } }, 'Cancel')));
        f.addEventListener('submit', async e => {
          e.preventDefault();
          const name = f.elements.namedItem('name').value.trim();
          const seats = Number(f.elements.namedItem('seats').value);
          if (!name) return f.elements.namedItem('name').focus();
          const type = f.elements.namedItem('type').value;
          const profile = { id: simEdit.id ?? newId(), name, type, seats, ...(type === 'wired' && !f.elements.namedItem('fullApi').checked ? { fullApi: false } : {}) };
          try {
            await saveSims(simEdit.id ? sims.map(p => (p.id === simEdit.id ? profile : p)) : [...sims, profile]);
            simEdit = null;
            renderSim();
            if (active === profile.id) toast('Reconnect to apply the change to the running simulation', 'info');
          } catch (err) { toastError(err, 'Simulation: '); }
        });
        return f;
      })() : null;
      replace(simBox,
        h('p', { class: 'muted small-text' }, 'Prepare rooms, cameras and participants without hardware: a simulated system runs inside LikeABosch. Each simulated system has its own project; download it and load it at the venue, then match its seats to the real system (Room → "Match seats").'),
        sims.length ? h('ul', { class: 'sim-list' }, sims.map(p => h('li', { class: p.id === active ? 'current' : null, 'data-sim': p.id },
          h('span', { class: 'name' }, h('strong', null, p.name), h('small', { class: 'sub' }, `${SIM_TYPES.find(t => t[0] === p.type)?.[1] ?? p.type}${p.type === 'wired' && p.fullApi !== false ? ' + full API' : ''} · ${p.seats} seats${p.id === active ? ' · running' : ''}`)),
          h('span', { class: 'row-actions' },
            p.id === active ? null : h('button', { type: 'button', class: 'primary small', onclick: () => simulate(p) }, 'Simulate'),
            h('button', { type: 'button', class: 'secondary small', onclick: () => { simEdit = { ...p }; renderSim(); } }, 'Edit'),
            h('button', { type: 'button', class: 'small danger-outline', disabled: p.id === active, onclick: () => removeSim(p) }, 'Delete'))))) : h('p', { class: 'muted' }, 'No simulated systems yet.'),
        form ?? h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'secondary small', onclick: () => { simEdit = {}; renderSim(); } }, 'Add simulated system'),
          active ? h('button', { type: 'button', class: 'secondary small', onclick: leaveSimulation }, 'Back to the real system') : null));
    }

    async function simulate(p) {
      try {
        settings = await api.connection.saveSettings({ simulate: p.id });
        renderSim();
        await connect();
      } catch (err) { toastError(err, 'Simulation: '); }
    }
    async function leaveSimulation() {
      try {
        settings = await api.connection.saveSettings({ simulate: '' });
        renderSim();
        if (settings.host) await connect(); else await disconnect();
      } catch (err) { toastError(err, 'Simulation: '); }
    }
    async function removeSim(p) {
      if (!(await confirmAction(`Delete the simulated system "${p.name}"? Its project stays (Projects…).`, { confirmLabel: 'Delete', danger: true }))) return;
      try { await saveSims((settings.simulators ?? []).filter(x => x.id !== p.id), settings.simulate === p.id ? { simulate: '' } : {}); } catch (err) { toastError(err); }
    }

    /** WO-098: jump to the Simulation card (from the status card or `#/settings/connection?simulate`). */
    function showSimulation() {
      if (settings && !(settings.simulators ?? []).length && !simEdit) { simEdit = {}; renderSim(); }
      simCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      simCard.querySelector('input, button.primary')?.focus({ preventScroll: true });
    }
    const wantsSimulation = () => /[?&]simulate\b/.test(location.hash);
    const onHash = () => { if (wantsSimulation()) showSimulation(); };
    window.addEventListener('hashchange', onHash);

    const simCard = h('article', { class: 'card sim-card', id: 'simulation' }, h('h2', null, 'Simulation'), simBox);
    el.append(
      h('h1', { id: 'view-title' }, 'Connection'),
      h('div', { class: 'cards two' },
        h('article', { class: 'card' }, h('h2', null, 'Status'), statusBox),
        h('article', { class: 'card' }, h('h2', null, 'Settings'), form)),
      simCard,
    );

    renderStatus();
    renderSim();
    const off = store.subscribe(['connection'], () => { renderStatus(); renderSim(); });
    api.connection.settings().then(s => { settings = s; renderForm(); renderSim(); onHash(); }).catch(err => toastError(err));
    return () => { off(); window.removeEventListener('hashchange', onHash); };
  },
};
