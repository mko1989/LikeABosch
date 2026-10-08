// Interpretation: booths, interpreter desks, routings, notifications, meta-functions (WO-023).
// Needs canViewInterpretation to view and canControlInterpretation for actions (spec), plus the DCNM-LIPM licence.
import { h, replace, humanize, actionButton, toastError } from '../dom.js';
import { interpreters } from '../interp.js';
import { mountDicentisLanguages } from '../dicentis-languages.js';

const MIC_STATES = [['off', 'Off'], ['activeOnOutputA', 'A'], ['activeOnOutputB', 'B'], ['activeOnOutputC', 'C']];
const SPEAK_SLOW = 'speakSlow'; // meta request value shown in the PDF example (p.125)
// RaiseBoothNotification remarks name "PhoneCall and/or Alarm"; exact values to verify on a real server (WO-028).
const BOOTH_NOTIFICATIONS = [['PhoneCall', 'Phone call'], ['Alarm', 'Alarm']];

export default {
  id: 'interpretation',
  feature: 'interpretation', // wired only (DEC-010)
  title: 'Interpretation',
  topics: ['interpreterBooths', 'interpreterSeats', 'interpretationLanguages'],
  permissions: ['canViewInterpretation'],
  mount(el, { store, api }) {
    const languagesBox = h('div');
    const setupBox = h('div'); // WO-102: add languages, meeting languages, desk outputs (full DICENTIS API)
    const boothsBox = h('div', { class: 'booths' });
    const canControl = () => store.can('canControlInterpretation');

    const languages = () => store.topic('interpretationLanguages')?.languages ?? [];
    const it = interpreters(store); // real 6.50 semantics: floor = language index 0, relay = '', PascalCase states
    const langLabel = id => it.abbr(id);

    async function call(op, params, what) {
      try { await api.wired(op, params); } catch (err) { toastError(err, `${what} failed: `); }
    }

    function deskCard(seat) {
      const routing = it.routing(seat.seatId);
      const metas = store.topic('interpretationMetaFunctionStatus')?.requestStatus?.seatMetaData?.find(m => m.seatId === seat.seatId)?.seatMetaRequests ?? [];
      const slow = metas.includes(SPEAK_SLOW);
      const control = canControl() && seat.status !== 'disconnected';
      const micState = it.mic(routing); // PascalCase on the real server ("ActiveOnOutputA")

      const outputSelect = (button, list, current) => h('select', {
        'aria-label': `Output ${button === 'outputPresetB' ? 'B' : 'C'} language`, disabled: !control,
        onchange: e => call('SetInterpretationOutputPreset', { seatId: seat.seatId, outputButton: button, languageId: e.target.value }, 'Output preset'),
      }, (list ?? []).map(id => h('option', { value: id, selected: id === current }, langLabel(id))));

      return h('div', { class: ['desk', seat.status, micState !== 'off' && 'live'] },
        h('div', { class: 'desk-head' },
          h('strong', null, `Desk ${seat.deskNumber}`),
          h('small', { class: 'muted' }, `${humanize(seat.deskType)} · ${humanize(seat.status)}`),
          slow ? h('span', { class: 'tag warn-tag' }, 'Speak slowly') : null),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Languages'),
          h('span', { class: 'v' }, `A ${langLabel(seat.aLanguageId)} · B `, outputSelect('outputPresetB', seat.bLanguageList, seat.bLanguageId),
            ' · C ', outputSelect('outputPresetC', seat.cLanguageList, seat.cLanguageId))),
        routing ? h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Routing'),
          h('span', { class: 'v' }, `${it.sourceLabel(it.source(routing))} → ${langLabel(routing.destinationLanguageId)}`,
            it.quality(routing) && it.quality(routing) !== 'unknown' ? h('small', { class: 'muted' }, ` (${humanize(it.quality(routing))})`) : null,
            routing.autoRelayContribution ? h('small', { class: 'tag' }, 'auto-relay') : null)) : null,
        h('div', { class: 'desk-controls' },
          h('div', { class: 'segmented', role: 'group', 'aria-label': `Desk ${seat.deskNumber} microphone` },
            MIC_STATES.map(([state, label]) => h('button', {
              type: 'button', class: state === micState ? 'on' : null, 'aria-pressed': String(state === micState), disabled: !control,
              title: state === 'off' ? 'Microphone off' : `Microphone on output ${label}`,
              onclick: () => call('GrantInterpretation', { seatId: seat.seatId, microphoneState: state }, 'Microphone'),
            }, label))),
          control ? actionButton('Floor', () => api.wired('SelectInterpretationFloor', { seatId: seat.seatId }), { cls: 'small' }) : null,
          control ? actionButton('Relay', () => api.wired('SelectRelayInterpretation', { seatId: seat.seatId }), { cls: 'small' }) : null,
          control ? actionButton(slow ? 'Cancel slow' : 'Speak slowly',
            () => api.wired(slow ? 'CancelInterpreterMetaFunction' : 'IssueInterpreterMetaFunction', { seatId: seat.seatId, request: SPEAK_SLOW }),
            { cls: 'small' }) : null));
    }

    function render() {
      const langs = languages();
      replace(languagesBox, langs.length
        ? h('ul', { class: 'chips' }, langs.map(l => h('li', { title: l.label }, `${l.abbreviation} · ${l.label}`)))
        : h('p', { class: 'muted' }, store.unavailable('interpretationLanguages') ?? 'No interpretation languages'));

      const booths = store.topic('interpreterBooths')?.booths ?? [];
      const seats = store.topic('interpreterSeats')?.seats ?? [];
      const notes = store.topic('boothNotifications')?.notifications ?? [];
      if (!booths.length) {
        replace(boothsBox, h('p', { class: 'muted' }, store.unavailable('interpreterBooths') ?? 'No interpreter booths configured'));
        return;
      }
      replace(boothsBox, booths.map(booth => {
        const boothNotes = notes.find(n => n.boothId === booth.boothId)?.notifications ?? [];
        return h('article', { class: 'card booth' },
          h('div', { class: 'card-head' },
            h('h2', null, `Booth ${booth.boothNumber}`, booth.autoRelay ? h('small', { class: 'tag' }, 'auto-relay') : null),
            canControl() ? h('span', { class: 'row-actions' }, BOOTH_NOTIFICATIONS.map(([value, label]) => actionButton(label,
              () => api.wired('RaiseBoothNotification', { boothId: booth.boothId, notification: value }), { cls: 'small' }))) : null),
          boothNotes.length ? h('p', { class: 'booth-notes' }, 'Notifications: ', boothNotes.map(humanize).join(', ')) : null,
          h('div', { class: 'desks' }, seats.filter(s => s.boothId === booth.boothId).sort((a, b) => a.deskNumber - b.deskNumber).map(deskCard)));
      }));
    }

    el.append(
      h('h1', { id: 'view-title' }, 'Interpretation'),
      h('article', { class: 'card' }, h('h2', null, 'Languages'), languagesBox),
      h('article', { class: 'card dicentis-languages', id: 'languages-setup' }, h('h2', null, 'Languages setup (add & assign)'), setupBox),
      boothsBox,
    );
    render();
    const offSetup = mountDicentisLanguages(setupBox, { store, api }); // WO-102
    const off = store.subscribe(['topic:interpretationLanguages', 'topic:interpreterBooths', 'topic:interpreterSeats', 'topic:interpretationRoutings',
      'topic:boothNotifications', 'topic:interpretationMetaFunctionStatus', 'connection'], render);
    return () => { off(); offSetup(); };
  },
};
