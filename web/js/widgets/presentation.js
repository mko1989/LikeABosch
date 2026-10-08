// Room widget: presentation (WO-104, DEC-030): presentation mode on/off (Conference Protocol), the stream address
// DICENTIS re-streams it on (WO-105: docs/research/dicentis-presentation.md, manual §16.22).
import { h, actionButton } from '../dom.js';

export default {
  id: 'presentation',
  title: 'Presentation',
  settingsHref: '#/system',
  topics: ['presentationState', 'permissions'],
  available: store => store.topic('presentationState') !== undefined,
  render(store, api) {
    const on = Boolean(store.topic('presentationState')?.isPresentationEnabled);
    // 6.50 servers have canControlPresentation; older ones don't list it (fallback: canManageMeeting), as in System.
    const can = store.can('canControlPresentation') || store.can('canManageMeeting');
    const host = store.state.connection?.simulated ? null : store.state.connection?.host;
    return [
      h('p', { class: 'widget-headline' }, h('span', { class: ['state', on ? 'activated' : 'closed'] }, on ? 'Presenting' : 'Off'),
        on ? ' · the presentation replaces the speaker picture' : ''),
      can ? h('div', { class: 'actions' }, on
        ? actionButton('Stop presentation', () => api.wired('DeactivatePresentation'), { cls: 'small danger-outline' })
        : actionButton('Start presentation', () => api.wired('ActivatePresentation'), { cls: 'small primary' })) : h('p', { class: 'muted small-text' }, 'This account may not switch the presentation.'),
      h('p', { class: 'muted small-text' }, 'Source: a laptop through an H.264 encoder (Media Gateway), an HD-SDI switcher input, or the presenter app. Stream: ',
        h('code', null, `rtsp://${host || '<server>'}:9554/stream1`)),
    ];
  },
};
