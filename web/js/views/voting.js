// Voting: lifecycle control and live results on the domain layer (both systems, WO-027); wired adds prepared/ad-hoc
// votings, majority/quorum and accept/reject; wireless adds voting parameters (subject, answer mode); DCN (WO-063) starts
// votings from the session's voting script in Settings → DCN and is controlled here like wireless (domain.voting only).
// Lifecycle (VotingState): ready → opened ⇄ onHold → done → accepted | rejected; opened/onHold → canceled (abort).
import { h, replace, humanize, actionButton, toastError } from '../dom.js';
import { IN_PROGRESS, CONTROLS, WIRELESS_CONTROLS, DCN_CONTROLS, resultRows } from '../voting-controls.js';

/** Wireless VotingParameters.mode (swagger). */
const WIRELESS_MODES = ['For / Against', 'For / Against / Abstain', 'For / Against / Abstain / DNPV', 'Yes / No', 'Yes / No / Abstain', 'Yes / No / Abstain / DNPV'];

export default {
  id: 'voting',
  title: 'Voting',
  topics: ['domain.voting'],
  mount(el, { store, api }) {
    const activeBox = h('div');
    const resultsBox = h('div');
    const listBox = h('div', { class: 'list' });
    const adHocBox = h('div');
    const parametersBox = h('div');
    const canControl = () => store.action('controlVoting');
    const wireless = () => store.system === 'wireless';
    /** Systems whose voting card reads only domain.voting (no wired votingInfo). */
    const domainOnly = () => ['wireless', 'dcn', 'dcn-smd'].includes(store.system);

    const voting = () => store.topic('domain.voting');
    const state = () => voting()?.state ?? 'closed';
    const info = () => (domainOnly() ? voting() : store.topic('votingInfo')?.votingInfo ?? null);
    /** A new voting can't be activated while one is open or on hold. */
    const busy = () => state() === 'opened' || state() === 'onHold';

    function renderActive() {
      if (!voting()) {
        const reason = store.unavailable('domain.voting');
        replace(activeBox, h('p', { class: 'muted' }, reason ? `Voting is not available: ${reason}.` : 'Loading…'));
        return;
      }
      const v = info();
      const st = state();
      if (domainOnly()) {
        const d = voting();
        const controls = (wireless() ? WIRELESS_CONTROLS : DCN_CONTROLS)[st];
        replace(activeBox,
          h('p', { class: 'headline' }, d?.reference ? `${d.reference} · ` : '', d?.subject || (st === 'closed' ? 'No voting' : '(no subject)')),
          d?.description ? h('p', { class: 'muted' }, d.description) : null,
          h('div', { class: 'kv' }, h('span', { class: 'k' }, 'State'), h('span', { class: ['v', 'state', st] }, humanize(st))),
          h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Answers'), h('span', { class: 'v' }, (d?.answers ?? []).map(humanize).join(', ') || '—')),
          canControl() && controls ? h('div', { class: 'actions' },
            controls.map(([label, action, opts]) => actionButton(label, () => api.domain('POST', `/voting/${action}`), opts))) : null);
        return;
      }
      if (!v || !IN_PROGRESS.has(st) && !['accepted', 'rejected', 'canceled'].includes(st)) {
        replace(activeBox, h('p', { class: 'muted' }, 'No voting is active. Activate a prepared voting or start an ad-hoc voting.'));
        return;
      }
      replace(activeBox,
        h('p', { class: 'headline' }, v.referenceNumber ? `${v.referenceNumber} · ` : '', v.subject || '(no subject)'),
        v.description ? h('p', { class: 'muted' }, v.description) : null,
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'State'), h('span', { class: ['v', 'state', st] }, humanize(st))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Answers'), h('span', { class: 'v' }, (v.votingAnswers ?? []).map(humanize).join(', ') || '—')),
        v.votingTimerType && v.votingTimerType !== 'noVotingTimer'
          ? h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Timer'), h('span', { class: 'v' }, `${humanize(v.votingTimerType)} · ${v.votingTimeDuration}s`))
          : null,
        canControl() && CONTROLS[st] ? h('div', { class: 'actions' },
          CONTROLS[st].map(([label, action, opts]) => actionButton(label, () => api.domain('POST', `/voting/${action}`), opts))) : null,
      );
    }

    function renderResults() {
      const results = voting()?.results ?? [];
      const seatResults = wireless() ? null : store.topic('seatVotingResults')?.votingResults;
      const seats = store.topic('domain.seats')?.filter(s => s.canVote).length;
      const { total, rows } = resultRows(results);
      if (!results.length) {
        replace(resultsBox, h('p', { class: 'muted' }, 'No results yet'));
        return;
      }
      replace(resultsBox,
        // One series → one hue, labels and counts as text on every row (no colour-only identity).
        h('div', { class: 'bars', role: 'table', 'aria-label': 'Voting results' }, rows.map(r =>
          // Answers: share of the votes cast. Not voted: share of everyone who could vote (cast + not voted).
          h('div', { class: 'bar-row', role: 'row', title: `${humanize(r.answer)}: ${r.count} vote${r.count === 1 ? '' : 's'} (${r.pct}%)` },
            h('span', { class: 'bar-label', role: 'cell' }, humanize(r.answer)),
            h('span', { class: 'bar-track', role: 'cell', 'aria-hidden': 'true' },
              h('span', { class: 'bar-fill', style: { width: `${r.width}%` } })),
            h('span', { class: 'bar-value', role: 'cell' }, String(r.count), h('small', null, ` ${r.pct}%`))))),
        h('p', { class: 'muted turnout' },
          `${total} vote${total === 1 ? '' : 's'} cast`,
          seats ? ` · ${seatResults?.length ?? total} of ${seats} voting seats responded` : ''),
        resultLine('Majority', store.topic('majorityResult')?.majorityResult),
        resultLine('Quorum', store.topic('quorumResult')?.quorumResult),
      );
    }

    function resultLine(label, r) {
      if (!r?.isEnabled) return null;
      const op = { greaterThan: '>', greaterThanOrEqualTo: '≥', equals: '=', lessThan: '<', lessThanOrEqualTo: '≤' }[r.comparisonOperator] ?? r.comparisonOperator;
      const verdict = r.status === 'true' ? 'reached' : r.status === 'false' ? 'not reached' : 'error';
      return h('div', { class: 'kv' }, h('span', { class: 'k' }, label),
        h('span', { class: 'v' }, `${r.numeratorValue}/${r.denominatorValue} ${op} ${r.thresholdValue}: `, h('strong', null, verdict)));
    }

    function renderParameters() {
      if (!store.feature('votingParameters')) return replace(parametersBox);
      const p = store.topic('wirelessVoting');
      const locked = state() !== 'closed' || !canControl();
      const form = h('form', { class: 'settings', novalidate: true },
        h('label', { class: 'field' }, h('span', null, 'Subject'), h('input', { name: 'subject', maxlength: 141, value: p?.subject ?? '', disabled: locked })),
        h('label', { class: 'field' }, h('span', null, 'Answers'), h('select', { name: 'mode', disabled: locked },
          WIRELESS_MODES.map((label, i) => h('option', { value: String(i), selected: i === p?.mode }, label)))),
        h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'secondary', disabled: locked }, 'Save parameters')),
        locked && canControl() ? h('p', { class: 'muted hint' }, 'Parameters can only be changed while the voting is closed.') : null);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        try {
          await api.domain('PUT', '/voting/parameters', { subject: form.elements.namedItem('subject').value.trim(), mode: Number(form.elements.namedItem('mode').value) });
        } catch (err) {
          toastError(err, 'Voting parameters: ');
        }
      });
      replace(parametersBox, form);
    }

    function renderList() {
      if (!store.feature('votingPrepared')) return replace(listBox);
      const list = store.topic('votings')?.votingList ?? [];
      const activeId = info()?.votingId;
      const locked = busy();
      replace(listBox, list.length ? list.map(v => h('div', { class: ['row-item', 'voting-row', v.votingId === activeId && 'current'] },
        h('span', { class: ['state-dot', v.state], title: humanize(v.state) }),
        h('span', { class: 'name' }, v.referenceNumber ? `${v.referenceNumber} ` : '', v.subject,
          h('small', { class: 'sub' }, humanize(v.state))),
        h('span'),
        h('span', { class: 'row-actions' }, canControl() && v.votingId !== activeId
          ? actionButton('Activate', () => api.wired('ActivateVoting', { votingId: v.votingId }), { cls: 'small', disabled: locked, title: locked ? 'Finish the current voting first' : undefined })
          : null)))
        : h('p', { class: 'muted empty' }, 'No prepared votings for this meeting'));
    }

    function renderAdHoc() {
      if (!canControl() || !store.feature('votingAdHoc')) return replace(adHocBox);
      const form = h('form', { class: 'settings', novalidate: true },
        h('div', { class: 'row' },
          h('label', { class: 'field' }, h('span', null, 'Subject'), h('input', { name: 'subject', maxlength: 50, required: true })),
          h('label', { class: 'field' }, h('span', null, 'Number'), h('input', { name: 'number', maxlength: 50 }))),
        h('label', { class: 'field' }, h('span', null, 'Description'), h('input', { name: 'description', maxlength: 255 })),
        h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'secondary', disabled: busy() }, 'Activate ad-hoc voting')));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const val = n => form.elements.namedItem(n).value.trim();
        if (!val('subject')) return form.elements.namedItem('subject').focus();
        const btn = form.querySelector('button');
        btn.disabled = true;
        try {
          await api.wired('ActivateAdHocVoting', { subject: val('subject'), number: val('number'), description: val('description') });
          form.reset();
        } catch (err) {
          toastError(err, 'Ad-hoc voting failed: ');
        } finally {
          btn.disabled = busy();
        }
      });
      replace(adHocBox, h('h2', { class: 'section-title' }, 'Ad-hoc voting'), form);
    }

    const render = () => { renderActive(); renderResults(); renderList(); renderAdHoc(); renderParameters(); };
    el.append(
      h('h1', { id: 'view-title' }, 'Voting'),
      h('div', { class: 'split' },
        h('div', { class: 'stack' },
          h('article', { class: 'card' }, h('h2', null, 'Current voting'), activeBox),
          h('article', { class: 'card' }, h('h2', null, 'Results'), resultsBox)),
        store.feature('votingPrepared')
          ? h('article', { class: 'card' }, h('h2', null, 'Prepared votings'), listBox, adHocBox)
          : store.feature('votingParameters')
            ? h('article', { class: 'card' }, h('h2', null, 'Voting parameters'), parametersBox)
            : store.feature('dcnControl')
              ? h('article', { class: 'card' }, h('h2', null, 'Voting script'),
                h('p', { class: 'muted' }, 'Select or start a voting from the active session\'s script, or start an ad-hoc voting, in ',
                  h('a', { href: '#/settings/dcn' }, 'Settings → DCN'), '.'))
              : store.feature('dcnStream')
                ? h('article', { class: 'card' }, h('h2', null, 'Read-only'),
                  h('p', { class: 'muted' }, 'Votings are run on the DCN system; LikeABosch follows them through the meeting data stream. Quorum, majority and percentages are in ',
                    h('a', { href: '#/settings/dcn-stream' }, 'Settings → DCN'), '.'))
                : null),
    );
    render();
    return store.subscribe(['topic:domain.voting', 'topic:votingInfo', 'topic:seatVotingResults', 'topic:majorityResult', 'topic:quorumResult',
      'topic:votings', 'topic:domain.seats', 'topic:wirelessVoting', 'topic:domain.capabilities', 'connection'], render);
  },
};
