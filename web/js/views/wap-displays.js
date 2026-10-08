// Settings → Seat displays on DICENTIS Wireless (WO-089, DEC-024): the seat display logo is uploaded like a firmware
// file (WAP web UI configUpgradeController): POST /upgrades/file (multipart "firmware"), then POST /upgrades with the
// device ids. A file name containing "png" targets DCNM-WDE (the seats with a display); firmware files are matched by
// the device type in their name. /system/settings showCompanyLogo switches the logo on the displays.
import { h, replace, toast, toastError } from '../dom.js';
import { undocumentedNote, unavailable, checkField } from '../wap.js';

const STATES = { 1: 'Idle', 2: 'Missing', 3: 'Downloading', 4: 'Programming', 5: 'Rebooting', 6: 'Done', 7: 'Failed' };
const BUSY = new Set([3, 4, 5]);

/** Device type a file is for, by its name (the web UI's rule). */
export function fileDeviceType(name) {
  for (const t of ['DCNM-WAP', 'DCNM-WDE', 'DCNM-WD', 'png']) if (name.includes(t)) return t === 'png' ? 'DCNM-WDE' : t;
  return null;
}

export default {
  id: 'seat-displays',
  title: 'Seat displays',
  feature: 'wapConfig',
  topics: ['wirelessUpgrades', 'wirelessSystemSettings'],
  mount(el, { store, api }) {
    const showBox = h('div');
    const uploadBox = h('div');
    const devicesBody = h('tbody');
    let file = null;
    let preview = null; // data: URL of the picked PNG (the CSP allows data:, not blob:)
    let busy = false;

    function renderShow() {
      const s = store.topic('wirelessSystemSettings');
      if (!s) return replace(showBox, unavailable(store, 'wirelessSystemSettings'));
      const d = store.topic('wirelessDiscuss');
      replace(showBox,
        'showCompanyLogo' in s
          ? checkField('Show the uploaded logo on the seat displays', s.showCompanyLogo, v => api.wireless('PUT', '/system/settings', { ...s, showCompanyLogo: v }))
          : h('p', { class: 'muted' }, 'This WAP firmware has no logo setting.'),
        d ? h('p', { class: 'muted hint' }, `Discussion hints on the displays: "first in waiting list" ${d.showFirstInWaitingList ? 'on' : 'off'}, "possible to speak" ${d.showPossibleToSpeak ? 'on' : 'off'} (`,
          h('a', { href: '#/settings/discussion-settings' }, 'Discussion settings'), ').') : null);
    }

    const picker = h('input', { type: 'file', accept: '.png,image/png,.fw,.bin,.img,.pkg', 'aria-label': 'Logo or firmware file' });
    picker.addEventListener('change', () => {
      file = picker.files?.[0] ?? null;
      preview = null;
      renderUpload();
      if (file && /\.png$/i.test(file.name) && file.size < 5_000_000) {
        const picked = file;
        const reader = new FileReader();
        reader.onload = () => { if (file === picked) { preview = String(reader.result); renderUpload(); } };
        reader.readAsDataURL(picked);
      }
    });

    function renderUpload() {
      const devices = store.topic('wirelessUpgrades') ?? [];
      const type = file ? fileDeviceType(file.name) : null;
      const targets = devices.filter(d => d.deviceType === type);
      replace(uploadBox,
        h('label', { class: 'field' }, h('span', null, 'PNG logo for the seat displays (or a WAP firmware file)'), picker),
        preview ? h('img', { class: 'logo-preview', src: preview, alt: 'Selected logo' }) : null,
        file && !type ? h('p', { class: 'error-text' }, 'Unknown file: the name must contain "png" (logo) or a device type such as DCNM-WD, DCNM-WDE, DCNM-WAP.') : null,
        file && type ? h('p', { class: 'muted hint' }, `${file.name} (${Math.round(file.size / 1024)} kB) → ${type === 'DCNM-WDE' && /png/i.test(file.name) ? 'logo for the seats with a display (DCNM-WDE)' : type}: ${targets.length ? targets.map(d => d.deviceName).join(', ') : 'no such device on the WAP'}`) : null,
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary', disabled: !file || !targets.length || busy, onclick: () => install(targets) }, busy ? 'Uploading…' : 'Upload and install')));
    }

    async function install(targets) {
      busy = true;
      renderUpload();
      try {
        await api.upload('POST', `/wireless/upgrades/file?name=${encodeURIComponent(file.name)}`, file, file.type || 'application/octet-stream');
        await api.wireless('POST', '/upgrades', targets.map(d => d.deviceID));
        toast(`${file.name} sent to ${targets.map(d => d.deviceName).join(', ')}: installing`, 'success');
        file = null;
        picker.value = '';
      } catch (err) {
        toastError(err, 'Upload: ');
      } finally {
        busy = false;
        renderUpload();
      }
    }

    function renderDevices() {
      const devices = store.topic('wirelessUpgrades');
      if (!devices) return replace(devicesBody, h('tr', null, h('td', { colspan: 4, class: 'muted' }, store.unavailable('wirelessUpgrades') ?? 'Loading…')));
      replace(devicesBody, devices.map(d => h('tr', null,
        h('td', null, h('strong', null, d.deviceName ?? d.deviceType)), h('td', null, d.deviceType ?? ''), h('td', null, h('code', null, d.version ?? '')),
        h('td', null, h('span', { class: ['pill', d.state === 6 ? 'loggedIn' : d.state === 7 ? 'disconnected' : BUSY.has(d.state) ? 'connecting' : null] }, STATES[d.state] ?? `State ${d.state}`)))));
    }

    el.append(h('h1', { id: 'view-title' }, 'Seat displays'),
      h('div', { class: 'split' },
        h('article', { class: 'card' }, h('h2', null, 'What the displays show'), showBox),
        h('article', { class: 'card' }, h('h2', null, 'Logo / firmware upload'), uploadBox)),
      h('article', { class: 'card' }, h('h2', null, 'Devices and upgrade progress'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, ['Device', 'Type', 'Version', 'State'].map(t => h('th', { scope: 'col' }, t)))), devicesBody))),
      undocumentedNote());
    const all = () => { renderShow(); renderUpload(); renderDevices(); };
    all();
    const off = store.subscribe(['topic:wirelessUpgrades', 'topic:wirelessSystemSettings', 'topic:wirelessDiscuss'], () => { renderShow(); renderDevices(); if (!busy && !file) renderUpload(); });
    return off;
  },
};
