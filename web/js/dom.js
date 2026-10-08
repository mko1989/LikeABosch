// DOM helpers (DEC-009). Build elements with h(); never put server data into innerHTML.

/**
 * Create an element.
 * @param {string} tag
 * @param {Record<string, any> | null} [props]  class, dataset, style (object), on<event> handlers, other attributes/properties
 * @param {...any} children  strings, numbers, nodes, arrays; null/undefined/false are skipped
 * @returns {HTMLElement}
 */
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && typeof value !== 'string') el[key] = value; // e.g. checked, disabled, value
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replace all children of `el`. */
export function replace(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/**
 * Show a transient message.
 * @param {string} message
 * @param {'info' | 'success' | 'error'} [kind]
 */
export function toast(message, kind = 'info', timeoutMs = kind === 'error' ? 8000 : 4000) {
  const host = document.getElementById('toasts');
  const el = h('div', { class: ['toast', kind], role: kind === 'error' ? 'alert' : 'status' }, message,
    h('button', { class: 'toast-close', 'aria-label': 'Dismiss', onclick: () => el.remove() }, '×'));
  host.append(el);
  setTimeout(() => el.remove(), timeoutMs);
}

/** Show an API error as a toast with the most useful text. */
export function toastError(err, prefix = '') {
  const detail = err.details?.length ? ` (${err.details.join('; ')})` : err.upstream ? ` (${err.upstream})` : '';
  toast(`${prefix}${err.message}${detail}`, 'error');
}

/**
 * Ask for confirmation with a native <dialog>. Resolves true/false.
 * @param {string} message
 * @param {{ confirmLabel?: string, danger?: boolean }} [opts]
 */
export function confirmAction(message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise(resolve => {
    const dialog = h('dialog', { class: 'confirm' },
      h('form', { method: 'dialog' },
        h('p', null, message),
        h('div', { class: 'actions' },
          h('button', { value: 'cancel', class: 'secondary' }, 'Cancel'),
          h('button', { value: 'ok', class: danger ? 'danger' : 'primary' }, confirmLabel))));
    dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'ok'); dialog.remove(); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Ask for a line of text with a native <dialog>. Resolves the trimmed text, or null when cancelled.
 * @param {string} message
 * @param {{ value?: string, confirmLabel?: string, label?: string, maxLength?: number }} [opts]
 */
export function promptText(message, { value = '', confirmLabel = 'OK', label = 'Name', maxLength = 80 } = {}) {
  return new Promise(resolve => {
    const input = h('input', { type: 'text', value, maxlength: maxLength, required: true, 'aria-label': label });
    const dialog = h('dialog', { class: 'confirm' },
      h('form', { method: 'dialog' },
        h('p', null, message),
        h('label', { class: 'field' }, h('span', null, label), input),
        h('div', { class: 'actions' },
          h('button', { value: 'cancel', class: 'secondary', formnovalidate: true }, 'Cancel'),
          h('button', { value: 'ok', class: 'primary' }, confirmLabel))));
    dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'ok' && input.value.trim() ? input.value.trim() : null); dialog.remove(); });
    document.body.append(dialog);
    dialog.showModal();
    input.select();
  });
}

/** Human-readable enum: "poweredOn" → "Powered on", "isPrioritySpeaker" → "Priority speaker". */
export function humanize(value) {
  if (value === null || value === undefined || value === '') return '—';
  const s = String(value).replace(/^is(?=[A-Z])/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** mm:ss from milliseconds; negative values get a leading minus (overtime). */
export function formatDuration(ms) {
  const sign = ms < 0 ? '-' : '';
  const total = Math.floor(Math.abs(ms) / 1000);
  return `${sign}${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * A button that runs an async action: disabled while running, errors shown as a toast.
 * The UI waits for the SSE update instead of changing state itself (DEC-009).
 * @param {string} label
 * @param {() => Promise<unknown>} action
 * @param {{ cls?: string, disabled?: boolean, title?: string, confirm?: string, danger?: boolean }} [opts]
 */
export function actionButton(label, action, { cls = 'secondary', disabled = false, title, confirm, danger = false } = {}) {
  const btn = h('button', { type: 'button', class: cls, disabled, title });
  btn.textContent = label;
  btn.addEventListener('click', async () => {
    if (confirm && !(await confirmAction(confirm, { confirmLabel: label, danger }))) return;
    btn.disabled = true;
    try {
      await action();
    } catch (err) {
      toastError(err, `${label} failed: `);
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  });
  return btn;
}
