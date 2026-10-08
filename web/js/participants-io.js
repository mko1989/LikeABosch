// Participants + seating Excel export / import (WO-085, DEC-023): toolbar buttons and the import preview dialog.
// The backend reads the file and plans the changes; nothing changes until "Apply" in the preview.
import { h, replace, toast, toastError } from './dom.js';

/**
 * "Export Excel" + "Import…" for the Participants and Seating views.
 * @param {{ store: object, api: object }} ctx
 */
export function participantIoButtons({ store, api }) {
  const file = h('input', { type: 'file', accept: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv', hidden: true });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = '';
    if (f) importDialog(f, { store, api });
  });
  const canEdit = Boolean(store.topic('domain.capabilities')?.actions?.editParticipants);
  return h('span', { class: 'io-buttons row-inline' },
    h('a', { class: 'button-like secondary small', href: '/api/domain/participants/export.xlsx', download: '', title: 'Participants and seats as an Excel workbook' }, 'Export Excel'),
    h('button', { type: 'button', class: 'secondary small', title: canEdit ? 'Import participants and seats from Excel (.xlsx) or CSV: preview first' : 'Preview an import (the connected system cannot apply it)',
      onclick: () => file.click() }, 'Import…'),
    file);
}

const rowText = e => `${e.line ? `Row ${e.line}: ` : ''}${e.message}`;

async function importDialog(f, { store, api }) {
  const canEdit = Boolean(store.topic('domain.capabilities')?.actions?.editParticipants);
  const remove = h('input', { type: 'checkbox', 'aria-label': 'Remove participants not in the file' });
  const body = h('div', { class: 'import-body' }, h('p', { class: 'muted' }, 'Reading the file…'));
  const apply = h('button', { type: 'button', class: 'primary', disabled: true }, 'Apply');
  const close = h('button', { type: 'button', class: 'secondary' }, 'Cancel');
  const dialog = h('dialog', { class: 'confirm import-dialog', 'aria-label': 'Import participants' },
    h('h2', null, 'Import participants'),
    body,
    h('label', { class: 'check' }, remove, ' Remove participants that are not in the file'),
    h('div', { class: 'actions' }, close, apply));
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();

  let plan = null;
  const query = extra => `/domain/participants/import?remove=${remove.checked ? 1 : 0}${extra}`;
  async function preview() {
    apply.disabled = true;
    try {
      ({ plan } = await api.upload('POST', query(''), f));
      render();
    } catch (err) {
      replace(body, h('p', { class: 'error-text' }, err.message));
    }
  }
  function render() {
    const n = plan.creates.length + plan.updates.length + plan.deletes.length + plan.unassigns.length;
    const list = (title, items, fmt) => (items.length ? [h('h3', null, `${title} (${items.length})`), h('ul', { class: 'compact import-list' }, items.map(x => h('li', null, fmt(x))))] : null);
    const seat = id => (id ? id : 'no seat');
    const change = u => [h('strong', null, u.name), ': ', [
      u.to.name !== undefined && `name → ${u.to.name}`,
      u.to.seatId !== undefined && `seat ${u.from.seatName ?? 'none'} → ${seat(u.seatName)}`,
      u.to.nfc !== undefined && `NFC → ${u.to.nfc || 'none'}`,
    ].filter(Boolean).join(', ')];
    replace(body,
      h('p', { class: 'muted small-text' }, `${f.name} · sheet "${plan.sheet}" · ${plan.columns.seat ? 'with' : 'without'} seats · ${plan.columns.nfc ? 'with' : 'without'} NFC tags · ${plan.unchanged} unchanged`),
      plan.errors.length ? [h('h3', { class: 'error-text' }, `Errors (${plan.errors.length}): nothing can be applied`), h('ul', { class: 'compact import-list error-text' }, plan.errors.map(e => h('li', null, rowText(e))))] : null,
      list('New participants', plan.creates, c => [h('strong', null, c.name), c.seatName ? ` · ${c.seatName}` : '', c.nfc ? ` · NFC ${c.nfc}` : '']),
      list('Changes', plan.updates, change),
      list('Lose their seat / NFC tag', plan.unassigns, u => [h('strong', null, u.name), u.seatName ? ` · ${u.seatName}` : '', u.nfc ? ' · NFC tag' : '']),
      list('Deleted', plan.deletes, d => h('strong', null, d.name)),
      list('Notes', plan.warnings.filter(w => w.line), rowText), // the others repeat "Lose their seat"
      !plan.errors.length && !n ? h('p', null, 'Nothing to change: the system already matches the file.') : null,
      !canEdit ? h('p', { class: 'muted small-text' }, 'The connected system does not let LikeABosch edit participants: this is a preview only.') : null);
    apply.disabled = !canEdit || plan.errors.length > 0 || n === 0;
    apply.textContent = n ? `Apply ${n} change${n === 1 ? '' : 's'}` : 'Apply';
  }
  remove.addEventListener('change', preview);
  apply.addEventListener('click', async () => {
    apply.disabled = true;
    try {
      const { result } = await api.upload('POST', query('&apply=1'), f);
      toast(`Import done: ${result.done} change${result.done === 1 ? '' : 's'}`, 'success');
      dialog.close();
    } catch (err) {
      toastError(err, 'Import: ');
      preview(); // show what is left to do
    }
  });
  await preview();
}
