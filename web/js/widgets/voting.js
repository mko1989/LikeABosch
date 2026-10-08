// Room widget: voting (WO-104, DEC-030): current voting, lifecycle controls, live results; start a prepared or an
// ad-hoc voting (wired). Same data and actions as Settings → Voting.
import { h, humanize, actionButton, toastError } from '../dom.js';
import { controlsFor, resultRows } from '../voting-controls.js';

export default {
  id: 'voting',
  title: 'Voting',
  settingsHref: '#/voting',
  topics: ['domain.voting', 'votingInfo', 'votings', 'domain.capabilities'],
  available: store => store.topic('domain.voting') !== undefined,
  render(store, api) {
    const d = store.topic('domain.voting');
    const st = d?.state ?? 'closed';
    const info = store.system === 'wired' ? store.topic('votingInfo')?.votingInfo : d;
    const can = store.action('controlVoting');
    const busy = st === 'opened' || st === 'onHold';
    const subject = info?.subject || d?.subject;
    const { total, rows } = resultRows(d?.results ?? []);
    const controls = can ? controlsFor(store.system, st) : [];
    const prepared = store.feature('votingPrepared') ? (store.topic('votings')?.votingList ?? []).filter(v => v.votingId !== info?.votingId) : [];
    let start = null;
    if (can && !busy && store.system === 'wired') {
      const pick = h('select', { 'aria-label': 'Prepared voting to activate' },
        h('option', { value: '' }, prepared.length ? 'Prepared voting…' : 'No prepared votings'),
        prepared.map(v => h('option', { value: v.votingId }, `${v.referenceNumber ? `${v.referenceNumber} ` : ''}${v.subject}`)));
      const adHoc = h('input', { type: 'text', maxlength: 50, placeholder: 'Ad-hoc subject', 'aria-label': 'Ad-hoc voting subject' });
      start = h('div', { class: 'widget-form' },
        prepared.length ? h('div', { class: 'row-inline' }, pick, actionButton('Activate', () => (pick.value ? api.wired('ActivateVoting', { votingId: pick.value }) : Promise.resolve()), { cls: 'small' })) : null,
        store.feature('votingAdHoc') ? h('form', { class: 'row-inline', onsubmit: async e => {
          e.preventDefault();
          if (!adHoc.value.trim()) return adHoc.focus();
          try { await api.wired('ActivateAdHocVoting', { subject: adHoc.value.trim(), number: '', description: '' }); adHoc.value = ''; } catch (err) { toastError(err, 'Ad-hoc voting failed: '); }
        } }, adHoc, h('button', { type: 'submit', class: 'small secondary' }, 'Start')) : null);
    }
    return [
      h('p', { class: 'widget-headline' }, h('span', { class: ['state', st] }, humanize(st)), subject ? ` · ${subject}` : ''),
      controls.length ? h('div', { class: 'actions' }, controls.map(([label, action, opts]) => actionButton(label, () => api.domain('POST', `/voting/${action}`), { ...opts, cls: `small ${opts?.cls ?? 'secondary'}` }))) : null,
      rows.length ? h('div', { class: 'bars compact', role: 'table', 'aria-label': 'Voting results' }, rows.map(r => h('div', { class: 'bar-row', role: 'row' },
        h('span', { class: 'bar-label', role: 'cell' }, humanize(r.answer)),
        h('span', { class: 'bar-track', role: 'cell', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: { width: `${r.width}%` } })),
        h('span', { class: 'bar-value', role: 'cell' }, String(r.count), h('small', null, ` ${r.pct}%`))))) : null,
      rows.length ? h('p', { class: 'muted small-text' }, `${total} vote${total === 1 ? '' : 's'} cast`) : null,
      start,
    ];
  },
};
