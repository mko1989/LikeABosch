// Files: meeting/voting notes, synoptic layout files, background images (WO-025).
// Notes HTML from the server is shown only inside a sandboxed iframe (no scripts, no same-origin): DEC-009.
import { h, replace, humanize, actionButton, toast, toastError } from '../dom.js';

const LAYOUT_ATTRIBUTE = 'Bosch.Synoptic.Layout'; // attribute value named in the PDF (ListFiles/CreateFile remarks)
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // SaveImage remarks: image < 2 MB

/** Trigger a browser download of text content. */
function download(name, text, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Show HTML in a modal dialog inside a fully sandboxed iframe. */
function showHtml(title, html) {
  const frame = h('iframe', { class: 'notes-frame', sandbox: '', title, referrerpolicy: 'no-referrer' });
  frame.srcdoc = html;
  const dialog = h('dialog', { class: 'viewer' },
    h('div', { class: 'card-head' }, h('h2', null, title),
      h('button', { type: 'button', class: 'secondary', onclick: () => dialog.close() }, 'Close')),
    frame);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

const readFile = (file, as) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  if (as === 'dataURL') reader.readAsDataURL(file); else reader.readAsText(file);
});

export default {
  id: 'files',
  feature: 'files', // wired only (DEC-010)
  title: 'Files & notes',
  topics: ['notesFileList', 'files', 'images'],
  mount(el, { store, api }) {
    const notesBox = h('div');
    const layoutsBox = h('div');
    const imagesBox = h('div');
    const from = h('input', { type: 'date', 'aria-label': 'From date' });
    const to = h('input', { type: 'date', 'aria-label': 'To date' });
    /** Notes list for a date range, fetched on demand; null = use the live (unfiltered) topic. */
    let rangeResult = null;

    const canViewNotes = () => store.can('canViewMeetingNotes') || store.can('canViewVotingNotes');

    async function applyRange() {
      if (!from.value && !to.value) { rangeResult = null; renderNotes(); return; }
      try {
        const res = await api.wired('GetNotesFileList', { searchDateRange: { startDate: from.value || '1900-01-01', endDate: to.value || '9999-12-31' } });
        rangeResult = res.fileData ?? [];
      } catch (err) {
        toastError(err, 'Search failed: ');
      }
      renderNotes();
    }
    from.addEventListener('change', applyRange);
    to.addEventListener('change', applyRange);

    function renderNotes() {
      const files = rangeResult ?? store.topic('notesFileList')?.fileData;
      if (!files) return replace(notesBox, h('p', { class: 'muted' }, store.unavailable('notesFileList') ?? 'Not available'));
      const sorted = [...files].sort((a, b) => String(b.creationDateTime).localeCompare(String(a.creationDateTime)));
      replace(notesBox, sorted.length ? h('div', { class: 'list' }, sorted.map(f => h('div', { class: 'row-item file-row' },
        h('span', { class: 'tag' }, humanize(f.fileType)),
        h('span', { class: 'name' }, f.fileName,
          h('small', { class: 'sub' }, f.creationDateTime ? new Date(f.creationDateTime).toLocaleString() : '')),
        f.isTampered ? h('span', { class: 'tag bad-tag', title: 'The file was modified after it was signed' }, 'Tampered') : h('span'),
        h('span', { class: 'row-actions' },
          canViewNotes() ? actionButton('View', async () => {
            const { notesHtml } = await api.wired('TransformNotesFile', { fileName: f.fileName });
            showHtml(f.fileName, notesHtml ?? '');
          }, { cls: 'small' }) : null,
          canViewNotes() ? actionButton('Verify', async () => {
            const { fileVerificationResponse: v } = await api.wired('CheckNotesFileTampered', { fileName: f.fileName });
            const signed = v?.isDocumentSigned ? 'signed' : 'not signed';
            toast(`${f.fileName}: ${v?.isTampered ? 'TAMPERED' : 'not tampered'}, ${signed}${v?.isAuthenticatedUsingCertificate ? ', certificate verified' : ''}`,
              v?.isTampered ? 'error' : 'success');
          }, { cls: 'small' }) : null,
          store.can('canPrepareMeetingAndAgenda') ? actionButton('Delete', async () => {
            const { success } = await api.wired('DeleteNotesFiles', { fileNames: [f.fileName] });
            if (!success) toast(`Could not delete ${f.fileName}`, 'error');
            if (rangeResult) applyRange();
          }, { cls: 'small danger-outline', danger: true, confirm: `Delete notes file "${f.fileName}"?` }) : null))))
        : h('p', { class: 'muted empty' }, rangeResult ? 'No notes files in this date range' : 'No notes files'));
    }

    function renderLayouts() {
      const files = store.topic('files')?.fileInfoList;
      if (!files) return replace(layoutsBox, h('p', { class: 'muted' }, store.unavailable('files') ?? 'Not available'));
      const upload = h('input', { type: 'file', class: 'visually-hidden', accept: '.xml,.json,.txt,*/*' });
      upload.addEventListener('change', async () => {
        const file = upload.files[0];
        if (!file) return;
        try {
          const payload = await readFile(file, 'text');
          await api.wired('CreateFile', { title: file.name.replace(/\.[^.]+$/, ''), attributes: [LAYOUT_ATTRIBUTE], payload });
          toast(`Uploaded ${file.name}`, 'success');
        } catch (err) {
          toastError(err, 'Upload failed: ');
        }
        upload.value = '';
      });
      replace(layoutsBox,
        files.length ? h('div', { class: 'list' }, files.map(f => h('div', { class: 'row-item file-row' },
          h('span', { class: 'tag' }, 'Layout'),
          h('span', { class: 'name' }, f.title || f.fileId),
          h('span'),
          h('span', { class: 'row-actions' },
            store.can('canViewSynoptic') ? actionButton('Download', async () => {
              const { fileInfo } = await api.wired('LoadFile', { fileId: f.fileId });
              download(`${fileInfo?.title || f.fileId}.layout`, fileInfo?.payload ?? '');
            }, { cls: 'small' }) : null,
            store.can('canEditSynoptic') ? actionButton('Delete', () => api.wired('DeleteFile', { fileId: f.fileId }), {
              cls: 'small danger-outline', danger: true, confirm: `Delete layout "${f.title}"?`,
            }) : null))))
          : h('p', { class: 'muted empty' }, 'No layout files'),
        store.can('canEditSynoptic') ? h('div', { class: 'actions' },
          h('label', { class: 'button-like secondary' }, 'Upload layout…', upload)) : null);
    }

    function renderImages() {
      const images = store.topic('images')?.images;
      if (!images) return replace(imagesBox, h('p', { class: 'muted' }, store.unavailable('images') ?? 'Not available'));
      const upload = h('input', { type: 'file', class: 'visually-hidden', accept: 'image/png,image/jpeg' });
      upload.addEventListener('change', async () => {
        const file = upload.files[0];
        if (!file) return;
        if (file.size > MAX_IMAGE_BYTES) {
          toast(`${file.name} is larger than 2 MB`, 'error');
          upload.value = '';
          return;
        }
        try {
          const dataUrl = await readFile(file, 'dataURL');
          await api.wired('SaveImage', { name: file.name, imageData: String(dataUrl).split(',')[1] ?? '' });
          toast(`Uploaded ${file.name}`, 'success');
        } catch (err) {
          toastError(err, 'Upload failed: ');
        }
        upload.value = '';
      });
      replace(imagesBox,
        images.length ? h('div', { class: 'list' }, images.map(uri => {
          const name = String(uri).split('/').pop(); // ListImages returns relative URIs; DeleteImage takes the name
          return h('div', { class: 'row-item file-row' },
            h('span', { class: 'tag' }, 'Image'),
            h('span', { class: 'name' }, name),
            h('span'),
            h('span', { class: 'row-actions' }, store.can('canEditSynoptic') ? actionButton('Delete', () => api.wired('DeleteImage', { imageName: name }), {
              cls: 'small danger-outline', danger: true, confirm: `Delete image "${name}"?`,
            }) : null));
        }))
          : h('p', { class: 'muted empty' }, 'No background images'),
        store.can('canEditSynoptic') ? h('div', { class: 'actions' },
          h('label', { class: 'button-like secondary' }, 'Upload image…', upload)) : null,
        h('p', { class: 'muted hint' }, 'Background images for synoptic layouts. PNG or JPEG, max 2 MB.'));
    }

    el.append(
      h('h1', { id: 'view-title' }, 'Files & notes'),
      h('div', { class: 'split' },
        h('article', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Meeting & voting notes'),
            h('span', { class: 'toolbar compact-toolbar' }, from, '–', to)),
          notesBox),
        h('div', { class: 'stack' },
          h('article', { class: 'card' }, h('h2', null, 'Synoptic layouts'), layoutsBox),
          h('article', { class: 'card' }, h('h2', null, 'Background images'), imagesBox))),
    );
    const render = () => { renderNotes(); renderLayouts(); renderImages(); };
    render();
    const offs = [
      store.subscribe(['topic:notesFileList', 'connection'], () => (rangeResult ? applyRange() : renderNotes())),
      store.subscribe(['topic:files', 'connection'], renderLayouts),
      store.subscribe(['topic:images', 'connection'], renderImages),
    ];
    return () => offs.forEach(off => off());
  },
};
