// Voting lifecycle controls per system and result rows (WO-021/027/063), shared by Settings → Voting and the Room voting
// widget (WO-104). Pure: no DOM.
// Lifecycle (VotingState): ready → opened ⇄ onHold → done → accepted | rejected; opened/onHold → canceled (abort).

export const IN_PROGRESS = new Set(['ready', 'opened', 'onHold', 'done']);

const ABORT = ['Abort', 'abort', { cls: 'danger-outline', danger: true, confirm: 'Abort this voting? Votes cast so far are discarded.' }];
/** Allowed controls per voting state: [label, domain action, options]. Wired lifecycle (DEC-010 vocabulary). */
export const CONTROLS = {
  ready: [['Open voting', 'open', { cls: 'primary' }]],
  opened: [['Hold', 'hold'], ['Close voting', 'close', { cls: 'primary' }], ABORT],
  onHold: [['Resume', 'resume', { cls: 'primary' }], ['Close voting', 'close'], ABORT],
  done: [['Accept result', 'accept', { cls: 'primary' }], ['Reject result', 'reject', { cls: 'danger-outline', danger: true, confirm: 'Reject the result of this voting?' }]],
};
/** Wireless: state 0/1/2 only, no abort/accept/reject. */
export const WIRELESS_CONTROLS = {
  closed: [['Open voting', 'open', { cls: 'primary' }]],
  opened: [['Hold', 'hold'], ['Close voting', 'close', { cls: 'primary' }]],
  onHold: [['Resume', 'resume', { cls: 'primary' }], ['Close voting', 'close']],
};
/** DCN: a voting is started by id (selected → open); results are published on stop; no abort/accept/reject. */
export const DCN_CONTROLS = {
  ready: [['Open voting', 'open', { cls: 'primary' }]],
  opened: [['Hold', 'hold'], ['Close voting', 'close', { cls: 'primary', confirm: 'Close the voting and publish the results?' }]],
  onHold: [['Resume', 'resume', { cls: 'primary' }], ['Close voting', 'close']],
};

/** Controls for a system and voting state ([] when nothing can be done). */
export function controlsFor(system, state) {
  const table = system === 'wireless' ? WIRELESS_CONTROLS : system === 'dcn' ? DCN_CONTROLS : system === 'dcn-smd' ? {} : CONTROLS;
  return table[state] ?? [];
}

/**
 * Result rows with percentages. Answers: share of the votes cast; "not voted": share of everyone who could vote.
 * @param {{ answer: string, count: number }[]} results
 */
export function resultRows(results) {
  const total = results.reduce((sum, r) => sum + (r.answer === 'notVoted' ? 0 : r.count), 0);
  const max = Math.max(1, ...results.map(r => r.count));
  return {
    total,
    rows: results.map(r => {
      const base = r.answer === 'notVoted' ? total + r.count : total;
      return { answer: r.answer, count: r.count, pct: base ? Math.round((r.count / base) * 100) : 0, width: (r.count / max) * 100 };
    }),
  };
}
