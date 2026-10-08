// System: power, presentation, seat illumination, room info (WO-024). Master volume moved to Settings → Audio (WO-049).
// Power runs on the domain layer (both systems, WO-027); the other cards appear per system capability.
import { h, replace, humanize, actionButton, toastError } from '../dom.js';

export default {
  id: 'system',
  title: 'System',
  topics: ['domain.power', 'dcnBridge', 'smdStream'], // any is enough to use the view (DCN has no power API)
  mount(el, { store, api }) {
    const powerBox = h('div');
    const presentationBox = h('div');
    const illuminationBox = h('div');
    const roomBox = h('div');

    const identificationBox = h('div');
    const IDENTIFICATION_MODES = ['By assignment', 'At any seat', 'At assigned seat', 'Off']; // swagger ParticipantSettings

    function renderPower() {
      const mode = store.topic('domain.power')?.state;
      if (!mode && store.system === 'dcn-smd') return replace(powerBox, h('p', { class: 'muted' }, 'The DCN meeting data stream is read-only and reports no power state. Stream details are in ', h('a', { href: '#/settings/dcn-stream' }, 'Settings → DCN'), '.'));
      if (!mode && store.system === 'dcn') return replace(powerBox, h('p', { class: 'muted' }, 'The DCN-SW API has no power control. Meeting, audio and discussion settings are in ', h('a', { href: '#/settings/dcn' }, 'Settings → DCN'), '.'));
      if (!mode) return replace(powerBox, h('p', { class: 'muted' }, store.unavailable('domain.power') ?? 'Not available'));
      const transitioning = mode === 'poweringOn' || mode === 'poweringOff';
      const setPower = state => () => api.domain('PUT', '/power', { state });
      replace(powerBox,
        h('p', { class: 'headline' }, h('span', { class: ['state', `power-${mode}`] }, mode === 'on' ? 'Powered on' : mode === 'off' ? 'Powered off' : humanize(mode))),
        h('div', { class: 'actions' },
          store.action('powerOn') && mode !== 'on'
            ? actionButton('Power on', setPower('on'), { cls: 'primary', disabled: transitioning })
            : null,
          store.feature('powerStandby') && store.action('powerOff') && mode === 'on'
            ? actionButton('Standby', setPower('standby'), { disabled: transitioning })
            : null,
          store.action('powerOff') && mode !== 'off'
            ? actionButton('Power off', setPower('off'), {
              cls: 'danger-outline', danger: true, disabled: transitioning,
              confirm: 'Switch the conference system off? All devices will power down.',
            })
            : null),
        !store.action('powerOn') && !store.action('powerOff')
          ? h('p', { class: 'muted hint' }, 'This account may not switch power.') : null);
    }

    function renderIdentification() {
      const mode = store.topic('wirelessIdentification')?.identification_mode;
      if (mode === undefined) return replace(identificationBox, h('p', { class: 'muted' }, store.unavailable('wirelessIdentification') ?? 'Not available'));
      const select = h('select', { 'aria-label': 'Identification mode' },
        IDENTIFICATION_MODES.map((label, i) => h('option', { value: String(i), selected: i === mode }, label)));
      select.addEventListener('change', async () => {
        try {
          await api.wireless('PUT', '/participants/settings', { identification_mode: Number(select.value) });
        } catch (err) {
          toastError(err, 'Identification mode: ');
          renderIdentification();
        }
      });
      replace(identificationBox,
        h('p', { class: 'muted hint' }, 'How participants identify themselves at the wireless devices.'),
        h('label', { class: 'field' }, h('span', null, 'Identification'), select));
    }

    function renderPresentation() {
      const on = store.topic('presentationState')?.isPresentationEnabled;
      if (on === undefined) return replace(presentationBox, h('p', { class: 'muted' }, 'Not available'));
      replace(presentationBox,
        h('p', { class: 'headline' }, on ? 'Presentation active' : 'Presentation off'),
        // 6.50 servers have canControlPresentation; older ones don't list a permission (fallback: canManageMeeting).
        store.can('canControlPresentation') || store.can('canManageMeeting') ? h('div', { class: 'actions' },
          on ? actionButton('Deactivate', () => api.wired('DeactivatePresentation'))
            : actionButton('Activate', () => api.wired('ActivatePresentation'), { cls: 'primary' })) : null);
    }

    function renderIllumination() {
      const enabled = store.topic('seatIlluminationEnabled')?.enable;
      const seatId = store.topic('illuminatedSeat')?.seatId;
      const seats = store.topic('seats')?.seats ?? [];
      if (enabled === undefined) {
        return replace(illuminationBox, h('p', { class: 'muted' }, store.unavailable('seatIlluminationEnabled') ?? 'Not available'));
      }
      const select = h('select', { 'aria-label': 'Seat to illuminate', disabled: !enabled || !store.can('canEnableSeatIllumination') },
        h('option', { value: '' }, '— none —'),
        seats.map(s => h('option', { value: s.seatId, selected: s.seatId === seatId }, `${s.seatName}${s.screenLine ? ` · ${s.screenLine}` : ''}`)));
      select.addEventListener('change', async () => {
        try {
          if (select.value) await api.wired('SetIlluminateSeat', { seatId: select.value, setIlluminate: true });
          else if (seatId) await api.wired('SetIlluminateSeat', { seatId, setIlluminate: false });
        } catch (err) {
          toastError(err, 'Seat illumination failed: ');
          renderIllumination();
        }
      });
      replace(illuminationBox,
        h('p', { class: 'muted hint' }, 'Installation aid: lights the microphone LEDs of a seat red to identify it.'),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Illumination mode'), h('span', { class: 'v' }, enabled ? 'Enabled' : 'Disabled')),
        store.can('canEditSynoptic') ? h('div', { class: 'actions' },
          actionButton(enabled ? 'Disable' : 'Enable', () => api.wired('EnableSeatIllumination', { enable: !enabled }))) : null,
        h('label', { class: 'field' }, h('span', null, 'Illuminated seat'), select));
    }

    function renderRoom() {
      const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
      if (store.system === 'wireless') {
        const info = store.topic('wirelessSystemInfo');
        return replace(roomBox,
          kv('System', info?.['System Type'] ?? '—'), kv('Device', info?.['Device Type'] ?? '—'), kv('Hostname', info?.Hostname ?? '—'),
          kv('IP address', info?.Networks?.Ethernet?.eth0?.IP ?? info?.Networks?.Wireless?.wlan0?.IP ?? '—'),
          kv('Firmware', info?.Versions?.Firmware ?? '—'), kv('API versions', (info?.Versions?.Api ?? []).join(', ') || '—'),
          kv('Seats', String(store.topic('domain.seats')?.length ?? '—')));
      }
      if (store.system === 'dcn-smd') {
        const st = store.topic('smdStream');
        const m = store.topic('smdMeeting')?.meeting;
        return replace(roomBox,
          kv('Stream', st ? (st.state === 'loggedIn' ? 'Receiving' : humanize(st.state)) : '—'), kv('Encoding', st?.encoding ?? '—'), kv('Activities', String(st?.activities ?? 0)),
          kv('Channels', String(m?.channels?.length ?? '—')), kv('Seats', String(store.topic('domain.seats')?.length ?? '—')));
      }
      if (store.system === 'dcn') {
        const b = store.topic('dcnBridge');
        return replace(roomBox,
          kv('Bridge', b?.bridge ? `${b.bridge.name} ${b.bridge.version}` : '—'), kv('DCN-SW API', b?.bridge?.apiVersion || '—'),
          kv('Channels', String(store.topic('dcnChannels')?.length ?? '—')), kv('Seats', String(store.topic('domain.seats')?.length ?? '—')));
      }
      replace(roomBox,
        kv('Room', store.topic('roomName')?.roomName || '—'),
        kv('Contact', store.topic('roomContactEmail')?.roomContactEmail || '—'),
        kv('Seats', String(store.topic('domain.seats')?.length ?? '—')));
    }

    const cardIf = (feature, title, box) => (store.feature(feature) ? h('article', { class: 'card' }, h('h2', null, title), box) : null);
    el.append(
      h('h1', { id: 'view-title' }, 'System'),
      h('div', { class: 'cards two' },
        h('article', { class: 'card' }, h('h2', null, 'Power'), powerBox),
        cardIf('masterVolume', 'Audio', h('p', { class: 'muted' }, 'Master volume and microphone sensitivity are in ', h('a', { href: '#/settings/audio' }, 'Settings → Audio'), '.')),
        cardIf('presentation', 'Presentation', presentationBox),
        cardIf('illumination', 'Seat illumination', illuminationBox),
        cardIf('identificationMode', 'Participant identification', identificationBox),
        h('article', { class: 'card' }, h('h2', null, { wireless: 'Access point', dcn: 'DCN system', 'dcn-smd': 'DCN meeting data' }[store.system] ?? 'Room'), roomBox)),
    );
    const parts = [
      [['topic:domain.power', 'topic:domain.capabilities'], renderPower],
      [['topic:wirelessIdentification'], renderIdentification],
      [['topic:presentationState'], renderPresentation],
      [['topic:seatIlluminationEnabled', 'topic:illuminatedSeat', 'topic:seats'], renderIllumination],
      [['topic:roomName', 'topic:roomContactEmail', 'topic:wirelessSystemInfo', 'topic:domain.seats', 'topic:dcnBridge', 'topic:dcnChannels', 'topic:smdStream', 'topic:smdMeeting'], renderRoom],
    ];
    parts.forEach(([, render]) => render());
    const offs = parts.map(([keys, render]) => store.subscribe([...keys, 'connection'], render));
    return () => offs.forEach(off => off());
  },
};
