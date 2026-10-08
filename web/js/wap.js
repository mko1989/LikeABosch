// Shared bits of the DICENTIS Wireless configuration views (WO-086…089, DEC-024): they use the WAP web UI's own,
// undocumented endpoints, so every view says so and shows "not available" when the firmware lacks an endpoint.
import { h, toastError } from './dom.js';

export const undocumentedNote = () => h('p', { class: 'muted hint undocumented-note' },
  'Uses the WAP\'s own web interface API (undocumented, checked with firmware 1.73): a WAP firmware update may change it.');

/** "Not available" text for a missing wireless topic. */
export const unavailable = (store, topic) => h('p', { class: 'muted' }, store.unavailable(topic) ?? 'Loading…');

/**
 * A labelled checkbox that writes at once.
 * @param {string} label
 * @param {boolean} checked
 * @param {(value: boolean) => Promise<unknown>} write
 * @param {{ disabled?: boolean, hint?: string }} [opts]
 */
export function checkField(label, checked, write, { disabled = false, hint } = {}) {
  const input = h('input', { type: 'checkbox', checked: Boolean(checked), disabled, 'aria-label': label });
  input.addEventListener('change', async () => {
    input.disabled = true;
    try { await write(input.checked); } catch (err) { input.checked = !input.checked; toastError(err, `${label}: `); } finally { input.disabled = disabled; }
  });
  return h('label', { class: 'check', title: hint ?? null }, input, ` ${label}`);
}

/** "fieldName" → "Field name" for fields the WAP sends that LikeABosch has no label for. */
export const fieldLabel = key => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, c => c.toUpperCase());
