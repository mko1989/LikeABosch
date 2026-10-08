// Project in the top bar (WO-057, DEC-016): name (click = rename), auto-save time, New…, Projects…, Save as…, Download.
// A project = room + cameras/switcher; every change is saved automatically into the open project.
// WO-091: "New…" in the bar, "Clear…" (choose what to reset), the project name in the window title, and a toast when
// another project is opened (also from another browser).
// DEC-025 (WO-093): a project belongs to the DICENTIS system it is used with; connecting to another system opens that
// system's project (or creates one). The bar says which system the project is for and warns when it is another one.
import { h, replace, toast, toastError, confirmAction, promptText } from './dom.js';

const when = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = d.toDateString() === new Date().toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
};

/** @param {HTMLElement} el  @param {{ store: any, api: any }} ctx */
export function mountProjectBar(el, { store, api }) {
  const info = () => store.topic('project');
  let dialog = null;

  async function rename() {
    const cur = info()?.current;
    if (!cur) return;
    const name = await promptText('Rename the open project.', { value: cur.name, confirmLabel: 'Rename' });
    if (name && name !== cur.name) await api.patch(`/projects/${encodeURIComponent(cur.id)}`, { name }).catch(toastError);
  }

  async function saveAs() {
    const cur = info()?.current;
    const name = await promptText('Save a copy of this project under a new name and continue in the copy.', { value: cur ? `${cur.name} copy` : '', confirmLabel: 'Save as' });
    if (!name) return;
    localSwitch = true;
    try { await api.post('/projects', { name, copyCurrent: true }); toast(`Now working in "${name}"`, 'success'); } catch (err) { toastError(err); }
  }

  async function newProject() {
    const name = await promptText('New empty project (no room layout, no cameras).', { value: 'New project', confirmLabel: 'Create' });
    if (!name) return;
    if (!(await confirmAction(`Create "${name}" and open it? The cameras and the switcher of the current project disconnect.`, { confirmLabel: 'Create and open' }))) return;
    localSwitch = true;
    try { await api.post('/projects', { name }); closeDialog(); toast(`Project "${name}" created`, 'success'); } catch (err) { toastError(err); }
  }

  async function clearProject() {
    const cur = info()?.current;
    if (!cur) return;
    const parts = [['layout', 'Room layout (seat, camera and desk positions, room size)'], ['shots', 'Camera presets of the seats and the overview shot'],
      ['background', 'Floor plan image'], ['devices', 'Cameras and video switcher']];
    const boxes = parts.map(([key, label]) => [key, h('input', { type: 'checkbox', name: key, 'aria-label': label })]);
    const go = h('button', { value: 'ok', class: 'danger', disabled: true }, 'Clear');
    const d = h('dialog', { class: 'confirm clear-dialog', 'aria-label': 'Clear project' },
      h('form', { method: 'dialog' },
        h('h2', null, `Clear "${cur.name}"`),
        h('p', null, 'Choose what to remove from the open project. This cannot be undone (download the project first to keep a copy).'),
        h('div', { class: 'check-list' }, boxes.map(([key, box]) => h('label', { class: 'check' }, box, ` ${parts.find(p => p[0] === key)[1]}`))),
        h('div', { class: 'actions' }, h('button', { value: 'cancel', class: 'secondary' }, 'Cancel'), go)));
    for (const [, box] of boxes) box.addEventListener('change', () => { go.disabled = !boxes.some(([, b]) => b.checked); });
    document.body.append(d);
    d.showModal();
    await new Promise(resolve => d.addEventListener('close', resolve, { once: true }));
    d.remove();
    if (d.returnValue !== 'ok') return;
    const body = Object.fromEntries(boxes.filter(([, b]) => b.checked).map(([key]) => [key, true]));
    try { await api.post('/projects/current/clear', body); closeDialog(); toast(`"${cur.name}" cleared`, 'success'); } catch (err) { toastError(err, 'Clear: '); }
  }

  async function linkHere(x) {
    const label = info()?.connected?.label;
    if (!(await confirmAction(`Use "${x.name}" with ${label}? From now on, connecting to ${label} opens this project.`, { confirmLabel: 'Use here' }))) return;
    await api.patch(`/projects/${encodeURIComponent(x.id)}`, { system: 'connected' }).then(() => toast(`"${x.name}" now belongs to ${label}`, 'success'), toastError);
  }

  async function openProject(p) {
    if (!(await confirmAction(`Open "${p.name}"? The room and cameras switch to that project; cameras and the switcher reconnect.`, { confirmLabel: 'Open' }))) return;
    localSwitch = true;
    try { await api.post(`/projects/${encodeURIComponent(p.id)}/open`); closeDialog(); toast(`Project "${p.name}" open`, 'success'); } catch (err) { toastError(err); }
  }

  async function deleteProject(p) {
    if (!(await confirmAction(`Delete project "${p.name}"? Its room layout and camera settings are removed from this computer.`, { confirmLabel: 'Delete', danger: true }))) return;
    await api.del(`/projects/${encodeURIComponent(p.id)}`).catch(toastError);
  }

  async function loadFile(file) {
    if (!file) return;
    try {
      localSwitch = true;
      const res = await api.upload('POST', '/projects/import', file, 'application/octet-stream');
      closeDialog();
      toast(`Loaded "${res.current.name}" from ${file.name}`, 'success');
    } catch (err) { toastError(err, 'Load: '); }
  }

  function renderDialogBody() {
    if (!dialog) return;
    const p = info();
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', 'aria-label': 'Project file' });
    fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
    replace(dialog.querySelector('.dialog-body'),
      h('ul', { class: 'project-list' }, (p?.projects ?? []).map(x => {
        const isOpen = x.id === p.current?.id;
        const forSystem = x.system ? `for ${x.system.label}` : 'no system yet';
        const elsewhere = p.connected && x.system?.key !== p.connected.key;
        return h('li', { class: isOpen ? 'current' : null, 'data-project': x.id },
          h('span', { class: 'name' }, x.name, h('small', { class: 'sub' }, `${forSystem} · ${isOpen ? `open · saved ${when(x.updatedAt)}` : `changed ${when(x.updatedAt)}`}`),
            isOpen && elsewhere ? h('button', { type: 'button', class: 'link small', onclick: () => linkHere(x) }, `Use with ${p.connected.label}`) : null),
          isOpen ? h('span', { class: 'tag ok-tag' }, 'Open')
            : h('span', { class: 'row-actions' },
              h('button', { type: 'button', class: 'small primary', onclick: () => openProject(x) }, 'Open'),
              h('button', { type: 'button', class: 'small danger-outline', onclick: () => deleteProject(x) }, 'Delete')));
      })),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'secondary small', onclick: saveAs }, 'Save as…'),
        p?.current ? h('a', { class: 'button-like secondary small', href: `/api/projects/${encodeURIComponent(p.current.id)}/download`, download: '' }, 'Download') : null,
        h('button', { type: 'button', class: 'secondary small', onclick: newProject }, 'New empty project'),
        p?.current ? h('button', { type: 'button', class: 'small danger-outline', onclick: clearProject }, 'Clear…') : null,
        h('label', { class: 'button-like secondary small' }, 'Load from file…', fileInput)),
      h('p', { class: 'muted small-text' }, `Projects are stored in ${p?.dataDir ?? 'the data folder'} and saved automatically. A downloaded file contains the camera passwords.`));
  }

  function openDialog() {
    closeDialog();
    dialog = h('dialog', { class: 'confirm projects-dialog', 'aria-label': 'Projects' },
      h('div', { class: 'card-head' }, h('h2', null, 'Projects'), h('button', { type: 'button', class: 'link small', onclick: () => closeDialog() }, 'Close')),
      h('div', { class: 'dialog-body' }));
    dialog.addEventListener('close', () => { dialog?.remove(); dialog = null; });
    document.body.append(dialog);
    renderDialogBody();
    dialog.showModal();
  }
  function closeDialog() { if (dialog) { const d = dialog; dialog = null; d.close(); d.remove(); } }

  let shownId; // project shown last: a change means another project was opened
  let localSwitch = false; // this browser switched (it shows its own toast); otherwise another browser did
  let shownOpenAt;
  function render() {
    const p = info();
    const cur = p?.current;
    if (!cur) return replace(el);
    document.title = `${cur.name} · LikeABosch`;
    const lo = p.lastOpen;
    if (shownId && shownId !== cur.id) {
      if (lo?.reason === 'system') toast(`Connected to ${lo.label}: opened its project "${cur.name}"`, 'info', 8000);
      else if (lo?.reason === 'system-new') toast(`Connected to ${lo.label}: new empty project "${cur.name}" for this system`, 'info', 8000);
      else if (!localSwitch) toast(`Project "${cur.name}" was opened (from another window)`, 'info');
      localSwitch = false;
    } else if (lo?.reason === 'system-adopt' && lo.at !== shownOpenAt && shownId) {
      toast(`"${cur.name}" is now the project for ${lo.label}`, 'info', 8000);
    }
    shownId = cur.id;
    shownOpenAt = lo?.at;
    const elsewhere = p.connected && cur.system?.key !== p.connected.key;
    replace(el,
      h('span', { class: 'project-label muted' }, 'Project'),
      h('button', { type: 'button', class: 'project-name', title: `Project${cur.system ? ` for ${cur.system.label}` : ''} (click to rename)`, onclick: rename }, cur.name),
      elsewhere ? h('button', { type: 'button', class: 'tag warn-tag project-elsewhere', onclick: () => linkHere(cur),
        title: `This project belongs to ${cur.system?.label ?? 'no system'}; you are connected to ${p.connected.label}. Click to use it with ${p.connected.label}.` },
      cur.system ? `for ${cur.system.label}` : 'no system') : null,
      h('small', { class: 'project-saved', title: `Saved automatically · ${p.dataDir}` }, `✓ Saved ${when(cur.updatedAt)}`),
      h('button', { type: 'button', class: 'secondary small', onclick: newProject, title: 'Start a new, empty project' }, 'New…'),
      h('button', { type: 'button', class: 'secondary small', onclick: openDialog, title: 'Open another project, clear this one, or load a file' }, 'Projects…'),
      h('button', { type: 'button', class: 'secondary small wide-only', onclick: saveAs, title: 'Save a copy under a new name' }, 'Save as…'),
      h('a', { class: 'button-like secondary small wide-only', href: `/api/projects/${encodeURIComponent(cur.id)}/download`, download: '', title: 'Download this project as a file (includes camera passwords)' }, 'Download'));
    renderDialogBody();
  }

  store.subscribe(['topic:project'], render);
  render();
}
