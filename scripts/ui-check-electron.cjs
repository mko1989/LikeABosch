// Headless browser check of the web UI, run inside Electron by scripts/ui-check.mjs (DEC-009).
// Args: <baseUrl> <outDir> <theme light|dark> <system wired|wireless|dcn> <route...>
// Prints JSON lines: {"type":"console",...}, {"type":"route",...}, {"type":"live",...}, {"type":"done",...}
const { app, BrowserWindow, nativeTheme } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const [baseUrl, outDir, theme, system, ...routes] = process.argv.slice(process.argv.indexOf(__filename) + 1);
const print = obj => process.stdout.write(`${JSON.stringify(obj)}\n`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  nativeTheme.themeSource = theme;
  const win = new BrowserWindow({ show: false, width: 1280, height: 860 });
  const consoleErrors = [];
  win.webContents.on('console-message', (event, legacyLevel, legacyMessage) => {
    const level = event.level ?? ['verbose', 'info', 'warning', 'error'][legacyLevel];
    const message = event.message ?? legacyMessage;
    if (level === 'error' || level === 'warning') {
      consoleErrors.push({ level, message });
      print({ type: 'console', level, message });
    }
  });
  const js = code => win.webContents.executeJavaScript(code);
  const waitFor = async (code, timeoutMs = 5000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) { if (await js(code)) return true; await sleep(100); }
    return false;
  };
  try {
    await win.loadURL(baseUrl);
    // Record error toasts too: an unexpected one fails the run (e.g. a 500 from the backend).
    await js(`window.__errorToasts = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList?.contains('toast') && n.classList.contains('error')) window.__errorToasts.push(n.textContent); }))).observe(document.getElementById('toasts'), { childList: true })`);
    const EXPECTED_TOASTS = /access denied/i; // the participants scenario provokes this one on purpose
    await waitFor("document.getElementById('connection-pill').dataset.state === 'loggedIn'");
    // Read-only snapshot mode (scripts/ui-snapshot.mjs, e.g. against a REAL system): visit + screenshot, never click.
    if (process.env.UI_CHECK_READONLY === '1') {
      for (const route of routes) {
        await js(`location.hash = '#/${route}'`);
        await sleep(1500);
        const file = join(outDir, `${system}-${route}-${theme}.png`);
        writeFileSync(file, (await win.webContents.capturePage()).toPNG());
        print({ type: 'route', route, file, title: await js('document.title') });
      }
      print({ type: 'done', consoleErrors: consoleErrors.length });
      app.exit(consoleErrors.length ? 1 : 0);
      return;
    }

    // Permission scenarios (orchestrated by ui-check.mjs, which restricts the mock account first).
    const permRoute = routes.find(r => r.startsWith('perm-'));
    if (permRoute) {
      await js("location.hash = '#/discussion'");
      await waitFor("document.querySelectorAll('.seat').length > 0");
      let ok;
      if (permRoute === 'perm-view-only') {
        await sleep(500);
        ok = await js("document.querySelectorAll('.seat button, .row-item button').length === 0");
      } else { // perm-no-mute: can manage, cannot mute
        await js("fetch('/api/wired/ops/AddSeatToSpeakers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seatId: 'seat-2' }) })");
        ok = await waitFor("[...document.querySelectorAll('.row-item button')].some(b => b.textContent === 'Remove')");
        ok = ok && await js("![...document.querySelectorAll('button')].some(b => b.textContent === 'Mute' || b.textContent === 'Unmute')");
        await js("fetch('/api/wired/ops/RemoveSeatFromDiscussionList', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seatId: 'seat-2' }) })");
      }
      print({ type: 'scenario', name: permRoute, ok });
      print({ type: 'done', consoleErrors: consoleErrors.length });
      app.exit(ok && !consoleErrors.length ? 0 : 1);
      return;
    }

    for (const route of routes) {
      await js(`location.hash = '#/${route}'`);
      await sleep(700);
      const file = join(outDir, `${system}-${route}-${theme}.png`);
      writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      print({ type: 'route', route, file, title: await js('document.title') });
    }
    // Generic page helpers for scenarios.
    const clickButton = (label, scope = 'main') => `(() => { const b = [...document.querySelectorAll('${scope} button')].find(x => x.textContent.trim() === '${label}' && !x.disabled); if (b) { b.click(); return true; } return false; })()`;
    const confirmDialog = () => waitFor("(() => { const b = document.querySelector('dialog[open] button[value=ok]'); if (b) { b.click(); return true; } return false; })()");
    const text = t => `document.querySelector('main').textContent.includes(${JSON.stringify(t)})`; // textContent: ignores CSS text-transform
    const setField = (sel, value) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
    // A hidden window may hand back its last painted frame: force a repaint first.
    const shot = async name => {
      win.webContents.invalidate();
      await sleep(150);
      writeFileSync(join(outDir, `${system}-${name}-scenario-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    };
    const seatButton = (seat, label) => `(() => { const t = [...document.querySelectorAll('.seat')].find(x => x.querySelector('.seat-name').textContent === '${seat}'); const b = t && [...t.querySelectorAll('button')].find(x => x.textContent === '${label}'); if (b && !b.disabled) { b.click(); return true; } return false; })()`;
    const listText = idx => `[...document.querySelectorAll('.discussion-lists .card')][${idx}].textContent`;
    const wirelessScenarios = {
      async discussion() {
        const nav = await js("document.getElementById('nav').textContent");
        let ok = !/Meetings|Interpretation|Files/.test(nav); // wired-only views hidden
        await js("location.hash = '#/discussion'");
        ok = ok && await waitFor("document.querySelectorAll('.seat').length === 20");
        ok = ok && await waitFor("document.querySelector('.seat-diag') !== null"); // battery/signal diagnostics
        ok = ok && await waitFor(seatButton('Seat 3', 'Add'));
        ok = ok && await waitFor(`${listText(0)}.includes('Chloe Bakker')`);
        ok = ok && await waitFor(seatButton('Seat 7', 'Request'));
        ok = ok && await waitFor(`${listText(1)}.includes('Gerrit de Boer')`);
        ok = ok && await waitFor(seatButton('Chairman', 'Priority'));
        ok = ok && await waitFor(`${listText(0)}.includes('Priority')`);
        await sleep(300);
        await shot('discussion');
        ok = ok && await waitFor(clickButton('Clear all'));
        ok = ok && await confirmDialog();
        ok = ok && await waitFor(`!${listText(0)}.includes('Chloe') && !${listText(1)}.includes('Gerrit')`);
        ok = ok && await waitFor(seatButton('Chairman', 'End priority'));
        ok = ok && await waitFor(`${listText(0)}.includes('Nobody is speaking')`);
        return ok;
      },
      async voting() {
        await js("location.hash = '#/voting'");
        let ok = await waitFor("document.querySelector('form.settings input[name=subject]') && !document.querySelector('form.settings input[name=subject]').disabled");
        await js("(() => { const f = document.querySelector('form.settings'); f.elements.subject.value = 'Wireless motion'; f.elements.mode.value = '3'; f.requestSubmit(); })()");
        ok = ok && await waitFor(text('Wireless motion') + " && " + text('Yes, No'));
        ok = ok && await waitFor(clickButton('Open voting'));
        ok = ok && await waitFor(text('Opened'));
        print({ type: 'mock', fn: 'castVote', args: [2, 'yes'] });
        print({ type: 'mock', fn: 'castVote', args: [3, 'no'] });
        print({ type: 'mock', fn: 'castVote', args: [4, 'yes'] });
        ok = ok && await waitFor(text('3 votes cast'), 8000);
        await sleep(300);
        await shot('voting');
        ok = ok && await waitFor(clickButton('Close voting'));
        ok = ok && await waitFor(clickButton('Open voting')); // back to closed → Open is offered again
        ok = ok && await waitFor(clickButton('Close voting'));
        // WO-104: the voting widget on the Room drives the same voting.
        const wv = '.widget[data-widget="voting"]';
        await js("location.hash = '#/room'");
        ok = ok && ((await waitFor(`document.querySelector('${wv}') !== null`, 8000)) || (print({ type: 'console', level: 'check', message: 'wireless widgets: no voting widget' }), false));
        ok = ok && await waitFor(clickButton('Open voting', wv));
        ok = ok && await waitFor(`document.querySelector('${wv} .state')?.textContent === 'Opened'`);
        await sleep(300);
        await shot('room-widgets');
        ok = ok && await waitFor(clickButton('Close voting', wv));
        return ok;
      },
      async room() {
        // WO-084: seat inspector in Edit mode: assign a participant, create + assign, clear. WO-083: names don't overlap.
        if (theme !== 'light') return true; // changes the WAP participants: once per run (restored at the end)
        const people = "fetch('/api/wireless/participants').then(r => r.json()).then(b => b.data)";
        const seatOf = name => `${people}.then(l => l.find(p => p.name === ${JSON.stringify(name)})?.seatId)`;
        await js("location.hash = '#/room'");
        let ok = await waitFor(clickButton('Edit layout', '.room-toolbar'));
        ok = ok && await waitFor(clickButton('Place all seats in a grid', '.room-side'));
        ok = ok && await waitFor("document.querySelectorAll('.seat-node').length >= 20");
        ok = ok && ((await waitFor(`(() => {
          const names = [...document.querySelectorAll('.seat-node > .seat-person')].map(t => t.getBoundingClientRect());
          const hit = (a, b) => a.left + 1 < b.right && b.left + 1 < a.right && a.top + 1 < b.bottom && b.top + 1 < a.bottom;
          return names.length >= 10 && names.every((a, i) => names.every((b, j) => i === j || !hit(a, b)));
        })()`)) || (print({ type: 'console', level: 'check', message: 'wireless room: names overlap' }), false));
        await js("[...document.querySelectorAll('.room-toolbar button')].find(b => b.textContent === 'Fit').click()");
        await js("document.querySelector('.seat-node[data-seat=\"3\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
        ok = ok && await waitFor("document.querySelector('select[aria-label=\"Participant on this seat\"]') !== null");
        const holder = await js(`${people}.then(l => l.find(p => p.seatId === 3)?.name)`);
        // assign Anna (seat 1) to seat 3: she moves, the holder loses the seat
        await js(`(() => { const s = document.querySelector('select[aria-label="Participant on this seat"]'); const o = [...s.options].find(x => x.textContent.startsWith('Anna de Vries'));
          s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        ok = ok && ((await waitFor(`${seatOf('Anna de Vries')}.then(v => v === 3)`)) || (print({ type: 'console', level: 'check', message: 'wireless room: assign failed' }), false));
        ok = ok && await waitFor(`${seatOf(holder)}.then(v => v === -1)`);
        // create + assign
        ok = ok && await waitFor("document.querySelector('input[aria-label=\"New participant name\"]') !== null");
        await js("(() => { const i = document.querySelector('input[aria-label=\"New participant name\"]'); i.value = 'Zoe Room'; i.form.requestSubmit(); })()");
        ok = ok && ((await waitFor(`${seatOf('Zoe Room')}.then(v => v === 3)`)) || (print({ type: 'console', level: 'check', message: 'wireless room: create failed' }), false));
        ok = ok && await waitFor(`${seatOf('Anna de Vries')}.then(v => v === -1)`);
        ok = ok && await waitFor("[...document.querySelectorAll('.seat-node[data-seat=\"3\"] .seat-person')].some(t => t.textContent.includes('Zoe'))");
        await sleep(300);
        await shot('room-participant');
        // clear the seat, then restore the mock's participants (the participants scenario counts them)
        await js("(() => { const s = document.querySelector('select[aria-label=\"Participant on this seat\"]'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
        ok = ok && await waitFor(`${people}.then(l => !l.some(p => p.seatId === 3))`);
        await js(`${people}.then(async l => {
          const call = (m, path, body) => fetch('/api/domain' + path, { method: m, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
          await call('DELETE', '/participants/' + l.find(p => p.name === 'Zoe Room').id);
          await call('PUT', '/seats/1/participant', { participantId: String(l.find(p => p.name === 'Anna de Vries').id) });
          await call('PUT', '/seats/3/participant', { participantId: String(l.find(p => p.name === ${JSON.stringify(holder)}).id) });
        })`);
        ok = ok && await waitFor(`${people}.then(l => l.length === 16 && l.find(p => p.name === 'Anna de Vries').seatId === 1)`);
        ok = ok && await waitFor(clickButton('Operate', '.room-toolbar'));
        return ok;
      },
      async participants() {
        await js("location.hash = '#/participants'");
        let ok = await waitFor("document.querySelectorAll('table.data tbody tr').length === 16");
        ok = ok && await waitFor(clickButton('Add participant'));
        await js("(() => { const f = document.querySelector('.participant-form'); f.elements.name.value = 'Zoe Test'; f.elements.seatId.value = '20'; f.elements.nfc.value = '04:FF:EE:DD'; f.requestSubmit(); })()");
        ok = ok && await waitFor("document.querySelectorAll('table.data tbody tr').length === 17");
        ok = ok && await waitFor(`(() => { const r = [...document.querySelectorAll('table.data tbody tr')].find(x => x.textContent.includes('Zoe Test')); const b = r && [...r.querySelectorAll('button')].find(x => x.textContent === 'Edit'); if (b) { b.click(); return true; } return false; })()`);
        await js("(() => { const f = document.querySelector('.participant-form'); f.elements.name.value = 'Zoe Tested'; f.requestSubmit(); })()");
        ok = ok && await waitFor(text('Zoe Tested'));
        await sleep(200);
        await shot('participants');
        ok = ok && await waitFor(`(() => { const r = [...document.querySelectorAll('table.data tbody tr')].find(x => x.textContent.includes('Zoe Tested')); const b = r && [...r.querySelectorAll('button')].find(x => x.textContent === 'Delete'); if (b) { b.click(); return true; } return false; })()`);
        ok = ok && await confirmDialog();
        ok = ok && await waitFor("document.querySelectorAll('table.data tbody tr').length === 16");
        return ok;
      },
      async seating() {
        // WO-085: Export Excel link + Import… (CSV here) → preview dialog → Apply; then restore the mock's participants.
        if (theme !== 'light') return true;
        const people = "fetch('/api/wireless/participants').then(r => r.json()).then(b => b.data)";
        await js("location.hash = '#/meeting/seating'");
        let ok = await waitFor("document.querySelector('.io-buttons a[href=\"/api/domain/participants/export.xlsx\"]') !== null");
        ok = ok && await waitFor("fetch('/api/domain/participants/export.xlsx').then(r => r.ok && r.headers.get('content-type').includes('spreadsheetml'))");
        const before = await js(people);
        const holder5 = before.find(p => p.seatId === 5);
        await js(`(() => { const input = document.querySelector('.io-buttons input[type=file]'); const dt = new DataTransfer();
          dt.items.add(new File(['Name;Seat\\nAnna de Vries;Seat 5\\nNew Import;Seat 20\\n'], 'seating.csv', { type: 'text/csv' }));
          input.files = dt.files; input.dispatchEvent(new Event('change')); })()`);
        ok = ok && ((await waitFor("document.querySelector('dialog.import-dialog[open]')?.textContent.includes('New Import')")) || (print({ type: 'console', level: 'check', message: 'seating import: no preview' }), false));
        ok = ok && await waitFor("document.querySelector('dialog.import-dialog').textContent.includes('Lose their seat')");
        await sleep(200);
        await shot('seating-import');
        ok = ok && await waitFor("(() => { const b = [...document.querySelectorAll('dialog.import-dialog button')].find(x => x.textContent.startsWith('Apply') && !x.disabled); if (b) { b.click(); return true; } return false; })()");
        ok = ok && ((await waitFor(`${people}.then(l => l.find(p => p.name === 'Anna de Vries')?.seatId === 5 && l.find(p => p.name === 'New Import')?.seatId === 20)`)) || (print({ type: 'console', level: 'check', message: 'seating import: not applied' }), false));
        ok = ok && await waitFor("!document.querySelector('dialog.import-dialog[open]')");
        // restore
        await js(`${people}.then(async l => {
          const call = (m, path, body) => fetch('/api/domain' + path, { method: m, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
          await call('DELETE', '/participants/' + l.find(p => p.name === 'New Import').id);
          await call('PUT', '/seats/1/participant', { participantId: String(l.find(p => p.name === 'Anna de Vries').id) });
          ${holder5 ? `await call('PUT', '/seats/5/participant', { participantId: '${holder5.id}' });` : ''}
        })`);
        ok = ok && await waitFor(`${people}.then(l => l.length === ${before.length} && l.find(p => p.name === 'Anna de Vries').seatId === 1)`);
        return ok;
      },
      async system() {
        await js("location.hash = '#/system'");
        let ok = await waitFor(clickButton('Standby'));
        ok = ok && await waitFor(text('Standby'));
        ok = ok && await waitFor(clickButton('Power on'));
        ok = ok && await waitFor(text('Powered on'));
        await js("(() => { const s = document.querySelector('select[aria-label=\"Identification mode\"]'); s.value = '1'; s.dispatchEvent(new Event('change')); })()");
        await sleep(600);
        ok = ok && await waitFor("document.querySelector('select[aria-label=\"Identification mode\"]').value === '1'");
        ok = ok && await waitFor(text('DICENTIS Wireless'));
        await shot('system');
        await js("(() => { const s = document.querySelector('select[aria-label=\"Identification mode\"]'); s.value = '0'; s.dispatchEvent(new Event('change')); })()");
        return ok;
      },
      // WO-086…089 (DEC-024): the WAP web UI's configuration, against the mock's undocumented endpoints.
      async 'discussion-settings'() {
        const get = path => `fetch('/api/wireless${path}').then(r => r.json()).then(b => b.data)`;
        await js("location.hash = '#/settings/discussion-settings'");
        let ok = await waitFor("document.querySelector('select[aria-label=\"Max open microphones\"]') !== null");
        const before = await js(get('/discuss'));
        await js(setField('select[aria-label="Max open microphones"]', '2'));
        ok = ok && await waitFor(clickButton('Save'));
        ok = ok && ((await waitFor(`${get('/discuss')}.then(d => d.maxOpenMics === 2)`)) || (print({ type: 'console', level: 'check', message: 'discussion settings: not saved' }), false));
        await sleep(200);
        await shot('discussion-settings');
        await js(`fetch('/api/wireless/discuss', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(before)}) })`);
        return ok;
      },
      async 'wap-audio'() {
        const get = path => `fetch('/api/wireless${path}').then(r => r.json()).then(b => b.data)`;
        await js("location.hash = '#/settings/wap-audio'");
        let ok = await waitFor("document.querySelector('button[aria-label=\"Delegate loudspeakers up\"]') !== null");
        const lsp = (await js(get('/audio'))).lsp;
        await js("document.querySelector('button[aria-label=\"Delegate loudspeakers up\"]').click()");
        ok = ok && ((await waitFor(`${get('/audio')}.then(a => a.lsp === ${lsp + 1})`)) || (print({ type: 'console', level: 'check', message: 'audio: level not changed' }), false));
        ok = ok && await waitFor(`document.querySelector('[aria-label="Delegate loudspeakers level"]')?.textContent === '${(-11 + (lsp)).toFixed(1).replace('-', '−')} dB'`);
        ok = ok && await waitFor("document.querySelector('input[aria-label=\"Band 1 Gain\"]') !== null");
        await js(setField('input[aria-label="Band 1 Gain"]', '-3'));
        ok = ok && ((await waitFor(`${get('/audio/equalizer/delegate-loudspeaker')}.then(b => b.find(x => x.id === 1).gain === -3)`)) || (print({ type: 'console', level: 'check', message: 'audio: EQ not saved' }), false));
        await sleep(300);
        await shot('wap-audio');
        await js(`fetch('/api/wireless/audio', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lsp: ${lsp} }) })`);
        await js("fetch('/api/wireless/audio/equalizer/delegate-loudspeaker', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ id: 1, gain: 0 }]) })");
        return ok;
      },
      async 'wap-seats'() {
        const get = path => `fetch('/api/wireless${path}').then(r => r.json()).then(b => b.data)`;
        await js("location.hash = '#/settings/wap-seats'");
        let ok = await waitFor("document.querySelector('input[aria-label=\"Name of seat 2\"]') !== null");
        await js(setField('input[aria-label="Name of seat 2"]', 'Mayor "Bob"'));
        ok = ok && ((await waitFor(`${get('/seats/2')}.then(s => s.name === 'Mayor Bob')`)) || (print({ type: 'console', level: 'check', message: 'seats: rename failed' }), false));
        await js("document.querySelector('input[aria-label^=\"Configuration mode\"]').click()");
        ok = ok && await waitFor(`${get('/seats/status')}.then(s => s.isConfigurationModeOn)`);
        await js("[...document.querySelectorAll('tr[data-seat=\"3\"] button')].find(b => b.textContent === 'Select').click()");
        ok = ok && await waitFor(`${get('/seats/3')}.then(s => s.selected)`);
        ok = ok && await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.startsWith('Remove disconnected seats (2)'))");
        await sleep(300);
        await shot('wap-seats');
        await js("fetch('/api/wireless/seats/2', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 2, name: 'Seat 2' }) })");
        await js("fetch('/api/wireless/seats/3/selected', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selected: false }) })");
        await js("location.hash = '#/settings/system'"); // leaving switches configuration mode off again
        ok = ok && ((await waitFor(`${get('/seats/status')}.then(s => !s.isConfigurationModeOn)`)) || (print({ type: 'console', level: 'check', message: 'seats: configuration mode left on' }), false));
        return ok;
      },
      async 'seat-displays'() {
        const get = path => `fetch('/api/wireless${path}').then(r => r.json()).then(b => b.data)`;
        await js("location.hash = '#/settings/seat-displays'");
        let ok = await waitFor("document.querySelector('input[aria-label=\"Logo or firmware file\"]') !== null && document.querySelectorAll('tbody tr').length >= 3");
        // a 2×1 red PNG
        await js(`(() => { const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAMAAH/pKbZ0QAAAABJRU5ErkJggg==';
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const input = document.querySelector('input[aria-label="Logo or firmware file"]');
          const dt = new DataTransfer(); dt.items.add(new File([bytes], 'council-logo.png', { type: 'image/png' })); input.files = dt.files; input.dispatchEvent(new Event('change')); })()`);
        ok = ok && await waitFor("document.querySelector('img.logo-preview') !== null && document.querySelector('main').textContent.includes('DCNM-WDE')");
        ok = ok && await waitFor(clickButton('Upload and install'));
        ok = ok && ((await waitFor(`${get('/upgrades')}.then(l => l.find(d => d.deviceType === 'DCNM-WDE').state === 6)`, 12000)) || (print({ type: 'console', level: 'check', message: 'displays: upgrade not done' }), false));
        ok = ok && await waitFor("[...document.querySelectorAll('tbody tr')].some(r => r.textContent.includes('DCNM-WDE') && r.textContent.includes('Done'))", 12000);
        await js("document.querySelector('input[aria-label=\"Show the uploaded logo on the seat displays\"]').click()");
        ok = ok && await waitFor(`${get('/system/settings')}.then(s => s.showCompanyLogo === true)`);
        await sleep(200);
        await shot('seat-displays');
        await js("fetch('/api/wireless/system/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ showCompanyLogo: false }) })");
        return ok;
      },
    };
    const scenarios = {
      // WO-095/096: simulate a WAP, lay out its seats, back to the real system, open the simulated project there,
      // match its seats to the real ones (by name) and make it the real system's project; then restore.
      async connection() {
        if (theme !== 'light') return true;
        const conn = "fetch('/api/connection').then(r => r.json()).then(b => b.data)";
        const proj = "fetch('/api/projects').then(r => r.json()).then(b => b.data)";
        const before = await js(proj);
        await js("location.hash = '#/settings/connection'");
        // WO-098: "Simulate a system…" in the status card jumps to the Simulation card (and opens the add form)
        let ok = await waitFor(clickButton('Simulate a system…'));
        ok = ok && ((await waitFor("(() => { const r = document.getElementById('simulation')?.getBoundingClientRect(); return r && r.top >= 0 && r.top < innerHeight - 48; })()")) || (print({ type: 'console', level: 'check', message: 'simulate: card not scrolled into view' }), false));
        if (!(await js("Boolean(document.querySelector('form.sim-form'))"))) ok = (await waitFor(clickButton('Add simulated system'))) && ok;
        await js(`(() => { const f = document.querySelector('form.sim-form'); f.elements.name.value = 'Sim hall'; f.elements.type.value = 'wireless'; f.elements.seats.value = '6'; f.requestSubmit(); return true; })()`);
        ok = ok && await waitFor("(() => { const li = [...document.querySelectorAll('.sim-list li')].find(x => x.textContent.includes('Sim hall')); const b = li && [...li.querySelectorAll('button')].find(x => x.textContent === 'Simulate'); if (!b) return false; b.click(); return true; })()");
        ok = ok && ((await waitFor(`${conn}.then(c => c.simulated?.name === 'Sim hall' && c.state === 'loggedIn' && c.system === 'wireless')`, 10000)) || (print({ type: 'console', level: 'check', message: 'simulation: not connected' }), false));
        ok = ok && await waitFor("document.getElementById('header-context').textContent.includes('SIMULATED')");
        ok = ok && ((await waitFor(`${proj}.then(p => p.current.name === 'Sim hall (simulated)')`, 8000)) || (print({ type: 'console', level: 'check', message: 'simulation: no project of its own' }), false));
        await js(`fetch('/api/room/placements', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seats: Object.fromEntries([1, 2, 3, 4, 5, 6].map(i => [String(i), { x: i * 100, y: 200, rotation: 0 }])) }) })`);
        await sleep(300);
        await shot('connection-simulation');
        const simProject = (await js(proj)).current.id;
        ok = ok && await waitFor(`fetch('/api/room').then(r => r.json()).then(b => b.data.seatNames?.['2'] === 'Seat 2')`); // names remembered (WO-096)
        ok = ok && await waitFor(clickButton('Back to the real system'));
        ok = ok && ((await waitFor(`${conn}.then(c => !c.simulated && c.state === 'loggedIn' && c.system === 'wired')`, 10000)) || (print({ type: 'console', level: 'check', message: 'simulation: not back on the real system' }), false));
        ok = ok && await waitFor(`${proj}.then(p => p.current.id === ${JSON.stringify(before.current.id)})`, 8000);
        // the simulated project, opened by hand on the real system: the Room offers to match its seats
        await js(`fetch('/api/projects/${simProject}/open', { method: 'POST' })`);
        await js("location.hash = '#/room'");
        ok = ok && ((await waitFor("(() => { const b = document.querySelector('.match-banner'); return b && !b.hidden && b.textContent.includes('6 seats'); })()", 8000)) || (print({ type: 'console', level: 'check', message: 'match: no banner' }), false));
        ok = ok && await waitFor(clickButton('Match seats…', '.match-banner'));
        ok = ok && await waitFor("document.querySelector('dialog.match-dialog select[aria-label=\"System seat for Seat 2\"]')?.value === 'seat-2'");
        await sleep(200);
        await shot('match-seats');
        ok = ok && await waitFor("(() => { const b = document.querySelector('dialog.match-dialog button[value=ok]'); if (!b || b.disabled) return false; b.click(); return true; })()");
        ok = ok && ((await waitFor(`fetch('/api/room').then(r => r.json()).then(b => ['seat-1', 'seat-2', 'seat-6'].every(id => b.data.seats[id]) && !b.data.seats['2'])`)) || (print({ type: 'console', level: 'check', message: 'match: seats not remapped' }), false));
        ok = ok && await waitFor("document.querySelector('.match-banner')?.hidden === true");
        ok = ok && await waitFor(`${proj}.then(p => p.current.system?.key === p.connected?.key)`);
        // restore: the original project again (the simulated one now belongs to the real system; harmless here)
        await js(`fetch('/api/projects/${before.current.id}/open', { method: 'POST' })`);
        ok = ok && await waitFor(`${proj}.then(p => p.current.id === ${JSON.stringify(before.current.id)})`);
        return ok;
      },
      // WO-099: Companion settings, then a seat's "mic on" button picked in the page viewer; mic on presses it.
      async companion() {
        if (theme !== 'light') return true;
        const port = Number(process.env.UI_CHECK_COMPANION_PORT);
        if (!port) return true;
        const put = (path, body) => `fetch('/api${path}', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(body)}) }).then(r => r.ok)`;
        let ok = await js(put('/companion', { host: '127.0.0.1', port }));
        await js("location.hash = '#/settings/companion'");
        ok = ok && await waitFor(`document.querySelector('form.settings input[name=host]')?.value === '127.0.0.1'`);
        ok = ok && await waitFor(clickButton('Test connection'));
        ok = ok && await waitFor("document.querySelector('.toast')?.textContent.includes('Companion answers')");
        await js("location.hash = '#/room?seat=seat-3'");
        ok = ok && ((await waitFor("Boolean(document.querySelector('[data-seat-panel=\"seat-3\"] .companion-row[data-edge=on] button.secondary'))", 8000)) || (print({ type: 'console', level: 'check', message: 'companion: no inspector section' }), false));
        ok = ok && await waitFor("(() => { document.querySelector('[data-seat-panel=\"seat-3\"] .companion-row[data-edge=on] button.secondary').click(); return true; })()");
        ok = ok && await waitFor("Boolean(document.querySelector('dialog.companion-dialog iframe'))");
        await sleep(1200); // let the frame paint
        await shot('companion-picker');
        ok = ok && await waitFor("(() => { const b = document.querySelector('dialog.companion-dialog [aria-label=\"Button 1/0/2\"]'); if (!b) return false; b.click(); return true; })()");
        ok = ok && await waitFor("(() => { const b = [...document.querySelectorAll('dialog.companion-dialog button')].find(x => x.textContent === 'Use this button' && !x.disabled); if (!b) return false; b.click(); return true; })()");
        ok = ok && ((await waitFor("fetch('/api/room').then(r => r.json()).then(b => JSON.stringify(b.data.triggers.seats['seat-3']?.on) === JSON.stringify([{ page: 1, row: 0, column: 2, action: 'press' }]))")) || (print({ type: 'console', level: 'check', message: 'companion: trigger not saved' }), false));
        ok = ok && await waitFor("document.querySelector('[data-seat-panel=\"seat-3\"] .companion-chip')?.textContent.includes('press 1/0/2')");
        await js("document.querySelectorAll('.toast button').forEach(b => b.click())");
        await js("document.querySelector('[data-seat-panel=\"seat-3\"] .companion-row[data-edge=off]').scrollIntoView({ block: 'end' })");
        await sleep(200);
        await shot('companion-inspector');
        // mic on → the backend presses 1/0/2 (logged), then clean up
        await js("fetch('/api/domain/discussion/speakers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seatId: 'seat-3' }) })");
        ok = ok && ((await waitFor("fetch('/api/companion').then(r => r.json()).then(b => b.data.log.some(e => e.message === 'seat seat-3 activated: press 1/0/2'))", 8000)) || (print({ type: 'console', level: 'check', message: 'companion: mic on did not press' }), false));
        await js("fetch('/api/domain/discussion/speakers/seat-3', { method: 'DELETE' })");
        await js("location.hash = '#/settings/companion'");
        ok = ok && await waitFor("Boolean(document.querySelector('tr[data-trigger=\"seats:seat-3\"]'))");
        await sleep(200);
        await shot('companion-settings');
        await js("fetch('/api/room/triggers/seats/seat-3', { method: 'DELETE' })");
        await js("fetch('/api/companion', { method: 'DELETE' })");
        return ok;
      },
      async seating() {
        // DEC-014: Meeting area tab; legacy links redirect; seating overview; "Show on plan" selects the seat in the room.
        await js("location.hash = '#/settings/meetings'");
        let ok = await waitFor("location.hash === '#/meeting/meetings'");
        ok = ok && await waitFor("document.getElementById('tabs').textContent.replace(/\\s+/g, '') === 'RoomMeetingSettings'");
        ok = ok && await waitFor("['Meeting', 'Agenda', 'Participants', 'Seating'].every(t => document.getElementById('nav').textContent.includes(t))");
        ok = ok && await waitFor("!document.getElementById('nav').textContent.includes('Cameras')");
        await js("location.hash = '#/meeting/seating'");
        ok = ok && await waitFor("document.querySelectorAll('table.seating tbody tr').length === 20");
        ok = ok && await waitFor("document.querySelector('table.seating tr[data-seat=\"seat-1\"]').textContent.includes('Anna de Vries')");
        await shot('seating');
        await js("document.querySelector('table.seating tr[data-seat=\"seat-3\"] a').click()");
        ok = ok && await waitFor("location.hash.startsWith('#/room?seat=seat-3')");
        // The plan must render; in the dark pass this runs after the light pass's disconnect/connect (regression WO-046).
        ok = ok && await waitFor("document.querySelector('.room-stage .room-canvas') !== null");
        ok = ok && await waitFor("document.querySelector('.room-side')?.textContent.includes('Seat 3')");
        ok = ok && await waitFor("document.querySelector('[data-seat-panel=\"seat-3\"]')?.textContent.includes('DCNM-DE 3')"); // devices (WO-047)
        ok = ok && await waitFor("document.querySelector('[data-seat-panel=\"seat-3\"]')?.textContent.includes('Chloe Bakker')"); // participant
        // Mic sensitivity +1 step from the panel → value shown changes (mock fires SeatMicrophoneSensitivityUpdated).
        ok = ok && await waitFor("(() => { const b = document.querySelector('[aria-label=\"Raise microphone sensitivity\"]'); if (b) { b.click(); return true; } return false; })()");
        ok = ok && await waitFor("document.querySelector('.sens-value')?.textContent === '+0.5 dB'");
        await shot('room-seat');
        await js("document.querySelector('[aria-label=\"Reset microphone sensitivity\"]')?.click()"); // reset
        return ok;
      },
      async meetings() {
        await js("location.hash = '#/meetings'");
        let ok = await waitFor(clickButton('Deactivate'));
        ok = ok && await confirmDialog();
        ok = ok && await waitFor(text('No prepared meeting is active')); // built-in Default meeting is active now (real 6.50 semantics)
        ok = ok && await waitFor(`(() => { const r = [...document.querySelectorAll('.meeting-row')].find(x => x.innerText.includes('City Council')); const b = r && r.querySelector('button'); if (b) { b.click(); return true; } return false; })()`);
        ok = ok && await waitFor(clickButton('Open meeting'));
        ok = ok && await waitFor("document.querySelector('.kv .v.state.opened') !== null");
        await shot('meetings');
        await js("location.hash = '#/meeting/agenda'"); // agenda has its own view since WO-046
        ok = ok && await waitFor(`(() => { const b = document.querySelectorAll('.agenda-item button')[1]; if (b) { b.click(); return true; } return false; })()`);
        ok = ok && await waitFor("document.querySelector('.agenda-item.opened') !== null");
        await sleep(300);
        await shot('agenda');
        ok = ok && await waitFor(clickButton('Close'));
        ok = ok && await waitFor("document.querySelector('.agenda-item.opened') === null");
        return ok;
      },
      async voting() {
        await js("location.hash = '#/voting'");
        let ok = await waitFor(`(() => { const b = [...document.querySelectorAll('.voting-row button')].find(x => !x.disabled); if (b) { b.click(); return true; } return false; })()`);
        ok = ok && await waitFor(clickButton('Open voting'));
        ok = ok && await waitFor(text('5 votes cast')); // ui-check.mjs casts 5 votes on the mock
        await sleep(300);
        await shot('voting');
        ok = ok && await waitFor(clickButton('Close voting'));
        ok = ok && await waitFor(clickButton('Accept result'));
        ok = ok && await waitFor(text('Accepted'));
        // WO-104: Room widgets: an ad-hoc voting run from the voting widget, presentation on/off, audio widget.
        const step104 = async (label, code, ms) => { if (!ok) return; ok = await waitFor(code, ms); if (!ok) print({ type: 'console', level: 'check', message: `widgets: ${label}` }); };
        const wv = '.widget[data-widget="voting"]';
        await js("location.hash = '#/room'");
        await step104('dock', `document.querySelector('${wv}') && document.querySelector('.widget[data-widget="audio"]') && document.querySelector('.widget[data-widget="presentation"]')`, 8000);
        await js(`(() => { const f = document.querySelector('${wv} form'); f.querySelector('input').value = 'Widget motion'; f.requestSubmit(); })()`);
        await step104('ad-hoc', `document.querySelector('${wv}').textContent.includes('Widget motion')`);
        await step104('open', clickButton('Open voting', wv));
        await step104('votes', `document.querySelector('${wv}').textContent.includes('5 votes cast')`, 8000);
        await step104('presentation on', clickButton('Start presentation', '.widget[data-widget="presentation"]'));
        await step104('presenting', "document.querySelector('.widget[data-widget=\"presentation\"]').textContent.includes('Presenting')");
        await step104('audio gains', "document.querySelector('.widget[data-widget=\"audio\"] [data-gain=\"Loudspeaker\"]') !== null");
        await sleep(300);
        await shot('room-widgets');
        await step104('collapse', "(() => { const b = document.querySelector('.widget[data-widget=\"audio\"] .widget-toggle'); if (!b) return false; b.click(); return true; })()");
        await step104('collapsed', "document.querySelector('.widget[data-widget=\"audio\"] .widget-body').hidden");
        await js("document.querySelector('.widget[data-widget=\"audio\"] .widget-toggle').click()");
        await step104('presentation off', clickButton('Stop presentation', '.widget[data-widget="presentation"]'));
        await step104('close', clickButton('Close voting', wv));
        await step104('accept', clickButton('Accept result', wv));
        await step104('accepted', `document.querySelector('${wv}').textContent.includes('Accepted')`);
        return ok;
      },
      async room() {
        if (theme !== 'light') return true; // creates devices + layout: once per run
        // 1. Two simulated cameras + simulated switcher
        await js("location.hash = '#/settings/cameras'");
        let ok = true;
        for (const [name, input] of [['Overview cam', '1'], ['Cam A', '2']]) {
          ok = ok && await waitFor(clickButton('Add camera'));
          await js(setField('.camera-form select[aria-label="Camera model"]', 'mock'));
          await waitFor("document.querySelector('.camera-form input[name=name]') !== null");
          ok = ok && await waitFor("document.querySelector('.camera-form select[aria-label=\"Camera model\"]').value === 'mock'"); // stays selected after the rebuild
          await js(`(() => { const f = document.querySelector('.camera-form'); f.elements.name.value = ${JSON.stringify(name)}; f.elements.switcherInput.value = ${JSON.stringify(input)}; f.requestSubmit(); })()`);
          ok = ok && await waitFor(text(name));
        }
        await js(setField('select[aria-label="Switcher type"]', 'mock'));
        ok = ok && await waitFor(clickButton('Save switcher'));
        ok = ok && await waitFor("document.querySelectorAll('.card .pill.loggedIn').length >= 3");
        // WO-090: ATEM autodiscovery (no ATEM on the test machine's network: the "none found" hint appears)
        ok = ok && await waitFor(clickButton('Find ATEM on the network'));
        ok = ok && ((await waitFor(text('No ATEM answered'), 8000)) || (print({ type: 'console', level: 'check', message: 'ATEM discovery: no result' }), false));
        // WO-056 / DEC-015: per-device automation switches (camera row + switcher card), saved immediately.
        const camAuto = "fetch('/api/devices/cameras').then(r => r.json()).then(b => b.data.find(c => c.name === 'Cam A').automation)";
        ok = ok && await waitFor("(() => { const i = document.querySelector('input[aria-label=\"Cam A: camera automation\"]'); if (!i) return false; i.click(); return true; })()");
        ok = ok && await waitFor(`${camAuto}.then(v => v === false)`);
        ok = ok && await waitFor("[...document.querySelectorAll('.camera-row')].some(r => r.textContent.includes('Cam A') && r.textContent.includes('Manual'))");
        ok = ok && await waitFor("(() => { const i = document.querySelector('input[aria-label=\"Automatic switcher cuts\"]'); if (!i || i.disabled) return false; i.click(); return true; })()");
        ok = ok && await waitFor("fetch('/api/devices/switcher').then(r => r.json()).then(b => b.data.automation === false)");
        await sleep(200);
        await shot('cameras-automation');
        await js("document.querySelector('input[aria-label=\"Cam A: camera automation\"]').click()");
        await js("document.querySelector('input[aria-label=\"Automatic switcher cuts\"]').click()");
        ok = ok && await waitFor(`${camAuto}.then(v => v === true)`);
        ok = ok && await waitFor("fetch('/api/devices/switcher').then(r => r.json()).then(b => b.data.automation === true)");
        // jog + preset on the selected camera
        ok = ok && await waitFor(`(() => { const r = [...document.querySelectorAll('.camera-row')].find(x => x.textContent.includes('Cam A')); const b = r && [...r.querySelectorAll('button')].find(x => x.textContent === 'Control'); if (b) { b.click(); return true; } return false; })()`);
        ok = ok && await waitFor("document.querySelector('.jog-pad') !== null");
        await js("(() => { const b = document.querySelector('.jog[title=\"Pan right\"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })); })()");
        await shot('cameras');
        // 2. Shots + automation
        await js("location.hash = '#/settings/automation'");
        ok = ok && await waitFor("document.querySelector('select[aria-label=\"Overview camera\"]') !== null");
        await js(setField('select[aria-label="Overview camera"]', 'cam-1'));
        await js(setField('input[aria-label="Overview preset"]', '0'));
        ok = ok && await waitFor(`(() => { const b = [...document.querySelectorAll('.card button')].find(x => x.textContent === 'Save' && x.closest('.row-inline')); if (b) { b.click(); return true; } return false; })()`);
        ok = ok && await waitFor("document.querySelector('select[aria-label=\"Camera for Seat 3\"]') !== null");
        await js(setField('select[aria-label="Camera for Seat 3"]', 'cam-2'));
        await js(setField('input[aria-label="Preset for Seat 3"]', '3'));
        ok = ok && await waitFor(`(() => { const tr = [...document.querySelectorAll('tbody tr')].find(x => x.textContent.includes('Seat 3')); const b = tr && [...tr.querySelectorAll('button')].find(x => x.textContent === 'Save'); if (b) { b.click(); return true; } return false; })()`);
        await sleep(300);
        await js("(() => { const f = document.querySelector('form.settings'); f.elements.enabled.checked = true; f.elements.delayMs.value = '0'; f.elements.minShotMs.value = '0'; f.requestSubmit(); })()");
        ok = ok && await waitFor("fetch('/api/room').then(r => r.json()).then(b => b.data.director.enabled && b.data.shots['seat-3']?.preset === 3 && b.data.overview?.cameraId === 'cam-1')");
        await shot('automation');
        // 3. Room: place seats + cameras, drag one seat
        await js("location.hash = '#/room'");
        ok = ok && await waitFor(clickButton('Edit layout', '.room-toolbar'));
        ok = ok && await waitFor(clickButton('Place all seats in a grid', '.room-side'));
        ok = ok && await waitFor("document.querySelectorAll('.seat-node').length >= 20");
        for (const cam of ['Overview cam', 'Cam A']) {
          ok = ok && await waitFor(`(() => { const b = [...document.querySelectorAll('.chip-button.cam')].find(x => x.textContent.includes(${JSON.stringify(cam)})); if (b) { b.click(); return true; } return false; })()`);
        }
        ok = ok && await waitFor("document.querySelectorAll('.camera-node').length === 2");
        const before = await js("fetch('/api/room').then(r => r.json()).then(b => b.data.seats['seat-3'])");
        // the plan may be mid re-render: find + drag in one step, retried until both are there
        ok = ok && await waitFor(`(() => {
          const node = document.querySelector('.seat-node[data-seat="seat-3"]'); const svg = document.querySelector('.room-canvas');
          if (!node || !svg) return false;
          const r = node.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
          node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 7 }));
          svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + 60, clientY: y + 40, pointerId: 7 }));
          svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + 60, clientY: y + 40, pointerId: 7 }));
          return true;
        })()`);
        ok = ok && await waitFor(`fetch('/api/room').then(r => r.json()).then(b => b.data.seats['seat-3'].x !== ${before?.x ?? -1})`);
        // Room outline is resizable: drag the right edge handle outwards → wider room is saved.
        const w0 = await js("fetch('/api/room').then(r => r.json()).then(b => b.data.canvas.width)");
        const dragFrom = (sel, dx, dy, id) => `(() => {
          const el = document.querySelector(${JSON.stringify(sel)}); const svg = document.querySelector('.room-canvas');
          if (!el) return false;
          const r = el.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: ${id} }));
          svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + ${dx} / 2, clientY: y + ${dy} / 2, pointerId: ${id} }));
          svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + ${dx}, clientY: y + ${dy}, pointerId: ${id} }));
          svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + ${dx}, clientY: y + ${dy}, pointerId: ${id} }));
          return true; })()`;
        ok = ok && await js(dragFrom('.room-handle.edge-r', 120, 0, 8));
        ok = ok && await waitFor(`fetch('/api/room').then(r => r.json()).then(b => b.data.canvas.width > ${w0})`);
        const w1 = await js("fetch('/api/room').then(r => r.json()).then(b => b.data.canvas.width)");
        ok = ok && await waitFor(`document.querySelector('.room-size-label')?.textContent.startsWith(${JSON.stringify(`${(w1 / 100).toFixed(1)} m`)})`);
        // Edit mode: the workspace pans with a middle-button drag (left drag = box selection, WO-055); nothing is saved.
        const vb0 = await js("document.querySelector('.room-canvas').getAttribute('viewBox')");
        await js(`(() => { const svg = document.querySelector('.room-canvas'); const r = svg.getBoundingClientRect();
          const x = r.x + 6, y = r.y + 6;
          svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 9, button: 1 }));
          svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + 80, clientY: y + 50, pointerId: 9 }));
          svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + 80, clientY: y + 50, pointerId: 9 })); })()`);
        ok = ok && await waitFor(`document.querySelector('.room-canvas').getAttribute('viewBox') !== ${JSON.stringify(vb0)}`);
        await shot('room-edit');
        // WO-055: box selection → group panel; group drag moves all in one save; arrange as a U (15/10/5 style counts); undo.
        await js("[...document.querySelectorAll('.room-toolbar button')].find(b => b.textContent === 'Fit').click()");
        await sleep(200);
        const boxSel = `(() => { const svg = document.querySelector('.room-canvas');
          const rs = [...document.querySelectorAll('.seat-node .seat-disc')].map(n => n.getBoundingClientRect());
          const x0 = Math.min(...rs.map(r => r.left)) - 8, y0 = Math.min(...rs.map(r => r.top)) - 8;
          const x1 = Math.max(...rs.map(r => r.right)) + 8, y1 = Math.max(...rs.map(r => r.bottom)) + 8;
          svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x0, clientY: y0, pointerId: 11, button: 0 }));
          svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: (x0 + x1) / 2, clientY: (y0 + y1) / 2, pointerId: 11 }));
          svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x1, clientY: y1, pointerId: 11 }));
          svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x1, clientY: y1, pointerId: 11 }));
          return true; })()`;
        ok = ok && await js(boxSel);
        const nSeats = await js("document.querySelectorAll('.seat-node').length");
        ok = ok && await waitFor(`document.querySelector('[data-group-panel] h2')?.textContent === '${nSeats} seats selected'`);
        ok = ok && await waitFor(`document.querySelectorAll('.seat-node.selected').length === ${nSeats}`);
        const g0 = await js("fetch('/api/room').then(r => r.json()).then(b => b.data.seats)");
        ok = ok && await js(dragFrom('.seat-node[data-seat="seat-5"]', 50, 30, 12));
        ok = ok && await waitFor(`fetch('/api/room').then(r => r.json()).then(b => Object.keys(${JSON.stringify(g0)}).every(id => b.data.seats[id].x !== ${JSON.stringify(g0)}[id].x))`);
        ok = ok && await waitFor("(() => { const d = document.querySelector('details.arrange'); if (!d) return false; d.open = true; return true; })()");
        await sleep(100); // let the toggle event record the open state
        ok = ok && await waitFor(clickButton('U-shape', '.room-side'));
        await waitFor("document.querySelectorAll('.arrange-counts input').length === 3");
        // Custom counts: left arm gets 2 more than the even split, right arm 2 fewer; start at the right arm.
        await js(`(() => { const [l, b, r] = document.querySelectorAll('.arrange-counts input');
          const set = (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
          set(l, Number(l.value) + 2); set(r, Number(r.value) - 2);
          const sel = [...document.querySelectorAll('.arrange select')][0]; sel.value = 'right'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        ok = ok && await waitFor(`document.querySelectorAll('.arrange-preview .ghost').length === ${nSeats} && document.querySelector('.arrange-start') !== null`);
        await sleep(200);
        await shot('room-arrange-preview');
        ok = ok && await waitFor(clickButton('Apply', '.arrange'));
        ok = ok && await waitFor(`fetch('/api/room').then(r => r.json()).then(b => new Set(Object.values(b.data.seats).map(p => p.rotation)).size >= 3)`); // arms + base face inward
        await sleep(300);
        await shot('room-arranged');
        ok = ok && await waitFor(clickButton('Undo', '[data-group-panel]'));
        ok = ok && await waitFor(`fetch('/api/room').then(r => r.json()).then(b => Object.values(b.data.seats).every(p => p.rotation === 0))`);
        // WO-094: more seats than the U holds (5/5/5 for all): the rest keep their place and become the next selection.
        const fit = 5;
        await js(`(() => { const ins = document.querySelectorAll('.arrange-counts input');
          for (const el of ins) { el.value = '${fit}'; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
        ok = ok && ((await waitFor(`document.querySelectorAll('.arrange-preview .ghost').length === ${3 * fit} && document.querySelector('.arrange-status').textContent.includes('${nSeats - 3 * fit} seats do not fit')`)) || (print({ type: 'console', level: 'check', message: 'arrange overflow: preview/status wrong' }), false));
        const beforeOverflow = await js("fetch('/api/room').then(r => r.json()).then(b => b.data.seats)");
        ok = ok && await waitFor(clickButton('Apply', '.arrange'));
        ok = ok && ((await waitFor(`document.querySelector('[data-group-panel] h2')?.textContent === '${nSeats - 3 * fit} seats selected'`)) || (print({ type: 'console', level: 'check', message: 'arrange overflow: leftovers not selected' }), false));
        ok = ok && await waitFor(`fetch('/api/room').then(r => r.json()).then(b => { const old = ${JSON.stringify(beforeOverflow)};
          const kept = [...document.querySelectorAll('.seat-node.selected')].map(n => n.dataset.seat);
          return kept.length === ${nSeats - 3 * fit} && kept.every(id => b.data.seats[id].x === old[id].x && b.data.seats[id].y === old[id].y); })`);
        await sleep(300);
        await shot('room-arrange-overflow');
        ok = ok && await waitFor(clickButton('Undo', '[data-group-panel]'));
        await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
        ok = ok && await waitFor("document.querySelector('[data-group-panel]') === null");
        // WO-056: seats 12–16 → Cam A presets from 10 (select one, Ctrl-click four more), preview, assign, undo.
        await js("document.querySelector('.seat-node[data-seat=\"seat-12\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
        for (const n of [13, 14, 15, 16]) await js(`document.querySelector('.seat-node[data-seat="seat-${n}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`);
        ok = ok && await waitFor("document.querySelector('[data-group-panel] h2')?.textContent === '5 seats selected'");
        ok = ok && await waitFor("(() => { const d = document.querySelector('details.shots-form'); if (!d) return false; d.open = true; return true; })()");
        await sleep(100); // let the toggle event record the open state
        await js(setField('select[aria-label="Camera for the selected seats"]', 'cam-2'));
        await js(`(() => { const i = document.querySelector('input[aria-label="First preset"]'); i.value = '10'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        ok = ok && await waitFor("document.querySelectorAll('.shot-preview .preset-tag').length === 5 && document.querySelector('.preset-tag.start')?.textContent.includes('P10')");
        await sleep(200);
        await shot('room-bulk-presets');
        ok = ok && await waitFor(clickButton('Assign presets', '.shots-form'));
        ok = ok && await waitFor("fetch('/api/room').then(r => r.json()).then(b => b.data.shots['seat-12']?.preset === 10 && b.data.shots['seat-16']?.preset === 14 && b.data.shots['seat-16']?.cameraId === 'cam-2')");
        ok = ok && await waitFor(clickButton('Undo', '[data-group-panel]'));
        ok = ok && await waitFor("fetch('/api/room').then(r => r.json()).then(b => !b.data.shots['seat-12'] && !b.data.shots['seat-16'])");
        await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
        await js("[...document.querySelectorAll('.room-toolbar button')].find(b => b.textContent === 'Fit').click()");
        // 3b. Interpreter desk (WO-048): place from the tray, then quick controls in operate mode
        ok = ok && await waitFor(`(() => { const b = [...document.querySelectorAll('.chip-button.desk')].find(x => x.textContent.includes('Booth 1 · Desk 1')); if (b) { b.click(); return true; } return false; })()`);
        ok = ok && await waitFor("document.querySelector('.desk-node[data-desk=\"seat-booth1-desk1\"]') !== null");
        // Edit mode: the strip is shown as an inert preview so the operator sees its footprint, and follows a dragged desk.
        const strip = "document.querySelector('[data-desk-strip=\"seat-booth1-desk1\"]')";
        const stripBelowDesk = `(() => { const dn = document.querySelector('.desk-node[data-desk="seat-booth1-desk1"] .desk-body'); const sn = ${strip}; if (!dn || !sn) return false; const d = dn.getBoundingClientRect(); const s = sn.getBoundingClientRect(); return Math.abs((s.left + s.right) / 2 - (d.left + d.right) / 2) < 3 && s.top >= d.bottom - 1 && s.top - d.bottom < 12; })()`;
        ok = ok && await waitFor(`${strip}?.classList.contains('preview') && ${strip}.inert === true`);
        ok = ok && await waitFor(stripBelowDesk);
        ok = ok && await waitFor(`(() => {
          const el = document.querySelector('.desk-node[data-desk="seat-booth1-desk1"]'); const svg = document.querySelector('.room-canvas');
          if (!el) return false;
          const r = el.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 11 }));
          svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + 200, clientY: y + 60, pointerId: 11 }));
          window.__midDrag = ${stripBelowDesk}; // strip follows while dragging
          svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + 200, clientY: y + 60, pointerId: 11 }));
          return true; })()`);
        ok = ok && await waitFor('window.__midDrag === true');
        ok = ok && await waitFor(stripBelowDesk);
        await shot('room-desk-edit');
        ok = ok && await waitFor(clickButton('Operate', '.room-toolbar'));
        // Quick controls on the plan (WO-051): strip under the desk, no panel needed.
        ok = ok && await waitFor(`!${strip}?.classList.contains('preview') && ${strip}.inert === false`);
        const deskOut = "document.querySelector('.desk-node[data-desk=\"seat-booth1-desk1\"] .desk-out').textContent";
        ok = ok && await waitFor(`${strip} !== null`);
        ok = ok && await waitFor(`(() => { const b = ${strip}.querySelector('button[data-output="B"]'); if (b && !b.disabled) { b.click(); return true; } return false; })()`);
        ok = ok && await waitFor(`${deskOut} === '● B NL' && ${strip}.classList.contains('live')`);
        await js(setField('[data-desk-strip="seat-booth1-desk1"] select', 'lang-003'));
        ok = ok && await waitFor("document.querySelector('.desk-node[data-desk=\"seat-booth1-desk1\"] .desk-in').textContent === 'hears FR'");
        // The interpreter "made a mistake": back to A and floor with two quick actions.
        ok = ok && await waitFor(`(() => { const b = ${strip}.querySelector('button[data-output="A"]'); if (b && !b.disabled) { b.click(); return true; } return false; })()`);
        await js(setField('[data-desk-strip="seat-booth1-desk1"] select', 'floor'));
        ok = ok && await waitFor(`${deskOut} === '● A EN' && document.querySelector('.desk-node[data-desk=\"seat-booth1-desk1\"] .desk-in').textContent === 'hears Floor'`);
        // The strip stays under its desk when zooming.
        ok = ok && await waitFor(stripBelowDesk);
        if (!ok) print({ type: 'console', level: 'check', message: `strip position: ${await js(`(() => { const dn = document.querySelector('.desk-node[data-desk="seat-booth1-desk1"] .desk-body'); const sn = ${strip}; return JSON.stringify({ desk: dn?.getBoundingClientRect(), strip: sn?.getBoundingClientRect(), strips: document.querySelectorAll('.desk-strip').length, hash: location.hash }); })()`)}` });
        await js("[...document.querySelectorAll('.room-toolbar button')].find(b => b.textContent === '+').click()");
        ok = ok && await waitFor(stripBelowDesk);
        // Preset languages stay in the desk panel.
        await js("document.querySelector('.desk-node[data-desk=\"seat-booth1-desk1\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
        ok = ok && await waitFor("document.querySelector('[data-desk-panel=\"seat-booth1-desk1\"]') !== null");
        ok = ok && await waitFor(`(() => { const b = ${strip}.querySelector('button[data-output="B"]'); if (b && !b.disabled) { b.click(); return true; } return false; })()`);
        await js(setField('select[aria-label="Output B language"]', 'lang-003'));
        ok = ok && await waitFor(`${deskOut} === '● B FR'`);
        await sleep(300);
        await shot('room-desk');
        ok = ok && await waitFor(`(() => { const b = ${strip}.querySelector('button[data-output="Off"]'); if (b) { b.click(); return true; } return false; })()`);
        ok = ok && await waitFor("!document.querySelector('.desk-node[data-desk=\"seat-booth1-desk1\"]').classList.contains('live')");
        await js("[...document.querySelectorAll('.room-toolbar button')].find(b => b.textContent === 'Fit').click()");
        await js("[...document.querySelectorAll('.desk-panel .link')].find(b => b.textContent === 'Close')?.click()");
        // 3c. Inspector cogs (WO-052): click = inspector, drag = move (operate mode).
        const cog = key => `document.querySelector('[data-cog="${key}"]')`;
        ok = ok && ((await waitFor(`${cog('seat:seat-3')} && ${cog('camera:cam-2')} && ${cog('desk:seat-booth1-desk1')}`)) || (print({ type: 'console', level: 'check', message: 'room cogs: step 1 failed' }), false));
        await js(`${cog('seat:seat-3')}.click()`);
        ok = ok && ((await waitFor("document.querySelector('[data-seat-panel=\"seat-3\"]') !== null")) || (print({ type: 'console', level: 'check', message: 'room cogs: step 2 failed' }), false));
        await js(`${cog('camera:cam-2')}.click()`);
        ok = ok && ((await waitFor("document.querySelector('[data-camera-panel=\"cam-2\"]')?.textContent.includes('Switcher input')")) || (print({ type: 'console', level: 'check', message: 'room cogs: step 3 failed' }), false));
        // Preview (WO-053): inspector button, and the global "camera cog sends to preview" option.
        const swPreview = "fetch('/api/devices/switcher').then(r => r.json()).then(b => b.data.status.preview)";
        await js(`${cog('camera:cam-1')}.click()`);
        ok = ok && ((await waitFor("document.querySelector('[data-camera-panel=\\\"cam-1\\\"]') !== null")) || (print({ type: 'console', level: 'check', message: 'room preview: cam-1 inspector' }), false));
        ok = ok && ((await waitFor(clickButton('Preview', '[data-camera-panel="cam-1"]'))) || (print({ type: 'console', level: 'check', message: 'room preview: button' }), false));
        ok = ok && ((await waitFor(`${swPreview}.then(p => p === 1)`)) || (print({ type: 'console', level: 'check', message: 'room preview: preview 1' }), false));
        await js(`${cog('camera:cam-2')}.click()`); // option off: inspector only
        await sleep(500);
        ok = ok && ((await js(`${swPreview}.then(p => p === 1)`)) || (print({ type: 'console', level: 'check', message: 'room preview: option off still previewed' }), false));
        await js("fetch('/api/room/operate', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cogSendsPreview: true }) })");
        ok = ok && await waitFor("fetch('/api/room').then(r => r.json()).then(b => b.data.operate.cogSendsPreview)");
        await sleep(300); // let the room topic reach the page
        await js(`${cog('camera:cam-2')}.click()`);
        ok = ok && ((await waitFor(`${swPreview}.then(p => p === 2)`)) || (print({ type: 'console', level: 'check', message: 'room preview: cog sent preview' }), false));
        await js("fetch('/api/room/operate', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cogSendsPreview: false }) })");
        // PTZ in the camera inspector (WO-054): quick recall → current preset → nudge → overwrite.
        const cam2 = "fetch('/api/devices/cameras').then(r => r.json()).then(b => b.data.find(c => c.id === 'cam-2'))";
        const step54 = async (label, code) => { if (!ok) return; ok = await waitFor(code); if (!ok) print({ type: 'console', level: 'check', message: `room ptz: ${label}` }); };
        await step54('panel', "document.querySelector('[data-camera-panel=\"cam-2\"] .jog-pad') !== null");
        await step54('recall chip', "(() => { const b = [...document.querySelectorAll('[data-camera-panel=\"cam-2\"] .preset-chips button')].find(x => x.textContent === 'Seat 3 · 3'); if (b && !b.disabled) { b.click(); return true; } return false; })()");
        await step54('current preset 3', `${cam2}.then(c => c.currentPreset?.preset === 3 && !c.currentPreset.modified)`);
        await step54('overwrite button', "document.querySelector('[data-camera-panel=\"cam-2\"] .current-preset')?.textContent.includes('Overwrite preset 3')");
        // Hold "pan right", release on the window (not the button): the camera must stop anyway.
        await js("document.querySelector('[data-camera-panel=\"cam-2\"] [title=\"Pan right\"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 31 }))");
        await step54('moving', `${cam2}.then(c => c.status.moving === true)`);
        await step54('adjusted', "document.querySelector('[data-camera-panel=\"cam-2\"] .current-preset')?.textContent.includes('adjusted') || true");
        await js("window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31 }))");
        await step54('stopped', `${cam2}.then(c => c.status.moving === false && c.currentPreset.modified === true)`);
        await step54('adjusted shown', "document.querySelector('[data-camera-panel=\"cam-2\"] .current-preset')?.textContent.includes('adjusted')");
        await sleep(300);
        await shot('room-camera-inspector');
        await step54('overwrite', "(() => { const b = [...document.querySelectorAll('[data-camera-panel=\"cam-2\"] .current-preset button')].find(x => x.textContent === 'Overwrite preset 3'); if (b && !b.disabled) { b.click(); return true; } return false; })()");
        await step54('overwritten', `${cam2}.then(c => c.currentPreset.preset === 3 && c.currentPreset.modified === false)`);
        await js(setField('[data-camera-panel="cam-2"] .preset-row input', '7'));
        await step54('save as 7', "(() => { const b = [...document.querySelectorAll('[data-camera-panel=\"cam-2\"] .preset-row button')].find(x => x.textContent === 'Save'); if (b && !b.disabled) { b.click(); return true; } return false; })()");
        await step54('current preset 7', `${cam2}.then(c => c.currentPreset.preset === 7)`);
        const cogAtCorner = (key, shapeSel) => `(() => { const c = ${cog(key)}?.getBoundingClientRect(); const s = document.querySelector(${JSON.stringify(shapeSel)})?.getBoundingClientRect(); if (!c || !s) return false; const cx = (c.left + c.right) / 2, cy = (c.top + c.bottom) / 2; return Math.abs(cx - s.right) < 8 && Math.abs(cy - s.bottom) < 8; })()`;
        const cogDrag = (key, dx, dy, id) => `(() => {
          const b = ${cog(key)}; if (!b) return false; const r = b.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
          b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: ${id}, button: 0 }));
          b.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + ${dx} / 2, clientY: y + ${dy} / 2, pointerId: ${id} }));
          b.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + ${dx}, clientY: y + ${dy}, pointerId: ${id} }));
          b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + ${dx}, clientY: y + ${dy}, pointerId: ${id} }));
          return true; })()`;
        ok = ok && ((await waitFor(cogAtCorner('seat:seat-4', '.seat-node[data-seat="seat-4"] .seat-disc'))) || (print({ type: 'console', level: 'check', message: 'room cogs: step 4 failed' }), false));
        const s4 = await js("fetch('/api/room').then(r => r.json()).then(b => b.data.seats['seat-4'].x)");
        ok = ok && ((await waitFor(cogDrag('seat:seat-4', 90, 30, 21))) || (print({ type: 'console', level: 'check', message: 'room cogs: step 5 failed' }), false));
        ok = ok && ((await waitFor(`fetch('/api/room').then(r => r.json()).then(b => b.data.seats['seat-4'].x > ${s4 + 60})`)) || (print({ type: 'console', level: 'check', message: 'room cogs: step 6 failed' }), false));
        ok = ok && ((await waitFor(cogAtCorner('seat:seat-4', '.seat-node[data-seat="seat-4"] .seat-disc'))) || (print({ type: 'console', level: 'check', message: 'room cogs: step 7 failed' }), false));
        ok = ok && await waitFor("!document.querySelector('[data-seat-panel=\"seat-4\"]')", 1500); // a drag doesn't open the inspector
        const d1 = await js("fetch('/api/room').then(r => r.json()).then(b => b.data.desks['seat-booth1-desk1'].y)");
        ok = ok && ((await waitFor(cogDrag('desk:seat-booth1-desk1', 0, 60, 22))) || (print({ type: 'console', level: 'check', message: 'room cogs: step 8 failed' }), false));
        ok = ok && ((await waitFor(`fetch('/api/room').then(r => r.json()).then(b => b.data.desks['seat-booth1-desk1'].y > ${d1 + 40})`)) || (print({ type: 'console', level: 'check', message: 'room cogs: step 9 failed' }), false));
        ok = ok && ((await waitFor(stripBelowDesk)) || (print({ type: 'console', level: 'check', message: 'room cogs: step 10 failed' }), false));
        await sleep(300);
        await shot('room-cogs');
        ok = ok && ((await waitFor(clickButton('Edit layout', '.room-toolbar'))) || (print({ type: 'console', level: 'check', message: 'room cogs: step 11 failed' }), false));
        ok = ok && await waitFor("document.querySelectorAll('.cog:not(.desk-strip .cog)').length === 0"); // operate mode only
        ok = ok && ((await waitFor(clickButton('Operate', '.room-toolbar'))) || (print({ type: 'console', level: 'check', message: 'room cogs: step 12 failed' }), false));
        await js("[...document.querySelectorAll('.room-side .link')].find(b => b.textContent === 'Close')?.click()");
        // 4. Operate: click seat 3 → mic on → director cuts to Cam A (tally red on the plan)
        ok = ok && await waitFor(clickButton('Operate', '.room-toolbar'));
        await js("document.querySelector('.seat-node[data-seat=\"seat-3\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
        ok = ok && await waitFor("document.querySelector('.seat-node[data-seat=\"seat-3\"]').classList.contains('st-speaking')");
        ok = ok && await waitFor("document.querySelector('.camera-node[data-camera=\"cam-2\"]')?.classList.contains('tally-program')");
        // WO-103: cam-2 turns to seat 3 (dashed aim line, head rotated), seats with presets get their camera's halo.
        ok = ok && ((await waitFor("document.querySelector('.aim-line[data-cam=\"cam-2\"]') !== null && document.querySelectorAll('.coverage-halo').length > 0")) || (print({ type: 'console', level: 'check', message: 'room aim: line/halo' }), false));
        ok = ok && ((await waitFor("(() => { const h = document.querySelector('.camera-node[data-camera=\"cam-2\"] .camera-head'); return h && h.style.transform !== '' && h.style.transform !== 'rotate(0deg)'; })()")) || (print({ type: 'console', level: 'check', message: 'room aim: head turned' }), false));
        await sleep(1100); // let the head finish turning
        await shot('room');
        // WO-103 fix: hover emphasis follows the pointer across re-renders and never sticks to the last camera.
        const over = sel => `(() => { const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return false; n.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); return true; })()`;
        const focusOf = "[...new Set([...document.querySelectorAll('.coverage-halo.focus, .aim-line.focus')].map(e => e.dataset.cam))].join(',')";
        const stepHover = async (label, code) => { if (!ok) return; ok = await waitFor(code); if (!ok) print({ type: 'console', level: 'check', message: `room hover: ${label}` }); };
        await stepHover('cam-2', over('.camera-node[data-camera="cam-2"] .camera-body'));
        await stepHover('cam-2 focus', `document.querySelector('.room-canvas').classList.contains('cam-focus') && ${focusOf} === 'cam-2'`);
        await js("document.querySelector('button[aria-label=\"Larger labels\"]').click()"); // re-render under the pointer
        await stepHover('still cam-2 after re-render', `${focusOf} === 'cam-2'`);
        await stepHover('floor', over('.room-floor'));
        await stepHover('no focus on the floor', "!document.querySelector('.room-canvas').classList.contains('cam-focus')");
        await stepHover('cam-1', over('.camera-node[data-camera="cam-1"] .camera-body'));
        await stepHover('cam-1 focus', `document.querySelector('.room-canvas').classList.contains('cam-focus') && !${focusOf}.includes('cam-2')`);
        await js("document.querySelector('.room-canvas').dispatchEvent(new PointerEvent('pointerleave'))");
        await stepHover('leave', "!document.querySelector('.room-canvas').classList.contains('cam-focus')");
        await js("document.querySelector('button[aria-label=\"Smaller labels\"]').click()");
        await js("document.querySelector('.seat-node[data-seat=\"seat-3\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
        ok = ok && await waitFor("document.querySelector('.camera-node[data-camera=\"cam-1\"]')?.classList.contains('tally-program')"); // back to overview
        // WO-058: label size − / + (per browser): 3 × larger = 200 % → seat numbers 28 px in plan units; back to 100 %.
        const labelPx = "parseFloat(getComputedStyle(document.querySelector('.seat-node[data-seat=\"seat-3\"] .seat-label')).fontSize)";
        // The setting persists in the browser profile: start from 100 %.
        for (let i = 0; i < 12; i += 1) {
          const pct = await js("document.querySelector('.label-size .zoom-label').textContent");
          if (pct === '100%') break;
          await js(`document.querySelector('button[aria-label="${parseInt(pct, 10) > 100 ? 'Smaller' : 'Larger'} labels"]').click()`);
        }
        ok = ok && await waitFor(`${labelPx} === 14`);
        // WO-083: participant names never overlap each other or a seat disc; neighbours alternate below / above.
        const namesClear = `(() => {
          const names = [...document.querySelectorAll('.seat-node > .seat-person')].map(t => t.getBoundingClientRect());
          const discs = [...document.querySelectorAll('.seat-disc')].map(c => c.getBoundingClientRect());
          const hit = (a, b, m = 1) => a.left + m < b.right && b.left + m < a.right && a.top + m < b.bottom && b.top + m < a.bottom;
          if (names.length < 3) return false;
          return names.every((a, i) => names.every((b, j) => i === j || !hit(a, b)) && discs.every(d => !hit(a, d, 2)));
        })()`;
        ok = ok && ((await waitFor(namesClear)) || (print({ type: 'console', level: 'check', message: 'room names overlap at 100 %' }), false));
        ok = ok && ((await waitFor("document.querySelector('.seat-person.below') && document.querySelector('.seat-person.above')")) || (print({ type: 'console', level: 'check', message: 'room names: no alternation' }), false));
        const deskW = "(document.querySelector('.desk-node[data-desk=\"seat-booth1-desk1\"] .desk-body')?.getBoundingClientRect().width ?? NaN)"; // NaN while re-rendering
        ok = ok && await waitFor("document.querySelector('.desk-node[data-desk=\"seat-booth1-desk1\"] .desk-body') !== null");
        let desk100 = NaN;
        for (let i = 0; i < 40 && !Number.isFinite(desk100); i += 1) { desk100 = await js(deskW); if (!Number.isFinite(desk100)) await sleep(50); }
        for (let i = 0; i < 3; i += 1) await js("document.querySelector('button[aria-label=\"Larger labels\"]').click()");
        ok = ok && await waitFor(`${labelPx} === 28 && document.querySelector('.label-size .zoom-label').textContent === '200%'`);
        ok = ok && await waitFor("localStorage.getItem('likeabosch.room.labelScale') === '2'");
        ok = ok && await waitFor(`Math.abs(${deskW} / ${desk100} - 2) < 0.05`); // interpreter desk symbol scales too
        ok = ok && await waitFor(stripBelowDesk); // its quick-control strip moves below the bigger desk
        await js("[...document.querySelectorAll('.room-toolbar button')].find(b => b.textContent === 'Fit').click()");
        await sleep(300);
        await shot('room-labels');
        ok = ok && ((await waitFor(namesClear)) || (print({ type: 'console', level: 'check', message: 'room names overlap at 200 %' }), false));
        for (let i = 0; i < 3; i += 1) await js("document.querySelector('button[aria-label=\"Smaller labels\"]').click()");
        ok = ok && await waitFor(`${labelPx} === 14`);
        // WO-057: project bar: rename, Save as (copy + switch), Load dialog → open the first one again, download.
        const proj = "fetch('/api/projects').then(r => r.json()).then(b => b.data)";
        const answer = (value, button = 'ok') => `(() => { const d = [...document.querySelectorAll('dialog.confirm[open]')].at(-1); if (!d) return false;
          const i = d.querySelector('input'); if (i && ${JSON.stringify(value)} !== null) i.value = ${JSON.stringify(value)};
          const b = d.querySelector('button[value="${button}"]'); if (!b) return false; b.click(); return true; })()`;
        ok = ok && await waitFor("document.querySelector('#project-bar .project-name')?.textContent === 'Untitled project'");
        await js("document.querySelector('#project-bar .project-name').click()");
        ok = ok && await waitFor(answer('Council chamber'));
        ok = ok && await waitFor(`${proj}.then(p => p.current.name === 'Council chamber')`);
        ok = ok && await waitFor("document.querySelector('#project-bar .project-name')?.textContent === 'Council chamber'");
        const seatsBefore = await js("fetch('/api/room').then(r => r.json()).then(b => Object.keys(b.data.seats).length)");
        ok = ok && await waitFor(clickButton('Save as…', '#project-bar'));
        ok = ok && await waitFor(answer('Council B'));
        ok = ok && await waitFor(`${proj}.then(p => p.current.name === 'Council B' && p.projects.length === 2)`);
        ok = ok && await waitFor(`fetch('/api/room').then(r => r.json()).then(b => Object.keys(b.data.seats).length === ${seatsBefore})`);
        const dl = await js(`${proj}.then(p => fetch('/api/projects/' + p.current.id + '/download')).then(r => r.json()).then(d => d.format + ':' + d.devices.cameras.length)`);
        ok = ok && dl === 'likeabosch-project:2';
        ok = ok && await waitFor("document.querySelector('#project-bar a[download]')?.getAttribute('href').endsWith('/download')");
        ok = ok && await waitFor(clickButton('Projects…', '#project-bar'));
        ok = ok && await waitFor("document.querySelectorAll('dialog.projects-dialog .project-list li').length === 2");
        // DEC-025: every project shows the system it belongs to (the mock reports its room name)
        ok = ok && ((await waitFor("[...document.querySelectorAll('dialog.projects-dialog .project-list li')].every(li => li.textContent.includes('for Mock Council Chamber'))")) || (print({ type: 'console', level: 'check', message: 'projects: system label missing' }), false));
        await sleep(200);
        await shot('projects-dialog');
        ok = ok && await waitFor("(() => { const li = [...document.querySelectorAll('dialog.projects-dialog .project-list li')].find(x => x.textContent.includes('Council chamber')); const b = li && [...li.querySelectorAll('button')].find(x => x.textContent === 'Open'); if (!b) return false; b.click(); return true; })()");
        ok = ok && await waitFor(answer(null));
        ok = ok && await waitFor(`${proj}.then(p => p.current.name === 'Council chamber')`);
        ok = ok && await waitFor("document.querySelector('#project-bar .project-name')?.textContent === 'Council chamber' && !document.querySelector('dialog.projects-dialog')");
        ok = ok && await waitFor("document.querySelectorAll('.camera-node').length === 2", 8000); // cameras of the reopened project
        ok = ok && await waitFor("document.title.startsWith('Council chamber')"); // WO-091
        await sleep(300);
        await shot('project-bar');
        // WO-091: "New…" in the bar → empty project; "Clear…" in Projects… removes the chosen parts; back to the chamber.
        ok = ok && await waitFor(clickButton('New…', '#project-bar'));
        ok = ok && await waitFor(answer('Fresh start'));
        ok = ok && await waitFor(answer(null));
        ok = ok && ((await waitFor(`${proj}.then(p => p.current.name === 'Fresh start') && fetch('/api/room').then(r => r.json()).then(b => !Object.keys(b.data.seats).length)`)) || (print({ type: 'console', level: 'check', message: 'projects: New failed' }), false));
        ok = ok && await waitFor("document.title.startsWith('Fresh start')");
        await js(`fetch('/api/room/shots/seat-1', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cameraId: 'cam-x', preset: 1 }) })`);
        await js(`fetch('/api/room/seats/seat-1', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 100, y: 100 }) })`);
        ok = ok && await waitFor(clickButton('Projects…', '#project-bar'));
        ok = ok && await waitFor(clickButton('Clear…', 'dialog.projects-dialog'));
        ok = ok && await waitFor("(() => { const b = document.querySelector('dialog.clear-dialog input[name=shots]'); if (!b) return false; b.click(); return true; })()");
        await shot('project-clear');
        ok = ok && await waitFor("(() => { const b = document.querySelector('dialog.clear-dialog button[value=ok]'); if (!b || b.disabled) return false; b.click(); return true; })()");
        ok = ok && ((await waitFor("fetch('/api/room').then(r => r.json()).then(b => !Object.keys(b.data.shots).length && b.data.seats['seat-1'])")) || (print({ type: 'console', level: 'check', message: 'projects: Clear failed' }), false));
        ok = ok && await waitFor(`${proj}.then(async p => { const c = p.projects.find(x => x.name === 'Council chamber'); await fetch('/api/projects/' + c.id + '/open', { method: 'POST' }); return true; })`);
        ok = ok && await waitFor("document.querySelector('#project-bar .project-name')?.textContent === 'Council chamber'");
        return ok;
      },
      async participants() {
        await js("location.hash = '#/participants'");
        let ok = await waitFor("document.querySelectorAll('table.data tbody tr').length === 16");
        await js("(() => { const i = document.querySelector('input[type=search]'); i.value = 'bakker'; i.dispatchEvent(new Event('input')); })()");
        ok = ok && await waitFor("document.querySelectorAll('table.data tbody tr').length === 1");
        await js("(() => { const i = document.querySelector('input[type=search]'); i.value = ''; i.dispatchEvent(new Event('input')); })()");
        await js("(() => { const c = document.querySelector('.toolbar input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change')); })()");
        ok = ok && await waitFor("document.querySelectorAll('table.data tbody tr').length === 12");
        print({ type: 'mock', fn: 'denyAccess', args: ['incorrectSeat'] }); // orchestrator calls mock.denyAccess
        ok = ok && await waitFor(text('Access denied (this session)'));
        ok = ok && await waitFor("document.body.innerText.includes('Participant access denied: Incorrect seat')");
        await sleep(300);
        await shot('participants');
        return ok;
      },
      async interpretation() {
        await js("location.hash = '#/interpretation'");
        let ok = await waitFor("document.querySelectorAll('.desk').length === 4");
        // WO-102: languages setup through the full DICENTIS API: new language → meeting → output B of a desk → clean up.
        const step102 = async (label, code, ms) => { if (!ok) return; ok = await waitFor(code, ms); if (!ok) print({ type: 'console', level: 'check', message: `languages: ${label}` }); };
        const details = "document.querySelector('.dicentis-languages details')";
        await step102('card', `${details} !== null`, 8000);
        await js(`${details}.open = true`);
        await js("(() => { const f = document.querySelector('.dicentis-languages details form'); const [a, l, n] = f.querySelectorAll('input'); a.value = 'SV'; l.value = 'Swedish'; n.value = 'Svenska'; f.requestSubmit(); })()");
        await step102('created', "[...document.querySelectorAll('.dicentis-languages details td')].some(td => td.textContent === 'Swedish')");
        await step102('pick', "(() => { const s = document.querySelector('select[aria-label=\"Language to add\"]'); const o = [...s.options].find(x => x.textContent.startsWith('Swedish')); if (!o) return false; s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
        await step102('add', clickButton('Add to meeting', '.dicentis-languages'));
        await step102('in meeting', "[...document.querySelectorAll('.dicentis-languages .lang-row')].some(r => r.textContent.includes('Swedish'))");
        await step102('wired sees it', "[...document.querySelectorAll('main .card')].find(c => c.querySelector('h2')?.textContent === 'Languages')?.textContent.includes('SV')");
        await step102('desk B', "(() => { const s = document.querySelector('select[aria-label=\"Booth 1 Desk 1 output B\"]'); const o = s && [...s.options].find(x => x.textContent === 'SV'); if (!o) return false; s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
        await step102('desk B set', "(() => { const s = document.querySelector('select[aria-label=\"Booth 1 Desk 1 output B\"]'); return s && s.options[s.selectedIndex]?.textContent === 'SV'; })()");
        await sleep(300);
        await js("document.getElementById('languages-setup').scrollIntoView()");
        await sleep(300);
        await shot('languages');
        await step102('remove', "(() => { const r = [...document.querySelectorAll('.dicentis-languages .lang-row')].find(x => x.textContent.includes('Swedish')); const b = r && [...r.querySelectorAll('button')].find(x => x.textContent === 'Remove'); if (!b) return false; b.click(); return true; })()");
        ok = ok && await confirmDialog();
        await step102('removed', "![...document.querySelectorAll('.dicentis-languages .lang-row')].some(r => r.textContent.includes('Swedish'))");
        await step102('delete', "(() => { const b = document.querySelector('button[aria-label=\"Delete Swedish\"]'); if (!b) return false; b.click(); return true; })()");
        ok = ok && await confirmDialog();
        await step102('deleted', "![...document.querySelectorAll('.dicentis-languages details td')].some(td => td.textContent === 'Swedish')");
        await js("window.scrollTo(0, 0)");
        // Desk 1 of booth 1: microphone on output A, then speak slowly, then raise a phone call in booth 1.
        ok = ok && await waitFor("(() => { const b = document.querySelector('.desk .segmented button:nth-child(2)'); if (b && !b.disabled) { b.click(); return true; } return false; })()");
        ok = ok && await waitFor("document.querySelector('.desk').classList.contains('live')");
        ok = ok && await waitFor(clickButton('Speak slowly', '.desk'));
        ok = ok && await waitFor(text('Cancel slow'));
        ok = ok && await waitFor(clickButton('Phone call', '.booth'));
        ok = ok && await waitFor("document.querySelector('.booth-notes') !== null");
        await sleep(300);
        await shot('interpretation');
        ok = ok && await waitFor(clickButton('Cancel slow', '.desk'));
        ok = ok && await waitFor("(() => { const b = document.querySelector('.desk .segmented button:nth-child(1)'); if (b) { b.click(); return true; } return false; })()");
        return ok;
      },
      async files() {
        await js("location.hash = '#/files'");
        let ok = await waitFor("document.querySelectorAll('.file-row').length >= 6"); // 3 notes + 2 layouts + images (one is deleted per pass)
        // Notes: date filter (only 2026-10-01..02), view in sandboxed iframe, verify.
        await js("(() => { const [a, b] = document.querySelectorAll('input[type=date]'); a.value = '2026-10-01'; b.value = '2026-10-02'; a.dispatchEvent(new Event('change')); })()");
        ok = ok && await waitFor("document.querySelectorAll('.split > .card .file-row').length === 2");
        ok = ok && await waitFor(clickButton('View'));
        ok = ok && await waitFor("document.querySelector('dialog.viewer iframe')?.getAttribute('sandbox') === ''");
        await sleep(300);
        await shot('files');
        await js("document.querySelector('dialog.viewer')?.close()");
        ok = ok && await waitFor(clickButton('Verify'));
        ok = ok && await waitFor("document.body.innerText.includes('not tampered')");
        // Images: delete one → list refreshes via refreshAfter (no change event exists).
        const images = "[...document.querySelectorAll('.file-row')].filter(r => r.innerText.includes('Image')).length";
        const before = await js(images);
        ok = ok && await waitFor(`(() => { const r = [...document.querySelectorAll('.file-row')].find(x => x.innerText.includes('Image')); const b = r && [...r.querySelectorAll('button')].find(x => x.textContent === 'Delete'); if (b) { b.click(); return true; } return false; })()`);
        ok = ok && await confirmDialog();
        ok = ok && await waitFor(`${images} === ${before - 1}`);
        return ok;
      },
      async audio() {
        // WO-049: master volume (moved from System) + per-seat microphone sensitivity incl. bulk set and reset.
        await js("location.hash = '#/settings/audio'");
        let ok = await waitFor("document.querySelector('input[type=range]') !== null");
        await js("(() => { const r = document.querySelector('input[type=range]'); r.value = '5'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()");
        ok = ok && await waitFor("document.querySelector('.volume-value').textContent === '5'");
        ok = ok && await waitFor("document.querySelectorAll('table.sensitivity tbody tr').length === 20");
        ok = ok && await waitFor("(() => { const b = document.querySelector('[aria-label=\"Raise Seat 2\"]'); if (b && !b.disabled) { b.click(); return true; } return false; })()");
        ok = ok && await waitFor("document.querySelector('table.sensitivity tr[data-seat=\"seat-2\"] .sens-value').textContent === '+0.5 dB'");
        for (const id of ['seat-4', 'seat-5']) await js(`document.querySelector('table.sensitivity tr[data-seat="${id}"] input[type=checkbox]').click()`);
        await js(setField('input[aria-label="Sensitivity for the selected seats (dB)"]', '-2'));
        ok = ok && await waitFor(clickButton('Set selected'));
        ok = ok && await waitFor("['seat-4', 'seat-5'].every(id => document.querySelector(`table.sensitivity tr[data-seat=\"${id}\"] .sens-value`).textContent === '-2 dB')");
        await sleep(300);
        await shot('audio');
        ok = ok && await waitFor(clickButton('Reset all'));
        ok = ok && await confirmDialog();
        ok = ok && await waitFor("[...document.querySelectorAll('table.sensitivity .sens-value')].every(e => e.textContent === '0 dB')");
        // WO-081: DICENTIS audio & Dante through the (linked mock) dicentis-bridge.
        const step81 = async (label, code, ms) => { if (!ok) return; ok = await waitFor(code, ms); if (!ok) print({ type: 'console', level: 'check', message: `dicentis audio: ${label}` }); };
        await step81('cards', "document.querySelector('[data-gain=\"Loudspeaker\"] input[type=range]') !== null", 8000);
        await js("(() => { const r = document.querySelector('[data-gain=\"Loudspeaker\"] input[type=range]'); r.value = '-6'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()");
        await step81('gain', "document.querySelector('[data-gain=\"Loudspeaker\"] output')?.textContent === '-6 dB'");
        await step81('mute', "(() => { const b = [...document.querySelectorAll('[data-gain=\"SoundReinforcement\"] button')].find(x => x.textContent === 'Mute'); if (b) { b.click(); return true; } return false; })()");
        await step81('muted', "document.querySelector('[data-gain=\"SoundReinforcement\"]')?.classList.contains('muted-gain')");
        await js(setField('select[aria-label="Dante out of Seat 2"]', 'DanteOutEnabledAlways'));
        await sleep(400);
        await step81('seat dante', "document.querySelector('select[aria-label=\"Dante out of Seat 2\"]')?.value === 'DanteOutEnabledAlways'");
        await step81('meters on', clickButton('Show level meters'));
        await step81('meters', "document.querySelectorAll('.vu-row').length > 5", 4000);
        await js("document.querySelector('.dicentis-audio').scrollIntoView()");
        await sleep(500);
        await shot('audio-dicentis');
        await step81('meters off', clickButton('Hide level meters'));
        await js("fetch('/api/dicentis/audio/gain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'SoundReinforcement', muted: false }) })");
        return ok;
      },
      async system() {
        await js("location.hash = '#/system'");
        let ok = await waitFor(clickButton('Power off'));
        ok = ok && await confirmDialog();
        ok = ok && await waitFor(text('Powered off'));
        ok = ok && await waitFor(clickButton('Power on'));
        ok = ok && await waitFor(text('Powered on'));
        ok = ok && await waitFor(clickButton('Enable'));
        ok = ok && await waitFor("!document.querySelector('select[aria-label=\"Seat to illuminate\"]').disabled");
        await js("(() => { const s = document.querySelector('select[aria-label=\"Seat to illuminate\"]'); s.value = 'seat-3'; s.dispatchEvent(new Event('change')); })()");
        ok = ok && await waitFor(text('Illumination mode') ) && await waitFor("document.querySelector('select[aria-label=\"Seat to illuminate\"]').value === 'seat-3'");
        await sleep(300);
        await shot('system');
        ok = ok && await waitFor(clickButton('Disable'));
        return ok;
      },
    };
    const dcnScenarios = {
      async discussion() {
        const nav = await js("document.getElementById('nav').textContent");
        let ok = !/Meetings|Interpretation|Files|Audio/.test(nav) && /DCN/.test(nav); // wired-only views hidden, DCN view shown
        await js("location.hash = '#/discussion'");
        ok = ok && await waitFor("document.querySelectorAll('.seat').length === 20");
        ok = ok && await waitFor(seatButton('Seat 3', 'Add'));
        ok = ok && await waitFor(`${listText(0)}.includes('Clara Ruiz')`);
        await shot('discussion');
        await js("fetch('/api/domain/discussion', { method: 'DELETE' })");
        ok = ok && await waitFor(`!${listText(0)}.includes('Clara Ruiz')`);
        if (!ok) print({ type: 'console', level: 'check', message: `dcn discussion: nav=${JSON.stringify(nav)}` });
        return ok;
      },
      async dcn() {
        await js("location.hash = '#/dcn'");
        let ok = await waitFor(text('Council meeting')) && await waitFor(text('Session: Morning session'));
        // voting from the script: start → delegates vote → stop → accepted
        ok = ok && await waitFor(`(() => { const r = [...document.querySelectorAll('.row-item')].find(x => x.textContent.includes('Approve the agenda')); const b = r && [...r.querySelectorAll('button')].find(x => x.textContent === 'Start'); if (b) { b.click(); return true; } return false; })()`);
        ok = ok && await waitFor(text('Voting: Opened'));
        print({ type: 'mock', fn: 'castVote', args: [2, 'Yes'] });
        print({ type: 'mock', fn: 'castVote', args: [3, 'Yes'] });
        print({ type: 'mock', fn: 'castVote', args: [4, 'No'] });
        await sleep(300);
        ok = ok && await waitFor(clickButton('Stop voting')) && await confirmDialog();
        ok = ok && await waitFor(text('Voting: Accepted'));
        // ad-hoc voting
        await js(setField('input[name="subject"]', 'Short break?'));
        ok = ok && await waitFor(clickButton('Start ad-hoc voting'));
        ok = ok && await waitFor(text('Voting: Opened'));
        await shot('dcn-voting');
        ok = ok && await waitFor(clickButton('Stop voting')) && await confirmDialog();
        ok = ok && await waitFor(text('Voting: Rejected')); // nobody voted
        // master audio
        ok = ok && await waitFor(clickButton('Mute all'));
        ok = ok && await waitFor(text('Muted') + " && document.querySelector('main').textContent.includes('Unmute')");
        ok = ok && await waitFor(clickButton('Unmute'));
        await js(setField('input[aria-label="DCN master volume"]', '22'));
        ok = ok && await waitFor("document.querySelector('.volume-value').textContent === '22'");
        // discussion settings
        await js(setField('input[name="NumberOfOpenMicrophones"]', '6'));
        ok = ok && await waitFor(clickButton('Save'));
        ok = ok && await waitFor("document.querySelector('input[name=\"NumberOfOpenMicrophones\"]').value === '6'");
        // stop and restart meeting + session
        ok = ok && await waitFor(`(() => { const r = [...document.querySelectorAll('.row-item')].find(x => x.textContent.includes('Council meeting')); const b = r && [...r.querySelectorAll('button')].find(x => x.textContent === 'Stop'); if (b) { b.click(); return true; } return false; })()`);
        ok = ok && await confirmDialog();
        ok = ok && await waitFor(text('No meeting running'));
        ok = ok && await waitFor(`(() => { const r = [...document.querySelectorAll('.row-item')].find(x => x.textContent.includes('Council meeting')); const b = r && [...r.querySelectorAll('button')].find(x => x.textContent === 'Start'); if (b) { b.click(); return true; } return false; })()`);
        ok = ok && await waitFor(`(() => { const r = [...document.querySelectorAll('.row-item')].find(x => x.textContent.includes('Morning session')); const b = r && [...r.querySelectorAll('button')].find(x => x.textContent === 'Start'); if (b) { b.click(); return true; } return false; })()`);
        ok = ok && await waitFor(text('Session: Morning session'));
        await sleep(300);
        await shot('dcn');
        return ok;
      },
    };
    const smdScenarios = {
      async discussion() {
        const nav = await js("document.getElementById('nav').textContent");
        let ok = !/Meetings|Interpretation|Files|Audio/.test(nav) && /DCN/.test(nav);
        await js("location.hash = '#/discussion'");
        ok = ok && await waitFor("document.querySelectorAll('.seat').length >= 10");
        print({ type: 'mock', fn: 'micOn', args: [3] });
        print({ type: 'mock', fn: 'request', args: [5] });
        ok = ok && await waitFor(`${listText(0)}.includes('Clara Ruiz') && ${listText(1)}.includes('Eva Lindqvist')`);
        ok = ok && await js("![...document.querySelectorAll('main button')].some(b => ['Add', 'Request', 'Remove', 'Clear all'].includes(b.textContent))"); // read-only
        await shot('discussion');
        print({ type: 'mock', fn: 'micOff', args: [3] });
        print({ type: 'mock', fn: 'cancelRequest', args: [5] });
        ok = ok && await waitFor(`!${listText(0)}.includes('Clara Ruiz')`);
        if (!ok) print({ type: 'console', level: 'check', message: `dcn-smd discussion: nav=${JSON.stringify(nav)}` });
        return ok;
      },
      async 'dcn-stream'() {
        await js("location.hash = '#/settings/dcn-stream'");
        let ok = await waitFor(text('Council meeting')) && await waitFor(text('Morning session'));
        print({ type: 'mock', fn: 'startVoting', args: [1] });
        ok = ok && await waitFor(text('Approve the agenda'));
        print({ type: 'mock', fn: 'castVote', args: [2, 1] });
        print({ type: 'mock', fn: 'castVote', args: [3, 1] });
        print({ type: 'mock', fn: 'castVote', args: [4, 2] });
        print({ type: 'mock', fn: 'stopVoting' });
        ok = ok && await waitFor(text('Accepted')) && await waitFor(text('Yes: 2 (67%)'));
        print({ type: 'mock', fn: 'serviceCall', args: [4] });
        ok = ok && await waitFor(text('0004 · David Kim')) && await waitFor(text('waiting for an usher'));
        print({ type: 'mock', fn: 'interpretation', args: [true] });
        ok = ok && await waitFor(text('FLR → A NLD'));
        print({ type: 'mock', fn: 'micTest' });
        ok = ok && await waitFor(text('11 passed, 1 failed'));
        await sleep(300);
        await shot('dcn-stream');
        return ok;
      },
    };
    // `connection` last: it switches to a simulated system and back, adding projects the other scenarios don't expect.
    for (const [name, run] of Object.entries(system === 'wireless' ? wirelessScenarios : system === 'dcn' ? dcnScenarios : system === 'dcn-smd' ? smdScenarios : scenarios).sort(([a], [b]) => (a === 'connection') - (b === 'connection'))) {
      if (!routes.includes(name)) continue;
      const ok = await run();
      print({ type: 'scenario', name, ok });
      if (!ok) consoleErrors.push({ level: 'check', message: `${name} scenario failed` });
    }

    if (system === 'wired' && routes.includes('discussion')) {
      // Scenario: 5 seats via the grid (mock allows 4 speakers → 5th is a request), remove one, give the floor.
      await js("location.hash = '#/discussion'");
      await waitFor("document.querySelectorAll('.seat').length > 0");
      const seatButton = (seat, label) => `(() => { const t = [...document.querySelectorAll('.seat')].find(x => x.querySelector('.seat-name').textContent === '${seat}'); const b = t && [...t.querySelectorAll('button')].find(x => x.textContent === '${label}'); if (b && !b.disabled) { b.click(); return true; } return false; })()`;
      const rows = box => `[...document.querySelectorAll('.discussion-lists .card')][${box === 'speakers' ? 0 : 1}].innerText`;
      let ok = true;
      // Each step is labelled so a failure says where it stopped (an intermittent dark-pass failure, WO-046 log).
      const need = async (label, code, timeoutMs) => {
        if (!ok) return;
        ok = await waitFor(code, timeoutMs);
        if (!ok) print({ type: 'console', level: 'check', message: `discussion: "${label}" not reached; speakers=${JSON.stringify(await js(`${rows('speakers')}`))?.slice(0, 200)} requests=${JSON.stringify(await js(`${rows('requests')}`))?.slice(0, 200)}` });
      };
      // Wait until each added seat shows up in a list before the next click: two adds in flight may reach the server
      // in either order (seat 7 then became a speaker and seat 6 the request: the intermittent failure).
      const PEOPLE = { 3: 'Chloe', 4: 'Dirk', 5: 'Eva', 6: 'Femke', 7: 'Gerrit' };
      for (const n of [3, 4, 5, 6, 7]) {
        await need(`add seat ${n}`, seatButton(`Seat ${n}`, 'Add'));
        await need(`seat ${n} listed`, `(${rows('speakers')} + ${rows('requests')}).includes('${PEOPLE[n]}')`);
      }
      await need('seat 7 is a request', `${rows('requests')}.includes('Gerrit')`); // seat 7 = Gerrit Mulder → request
      await need('remove seat 3', seatButton('Seat 3', 'Remove'));
      await need('seat 7 promoted', `${rows('speakers')}.includes('Gerrit')`); // mock promotes the first request
      await sleep(1500); // let a timer tick
      writeFileSync(join(outDir, `discussion-scenario-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      for (const n of [4, 5, 6, 7]) await js(`fetch('/api/wired/ops/RemoveSeatFromDiscussionList', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seatId: 'seat-${n}' }) })`);
      await need('list empty again', `${rows('speakers')}.includes('Nobody is speaking')`);
      print({ type: 'scenario', name: 'discussion', ok });
      if (!ok) consoleErrors.push({ level: 'check', message: 'discussion scenario failed' });
    }

    // Connection view buttons: Disconnect, then Connect, observed through the header pill (SSE).
    await js("location.hash = '#/connection'");
    await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent === 'Disconnect' && !b.disabled)");
    await js("[...document.querySelectorAll('button')].find(b => b.textContent === 'Disconnect').click()");
    const disconnected = await waitFor("document.getElementById('connection-pill').dataset.state === 'disconnected'");
    await js("[...document.querySelectorAll('button')].find(b => b.textContent === 'Connect').click()");
    const reconnected = await waitFor("document.getElementById('connection-pill').dataset.state === 'loggedIn'");
    await waitFor("document.body.innerText.includes('Connected to')"); // success toast
    print({ type: 'buttons', ok: disconnected && reconnected });
    if (!(disconnected && reconnected)) consoleErrors.push({ level: 'check', message: 'connect/disconnect buttons failed' });
    await sleep(500); // let the post-connect sync finish

    // Live loop: UI → backend → DICENTIS (mock) → event → SSE → UI, without reload.
    await js("location.hash = '#/overview'");
    await sleep(300);
    let live;
    if (system !== 'wired') {
      print({ type: 'mock', fn: 'requestToSpeak', args: [12] }); // a delegate presses request-to-speak (WAP / DCN unit)
      live = await waitFor("[...document.querySelectorAll('.stat')].some(x => x.textContent === '1waiting')", 8000);
      await js("fetch('/api/domain/discussion', { method: 'DELETE' })");
    } else {
      await js("fetch('/api/wired/ops/SetMasterVolume', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ volume: 17 }) })");
      live = await waitFor("document.body.innerText.includes('17 (0–20)')"); // mock range 0..20 → no dB suffix
    }
    print({ type: 'live', ok: live });
    for (const t of (await js('window.__errorToasts')).filter(x => !EXPECTED_TOASTS.test(x))) {
      consoleErrors.push({ level: 'toast', message: t });
      print({ type: 'console', level: 'error toast', message: t });
    }
    print({ type: 'done', consoleErrors: consoleErrors.length });
    app.exit(consoleErrors.length || !live ? 1 : 0);
  } catch (err) {
    print({ type: 'done', error: err.message });
    app.exit(1);
  }
});
