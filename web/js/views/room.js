// Room: top view of the meeting room — the operator's main screen (WO-035, DEC-011, DEC-012).
// Operate mode: live mic states, click a seat = mic on/off, click a camera = cut to it, automation status.
// Edit mode: drag & drop seats/cameras, rotate, unplaced tray, floor plan, seat → camera/preset shots.
// Edit mode (WO-055): drag on empty floor = box selection; drag a selected seat = move the group; arrange in shapes.
import { h, replace, humanize, toast, toastError, actionButton } from '../dom.js';
import { interpreters } from '../interp.js';
import { ptzPad, ptzHolding, afterPtzHold } from '../ptz.js';
import { SHAPES, arrange, defaultCounts, countsError, placesFor, rotateAround, boxCenter, byName, COUNT_FROM, orderSeats } from '../arrange.js';
import { layoutNames } from '../labels.js';
import { proposeMatch, unmatchedSeats } from '../seat-match.js';
import { companionSection } from '../companion.js';
import { cameraColors, relativeAim, turnTo, aimedSeat } from '../camera-aim.js';
import { createWidgetDock } from '../widgets/dock.js';

const SVG = 'http://www.w3.org/2000/svg';
/** SVG element builder (h() creates HTML elements). */
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** Inline style through the CSSOM (the CSP blocks style attributes, DEC-009). */
const styled = (el, props) => { for (const [k, v] of Object.entries(props)) if (v) el.style.setProperty(k, v); return el; };

const SEAT_R = 30;
const MIN_ROOM = 100;                // smallest room outline (units; backend limit)
const LIMIT = 10_000;                // placement / origin range accepted by the backend
const Z_MIN = 0.05, Z_MAX = 8;       // zoom = screen px per workspace unit (1 unit ≈ 1 cm)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const snap = v => Math.round(v / 10) * 10;
const metres = units => `${(units / 100).toFixed(1)} m`;

// The view (centre + zoom) survives leaving and re-entering the Room tab within a session.
let savedView = null;

// Label size on the plan (WO-058): per browser, the right size depends on the screen.
const LABEL_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6];
const LABEL_KEY = 'likeabosch.room.labelScale';
function loadLabelScale() {
  try { const v = Number(localStorage.getItem(LABEL_KEY)); return LABEL_STEPS.includes(v) ? v : 1; } catch { return 1; }
}

export default {
  id: 'room',
  title: 'Room',
  mount(el, { store, api }) {
    let mode = 'operate';            // 'operate' | 'edit'
    let selected = null;             // { kind: 'seat' | 'camera', id }
    let multi = new Set();           // edit mode: selected seat ids, in selection order (WO-055); ≥ 2 = group
    const undoStack = [];            // edit mode: [{ seats?: { id: placement | null }, shots?: { id: shot | null } }] to restore (WO-055/056)
    // Camera presets for many seats (WO-056): camera, first preset, step, counting order.
    const shotsForm = { open: false, cameraId: '', start: 1, step: 1, by: 'name' };
    let spaceHeld = false;           // Space + drag pans in edit mode
    // Arrange-in-a-shape settings survive re-renders of the group panel.
    const arr = { open: false, shape: 'u', order: 'name', counts: {}, start: { line: 'left', u: 'left', rect: 'tl', grid: 'tl' }, direction: 'cw', facing: 'in', spacing: 100, rotation: 0, columns: 0 };
    let pendingRoute = false;        // a #/room?seat= selection waiting for the room data
    let drag = null;                 // node drag { kind, id, dx, dy, node } | { kind: 'resize', … } | { kind: 'pan' | 'marquee' | 'group', … }
    // Unbounded workspace: the SVG fills the stage; the viewBox is derived from centre + zoom.
    // The room outline (room.canvas) is just a resizable rectangle on it; items may lie outside.
    const view = savedView ? { ...savedView } : { cx: 800, cy: 500, z: 0.5 };
    let autoFit = !savedView;        // keep fitting on resize until the operator pans/zooms
    const pointers = new Map();      // active touch/pen pointers (pinch zoom)
    let pinch = null;

    const svg = s('svg', { class: 'room-canvas', role: 'img', 'aria-label': 'Room top view' });
    let labelScale = loadLabelScale();
    const labelLabel = h('span', { class: 'zoom-label muted', title: 'Label size' });
    function applyLabelScale() {
      svg.style.setProperty('--label-scale', String(labelScale));
      labelLabel.textContent = `${Math.round(labelScale * 100)}%`;
    }
    function stepLabels(dir) {
      const i = LABEL_STEPS.indexOf(labelScale);
      labelScale = LABEL_STEPS[clamp((i < 0 ? 2 : i) + dir, 0, LABEL_STEPS.length - 1)];
      try { localStorage.setItem(LABEL_KEY, String(labelScale)); } catch { /* private mode: not remembered */ }
      applyLabelScale();
      renderToolbar(); // enable/disable − / + at the limits
      positionStrips(); // desk strips sit under the (now larger/smaller) desk symbols
      layoutSeatNames(); // names take more / less room (WO-083)
    }
    applyLabelScale();
    const handles = s('g', { class: 'room-handles' });
    const zoomLabel = h('span', { class: 'zoom-label muted', title: 'Zoom' });
    // HTML layer over the plan for the interpreter desk strips (WO-051): constant size at any zoom.
    const overlay = h('div', { class: 'desk-overlays' });
    const stage = h('div', { class: 'room-stage' }, svg, overlay);
    const side = h('aside', { class: 'room-side' });
    const toolbar = h('div', { class: 'room-toolbar' });
    const meetingBox = h('span', { class: 'meeting-control', role: 'group', 'aria-label': 'Meeting' }); // WO-072

    const room = () => store.topic('room');
    const seats = () => (store.topic('domain.seats') ?? []).filter(x => !x.hidden || room()?.seats?.[x.id]);
    const cameras = () => store.topic('devices.cameras')?.cameras ?? [];
    const switcher = () => store.topic('devices.switcher')?.switcher;
    const director = () => store.topic('director');
    const discussion = () => store.topic('domain.discussion');

    const seatState = id => {
      const d = discussion();
      const sp = d?.speakers?.find(e => e.seatId === id);
      if (sp) return sp.micState === 'on' ? (sp.priority ? 'priority' : 'speaking') : 'muted';
      if (d?.requests?.some(e => e.seatId === id)) return 'waiting';
      return 'idle';
    };
    const cameraTally = cam => {
      const st = switcher()?.status;
      if (cam.switcherInput === null || cam.switcherInput === undefined || !st?.connected) return null;
      if (st.program === cam.switcherInput) return 'program';
      if (st.preview === cam.switcherInput) return 'preview';
      return null;
    };

    // ---------------------------------------------------------------- actions
    async function toggleMic(seatId) {
      const st = seatState(seatId);
      try {
        if (st === 'idle' || st === 'waiting') await api.domain('POST', '/discussion/speakers', { seatId });
        else await api.domain('DELETE', `/discussion/speakers/${encodeURIComponent(seatId)}`);
      } catch (err) { toastError(err); }
    }
    /** Put a camera on the switcher's preview bus (WO-053). */
    async function previewTo(cam) {
      if (cam.switcherInput === null || cam.switcherInput === undefined) return toast(`${cam.name} has no switcher input`, 'error');
      try { await api.post('/devices/switcher/preview', { input: cam.switcherInput }); } catch (err) { toastError(err); }
    }
    async function cutTo(cam) {
      if (cam.switcherInput === null || cam.switcherInput === undefined) return toast(`${cam.name} has no switcher input`, 'error');
      try { await api.post('/devices/switcher/cut', { input: cam.switcherInput }); } catch (err) { toastError(err); }
    }
    const COLLECTION = { seat: 'seats', camera: 'cameras', desk: 'desks' };
    async function savePosition(kind, id, pos) {
      try { await api.put(`/room/${COLLECTION[kind]}/${encodeURIComponent(id)}`, pos); } catch (err) { toastError(err); }
    }
    /** Many seats in one save (WO-055); `null` removes a seat from the plan. Remembers the old placements for undo. */
    async function savePlacements(seatMap, { undo = true } = {}) {
      const before = room()?.seats ?? {};
      const prev = Object.fromEntries(Object.keys(seatMap).map(id => [id, before[id] ?? null]));
      // Recorded before the request: an Undo pressed while it is in flight must undo this change, not the one before.
      const entry = undo ? pushUndo({ seats: prev }) : null;
      try {
        await api.patch('/room/placements', { seats: seatMap });
      } catch (err) { dropUndo(entry); toastError(err); renderCanvas(); }
    }
    /** Many seat shots in one save (WO-056); `null` clears a seat's shot. Undoable. */
    async function saveShots(shotMap, { undo = true } = {}) {
      const before = room()?.shots ?? {};
      const prev = Object.fromEntries(Object.keys(shotMap).map(id => [id, before[id] ?? null]));
      const entry = undo ? pushUndo({ shots: prev }) : null;
      try {
        await api.patch('/room/shots', shotMap);
        return true;
      } catch (err) { dropUndo(entry); toastError(err); return false; }
    }
    function pushUndo(entry) { undoStack.push(entry); if (undoStack.length > 50) undoStack.shift(); return entry; }
    function dropUndo(entry) { const i = undoStack.lastIndexOf(entry); if (entry && i > -1) undoStack.splice(i, 1); }
    async function undoLast() {
      const last = undoStack.pop();
      if (!last) return toast('Nothing to undo', 'error');
      if (last.seats) await savePlacements(last.seats, { undo: false });
      if (last.shots) await saveShots(last.shots, { undo: false });
      renderSide(true);
    }

    // ---------------------------------------------------------------- interpreter desks (WO-048 wired, WO-074 DCN)
    // Wired: raw interpreter* topics with quick controls. DCN: `domain.interpreterDesks` from the meeting data stream,
    // read-only (`generic`), keyed like the wired ones (`seatId` = placement id) so placing / tray / inspector are shared.
    const dcnDesks = () => store.system === 'dcn' || store.system === 'dcn-smd';
    const desks = () => (dcnDesks()
      ? (store.topic('domain.interpreterDesks') ?? []).map(d => ({ ...d, seatId: d.id, deskSeatId: d.seatId, deskNumber: d.desk, generic: true }))
      : store.topic('interpreterSeats')?.seats ?? []);
    const it = interpreters(store);
    const routingOf = id => it.routing(id);
    const boothNo = id => store.topic('interpreterBooths')?.booths?.find(b => b.boothId === id)?.boothNumber ?? '?';
    const deskLabel = d => `Booth ${d.generic ? d.booth ?? '?' : boothNo(d.boothId)} · Desk ${d.deskNumber}`;
    /** DCN output, e.g. "A NLD" (channel letter + language). */
    const dcnOut = d => [d.output?.output, d.output?.abbreviation ?? d.output?.language].filter(Boolean).join(' ');
    const lang = id => it.abbr(id);
    const langName = id => it.name(id);
    const DESK_OUTPUTS = [['off', 'Off', null], ['activeOnOutputA', 'A', 'aLanguageId'], ['activeOnOutputB', 'B', 'bLanguageId'], ['activeOnOutputC', 'C', 'cLanguageId']];
    const deskMic = id => it.mic(routingOf(id));
    const SPEAK_SLOW = 'speakSlow';
    async function deskCall(op, params) {
      try { await api.wired(op, params); } catch (err) { toastError(err, `${op}: `); }
    }

    // ---------------------------------------------------------------- view (pan / zoom)
    const canvasOf = r => ({ x: 0, y: 0, ...r.canvas });
    const stageSize = () => ({ w: Math.max(stage.clientWidth, 1), h: Math.max(stage.clientHeight, 1) });

    function applyView() {
      const { w, h: ht } = stageSize();
      svg.setAttribute('viewBox', `${view.cx - w / 2 / view.z} ${view.cy - ht / 2 / view.z} ${w / view.z} ${ht / view.z}`);
      zoomLabel.textContent = `${Math.round(view.z * 100)}%`;
      savedView = { ...view };
      renderHandles();
      // Cogs scale with the seats (seat Ø 60 units) within 14–22 px, so they don't bury the plan when zoomed out.
      overlay.style.setProperty('--cog-size', `${clamp(Math.round(SEAT_R * view.z * 0.9), 14, 22)}px`);
      positionStrips();
    }

    /** Zoom by `factor`, keeping the workspace point under (clientX, clientY) fixed on screen. */
    function zoomAt(clientX, clientY, factor) {
      const z = clamp(view.z * factor, Z_MIN, Z_MAX);
      if (z === view.z) return;
      const box = stage.getBoundingClientRect();
      const { w, h: ht } = stageSize();
      const px = view.cx + (clientX - box.left - w / 2) / view.z;
      const py = view.cy + (clientY - box.top - ht / 2) / view.z;
      view.cx = px - (px - view.cx) * view.z / z;
      view.cy = py - (py - view.cy) * view.z / z;
      view.z = z;
      autoFit = false;
      applyView();
    }
    const zoomCenter = factor => { const b = stage.getBoundingClientRect(); zoomAt(b.left + b.width / 2, b.top + b.height / 2, factor); };

    /** Bounding box of the room outline and everything placed on the plan (cameras have a field of view). */
    function contentBounds() {
      const r = room();
      const c = canvasOf(r);
      let x0 = c.x, y0 = c.y, x1 = c.x + c.width, y1 = c.y + c.height;
      const grow = (p, m) => { x0 = Math.min(x0, p.x - m); y0 = Math.min(y0, p.y - m); x1 = Math.max(x1, p.x + m); y1 = Math.max(y1, p.y + m); };
      for (const p of Object.values(r.seats)) grow(p, SEAT_R + 30);
      for (const p of Object.values(r.cameras)) grow(p, 140);
      for (const p of Object.values(r.desks ?? {})) grow(p, 60 * labelScale);
      return { x0, y0, x1, y1 };
    }

    function fit() {
      if (!room()) return;
      const b = contentBounds();
      const { w, h: ht } = stageSize();
      view.z = clamp(Math.min((w - 32) / (b.x1 - b.x0), (ht - 32) / (b.y1 - b.y0)), Z_MIN, Z_MAX);
      view.cx = (b.x0 + b.x1) / 2;
      view.cy = (b.y0 + b.y1) / 2;
      applyView();
    }

    svg.addEventListener('wheel', evt => {
      evt.preventDefault();
      const unit = evt.deltaMode === 1 ? 16 : evt.deltaMode === 2 ? stageSize().h : 1;
      if (evt.ctrlKey || evt.metaKey) zoomAt(evt.clientX, evt.clientY, Math.exp(-evt.deltaY * unit * 0.01)); // also trackpad pinch
      else {
        view.cx += (evt.shiftKey && !evt.deltaX ? evt.deltaY : evt.deltaX) * unit / view.z;
        view.cy += (evt.shiftKey && !evt.deltaX ? 0 : evt.deltaY) * unit / view.z;
        autoFit = false;
        applyView();
      }
    }, { passive: false });

    // ---------------------------------------------------------------- canvas pointer handling
    function toSvg(evt) {
      const p = svg.createSVGPoint();
      p.x = evt.clientX; p.y = evt.clientY;
      return p.matrixTransform(svg.getScreenCTM().inverse());
    }
    const capture = evt => { try { svg.setPointerCapture(evt.pointerId); } catch { /* not capturable (synthetic/pen edge cases): drag still works */ } };

    const modifier = evt => evt.shiftKey || evt.ctrlKey || evt.metaKey;

    function startDrag(evt, kind, id, pos, node) {
      if (mode !== 'edit' || evt.button > 0) return;
      if (spaceHeld) return; // Space + drag pans, even over an item
      evt.preventDefault();
      if (kind === 'seat' && modifier(evt)) return; // the click toggles it in the selection
      const pt = toSvg(evt);
      if (kind === 'seat' && multi.has(id) && multi.size > 1) {
        const r = room();
        const items = [...multi].filter(x => r.seats[x]).map(x => ({ id: x, ...r.seats[x], node: svg.querySelector(`[data-seat="${CSS.escape(x)}"]`) }));
        drag = { kind: 'group', id, x0: pt.x, y0: pt.y, items, moved: false };
        capture(evt);
        return;
      }
      drag = { kind, id, dx: pt.x - pos.x, dy: pt.y - pos.y, node, rotation: pos.rotation ?? 0, moved: false };
      selected = { kind, id };
      multi = kind === 'seat' ? new Set([id]) : new Set();
      capture(evt);
      renderSide();
    }

    function startResize(evt, edges) {
      evt.preventDefault();
      evt.stopPropagation();
      drag = { kind: 'resize', edges, start: canvasOf(room()), canvas: canvasOf(room()), moved: false };
      capture(evt);
    }

    svg.addEventListener('pointerdown', evt => {
      if (evt.pointerType === 'touch' || evt.pointerType === 'pen') pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
      if (pointers.size === 2) { // second finger: pinch zoom + two-finger pan replace whatever the first finger started
        const [a, b] = [...pointers.values()];
        if (drag?.kind === 'marquee') marquee.remove();
        drag = null;
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), z: view.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        return;
      }
      const panButton = evt.button === 1 || (evt.button === 0 && (mode !== 'edit' || spaceHeld));
      if (drag || (evt.button > 0 && !panButton)) return; // a node or handle already took this pointer
      if (!spaceHeld && evt.button === 0 && evt.target.closest?.('.seat-node, .camera-node, .desk-node')) return; // operate mode: let the click through
      if (panButton) {
        evt.preventDefault(); // middle button: no autoscroll
        drag = { kind: 'pan', x: evt.clientX, y: evt.clientY, cx: view.cx, cy: view.cy, moved: false };
      } else {
        // Edit mode: drag on empty floor draws a selection box (WO-055).
        const pt = toSvg(evt);
        drag = { kind: 'marquee', x0: pt.x, y0: pt.y, sx: evt.clientX, sy: evt.clientY, additive: modifier(evt), moved: false };
      }
      capture(evt);
    });

    svg.addEventListener('pointermove', evt => {
      if (pointers.has(evt.pointerId)) pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        view.cx -= (mx - pinch.mx) / view.z; // two-finger pan
        view.cy -= (my - pinch.my) / view.z;
        pinch.mx = mx; pinch.my = my;
        autoFit = false;
        const factor = (pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist) / view.z;
        if (Math.abs(factor - 1) > 1e-3) zoomAt(mx, my, factor); else applyView();
        return;
      }
      if (!drag || drag.kind === 'cog') return; // cog drags are handled by the cog button (WO-052)
      if (drag.kind === 'pan') {
        const dx = evt.clientX - drag.x, dy = evt.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 3) return;
        drag.moved = true;
        view.cx = drag.cx - dx / view.z;
        view.cy = drag.cy - dy / view.z;
        autoFit = false;
        svg.classList.add('panning');
        applyView();
        return;
      }
      const pt = toSvg(evt);
      if (drag.kind === 'marquee') {
        if (!drag.moved && Math.hypot(evt.clientX - drag.sx, evt.clientY - drag.sy) < 4) return;
        if (!drag.moved) svg.append(marquee);
        drag.moved = true;
        drag.box = { x0: Math.min(drag.x0, pt.x), y0: Math.min(drag.y0, pt.y), x1: Math.max(drag.x0, pt.x), y1: Math.max(drag.y0, pt.y) };
        for (const [k, v] of Object.entries({ x: drag.box.x0, y: drag.box.y0, width: drag.box.x1 - drag.box.x0, height: drag.box.y1 - drag.box.y0 })) marquee.setAttribute(k, v);
        return;
      }
      if (drag.kind === 'group') {
        drag.dx = Math.round(pt.x - drag.x0);
        drag.dy = Math.round(pt.y - drag.y0);
        drag.moved = true;
        for (const it of drag.items) it.node?.setAttribute('transform', `translate(${it.x + drag.dx} ${it.y + drag.dy}) rotate(${it.rotation ?? 0})`);
        return;
      }
      if (drag.kind === 'resize') {
        const { start: s0, edges } = drag;
        let { x, y, width, height } = s0;
        if (edges.includes('r')) width = Math.max(MIN_ROOM, snap(pt.x - s0.x));
        if (edges.includes('b')) height = Math.max(MIN_ROOM, snap(pt.y - s0.y));
        if (edges.includes('l')) { x = clamp(snap(pt.x), -LIMIT, s0.x + s0.width - MIN_ROOM); width = s0.x + s0.width - x; }
        if (edges.includes('t')) { y = clamp(snap(pt.y), -LIMIT, s0.y + s0.height - MIN_ROOM); height = s0.y + s0.height - y; }
        drag.canvas = { x, y, width: Math.min(width, 20_000), height: Math.min(height, 20_000) };
        drag.moved = true;
        drawRoom(drag.canvas);
        return;
      }
      drag.x = Math.round(clamp(pt.x - drag.dx, -LIMIT, LIMIT));
      drag.y = Math.round(clamp(pt.y - drag.dy, -LIMIT, LIMIT));
      drag.moved = true;
      drag.node.setAttribute('transform', `translate(${drag.x} ${drag.y}) rotate(${drag.rotation})`);
      if (drag.kind === 'desk') positionStrips({ id: drag.id, x: drag.x, y: drag.y, rotation: drag.rotation }); // strip follows the desk
    });

    async function endPointer(evt) {
      pointers.delete(evt.pointerId);
      if (pinch) { if (pointers.size < 2) { pinch = null; renderCanvas(); } return; }
      if (!drag || drag.kind === 'cog') return;
      const d = drag;
      drag = null;
      svg.classList.remove('panning');
      if (d.kind === 'pan') return;
      if (d.kind === 'marquee') {
        marquee.remove();
        if (!d.moved) { // a plain click on empty floor clears the selection
          if (!d.additive && (selected || multi.size)) { selected = null; multi = new Set(); renderAll(); }
          return;
        }
        const r = room();
        const { x0, y0, x1, y1 } = d.box;
        const hits = seats().filter(x => { const p = r.seats[x.id]; return p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1; }).map(x => x.id);
        setMulti(d.additive ? [...multi, ...hits] : hits);
        return;
      }
      if (d.kind === 'group') {
        if (!d.moved) { select('seat', d.id); return; } // a click on a group member selects just that seat
        const moved = Object.fromEntries(d.items.map(it => [it.id, { x: clamp(it.x + d.dx, -LIMIT, LIMIT), y: clamp(it.y + d.dy, -LIMIT, LIMIT), rotation: it.rotation ?? 0 }]));
        await savePlacements(moved);
        return;
      }
      if (d.kind === 'resize') {
        if (!d.moved) return;
        try { await api.put('/room/canvas', d.canvas); } catch (err) { toastError(err); renderCanvas(); }
        return;
      }
      if (d.moved) await savePosition(d.kind, d.id, { x: d.x, y: d.y, rotation: d.rotation });
      else renderAll();
    }
    svg.addEventListener('pointerup', endPointer);
    // Camera hover (WO-103), delegated on the plan: camera nodes are replaced on every re-render, and a node removed under
    // the pointer never gets its pointerleave (the last hovered camera stayed highlighted).
    svg.addEventListener('pointerover', evt => {
      const id = evt.target.closest?.('.camera-node')?.dataset.camera ?? null;
      if (id !== hoverCam) { hoverCam = id; focusCamera(); }
    });
    svg.addEventListener('pointerleave', () => { if (hoverCam) { hoverCam = null; focusCamera(); } });
    svg.addEventListener('pointercancel', endPointer);

    function seatNode(seat, pos) {
      const st = seatState(seat.id);
      const shot = room()?.shots?.[seat.id];
      const target = director()?.target;
      const onCamera = target && !target.overview && target.seatId === seat.id;
      const isSel = (selected?.kind === 'seat' && selected.id === seat.id) || (mode === 'edit' && multi.has(seat.id));
      const g = s('g', {
        class: ['seat-node', `st-${st}`, !seat.connected && 'offline', isSel && 'selected', onCamera && 'on-camera'].filter(Boolean).join(' '),
        transform: `translate(${pos.x} ${pos.y}) rotate(${pos.rotation ?? 0})`,
        tabindex: 0, role: 'button', 'data-seat': seat.id,
        'aria-label': `${seat.name}${seat.person ? `, ${seat.person}` : ''}: ${humanize(st)}`,
        onpointerdown: evt => startDrag(evt, 'seat', seat.id, pos, g),
        onclick: evt => {
          if (mode === 'operate') toggleMic(seat.id);
          else if (modifier(evt)) setMulti(multi.has(seat.id) ? [...multi].filter(x => x !== seat.id) : [...multi, seat.id]);
          else select('seat', seat.id);
        },
        // Operate mode: a click switches the mic, so details open with right-click / long-press or the I key.
        oncontextmenu: evt => { evt.preventDefault(); select('seat', seat.id); },
        onkeydown: evt => {
          if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); g.dispatchEvent(new MouseEvent('click')); }
          if (evt.key === 'i' || evt.key === 'I') select('seat', seat.id);
        },
      },
      s('circle', { r: SEAT_R, class: 'seat-disc' }),
      s('path', { d: `M -10 ${-SEAT_R + 6} L 10 ${-SEAT_R + 6} L 0 ${-SEAT_R - 6} Z`, class: 'seat-front' }), // facing direction
      s('text', { class: ['seat-label', seat.name.replace(/^Seat\s*/i, '').length > 4 && 'long'].filter(Boolean).join(' '), 'text-anchor': 'middle', y: 0, transform: `rotate(${-(pos.rotation ?? 0)})` }, seat.name.replace(/^Seat\s*/i, '').slice(0, 8)),
      // Shot badge: always top-right on screen (counter-rotated like the labels); the inspector cog sits bottom-right (WO-071).
      shot ? s('g', { transform: `rotate(${-(pos.rotation ?? 0)})` }, styled(s('circle', { class: 'shot-badge', cx: SEAT_R - 4, cy: -SEAT_R + 4, r: 7 }), { fill: camColor(shot.cameraId) })) : null,
      s('title', null, `${seat.name}${seat.person ? ` · ${seat.person}` : ''} · ${humanize(st)}${shot ? ` · camera ${cameras().find(c => c.id === shot.cameraId)?.name ?? shot.cameraId} preset ${shot.preset}` : ''}`));
      return g; // the participant name is added by layoutSeatNames() (WO-083)
    }

    // ---------------------------------------------------------------- participant names (WO-083)
    // Names alternate below / above in rows and never overlap: measured in the SVG, placed by labels.js.
    const measureText = s('text', { class: 'seat-person', visibility: 'hidden', 'aria-hidden': 'true' });
    const widthCache = new Map(); // text → width at `widthScale`
    let widthScale = null;
    let layoutRetry = 0;
    function measure(text) {
      if (widthScale !== labelScale) { widthCache.clear(); widthScale = labelScale; }
      let w = widthCache.get(text);
      if (w === undefined) {
        measureText.textContent = text;
        w = measureText.getComputedTextLength() || text.length * 6.5 * labelScale;
        widthCache.set(text, w);
      }
      return w;
    }
    function layoutSeatNames() {
      const r = room();
      if (!r) return;
      if (!svg.isConnected) { // first render before the view is in the document: measure once it is
        if (!layoutRetry) layoutRetry = requestAnimationFrame(() => { layoutRetry = 0; if (svg.isConnected) layoutSeatNames(); });
        return;
      }
      if (!measureText.isConnected) svg.append(measureText);
      for (const t of svg.querySelectorAll('.seat-node > .seat-person')) t.remove();
      const placedSeats = seats().filter(x => r.seats[x.id]);
      const named = placedSeats.filter(x => x.person).map(x => ({ id: x.id, x: r.seats[x.id].x, y: r.seats[x.id].y, text: x.person }));
      if (!named.length) return;
      const deskR = Math.hypot(44, 26) * labelScale;
      const layout = layoutNames(named, {
        measure,
        lineHeight: 12 * labelScale * 1.2,
        seatR: SEAT_R,
        gap: 3 * labelScale,
        discs: placedSeats.map(x => ({ x: r.seats[x.id].x, y: r.seats[x.id].y, r: SEAT_R })),
        obstacles: [
          ...cameras().filter(c => r.cameras[c.id]).map(c => ({ x: r.cameras[c.id].x, y: r.cameras[c.id].y, r: 26 })),
          ...desks().filter(d => r.desks?.[d.seatId]).map(d => ({ x: r.desks[d.seatId].x, y: r.desks[d.seatId].y, r: deskR })),
        ],
      });
      const lineHeight = 12 * labelScale * 1.2;
      for (const { id } of named) {
        const place = layout.get(id);
        const g = svg.querySelector(`.seat-node[data-seat="${CSS.escape(id)}"]`);
        if (!place || !g) continue;
        g.append(s('text', { class: ['seat-person', place.side].join(' '), 'text-anchor': 'middle', y: place.dy, transform: `rotate(${-(r.seats[id].rotation ?? 0)})` },
          place.lines.map((line, i) => s('tspan', { x: 0, dy: i ? lineHeight : null }, line))));
      }
    }

    // ---------------------------------------------------------------- camera aim + coverage (WO-103)
    // Each camera has a colour; seats with a preset on it get a faint halo in that colour. The camera's head turns to the
    // seat of its current preset (smooth CSS turn: the previous angle is kept per camera across re-renders).
    let camColorMap = new Map();
    const camColor = id => camColorMap.get(id) ?? null;
    const aimAngles = new Map();   // camera id → last head angle (relative to its placed rotation, unwrapped)
    let pendingAims = [];          // [{ head, angle }] applied after the nodes are in the document
    let hoverCam = null;
    /** The seat a camera currently points at (its last recalled preset), or null. */
    function aimTarget(cam) {
      const r = room();
      if (mode === 'edit' && selected?.kind === 'camera' && selected.id === cam.id) return null; // show the placed direction
      const t = director()?.target;
      const seatId = aimedSeat(cam, r?.shots ?? {}, t && !t.overview ? t.seatId : null);
      return seatId && r?.seats?.[seatId] ? { seatId, pos: r.seats[seatId] } : null;
    }
    function coverageLayer(r) {
      const layer = s('g', { class: 'coverage' });
      for (const [seatId, shot] of Object.entries(r.shots ?? {})) {
        const pos = r.seats[seatId];
        const color = camColor(shot.cameraId);
        if (!pos || !color || !r.cameras[shot.cameraId]) continue;
        layer.append(styled(s('circle', { class: 'coverage-halo', 'data-cam': shot.cameraId, cx: pos.x, cy: pos.y, r: SEAT_R + 10 }), { fill: color }));
      }
      for (const cam of cameras()) {
        const pos = r.cameras[cam.id];
        const aim = pos && aimTarget(cam);
        if (!aim) continue;
        const tally = cameraTally(cam);
        layer.append(styled(s('line', { class: ['aim-line', tally && `tally-${tally}`].filter(Boolean).join(' '), 'data-cam': cam.id,
          x1: pos.x, y1: pos.y, x2: aim.pos.x, y2: aim.pos.y }), { stroke: tally ? null : camColor(cam.id) }));
      }
      return layer;
    }
    /** Emphasise one camera's seats: the hovered camera (edit mode: also the selected one); none = all equal. */
    function focusCamera() {
      const id = hoverCam ?? (mode === 'edit' && selected?.kind === 'camera' ? selected.id : null);
      svg.classList.toggle('cam-focus', Boolean(id));
      for (const el of svg.querySelectorAll('.coverage-halo, .aim-line')) el.classList.toggle('focus', el.dataset.cam === id);
    }
    function applyAims() {
      const list = pendingAims;
      pendingAims = [];
      if (!list.length) return;
      svg.getBoundingClientRect(); // commit the start angles so the change below animates
      for (const { head, angle } of list) head.style.transform = `rotate(${angle}deg)`;
    }

    function cameraNode(cam, pos) {
      const tally = cameraTally(cam);
      const isSel = selected?.kind === 'camera' && selected.id === cam.id;
      const color = camColor(cam.id);
      const aim = aimTarget(cam);
      const prev = aimAngles.get(cam.id) ?? 0;
      const angle = turnTo(prev, relativeAim(pos, aim?.pos ?? null));
      aimAngles.set(cam.id, angle);
      const head = styled(s('g', { class: 'camera-head' },
        styled(s('path', { class: 'camera-fov', d: 'M 0 0 L 120 -60 A 135 135 0 0 1 120 60 Z' }), { fill: color && !tally ? color : null }),
        s('rect', { class: 'camera-body', x: -18, y: -14, width: 30, height: 28, rx: 5 }),
        s('path', { class: 'camera-lens', d: 'M 12 -9 L 26 -15 L 26 15 L 12 9 Z' })), { transform: `rotate(${prev}deg)` });
      if (angle !== prev) pendingAims.push({ head, angle });
      const aimedName = aim ? (seats().find(x => x.id === aim.seatId)?.name ?? aim.seatId) : null;
      const g = s('g', {
        class: ['camera-node', tally && `tally-${tally}`, !cam.status?.connected && 'offline', isSel && 'selected', cam.automation === false && 'manual'].filter(Boolean).join(' '),
        transform: `translate(${pos.x} ${pos.y}) rotate(${pos.rotation ?? 0})`,
        tabindex: 0, role: 'button', 'data-camera': cam.id,
        'aria-label': `Camera ${cam.name}${tally ? `, ${tally}` : ''}`,
        onpointerdown: evt => startDrag(evt, 'camera', cam.id, pos, g),
        onclick: () => { if (mode === 'operate') cutTo(cam); else { selected = { kind: 'camera', id: cam.id }; renderAll(); } },
      },
      head,
      color ? styled(s('circle', { class: 'camera-color', cx: -18, cy: -14, r: 5 }), { fill: color }) : null,
      s('text', { class: 'camera-label', 'text-anchor': 'middle', y: 22, transform: `rotate(${-(pos.rotation ?? 0)})` }, cam.name, cam.automation === false ? s('tspan', { class: 'camera-manual', x: 0, dy: '1.3em' }, 'MANUAL') : null),
      s('title', null, `${cam.name} (${cam.driver}) · ${cam.status?.connected ? 'connected' : 'offline'}${tally ? ` · ${tally}` : ''}${aimedName ? ` · on ${aimedName}` : ''}${cam.automation === false ? ' · not used by the automation' : ''}`));
      return g;
    }

    // Room outline: floor, grid or floor-plan image, size label. drawRoom() also runs live during a resize.
    const floor = s('rect', { class: 'room-floor' });
    const grid = s('rect', { class: 'room-grid', fill: 'url(#grid)' });
    const bgImage = s('image', { class: 'room-bg', preserveAspectRatio: 'xMidYMid meet' });
    const sizeLabel = s('text', { class: 'room-size-label' });
    const marquee = s('rect', { class: 'marquee' });               // box selection (WO-055)
    const previewLayer = s('g', { class: 'arrange-preview' });     // arrange-in-a-shape ghosts (WO-055)
    const shotPreviewLayer = s('g', { class: 'shot-preview' });    // preset numbers for many seats (WO-056)

    function drawRoom(c) {
      for (const node of [floor, grid, bgImage]) {
        node.setAttribute('x', c.x); node.setAttribute('y', c.y);
        node.setAttribute('width', c.width); node.setAttribute('height', c.height);
      }
      sizeLabel.textContent = `${metres(c.width)} × ${metres(c.height)}`;
      renderHandles(c);
    }

    /** Resize handles in edit mode. Sized in screen pixels, so they are redrawn on every zoom change. */
    function renderHandles(c = drag?.kind === 'resize' ? drag.canvas : room() && canvasOf(room())) {
      handles.replaceChildren();
      if (mode !== 'edit' || !c) return;
      const k = 1 / view.z; // workspace units per screen pixel
      sizeLabel.setAttribute('x', c.x + 4 * k);
      sizeLabel.setAttribute('y', c.y - 8 * k);
      sizeLabel.setAttribute('font-size', 13 * k);
      const { x, y, width: w, height: ht } = c;
      const edge = (edges, x1, y1, x2, y2) => s('line', {
        class: `room-handle edge-${edges}`, x1, y1, x2, y2, 'stroke-width': 12 * k, 'data-edges': edges,
        onpointerdown: evt => startResize(evt, edges),
      });
      const corner = (edges, cx, cy) => s('rect', {
        class: `room-handle corner corner-${edges}`, x: cx - 6 * k, y: cy - 6 * k, width: 12 * k, height: 12 * k, 'stroke-width': 2 * k, 'data-edges': edges,
        onpointerdown: evt => startResize(evt, edges),
      });
      handles.append(
        edge('t', x, y, x + w, y), edge('b', x, y + ht, x + w, y + ht), edge('l', x, y, x, y + ht), edge('r', x + w, y, x + w, y + ht),
        corner('tl', x, y), corner('tr', x + w, y), corner('bl', x, y + ht), corner('br', x + w, y + ht), sizeLabel);
    }

    /** DCN desk (WO-074): live state from the stream; a click opens the read-only inspector. */
    function dcnDeskNode(d, pos) {
      const isSel = selected?.kind === 'desk' && selected.id === d.seatId;
      const g = s('g', {
        class: ['desk-node', d.live && 'live', isSel && 'selected'].filter(Boolean).join(' '),
        transform: `translate(${pos.x} ${pos.y}) rotate(${pos.rotation ?? 0})`,
        tabindex: 0, role: 'button', 'data-desk': d.seatId,
        'aria-label': `Interpreter ${deskLabel(d)}: ${d.live ? `translating into ${dcnOut(d) || 'unknown output'}${d.source ? `, from ${d.source.language ?? d.source.abbreviation}` : ''}` : 'not translating'}`,
        onpointerdown: evt => startDrag(evt, 'desk', d.seatId, pos, g),
        onclick: () => select('desk', d.seatId),
        onkeydown: evt => { if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); select('desk', d.seatId); } },
      },
      s('g', { class: 'desk-art' },
        s('rect', { class: 'desk-body', x: -44, y: -26, width: 88, height: 52, rx: 8 }),
        s('g', { transform: `rotate(${-(pos.rotation ?? 0)})` },
          s('text', { class: 'desk-title', 'text-anchor': 'middle', y: -9 }, `B${d.booth ?? '?'} · D${d.deskNumber}`),
          s('text', { class: 'desk-out', 'text-anchor': 'middle', y: 7 }, d.live ? `● ${dcnOut(d) || 'on air'}` : 'not translating'),
          d.live && d.source ? s('text', { class: 'desk-in', 'text-anchor': 'middle', y: 20 }, `hears ${d.source.abbreviation ?? d.source.language}`) : null)),
      s('title', null, `Interpreter ${deskLabel(d)}${d.seatName ? ` · seat ${d.seatName}` : ''}`));
      return g;
    }

    function deskNode(d, pos) {
      if (d.generic) return dcnDeskNode(d, pos);
      const mic = deskMic(d.seatId);
      const out = DESK_OUTPUTS.find(o => o[0] === mic);
      const live = mic !== 'off';
      const routing = routingOf(d.seatId);
      const isSel = selected?.kind === 'desk' && selected.id === d.seatId;
      const status = String(d.status).toLowerCase();
      const g = s('g', {
        class: ['desk-node', live && 'live', status === 'disconnected' && 'offline', isSel && 'selected'].filter(Boolean).join(' '),
        transform: `translate(${pos.x} ${pos.y}) rotate(${pos.rotation ?? 0})`,
        tabindex: 0, role: 'button', 'data-desk': d.seatId,
        'aria-label': `Interpreter ${deskLabel(d)}: ${live ? `on air on ${out[1]} (${lang(d[out[2]])}), listening to ${it.sourceLabel(it.source(routing), { short: false })}` : 'microphone off'}`,
        onpointerdown: evt => startDrag(evt, 'desk', d.seatId, pos, g),
        onclick: () => select('desk', d.seatId),
        onkeydown: evt => { if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); select('desk', d.seatId); } },
      },
      // The whole desk symbol (box + text) follows the label size (WO-058): CSS scale on .desk-art.
      s('g', { class: 'desk-art' },
      s('rect', { class: 'desk-body', x: -44, y: -26, width: 88, height: 52, rx: 8 }),
      s('g', { transform: `rotate(${-(pos.rotation ?? 0)})` },
        s('text', { class: 'desk-title', 'text-anchor': 'middle', y: -9 }, `B${boothNo(d.boothId)} · D${d.deskNumber}`),
        s('text', { class: 'desk-out', 'text-anchor': 'middle', y: 7 }, live ? `● ${out[1]} ${lang(d[out[2]])}` : 'mic off'),
        // The input is only reported while the microphone is on (real 6.50).
        live ? s('text', { class: 'desk-in', 'text-anchor': 'middle', y: 20 }, `hears ${it.sourceLabel(it.source(routing))}`) : null)),
      s('title', null, `Interpreter ${deskLabel(d)} · ${status}`));
      return g;
    }

    function renderCanvas() {
      if (drag && drag.kind !== 'pan') return; // don't fight an ongoing drag/resize
      const r = room();
      if (!r) return replace(stage, h('p', { class: 'muted pad' }, 'Loading room…'));
      if (!stage.contains(svg)) { replace(stage, svg, overlay); applyView(); }
      if (r.background) bgImage.setAttribute('href', `/api/room/background?v=${encodeURIComponent(r.background.updatedAt)}`);
      const defs = s('defs', null, s('pattern', { id: 'grid', width: 50, height: 50, patternUnits: 'userSpaceOnUse' }, s('path', { d: 'M 50 0 L 0 0 0 50', class: 'grid-line' })));
      camColorMap = cameraColors(cameras());
      pendingAims = [];
      const seatNodes = seats().filter(x => r.seats[x.id]).map(x => seatNode(x, r.seats[x.id]));
      const camNodes = cameras().filter(c => r.cameras[c.id]).map(c => cameraNode(c, r.cameras[c.id]));
      const deskNodes = desks().filter(d => r.desks?.[d.seatId]).map(d => deskNode(d, r.desks[d.seatId]));
      svg.replaceChildren(defs, floor, r.background ? bgImage : grid, coverageLayer(r), ...camNodes, ...deskNodes, ...seatNodes, previewLayer, shotPreviewLayer, handles);
      applyAims();
      focusCamera();
      layoutSeatNames();
      svg.classList.toggle('editing', mode === 'edit');
      drawRoom(canvasOf(r));
      renderPreview();
      renderShotPreview();
      renderStrips();
    }

    // ---------------------------------------------------------------- desk strips under the desks (WO-051)
    /** deskId → { el, key }: a strip is rebuilt only when its desk's state changes (keeps an open dropdown open). */
    const strips = new Map();
    function renderStrips() {
      const r = room();
      // Edit mode shows the strips as inert previews so the operator sees the space they take while arranging (WO-051).
      const placed = r ? desks().filter(d => r.desks?.[d.seatId] && !d.generic) : []; // DCN desks: no quick controls (WO-074)
      const preview = mode === 'edit';
      const ids = new Set(placed.map(d => d.seatId));
      for (const [id, item] of strips) if (!ids.has(id)) { item.el.remove(); strips.delete(id); }
      const common = [store.can('canControlInterpretation'), it.languages().map(l => l.languageId), store.topic('interpreterBooths')];
      for (const d of placed) {
        const key = JSON.stringify([d, routingOf(d.seatId), common, preview]);
        const item = strips.get(d.seatId);
        if (item?.key === key) continue;
        // Don't yank a dropdown away while the operator has it open; refresh when it loses focus.
        if (item && item.el.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') {
          document.activeElement.addEventListener('blur', () => renderStrips(), { once: true });
          continue;
        }
        const el = h('div', { class: ['desk-strip', deskMic(d.seatId) !== 'off' && 'live', preview && 'preview'], 'data-desk-strip': d.seatId,
          inert: preview, title: preview ? 'Quick controls (usable in Operate mode)' : null },
          deskOutputs(d, { compact: true }),
          h('div', { class: 'strip-row' }, deskInput(d, { compact: true }), cogButton('desk', d.seatId, deskLabel(d))));
        if (item) item.el.replaceWith(el); else overlay.append(el);
        strips.set(d.seatId, { el, key });
      }
      renderCogs();
      positionStrips();
    }

    // ---------------------------------------------------------------- inspector cogs (WO-052)
    // Operate mode: a click acts (seat = mic, camera = cut), so each item gets a cog at its bottom right:
    // click = open the inspector, drag = move the item (saved on release). Desks carry theirs in the control strip.
    const cogs = new Map(); // 'seat:<id>' | 'camera:<id>' → button
    let cogDragged = false;  // swallow the click that follows a drag

    function cogButton(kind, id, label) {
      const b = h('button', { type: 'button', class: 'cog', 'data-cog': `${kind}:${id}`, 'aria-label': `Inspect ${label}`, title: `${label}: inspector (drag to move)` }, '⚙');
      b.addEventListener('click', () => {
        if (cogDragged) { cogDragged = false; return; }
        select(kind, id);
        // Global option (Settings → Cameras & switcher): a camera's cog also puts it on preview.
        const cam = kind === 'camera' && room()?.operate?.cogSendsPreview ? cameras().find(c => c.id === id) : null;
        if (cam) previewTo(cam);
      });
      b.addEventListener('pointerdown', e => {
        const pos = room()?.[COLLECTION[kind]]?.[id];
        if (e.button > 0 || !pos) return;
        e.preventDefault();
        e.stopPropagation();
        drag = { kind: 'cog', item: kind, id, sx: e.clientX, sy: e.clientY, start: { ...pos }, moved: false }; // also pauses re-renders
        try { b.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      });
      b.addEventListener('pointermove', e => {
        if (drag?.kind !== 'cog' || drag.id !== id) return;
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        drag.x = Math.round(clamp(drag.start.x + dx / view.z, -LIMIT, LIMIT));
        drag.y = Math.round(clamp(drag.start.y + dy / view.z, -LIMIT, LIMIT));
        svg.querySelector(`[data-${kind}="${CSS.escape(id)}"]`)?.setAttribute('transform', `translate(${drag.x} ${drag.y}) rotate(${drag.start.rotation ?? 0})`);
        positionStrips(kind === 'desk' ? { id, x: drag.x, y: drag.y, rotation: drag.start.rotation } : null);
      });
      const end = async () => {
        if (drag?.kind !== 'cog' || drag.id !== id) return;
        const d = drag;
        drag = null;
        if (!d.moved) return; // the click handler opens the inspector
        cogDragged = true;
        setTimeout(() => { cogDragged = false; }, 0); // no click follows when the pointer left the button
        await savePosition(kind, id, { x: d.x, y: d.y, rotation: d.start.rotation ?? 0 });
        renderCanvas();
      };
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', end);
      return b;
    }

    function renderCogs() {
      const r = room();
      const wanted = new Map();
      if (mode === 'operate' && r) {
        for (const x of seats()) if (r.seats[x.id]) wanted.set(`seat:${x.id}`, ['seat', x.id, x.name]);
        for (const c of cameras()) if (r.cameras[c.id]) wanted.set(`camera:${c.id}`, ['camera', c.id, `camera ${c.name}`]);
        for (const d of desks()) if (d.generic && r.desks?.[d.seatId]) wanted.set(`desk:${d.seatId}`, ['desk', d.seatId, deskLabel(d)]); // wired desks: cog in the strip
      }
      for (const [key, el] of cogs) if (!wanted.has(key)) { el.remove(); cogs.delete(key); }
      for (const [key, [kind, id, label]] of wanted) {
        if (!cogs.has(key)) { const b = cogButton(kind, id, label); overlay.append(b); cogs.set(key, b); }
        cogs.get(key).classList.toggle('active', selected?.kind === kind && selected.id === id);
      }
    }

    /** Cog at the bottom right of the rendered shape (handles rotation and zoom). */
    function positionCogs() {
      if (!cogs.size) return;
      const base = stage.getBoundingClientRect();
      for (const [key, el] of cogs) {
        const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
        const shape = svg.querySelector(`[data-${kind}="${CSS.escape(id)}"] ${{ seat: '.seat-disc', desk: '.desk-body' }[kind] ?? '.camera-body'}`);
        if (!shape) { el.hidden = true; continue; }
        const r = shape.getBoundingClientRect();
        el.hidden = false;
        el.style.transform = `translate(${Math.round(r.right - base.left)}px, ${Math.round(r.bottom - base.top)}px) translate(-55%, -55%)`;
      }
    }

    /** Place each strip just below its desk in screen pixels (follows pan, zoom, resize); cogs follow their items. */
    function positionStrips(moving = null) {
      const r = room();
      if (!r) return;
      positionCogs();
      const { w, h: ht } = stageSize();
      for (const [id, item] of strips) {
        const pos = moving?.id === id ? moving : r.desks?.[id];
        if (!pos) continue;
        const rad = (pos.rotation ?? 0) * Math.PI / 180;
        const below = (Math.abs(44 * Math.sin(rad)) + Math.abs(26 * Math.cos(rad))) * labelScale; // half height of the rotated, scaled desk body
        const x = (pos.x - view.cx) * view.z + w / 2;
        const y = (pos.y + below - view.cy) * view.z + ht / 2 + 4;
        item.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, 0)`;
      }
    }
    // Scrolling over a strip still pans/zooms the plan.
    overlay.addEventListener('wheel', e => { e.preventDefault(); svg.dispatchEvent(new WheelEvent('wheel', e)); }, { passive: false });

    // ---------------------------------------------------------------- toolbar
    function renderToolbar() {
      const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'visually-hidden' });
      fileInput.addEventListener('change', async () => {
        const f = fileInput.files[0];
        if (!f) return;
        try {
          const res = await fetch('/api/room/background', { method: 'PUT', headers: { 'content-type': f.type }, body: f });
          const body = await res.json();
          if (!body.ok) throw Object.assign(new Error(body.error.message), body.error);
          // Give the room outline the plan's aspect ratio (keep the width) so the image fills it.
          const bmp = await createImageBitmap(f).catch(() => null);
          if (bmp?.width && bmp.height) {
            const c = canvasOf(room());
            await api.put('/room/canvas', { ...c, height: clamp(Math.round(c.width * bmp.height / bmp.width), MIN_ROOM, 20_000) });
            bmp.close();
          }
          toast('Floor plan updated: drag the room edges to scale it', 'success');
        } catch (err) { toastError(err, 'Floor plan: '); }
      });
      replace(toolbar,
        h('div', { class: 'segmented mode-switch', role: 'group', 'aria-label': 'Mode' },
          h('button', { type: 'button', class: mode === 'operate' ? 'on' : null, 'aria-pressed': String(mode === 'operate'), onclick: () => { mode = 'operate'; selected = null; multi = new Set(); renderAll(); } }, 'Operate'),
          h('button', { type: 'button', class: mode === 'edit' ? 'on' : null, 'aria-pressed': String(mode === 'edit'), onclick: () => { mode = 'edit'; renderAll(); } }, 'Edit layout')),
        meetingBox,
        h('span', { class: 'spacer' }),
        mode === 'edit' ? h('label', { class: 'button-like secondary small' }, 'Floor plan…', fileInput) : null,
        mode === 'edit' ? h('button', { type: 'button', class: 'secondary small', title: 'Map the seats of this plan to the seats of the connected system (WO-096)', onclick: openMatchDialog }, 'Match seats…') : null,
        h('span', { class: 'label-size', role: 'group', 'aria-label': 'Label size' },
          h('small', { class: 'muted' }, 'Labels'),
          h('button', { type: 'button', class: 'secondary small', title: 'Smaller labels', 'aria-label': 'Smaller labels', disabled: labelScale <= LABEL_STEPS[0], onclick: () => stepLabels(-1) }, '−'),
          labelLabel,
          h('button', { type: 'button', class: 'secondary small', title: 'Larger labels', 'aria-label': 'Larger labels', disabled: labelScale >= LABEL_STEPS.at(-1), onclick: () => stepLabels(1) }, '+')),
        h('small', { class: 'muted room-hint' }, mode === 'edit'
          ? 'Drag to select · Shift/⌘ adds · Space + drag or scroll to pan · Ctrl/⌘ + scroll to zoom'
          : 'Drag empty space to pan · Ctrl/⌘ + scroll to zoom'),
        h('button', { type: 'button', class: 'secondary small', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => zoomCenter(1 / 1.25) }, '−'),
        zoomLabel,
        h('button', { type: 'button', class: 'secondary small', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => zoomCenter(1.25) }, '+'),
        h('button', { type: 'button', class: 'secondary small', title: 'Show the whole room and everything on it', onclick: () => { autoFit = true; fit(); } }, 'Fit'));
    }

    // ---------------------------------------------------------------- meeting start / stop (WO-072)
    // Wired: Start = activate + open, Stop = close. DCN: Start = meeting + its first session, Stop = both.
    let meetingKey = null;
    function renderMeeting() {
      const caps = store.topic('domain.capabilities');
      const m = store.topic('domain.meeting');
      const key = JSON.stringify([caps?.features?.meetingControl, caps?.actions?.controlMeeting, m]);
      if (key === meetingKey) return; // keeps an open dropdown open
      meetingKey = key;
      if (!caps?.features?.meetingControl || !m) return replace(meetingBox);
      const can = caps.actions.controlMeeting;
      const cur = m.current;
      const start = id => api.domain('POST', '/meeting/start', { meetingId: id });
      if (cur) {
        const label = `${cur.title}${m.session ? ` · ${m.session.title}` : ''}`;
        return replace(meetingBox,
          h('span', { class: ['meeting-state', cur.running && 'running'], title: `${label}${cur.running ? '' : ` (${humanize(cur.state).toLowerCase()})`}` },
            h('span', { class: ['state-dot', cur.running ? 'opened' : 'ready'] }), h('span', { class: 'meeting-title' }, label)),
          !can ? null : cur.running
            ? actionButton('Stop meeting', () => api.domain('POST', '/meeting/stop'), {
              cls: 'small danger-outline', danger: true,
              confirm: `Stop "${cur.title}"?${store.system === 'dcn' ? ' Its session ends too; all microphones and requests are cleared.' : ' It is closed and deactivated; the discussion list is cleared.'}`,
            })
            : actionButton('Start', () => start(cur.id), { cls: 'small primary' }));
      }
      if (!m.meetings.length) return replace(meetingBox, h('small', { class: 'muted' }, 'No meetings prepared'));
      const pick = h('select', { 'aria-label': 'Meeting to start', disabled: !can, class: 'small' }, m.meetings.map(x => h('option', { value: String(x.id) }, x.title)));
      return replace(meetingBox,
        h('span', { class: 'meeting-state idle', title: 'No meeting is running' }, h('span', { class: 'state-dot deactivated' }), 'No meeting'),
        pick,
        can ? actionButton('Start meeting', () => start(m.meetings.find(x => String(x.id) === pick.value)?.id), { cls: 'small primary' }) : null);
    }

    // ---------------------------------------------------------------- side panel
    function directorPanel() {
      const d = director();
      const r = room();
      const t = d?.target;
      const camName = id => cameras().find(c => c.id === id)?.name ?? id ?? '—';
      return h('section', { class: 'side-card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Camera automation'),
          h('label', { class: 'switch' },
            h('input', {
              type: 'checkbox', checked: Boolean(r?.director?.enabled), 'aria-label': 'Automatic camera control',
              onchange: async e => { try { await api.put('/room/director', { enabled: e.target.checked }); } catch (err) { toastError(err); } },
            }), h('span', null, r?.director?.enabled ? 'Auto' : 'Manual'))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Shot'), h('span', { class: 'v' }, t ? (t.overview ? 'Overview' : `${seats().find(x => x.id === t.seatId)?.name ?? t.seatId}`) : '—')),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'On air'), h('span', { class: 'v' }, d?.onAirCamera ? camName(d.onAirCamera) : '—', d?.busy ? h('small', { class: 'tag' }, 'moving') : null)),
        // DEC-015: per-device automation switches (the master switch above stays in charge).
        switcher() ? h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Switcher cuts'),
          h('label', { class: 'switch v' }, h('input', {
            type: 'checkbox', checked: switcher().automation !== false, 'aria-label': 'Automatic switcher cuts',
            onchange: async e => { try { await api.patch('/devices/switcher', { automation: e.target.checked }); } catch (err) { toastError(err); e.target.checked = !e.target.checked; } },
          }), h('span', null, switcher().automation !== false ? 'Auto' : 'Manual'))) : null,
        cameras().some(c => c.automation === false) ? kv('Manual cameras', cameras().filter(c => c.automation === false).map(c => c.name).join(', ')) : null,
        h('div', { class: 'actions' },
          actionButton('Overview', () => api.post('/director/shot', {}), { cls: 'small', disabled: !r?.overview }),
          r?.director?.strategy ? h('small', { class: 'muted' }, `${r.director.strategy === 'safe' ? 'Safe' : 'Live'} moves`) : null));
    }

    function speakersPanel() {
      const d = discussion();
      const list = (items, empty) => (items.length ? h('ul', { class: 'side-list' }, items.map(e => h('li', null,
        h('span', { class: ['mic', e.micState] }, humanize(e.micState)), ' ', e.name,
        room()?.shots?.[e.seatId] ? h('button', { type: 'button', class: 'link small', title: 'Show on camera now', onclick: () => api.post('/director/shot', { seatId: e.seatId }).catch(toastError) }, '📷') : null)))
        : h('p', { class: 'muted small-text' }, empty));
      return h('section', { class: 'side-card' },
        h('h2', null, 'Speakers'), list(d?.speakers ?? [], 'Nobody is speaking'),
        h('h2', null, 'Requests'), list(d?.requests ?? [], 'No requests'));
    }

    function trayPanel() {
      const r = room();
      if (!r) return null;
      const unplacedSeats = (store.topic('domain.seats') ?? []).filter(x => !r.seats[x.id]);
      const unplacedCams = cameras().filter(c => !r.cameras[c.id]);
      const unplacedDesks = desks().filter(d => !r.desks?.[d.seatId]);
      // New items appear in the middle of what the operator is looking at.
      const center = (i) => ({ x: Math.round(view.cx + ((i % 8) - 4) * 70), y: Math.round(view.cy + Math.floor(i / 8) * 70), rotation: 0 });
      return h('section', { class: 'side-card' },
        h('h2', null, `Not placed (${unplacedSeats.length + unplacedCams.length + unplacedDesks.length})`),
        unplacedSeats.length || unplacedCams.length || unplacedDesks.length ? h('div', { class: 'tray' },
          unplacedSeats.map((x, i) => h('button', { type: 'button', class: 'chip-button', title: `Place ${x.name}`, onclick: () => savePosition('seat', x.id, center(i)) }, '＋ ', x.name, x.hidden ? ' (hidden)' : '')),
          unplacedCams.map((c, i) => h('button', { type: 'button', class: 'chip-button cam', title: `Place camera ${c.name}`, onclick: () => savePosition('camera', c.id, center(i + unplacedSeats.length)) }, '📷 ', c.name)),
          unplacedDesks.map((d, i) => h('button', { type: 'button', class: 'chip-button desk', title: `Place interpreter ${deskLabel(d)}`, onclick: () => savePosition('desk', d.seatId, center(i + unplacedSeats.length + unplacedCams.length)) }, '🎧 ', deskLabel(d))),
          unplacedSeats.length > 1 ? h('button', { type: 'button', class: 'link small', onclick: () => placeAll(unplacedSeats) }, 'Place all seats in a grid') : null)
          : h('p', { class: 'muted small-text' }, 'Everything is placed.'),
        cameras().length ? null : h('p', { class: 'muted small-text' }, 'Add cameras in ', h('a', { href: '#/settings/cameras' }, 'Settings → Cameras'), '.'));
    }

    async function placeAll(list) {
      const c = canvasOf(room());
      const cols = Math.ceil(Math.sqrt(list.length * 1.6));
      const gap = 110;
      const x0 = c.x + (c.width - (cols - 1) * gap) / 2;
      const y0 = c.y + 150;
      for (const [i, x] of list.entries()) await savePosition('seat', x.id, { x: Math.round(x0 + (i % cols) * gap), y: Math.round(y0 + Math.floor(i / cols) * gap), rotation: 0 });
    }

    function select(kind, id) {
      selected = { kind, id };
      multi = kind === 'seat' ? new Set([id]) : new Set();
      renderAll();
    }

    /** Set the seat selection (edit mode, WO-055): one seat opens its inspector, several the group panel. */
    function setMulti(ids) {
      multi = new Set(ids);
      selected = multi.size === 1 ? { kind: 'seat', id: [...multi][0] } : null;
      renderAll();
    }

    /** #/room?seat=<id> / ?desk=<id> (e.g. from Meeting → Seating): select it and bring it into view. */
    function applyRouteSelection() {
      const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
      const kind = q.has('desk') ? 'desk' : 'seat';
      const id = q.get(kind);
      if (!id) return;
      selected = { kind, id };
      const pos = room()?.[COLLECTION[kind]]?.[id];
      if (pos) { view.cx = pos.x; view.cy = pos.y; autoFit = false; applyView(); }
      pendingRoute = !room();
      renderAll();
    }

    const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v ?? '—'));
    const yesNo = v => (v === null || v === undefined ? '—' : v ? 'Yes' : 'No');

    /** Everything known about a seat (WO-047): identity, rights, participant, live state, sensitivity, devices, shot. */
    function seatPanel(id) {
      const seat = (store.topic('domain.seats') ?? []).find(x => x.id === id);
      if (!seat) return h('section', { class: 'side-card' }, h('p', { class: 'muted' }, `Seat ${id} is not known to the connected system.`));
      const d = seat.details ?? {};
      const r = room();
      const pos = r?.seats?.[id];
      const editing = mode === 'edit';
      const people = store.topic('domain.participants') ?? [];
      const assigned = people.find(p => p.assignedSeatId === id) ?? people.find(p => p.id === d.assignedParticipantId);
      const seated = people.find(p => p.seatedSeatId === id) ?? people.find(p => p.id === d.seatedParticipantId);
      const disc = discussion();
      const speaking = disc?.speakers?.find(e => e.seatId === id);
      const queuePos = (disc?.requests ?? []).findIndex(e => e.seatId === id);
      const live = speaking ? `${humanize(speaking.kind)} · mic ${speaking.micState}` : queuePos >= 0 ? `Request to speak (#${queuePos + 1} in queue)` : 'Not in the discussion';
      const close = h('button', { type: 'button', class: 'link small', onclick: () => { selected = null; if (location.hash.includes('?')) history.replaceState(null, '', '#/room'); renderAll(); } }, 'Close');

      const parts = [
        h('div', { class: 'card-head' }, h('h2', null, `Seat: ${seat.name}`), close),
        h('div', { class: 'seat-badges' },
          h('span', { class: ['pill', seat.connected ? 'loggedIn' : 'disconnected'] }, seat.connected ? humanize(d.status ?? 'connected') : 'Offline'),
          seat.remote ? h('span', { class: 'tag' }, 'remote') : null,
          seat.hidden ? h('span', { class: 'tag' }, 'hidden in synoptic') : null,
          (d.attributes ?? []).map(a => h('span', { class: 'tag' }, a))),
      ];
      if (editing) {
        parts.push(pos
          ? h('div', { class: 'actions' },
            h('button', { type: 'button', class: 'secondary small', title: 'Rotate left', onclick: () => savePosition('seat', id, { ...pos, rotation: ((pos.rotation ?? 0) + 345) % 360 }) }, '⟲ 15°'),
            h('button', { type: 'button', class: 'secondary small', title: 'Rotate right', onclick: () => savePosition('seat', id, { ...pos, rotation: ((pos.rotation ?? 0) + 15) % 360 }) }, '⟳ 15°'),
            h('button', { type: 'button', class: 'small danger-outline', onclick: () => api.del(`/room/seats/${encodeURIComponent(id)}`).then(() => { selected = null; }, toastError) }, 'Remove from plan'))
          : h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary small', onclick: () => savePosition('seat', id, { x: Math.round(view.cx), y: Math.round(view.cy), rotation: 0 }) }, 'Place on plan')));
      }
      parts.push(
        h('h3', null, 'Participant'),
        editing ? participantEditor(id, assigned) : null,
        kv('Assigned', assigned ? [assigned.name, assigned.group ? h('small', { class: 'muted' }, ` · ${assigned.group}`) : null] : seat.person || null),
        kv('Seated now', seated ? seated.name : assigned ? 'not logged in' : null),
        assigned?.userName ? kv('User name', assigned.userName) : null,
        h('h3', null, 'Live'),
        kv('Discussion', live),
        speaking?.timer?.show && speaking.timer.remainingSpeechDuration ? kv('Speech time left', `${Math.round(speaking.timer.remainingSpeechDuration / 1000)} s (at last update)`) : null,
        sensitivityRow(id),
        h('h3', null, 'Seat'),
        kv('Type', humanize(d.seatType ?? (seat.remote ? 'remote' : 'local'))),
        kv('Can vote', yesNo(seat.canVote)),
        kv('Priority', yesNo(seat.canPrio)),
        d.hasVotingLicense !== null ? kv('Voting licence', yesNo(d.hasVotingLicense)) : null,
        d.visType ? kv('VIS (visually impaired)', humanize(d.visType)) : null,
        d.supportsSpeaking !== null ? kv('Supports speaking', yesNo(d.supportsSpeaking)) : null,
        seat.diagnostics ? kv('Battery', seat.diagnostics.batteryHours !== null ? `${seat.diagnostics.batteryHours} h` : null) : null,
        seat.diagnostics ? kv('Signal', seat.diagnostics.signalDbm !== null ? `${seat.diagnostics.signalDbm} dBm` : null) : null,
        kv('Seat id', h('code', { class: 'id' }, id)),
        (d.devices ?? []).length ? [h('h3', null, `Devices (${d.devices.length})`), h('ul', { class: 'device-list' }, d.devices.map(dev => h('li', null,
          h('strong', null, dev.name || humanize(dev.type ?? 'device')),
          h('span', { class: ['tag', dev.state === 'operational' ? 'ok-tag' : 'warn-tag'] }, humanize(dev.state ?? 'unknown')),
          h('small', { class: 'sub' }, [humanize(dev.type ?? ''), dev.serial && `S/N ${dev.serial}`, dev.version && `v${dev.version}`, !dev.foundAtSeat && 'not found at seat',
            dev.capabilities.length ? dev.capabilities.map(humanize).join(', ') : null].filter(Boolean).join(' · ')))))] : null,
        h('h3', null, 'Plan'),
        kv('Position', pos ? `${(pos.x / 100).toFixed(1)} m, ${(pos.y / 100).toFixed(1)} m · ${pos.rotation ?? 0}°` : 'not placed'),
        editing ? shotEditor(id) : kv('Camera shot', r?.shots?.[id] ? `${cameras().find(c => c.id === r.shots[id].cameraId)?.name ?? r.shots[id].cameraId} · preset ${r.shots[id].preset}` : null),
        companionSection({ store, api, kind: 'seats', id, label: seat.name })); // WO-099
      return h('section', { class: 'side-card seat-panel', 'data-seat-panel': id }, parts);
    }

    /** Edit mode (WO-084, DEC-023): give the seat to a participant, clear it, or create a participant on it. */
    function participantEditor(id, assigned) {
      if (!store.topic('domain.capabilities')?.actions?.editParticipants) {
        return h('p', { class: 'muted small-text' }, 'The connected system does not let LikeABosch edit participants.');
      }
      const people = [...(store.topic('domain.participants') ?? [])].sort((a, b) => a.sortName.localeCompare(b.sortName));
      const assign = async participantId => {
        const who = people.find(p => p.id === participantId);
        try {
          await api.domain('PUT', `/seats/${encodeURIComponent(id)}/participant`, { participantId });
          toast(who ? `${who.name} assigned${who.assignedSeatId && who.assignedSeatId !== id ? ` (moved from ${who.seat ?? who.assignedSeatId})` : ''}` : 'Seat cleared', 'success');
        } catch (err) { toastError(err, 'Participant: '); }
      };
      const pick = h('select', { 'aria-label': 'Participant on this seat', onchange: e => assign(e.target.value || null) },
        h('option', { value: '' }, '— nobody —'),
        people.map(p => h('option', { value: p.id, selected: p.id === assigned?.id },
          p.assignedSeatId && p.assignedSeatId !== id ? `${p.name} (now ${p.seat ?? p.assignedSeatId})` : p.name)));
      const nameInput = h('input', { type: 'text', maxlength: 32, placeholder: 'New name', 'aria-label': 'New participant name' });
      const create = h('form', { class: 'row-inline new-participant' }, nameInput, h('button', { type: 'submit', class: 'primary small' }, 'Create & assign'));
      create.addEventListener('submit', async e => {
        e.preventDefault();
        const name = nameInput.value.trim();
        if (!name) return nameInput.focus();
        try {
          await api.domain('POST', '/participants', { name, seatId: id });
          toast(`${name} created and assigned`, 'success');
        } catch (err) { toastError(err, 'Participant: '); }
      });
      return h('div', { class: 'participant-editor' }, pick, create);
    }

    // ---------------------------------------------------------------- group selection + arrange in a shape (WO-055)
    /** Selected seats that are on the plan, in selection order. */
    function groupSeats() {
      const r = room();
      const all = store.topic('domain.seats') ?? [];
      return [...multi].filter(id => r?.seats?.[id]).map(id => all.find(x => x.id === id) ?? { id, name: id });
    }
    const groupCenter = () => boxCenter(groupSeats().map(x => room().seats[x.id]));

    /** Seats per segment for the current shape; reset to an even split when the group size changed. */
    function segmentCounts(shape, n) {
      if (arr.counts[shape]?.n !== n) arr.counts[shape] = { n, values: defaultCounts(shape, n) };
      return arr.counts[shape].values;
    }

    /** Target placements of the selected seats in seat order ({ items, overflow }) or { error }. Overflow (WO-094): the
     *  seats beyond the segments' places, in seat order; they keep their position. */
    function arrangement() {
      const list = groupSeats();
      const n = list.length;
      if (n < 2) return { error: 'Select at least two seats on the plan' };
      const shape = arr.shape;
      const counts = segmentCounts(shape, n);
      const error = countsError(shape, counts, n);
      if (error) return { error };
      const ordered = arr.order === 'name' ? [...list].sort(byName) : list;
      const places = placesFor(shape, counts, n);
      const pts = arrange({ shape, n: places, counts, spacing: arr.spacing, rotation: arr.rotation, center: groupCenter(), start: arr.start[shape],
        direction: arr.direction, facing: arr.facing, columns: arr.columns || undefined });
      return { items: ordered.slice(0, places).map((x, i) => ({ id: x.id, name: x.name, ...pts[i] })), overflow: ordered.slice(places) };
    }

    /** Ghost seats where the arrangement would put them: seat names, START marker, arrows along the seat order. */
    function renderPreview() {
      previewLayer.replaceChildren();
      if (mode !== 'edit' || multi.size < 2 || !arr.open || !room()) return;
      const { items } = arrangement();
      if (!items) return;
      for (let i = 1; i < items.length; i += 1) {
        const a = items[i - 1], b = items[i];
        const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
        previewLayer.append(s('line', { class: 'arrange-path', x1: a.x, y1: a.y, x2: b.x, y2: b.y }),
          s('path', { class: 'arrange-arrow', d: 'M -7 -6 L 7 0 L -7 6 Z', transform: `translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2}) rotate(${ang})` }));
      }
      // Already arranged like this: keep only START and the arrows, the seats themselves show the result.
      const placed = room().seats;
      const applied = items.every(p => placed[p.id]?.x === p.x && placed[p.id]?.y === p.y && (placed[p.id].rotation ?? 0) === p.rotation);
      if (!applied) items.forEach((p, i) => previewLayer.append(s('g', { class: i === 0 ? 'ghost start' : 'ghost', transform: `translate(${p.x} ${p.y})` },
        s('circle', { r: SEAT_R }),
        s('path', { class: 'ghost-front', d: `M -10 ${-SEAT_R + 6} L 10 ${-SEAT_R + 6} L 0 ${-SEAT_R - 6} Z`, transform: `rotate(${p.rotation})` }),
        s('text', { 'text-anchor': 'middle', y: 5 }, String(p.name).replace(/^Seat\s*/i, '').slice(0, 8)),
        s('title', null, `${i + 1}. ${p.name}`))));
      const first = items[0];
      previewLayer.append(s('text', { class: 'arrange-start', x: first.x, y: first.y - SEAT_R - 12, 'text-anchor': 'middle' }, 'START'));
    }

    function groupPanel() {
      const list = groupSeats();
      const r = room();
      const rotate = deg => {
        const turned = rotateAround(list.map(x => ({ id: x.id, ...r.seats[x.id] })), groupCenter(), deg);
        return savePlacements(Object.fromEntries(turned.map(({ id, ...p }) => [id, p])));
      };
      return h('section', { class: 'side-card group-panel', 'data-group-panel': '' },
        h('div', { class: 'card-head' }, h('h2', null, `${list.length} seats selected`),
          h('button', { type: 'button', class: 'link small', onclick: () => setMulti([]) }, 'Clear')),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'secondary small', title: 'Rotate the group left around its centre', onclick: () => rotate(-15) }, '⟲ 15°'),
          h('button', { type: 'button', class: 'secondary small', title: 'Rotate the group right around its centre', onclick: () => rotate(15) }, '⟳ 15°'),
          h('button', { type: 'button', class: 'secondary small', disabled: !undoStack.length, title: 'Undo the last group change (Ctrl/⌘ + Z)', onclick: undoLast }, 'Undo'),
          h('button', { type: 'button', class: 'small danger-outline', onclick: () => savePlacements(Object.fromEntries(list.map(x => [x.id, null]))).then(() => setMulti([])) }, 'Remove from plan')),
        h('p', { class: 'muted small-text' }, 'Drag any selected seat to move the whole group. Shift/⌘-click adds or removes a seat · Esc clears · Ctrl/⌘ + A selects all.'),
        arrangeSection(list.length),
        shotsSection(list));
    }

    /** Preset per selected seat (WO-056): { items: [{ id, name, x, y, preset }] } in counting order, or { error }. */
    function shotPlan() {
      const list = groupSeats();
      if (!list.length) return { error: 'Select seats on the plan' };
      if (!shotsForm.cameraId || !cameras().some(c => c.id === shotsForm.cameraId)) return { error: 'Choose a camera' };
      if (!Number.isInteger(shotsForm.start) || shotsForm.start < 0) return { error: 'The first preset must be a whole number ≥ 0' };
      if (!Number.isInteger(shotsForm.step) || shotsForm.step < 1) return { error: 'Step must be a whole number ≥ 1' };
      const pos = room().seats;
      return { items: orderSeats(list, shotsForm.by, pos).map((x, i) => ({ id: x.id, name: x.name, ...pos[x.id], preset: shotsForm.start + i * shotsForm.step })) };
    }

    function renderShotPreview() {
      shotPreviewLayer.replaceChildren();
      if (mode !== 'edit' || !multi.size || !shotsForm.open || !room()) return;
      const { items } = shotPlan();
      if (!items) return;
      items.forEach((p, i) => {
        const label = `P${p.preset}`;
        const w = 12 + label.length * 9;
        shotPreviewLayer.append(s('g', { class: i === 0 ? 'preset-tag start' : 'preset-tag', transform: `translate(${p.x} ${p.y - SEAT_R - 16})` },
          s('rect', { x: -w / 2, y: -11, width: w, height: 22, rx: 11 }),
          s('text', { 'text-anchor': 'middle', y: 5 }, label),
          i === 0 ? s('text', { class: 'preset-start', 'text-anchor': 'middle', y: -18 }, 'START') : null));
      });
    }

    /** The arrange and preset sections are an accordion: opening one closes the other (and its preview). */
    function closeOther(opened) {
      for (const d of side.querySelectorAll('details.arrange')) if (d !== opened && d.open) d.open = false;
    }

    function shotsSection(list) {
      const cams = cameras();
      if (shotsForm.cameraId && !cams.some(c => c.id === shotsForm.cameraId)) shotsForm.cameraId = '';
      if (!shotsForm.cameraId && cams.length === 1) shotsForm.cameraId = cams[0].id;
      const status = h('p', { class: 'small-text arrange-status', 'aria-live': 'polite' });
      const applyBtn = h('button', { type: 'button', class: 'primary small' }, 'Assign presets');
      const refresh = () => {
        const res = shotPlan();
        const cam = cams.find(c => c.id === shotsForm.cameraId);
        const last = res.items?.at(-1);
        const warn = !res.items ? null
          : cam?.driver === 'onvif' ? 'ONVIF presets are tokens: numbers only work if this camera\'s tokens are numbers.'
            : cam?.driver === 'panasonic' && last.preset > 100 ? 'Panasonic AW cameras have presets 1–100.' : null;
        status.textContent = res.error ?? `${res.items[0].name} → ${cam.name} preset ${res.items[0].preset} … ${last.name} → preset ${last.preset}${warn ? ` · ${warn}` : ''}`;
        status.classList.toggle('error-text', Boolean(res.error));
        applyBtn.disabled = Boolean(res.error);
        renderShotPreview();
      };
      applyBtn.addEventListener('click', async () => {
        const res = shotPlan();
        if (res.error) return toast(res.error, 'error');
        if (await saveShots(Object.fromEntries(res.items.map(x => [x.id, { cameraId: shotsForm.cameraId, preset: x.preset }])))) {
          toast(`${res.items.length} seats: ${cams.find(c => c.id === shotsForm.cameraId)?.name} presets ${res.items[0].preset}–${res.items.at(-1).preset}`, 'success');
        }
      });
      const withShot = list.filter(x => room().shots?.[x.id]).length;
      const num = (label, key, attrs) => h('label', { class: 'field' }, h('span', null, label),
        h('input', { type: 'number', value: shotsForm[key], step: 1, ...attrs, oninput: e => { shotsForm[key] = e.target.value === '' ? NaN : Number(e.target.value); refresh(); } }));
      const details = h('details', { class: 'arrange shots-form', open: shotsForm.open },
        h('summary', null, 'Camera presets for these seats'),
        cams.length ? [
          h('div', { class: 'row-inline' },
            h('label', { class: 'field' }, h('span', null, 'Camera'), h('select', { 'aria-label': 'Camera for the selected seats', onchange: e => { shotsForm.cameraId = e.target.value; refresh(); } },
              h('option', { value: '' }, 'Choose…'), cams.map(c => h('option', { value: c.id, selected: c.id === shotsForm.cameraId }, c.name)))),
            num('First preset', 'start', { min: 0, 'aria-label': 'First preset' }),
            num('Step', 'step', { min: 1, 'aria-label': 'Preset step' })),
          h('label', { class: 'field' }, h('span', null, 'Count from'), h('select', { 'aria-label': 'Count seats from', onchange: e => { shotsForm.by = e.target.value; refresh(); } },
            COUNT_FROM.map(([v, t]) => h('option', { value: v, selected: v === shotsForm.by }, t)))),
          status,
          h('div', { class: 'actions' }, applyBtn,
            withShot ? h('button', { type: 'button', class: 'small danger-outline', onclick: () => saveShots(Object.fromEntries(list.filter(x => room().shots?.[x.id]).map(x => [x.id, null]))).then(ok => ok && toast(`Presets deleted on ${withShot} seats`, 'success')) }, `Delete presets (${withShot})`) : null),
          h('p', { class: 'muted small-text' }, `${withShot} of ${list.length} selected seats have a shot. The plan shows the preset each seat gets; Undo restores the previous shots.`),
        ] : h('p', { class: 'muted small-text' }, 'Add cameras in ', h('a', { href: '#/settings/cameras' }, 'Settings → Cameras'), ' first.'));
      details.addEventListener('toggle', () => {
        shotsForm.open = details.open;
        if (details.open) closeOther(details);
        renderShotPreview();
      });
      refresh();
      return details;
    }

    function arrangeSection(n) {
      const shape = arr.shape;
      const rebuild = () => { arr.open = true; renderSide(true); }; // the fields depend on the shape; only reachable while open
      const status = h('p', { class: 'small-text arrange-status', 'aria-live': 'polite' });
      const applyBtn = h('button', { type: 'button', class: 'primary small' }, 'Apply');
      const refresh = () => {
        const res = arrangement();
        status.textContent = res.error ?? `Seat order starts with ${res.items[0].name} (START on the plan).${res.overflow.length
          ? ` ${res.overflow.length} seat${res.overflow.length === 1 ? ' does' : 's do'} not fit (${res.overflow[0].name}${res.overflow.length > 1 ? ` … ${res.overflow.at(-1).name}` : ''}): they stay where they are and stay selected for the next arrangement.` : ''}`;
        status.classList.toggle('error-text', Boolean(res.error));
        applyBtn.disabled = Boolean(res.error);
        renderPreview();
      };
      applyBtn.addEventListener('click', async () => {
        const res = arrangement();
        if (res.error) return toast(res.error, 'error');
        await savePlacements(Object.fromEntries(res.items.map(({ id, x, y, rotation }) => [id, { x, y, rotation }])));
        toast(`${res.items.length} seats arranged: ${SHAPES[shape].label}${res.overflow.length ? `; ${res.overflow.length} left over and selected: arrange them next` : ''}`, 'success');
        if (res.overflow.length) setMulti(res.overflow.map(x => x.id)); // WO-094: the leftovers are the next group
      });
      const num = (label, value, set, attrs = {}) => h('label', { class: 'field' }, h('span', null, label),
        h('input', { type: 'number', value, ...attrs, oninput: e => { const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v)) { set(v); refresh(); } } }));
      const pick = (label, value, options, set) => h('label', { class: 'field' }, h('span', null, label),
        h('select', { onchange: e => { set(e.target.value); refresh(); } }, options.map(([v, t]) => h('option', { value: v, selected: v === value }, t))));
      const startOptions = {
        line: [['left', 'Left end'], ['right', 'Right end']],
        u: [['left', 'Left arm, open end'], ['right', 'Right arm, open end']],
        rect: [['tl', 'Top-left corner'], ['tr', 'Top-right corner'], ['br', 'Bottom-right corner'], ['bl', 'Bottom-left corner']],
        grid: [['tl', 'Top-left'], ['tr', 'Top-right'], ['bl', 'Bottom-left'], ['br', 'Bottom-right']],
      }[shape];
      const segments = SHAPES[shape].segments;
      const counts = segments ? segmentCounts(shape, n) : null;

      const details = h('details', { class: 'arrange', open: arr.open },
        h('summary', null, 'Arrange in a shape'),
        h('div', { class: 'segmented shape-pick', role: 'group', 'aria-label': 'Shape' },
          Object.entries(SHAPES).map(([key, def]) => h('button', { type: 'button', class: key === shape ? 'on' : null, 'aria-pressed': String(key === shape),
            onclick: () => { arr.shape = key; rebuild(); } }, def.label))),
        segments ? h('div', { class: 'arrange-counts' },
          h('div', { class: 'row-inline counts-row' }, segments.map((label, i) => num(label, counts[i], v => { counts[i] = Math.round(v); }, { min: 0, max: n, step: 1, 'aria-label': `Seats on ${label}` }))),
          h('button', { type: 'button', class: 'link small', onclick: () => { arr.counts[shape] = { n, values: defaultCounts(shape, n) }; rebuild(); } }, 'Split evenly')) : null,
        shape === 'grid' ? num('Columns', arr.columns || Math.ceil(Math.sqrt(n)), v => { arr.columns = Math.max(1, Math.round(v)); }, { min: 1, max: n, step: 1 }) : null,
        h('div', { class: 'row-inline' },
          pick('Start (seat 1)', arr.start[shape], startOptions, v => { arr.start[shape] = v; }),
          shape === 'rect' ? pick('Direction', arr.direction, [['cw', 'Clockwise'], ['ccw', 'Counter-clockwise']], v => { arr.direction = v; }) : null),
        h('div', { class: 'row-inline' },
          pick('Seat order', arr.order, [['name', 'By seat name'], ['selection', 'In the order selected']], v => { arr.order = v; }),
          shape === 'u' || shape === 'rect' ? pick('Seats face', arr.facing, [['in', 'Inward'], ['out', 'Outward']], v => { arr.facing = v; }) : null),
        h('div', { class: 'row-inline' },
          num('Spacing (cm)', arr.spacing, v => { arr.spacing = clamp(v, 30, 2000); }, { min: 30, max: 2000, step: 10 }),
          num('Rotation (°)', arr.rotation, v => { arr.rotation = v; }, { min: -360, max: 360, step: 15 })),
        h('p', { class: 'muted small-text' }, shape === 'u' ? '0° = open side at the top. Corners stay free.' : shape === 'line' ? '0° = seats in a row facing up.' : shape === 'rect' ? 'Corners stay free.' : 'Row by row from the start corner.'),
        status,
        h('div', { class: 'actions' }, applyBtn));
      details.addEventListener('toggle', () => {
        arr.open = details.open;
        if (details.open) closeOther(details); // one preview on the plan at a time
        renderPreview();
      });
      refresh();
      return details;
    }

    // Edit-mode keys (WO-055): Esc clears the selection, Ctrl/⌘ + A selects all placed seats, Ctrl/⌘ + Z undoes,
    // Space held = drag pans.
    const typing = t => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName));
    function onKeyDown(evt) {
      if (mode !== 'edit' || !el.isConnected || typing(evt.target)) return;
      if (evt.key === ' ' && !evt.repeat && !evt.target.closest?.('button, [role="button"]')) {
        spaceHeld = true; svg.classList.add('pan-ready'); evt.preventDefault();
      } else if (evt.key === 'Escape' && (multi.size || selected)) {
        setMulti([]);
      } else if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'a') {
        evt.preventDefault();
        setMulti(seats().filter(x => room()?.seats?.[x.id]).map(x => x.id));
      } else if ((evt.ctrlKey || evt.metaKey) && !evt.shiftKey && evt.key.toLowerCase() === 'z' && undoStack.length) {
        evt.preventDefault();
        undoLast();
      }
    }
    function onKeyUp(evt) {
      if (evt.key === ' ') { spaceHeld = false; svg.classList.remove('pan-ready'); }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const onBlur = () => { spaceHeld = false; svg.classList.remove('pan-ready'); };
    window.addEventListener('blur', onBlur);

    const deskCanControl = d => store.can('canControlInterpretation') && String(d.status).toLowerCase() !== 'disconnected';

    /** Output channel buttons Off / A / B / C with their languages (shared by the desk panel and the plan strip). */
    function deskOutputs(d, { compact = false } = {}) {
      const mic = deskMic(d.seatId);
      const can = deskCanControl(d);
      return h('div', { class: ['segmented', 'desk-outputs', compact && 'compact'], role: 'group', 'aria-label': `${deskLabel(d)} microphone` },
        DESK_OUTPUTS.map(([state, label, key]) => h('button', {
          type: 'button', class: [state === mic && 'on', state === mic && state !== 'off' && 'live'], 'aria-pressed': String(state === mic),
          disabled: !can || (key && !d[key]), 'data-output': label,
          title: state === 'off' ? 'Microphone off' : `Microphone on output ${label} (${langName(d[key])})`,
          onclick: () => deskCall('GrantInterpretation', { seatId: d.seatId, microphoneState: state }),
        }, label, key && d[key] ? h('small', null, ` ${lang(d[key])}`) : null)));
    }

    /** What the interpreter listens to: Floor / Relay / a language (shared by the desk panel and the plan strip). */
    function deskInput(d, { compact = false } = {}) {
      const id = d.seatId;
      const source = it.source(routingOf(id)); // null while the mic is off (not reported)
      return h('select', {
        class: compact ? 'desk-input compact' : 'desk-input', 'aria-label': `${deskLabel(d)} listens to`, disabled: !deskCanControl(d),
        title: 'Input of the interpreter: floor, relay or a booth language',
        onchange: e => {
          const v = e.target.value;
          if (v === 'floor') deskCall('SelectInterpretationFloor', { seatId: id });
          else if (v === 'relay') deskCall('SelectRelayInterpretation', { seatId: id });
          else deskCall('SelectInterpretationInputLanguage', { seatId: id, inputButton: 'inputPresetA', languageId: v });
        },
      },
      // DICENTIS reports the input only while the microphone is on: don't pretend to know it otherwise.
      source === null ? h('option', { value: '', selected: true, disabled: true }, compact ? 'in: —' : '— shown while the mic is on —') : null,
      h('option', { value: 'floor', selected: source === 'floor' }, compact ? 'in: Floor' : 'Floor'),
      h('option', { value: 'relay', selected: source === 'relay' }, compact ? 'in: Relay' : 'Relay (auto)'),
      it.languages().map(l => h('option', { value: l.languageId, selected: l.languageId === source }, compact ? `in: ${l.abbreviation}` : `${l.abbreviation} · ${l.label}`)),
      source && !['floor', 'relay'].includes(source) && !it.languages().some(l => l.languageId === source) ? h('option', { value: '', selected: true, disabled: true }, 'Unknown source') : null);
    }

    /** DCN interpreter desk (WO-074): what the meeting data stream reports; DCN offers no desk control. */
    function dcnDeskPanel(d) {
      const id = d.seatId;
      const pos = room()?.desks?.[id];
      return h('section', { class: 'side-card desk-panel', 'data-desk-panel': id },
        h('div', { class: 'card-head' }, h('h2', null, `Interpreter: ${deskLabel(d)}`),
          h('button', { type: 'button', class: 'link small', onclick: () => { selected = null; renderAll(); } }, 'Close')),
        h('div', { class: 'seat-badges' }, d.live ? h('span', { class: 'tag live-tag' }, 'Translating') : h('span', { class: 'tag' }, 'Not translating'),
          d.boothInUse ? h('span', { class: 'tag' }, 'Booth in use') : null),
        mode === 'edit' ? h('div', { class: 'actions' }, pos
          ? [h('button', { type: 'button', class: 'secondary small', onclick: () => savePosition('desk', id, { ...pos, rotation: ((pos.rotation ?? 0) + 345) % 360 }) }, '⟲ 15°'),
            h('button', { type: 'button', class: 'secondary small', onclick: () => savePosition('desk', id, { ...pos, rotation: ((pos.rotation ?? 0) + 15) % 360 }) }, '⟳ 15°'),
            h('button', { type: 'button', class: 'small danger-outline', onclick: () => api.del(`/room/desks/${encodeURIComponent(id)}`).then(() => { selected = null; }, toastError) }, 'Remove from plan')]
          : h('button', { type: 'button', class: 'primary small', onclick: () => savePosition('desk', id, { x: Math.round(view.cx), y: Math.round(view.cy), rotation: 0 }) }, 'Place on plan')) : null,
        kv('Seat', d.seatName ?? d.deskSeatId),
        kv('Output', d.output ? [d.output.output && `channel ${d.output.output}`, d.output.language].filter(Boolean).join(' · ') : null),
        kv('Listening to', d.source ? d.source.language ?? d.source.abbreviation : null),
        h('p', { class: 'muted small-text' }, d.live ? 'Live from the DCN-SW meeting data stream.'
          : 'Output and source are the last ones the meeting data stream reported. DCN has no API to control interpreter desks.'),
        companionSection({ store, api, kind: 'desks', id, label: `Interpreter ${deskLabel(d)}` })); // WO-099
    }

    /** Interpreter desk: state + quick controls (WO-048). */
    function deskPanel(id) {
      const d = desks().find(x => x.seatId === id);
      if (d?.generic) return dcnDeskPanel(d);
      if (!d) return h('section', { class: 'side-card' }, h('p', { class: 'muted' }, 'This interpreter desk is not in the active meeting.'));
      const r = room();
      const pos = r?.desks?.[id];
      const routing = routingOf(id);
      const mic = deskMic(id);
      const status = String(d.status).toLowerCase();
      const can = store.can('canControlInterpretation') && status !== 'disconnected';
      const slow = (store.topic('interpretationMetaFunctionStatus')?.requestStatus?.seatMetaData?.find(m => m.seatId === id)?.seatMetaRequests ?? []).includes(SPEAK_SLOW);
      const source = it.source(routing); // null while the mic is off (not reported)
      const outputSelect = (button, listKey, key) => h('select', {
        'aria-label': `Output ${button === 'outputPresetB' ? 'B' : 'C'} language`, disabled: !can || !(d[listKey] ?? []).length,
        onchange: e => deskCall('SetInterpretationOutputPreset', { seatId: id, outputButton: button, languageId: e.target.value }),
      }, (d[listKey] ?? []).length ? d[listKey].map(l => h('option', { value: l, selected: l === d[key] }, langName(l))) : h('option', null, '—'));
      const editing = mode === 'edit';
      return h('section', { class: 'side-card desk-panel', 'data-desk-panel': id },
        h('div', { class: 'card-head' }, h('h2', null, `Interpreter: ${deskLabel(d)}`),
          h('button', { type: 'button', class: 'link small', onclick: () => { selected = null; renderAll(); } }, 'Close')),
        h('div', { class: 'seat-badges' },
          h('span', { class: ['pill', status === 'disconnected' ? 'disconnected' : 'loggedIn'] }, humanize(status)),
          h('span', { class: 'tag' }, humanize(String(d.deskType ?? 'desk').toLowerCase())),
          mic !== 'off' ? h('span', { class: 'tag live-tag' }, 'On air') : null,
          slow ? h('span', { class: 'tag warn-tag' }, 'Speak slowly') : null),
        store.topic('domain.capabilities')?.dicentis?.languages
          ? h('p', { class: 'small-text' }, h('a', { href: '#/settings/interpretation#languages-setup' }, 'Assign languages to this desk…')) : null, // WO-102
        editing ? h('div', { class: 'actions' }, pos
          ? [h('button', { type: 'button', class: 'secondary small', onclick: () => savePosition('desk', id, { ...pos, rotation: ((pos.rotation ?? 0) + 345) % 360 }) }, '⟲ 15°'),
            h('button', { type: 'button', class: 'secondary small', onclick: () => savePosition('desk', id, { ...pos, rotation: ((pos.rotation ?? 0) + 15) % 360 }) }, '⟳ 15°'),
            h('button', { type: 'button', class: 'small danger-outline', onclick: () => api.del(`/room/desks/${encodeURIComponent(id)}`).then(() => { selected = null; }, toastError) }, 'Remove from plan')]
          : h('button', { type: 'button', class: 'primary small', onclick: () => savePosition('desk', id, { x: Math.round(view.cx), y: Math.round(view.cy), rotation: 0 }) }, 'Place on plan')) : null,
        h('h3', null, 'Microphone / output channel'),
        deskOutputs(d),
        h('h3', null, 'Listening to (input)'),
        deskInput(d),
        h('h3', null, 'Output presets'),
        kv('A (fixed)', langName(d.aLanguageId)),
        kv('B', outputSelect('outputPresetB', 'bLanguageList', 'bLanguageId')),
        kv('C', outputSelect('outputPresetC', 'cLanguageList', 'cLanguageId')),
        h('h3', null, 'Now'),
        kv('Producing', mic === 'off' ? 'nothing (mic off)' : `${langName(routing?.destinationLanguageId)}${it.quality(routing) && it.quality(routing) !== 'unknown' ? ` (quality ${humanize(it.quality(routing))})` : ''}`),
        routing?.autoRelayContribution ? kv('Auto-relay', 'This desk provides the relay language') : null,
        d.headphone?.headphoneDescription ? kv('Headphone', d.headphone.headphoneDescription) : null,
        can ? h('div', { class: 'actions' }, actionButton(slow ? 'Cancel "speak slowly"' : 'Ask speaker to slow down',
          () => api.wired(slow ? 'CancelInterpreterMetaFunction' : 'IssueInterpreterMetaFunction', { seatId: id, request: SPEAK_SLOW }), { cls: 'small' })) : null,
        !store.can('canControlInterpretation') ? h('p', { class: 'muted small-text' }, 'Read-only: the account lacks canControlInterpretation.') : null,
        h('p', { class: 'muted small-text' }, 'Booths, desks and language lists are configured in DICENTIS (Windows connector, WO-050).'),
        companionSection({ store, api, kind: 'desks', id, label: `Interpreter ${deskLabel(d)}` })); // WO-099
    }

    /** Microphone sensitivity (wired, 6.1+): value from the `microphoneSensitivity` topic, ± one step, reset. */
    function sensitivityRow(id) {
      const value = store.topic('microphoneSensitivity')?.seatMicrophoneSensitivities?.find(x => x.seatId === id)?.sensitivityValue;
      if (value === undefined) return null;
      const desc = store.topic('microphoneSensitivityDescription')?.micSensitivityDescription;
      const can = store.can('canControlMicrophoneSensitivity') && desc;
      const set = async v => {
        try {
          const res = await api.wired('UpdateMicrophoneSensitivity', { seatMicrophoneSensitivity: [{ seatId: id, sensitivityValue: v }] });
          if (res?.status === false) toast('The seat rejected the sensitivity change', 'error');
        } catch (err) { toastError(err); }
      };
      const step = desc?.microphoneSensitivityStepSize ?? 0.5;
      const fmt = v => `${v > 0 ? '+' : ''}${v} dB`;
      return kv('Mic sensitivity', can
        ? h('span', { class: 'row-inline sens' },
          h('button', { type: 'button', class: 'secondary small', 'aria-label': 'Lower microphone sensitivity', disabled: value - step < desc.minimumMicrophoneSensitivity, onclick: () => set(+(value - step).toFixed(2)) }, '−'),
          h('span', { class: 'sens-value' }, fmt(value)),
          h('button', { type: 'button', class: 'secondary small', 'aria-label': 'Raise microphone sensitivity', disabled: value + step > desc.maximumMicrophoneSensitivity, onclick: () => set(+(value + step).toFixed(2)) }, '+'),
          h('button', { type: 'button', class: 'link small', title: 'Reset to 0 dB', 'aria-label': 'Reset microphone sensitivity', disabled: value === 0, onclick: () => api.wired('ResetMicrophoneSensitivity', { seatIds: [id] }).catch(toastError) }, '↺'))
        : fmt(value));
    }

    function selectionPanel() {
      if (multi.size > 1) return groupPanel();
      if (!selected) return [h('section', { class: 'side-card' }, h('p', { class: 'muted small-text' }, 'Drag seats and cameras to arrange the room. Select one to see everything about it, rotate it, assign a camera shot or remove it from the plan. Drag a box on empty floor to select several seats, then move them together or arrange them in a shape.')), roomSizePanel()];
      if (selected.kind === 'seat') return seatPanel(selected.id);
      if (selected.kind === 'desk') return deskPanel(selected.id);
      return cameraPanel(selected.id);
    }

    /** Camera inspector (WO-052): status, address, switcher input/tally, shots using it; cut / recall in both modes. */
    function cameraPanel(id) {
      const cam = cameras().find(c => c.id === id);
      const close = h('button', { type: 'button', class: 'link small', onclick: () => { selected = null; renderAll(); } }, 'Close');
      if (!cam) return h('section', { class: 'side-card' }, h('div', { class: 'card-head' }, h('h2', null, 'Camera'), close), h('p', { class: 'muted' }, 'This camera was removed in Settings → Cameras.'));
      const r = room();
      const pos = r?.cameras?.[id];
      const tally = cameraTally(cam);
      const d = director();
      const shotSeats = Object.entries(r?.shots ?? {}).filter(([, sh]) => sh.cameraId === id)
        .map(([seatId, sh]) => `${(store.topic('domain.seats') ?? []).find(x => x.id === seatId)?.name ?? seatId} (${sh.preset})`);
      const presetInput = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'Preset', 'aria-label': `Preset for ${cam.name}`, class: 'preset-input' });
      const typed = () => { const v = presetInput.value.trim(); return /^\d+$/.test(v) ? Number(v) : v; };
      const camUrl = `/devices/cameras/${encodeURIComponent(id)}`;
      const recallPreset = p => api.post(`${camUrl}/recall`, { preset: p });
      const recall = () => (typed() === '' ? toast('Enter a preset', 'error') : recallPreset(typed()));
      const save = async () => {
        if (typed() === '') return toast('Enter the preset number to save to', 'error');
        const r = await api.post(`${camUrl}/store`, { preset: typed(), name: cam.name });
        toast(`${cam.name}: saved as preset ${r.preset}`, 'success');
      };
      const st = cam.status ?? {};
      const cur = cam.currentPreset;
      // Quick recall: presets this camera uses for seat shots and the overview.
      const used = [
        ...(r?.overview?.cameraId === id ? [['Overview', r.overview.preset]] : []),
        ...Object.entries(r?.shots ?? {}).filter(([, sh]) => sh.cameraId === id)
          .map(([seatId, sh]) => [(store.topic('domain.seats') ?? []).find(x => x.id === seatId)?.name ?? seatId, sh.preset]),
      ];
      return h('section', { class: 'side-card camera-panel', 'data-camera-panel': id },
        h('div', { class: 'card-head' }, h('h2', null, `Camera: ${cam.name}`), close),
        h('div', { class: 'seat-badges' },
          h('span', { class: ['pill', st.connected ? 'loggedIn' : 'disconnected'] }, st.connected ? 'Connected' : 'Offline'),
          tally === 'program' ? h('span', { class: 'tag live-tag' }, 'Program (on air)') : tally === 'preview' ? h('span', { class: 'tag ok-tag' }, 'Preview') : null,
          d?.onAirCamera === id && d?.busy ? h('span', { class: 'tag' }, 'moving') : null),
        mode === 'edit' && pos ? h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'secondary small', onclick: () => savePosition('camera', id, { ...pos, rotation: ((pos.rotation ?? 0) + 345) % 360 }) }, '⟲ 15°'),
          h('button', { type: 'button', class: 'secondary small', onclick: () => savePosition('camera', id, { ...pos, rotation: ((pos.rotation ?? 0) + 15) % 360 }) }, '⟳ 15°'),
          h('button', { type: 'button', class: 'small danger-outline', onclick: () => api.del(`/room/cameras/${encodeURIComponent(id)}`).then(() => { selected = null; }, toastError) }, 'Remove from plan')) : null,
        st.lastError ? kv('Last error', h('span', { class: 'error-text' }, st.lastError)) : null,
        h('h3', null, 'Control'),
        h('div', { class: 'actions' },
          actionButton('Cut to camera', () => cutTo(cam), { cls: 'small primary', disabled: cam.switcherInput === null || cam.switcherInput === undefined }),
          actionButton('Preview', () => previewTo(cam), { cls: 'small secondary', disabled: cam.switcherInput === null || cam.switcherInput === undefined, title: 'Put this camera on the switcher preview' })),
        h('h3', null, 'PTZ'),
        st.connected ? ptzPad({ api, cam, compact: true }) : h('p', { class: 'muted small-text' }, 'Camera offline.'),
        h('div', { class: 'current-preset' },
          cur ? [h('span', null, 'Current preset ', h('strong', null, String(cur.preset)), cur.modified ? h('span', { class: 'tag warn-tag' }, 'adjusted') : null),
            actionButton(`Overwrite preset ${cur.preset}`, async () => {
              await api.post(`${camUrl}/store`, { preset: cur.preset, name: cam.name });
              toast(`${cam.name}: preset ${cur.preset} overwritten with the current position`, 'success');
            }, { cls: cur.modified ? 'small primary' : 'small secondary', disabled: !st.connected, title: 'Store the current position into the preset that was recalled last' })]
            : h('span', { class: 'muted small-text' }, 'No current preset: recall one to be able to overwrite it.')),
        h('div', { class: 'row-inline preset-row' }, presetInput,
          actionButton('Recall', recall, { cls: 'small secondary', disabled: !st.connected }),
          actionButton('Save', save, { cls: 'small secondary', disabled: !st.connected, title: 'Store the current position as this preset number' })),
        used.length ? h('div', { class: 'tray preset-chips' }, used.map(([label, p]) => h('button', {
          type: 'button', class: ['chip-button', cur && String(cur.preset) === String(p) && 'on'], disabled: !st.connected,
          title: `Recall preset ${p}`, onclick: () => recallPreset(p).catch(toastError),
        }, `${label} · ${p}`))) : null,
        h('h3', null, 'Device'),
        kv('Type', humanize(cam.driver ?? '')),
        cam.host ? kv('Address', `${cam.host}${cam.port ? `:${cam.port}` : ''}${cam.transport ? ` (${cam.transport.toUpperCase()}${cam.framing ? `, ${cam.framing}` : ''})` : ''}`) : null,
        kv('Switcher input', cam.switcherInput ?? '—'),
        h('h3', null, 'Automation'),
        h('label', { class: 'check camera-automation' }, h('input', {
          type: 'checkbox', checked: cam.automation !== false, 'aria-label': `Use ${cam.name} in camera automation`,
          onchange: async e => { try { await api.put(camUrl, { automation: e.target.checked }); } catch (err) { toastError(err); e.target.checked = !e.target.checked; } },
        }), ' Used by the camera automation', h('small', { class: 'muted' }, ' (off = never moved or cut to automatically)')),
        kv('Overview camera', r?.overview?.cameraId === id ? `Yes (preset ${r.overview.preset})` : 'No'),
        kv('Seat shots', shotSeats.length ? shotSeats.join(', ') : 'none'),
        pos ? kv('Position', `${(pos.x / 100).toFixed(1)} m, ${(pos.y / 100).toFixed(1)} m · ${pos.rotation ?? 0}°`) : null,
        h('p', { class: 'muted small-text' }, h('a', { href: '#/settings/cameras' }, 'Settings → Cameras'), ' for connection settings, jog and presets.'));
    }

    function roomSizePanel() {
      const c = canvasOf(room());
      const field = (name, label, units) => h('label', { class: 'field' }, h('span', null, label),
        h('input', { name, type: 'number', min: 1, max: 200, step: 0.1, value: (units / 100).toFixed(1), 'aria-label': `Room ${name} in metres` }));
      const form = h('form', { class: 'room-size', novalidate: true },
        h('div', { class: 'row-inline' }, field('width', 'Width (m)', c.width), field('height', 'Depth (m)', c.height)),
        h('div', { class: 'actions' },
          h('button', { type: 'submit', class: 'primary small' }, 'Apply'),
          actionButton('Fit room around items', async () => {
            const r = room();
            const pts = [...Object.values(r.seats), ...Object.values(r.cameras)];
            if (!pts.length) return toast('Nothing placed yet', 'error');
            const m = 100;
            const x = snap(Math.min(...pts.map(p => p.x)) - m), y = snap(Math.min(...pts.map(p => p.y)) - m);
            const width = Math.max(MIN_ROOM, snap(Math.max(...pts.map(p => p.x)) + m - x));
            const height = Math.max(MIN_ROOM, snap(Math.max(...pts.map(p => p.y)) + m - y));
            await api.put('/room/canvas', { x: clamp(x, -LIMIT, LIMIT), y: clamp(y, -LIMIT, LIMIT), width, height });
          }, { cls: 'small secondary' })),
        h('p', { class: 'muted small-text' }, 'Or drag the room edges and corners on the plan. Seats and cameras may also stand outside the room.'));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const val = n => Math.round(Number(form.elements.namedItem(n).value) * 100);
        const width = val('width'), height = val('height');
        if (!(width >= MIN_ROOM && width <= 20_000 && height >= MIN_ROOM && height <= 20_000)) return toast('Room size must be 1–200 m', 'error');
        try { await api.put('/room/canvas', { ...c, width, height }); toast('Room size saved', 'success'); } catch (err) { toastError(err); }
      });
      return h('section', { class: 'side-card' }, h('h2', null, 'Room size'), form);
    }

    function shotEditor(seatId) {
      const shot = room().shots[seatId];
      const camSelect = h('select', { 'aria-label': 'Camera for this seat' },
        h('option', { value: '' }, '— no camera —'),
        cameras().map(c => h('option', { value: c.id, selected: shot?.cameraId === c.id }, c.name)));
      const presetInput = h('input', { type: 'text', inputmode: 'numeric', value: shot?.preset ?? '', placeholder: 'Preset', 'aria-label': 'Preset', class: 'preset-input' });
      const presetValue = () => { const v = presetInput.value.trim(); return /^\d+$/.test(v) ? Number(v) : v; };
      const save = async () => {
        try {
          if (!camSelect.value) await api.del(`/room/shots/${encodeURIComponent(seatId)}`);
          else await api.put(`/room/shots/${encodeURIComponent(seatId)}`, { cameraId: camSelect.value, preset: presetValue() });
          toast('Shot saved', 'success');
        } catch (err) { toastError(err); }
      };
      return h('div', { class: 'shot-editor' },
        h('h3', null, 'Camera shot'),
        h('div', { class: 'row-inline' }, camSelect, presetInput),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'primary small', onclick: save }, 'Save'),
          shot ? h('button', { type: 'button', class: 'small danger-outline', title: 'Delete this seat\'s saved preset (WO-092)',
            onclick: () => api.del(`/room/shots/${encodeURIComponent(seatId)}`).then(() => toast('Preset deleted', 'success'), toastError) }, 'Delete') : null,
          h('button', { type: 'button', class: 'secondary small', title: 'Move the camera to this preset', onclick: () => camSelect.value && api.post(`/devices/cameras/${camSelect.value}/recall`, { preset: presetValue() }).catch(toastError) }, 'Test'),
          h('button', { type: 'button', class: 'secondary small', title: 'Store the camera\'s current position as this preset', onclick: async () => {
            if (!camSelect.value) return;
            try {
              const r = await api.post(`/devices/cameras/${camSelect.value}/store`, { preset: presetValue() === '' ? undefined : presetValue(), name: seats().find(x => x.id === seatId)?.name });
              presetInput.value = r.preset;
              toast(`Stored as preset ${r.preset}`, 'success');
            } catch (err) { toastError(err); }
          } }, 'Store position')),
        h('p', { class: 'muted small-text' }, 'Point the camera with the jog pad in Settings → Cameras, then “Store position”.'));
    }

    // Side panel in sections, each rebuilt only when the data it shows changes (WO-054): keeps half-typed inputs and
    // never rebuilds a PTZ pad while a button is held (a lost pointer release would leave the camera moving).
    const slots = new Map(); // `${mode}:${name}` → { el, key }
    function slot(name, key, build, force) {
      let sl = slots.get(name);
      if (!sl) { sl = { el: h('div', { class: 'side-slot' }), key: undefined }; slots.set(name, sl); }
      if (force || sl.key !== key) { replace(sl.el, build()); sl.key = key; }
      return sl.el;
    }

    /** Everything the inspector of the selected item shows. */
    function inspectorKey() {
      if (mode === 'edit' && multi.size > 1) {
        const r = room();
        return JSON.stringify(['group', [...multi], [...multi].map(id => [r?.seats?.[id], r?.shots?.[id]]), undoStack.length, (store.topic('domain.seats') ?? []).filter(x => multi.has(x.id)).map(x => x.name),
          cameras().map(c => [c.id, c.name, c.driver])]);
      }
      if (!selected) return 'none';
      const { kind, id } = selected;
      const r = room();
      const companionCfg = store.topic('devices.companion')?.config ?? null; // WO-099: the Companion section
      const common = [kind, id, mode, store.topic('permissions'), companionCfg, r?.triggers?.[kind === 'seat' ? 'seats' : 'desks']?.[id] ?? null];
      if (kind === 'seat') {
        return JSON.stringify([...common, (store.topic('domain.seats') ?? []).find(x => x.id === id),
          [...(discussion()?.speakers ?? []), ...(discussion()?.requests ?? [])].map(e => e.seatId === id && [e.kind, e.micState, e.timer?.remainingSpeechDuration]),
          store.topic('microphoneSensitivity')?.seatMicrophoneSensitivities?.find(x => x.seatId === id), store.topic('microphoneSensitivityDescription'),
          (store.topic('domain.participants') ?? []).filter(p => p.assignedSeatId === id || p.seatedSeatId === id), r?.seats?.[id], r?.shots?.[id], cameras().map(c => [c.id, c.name]),
          // Edit mode lists everyone in the participant picker (WO-084).
          mode === 'edit' ? [store.topic('domain.capabilities')?.actions?.editParticipants, (store.topic('domain.participants') ?? []).map(p => [p.id, p.name, p.assignedSeatId])] : null]);
      }
      if (kind === 'desk') {
        return JSON.stringify([...common, desks().find(d => d.seatId === id), routingOf(id), store.topic('interpretationMetaFunctionStatus'),
          store.topic('interpretationLanguages'), store.topic('interpreterBooths'), r?.desks?.[id]]);
      }
      const sw = switcher()?.status;
      return JSON.stringify([...common, cameras().find(c => c.id === id), r?.cameras?.[id], r?.shots, r?.overview, [sw?.connected, sw?.program, sw?.preview],
        director()?.onAirCamera, director()?.busy, (store.topic('domain.seats') ?? []).map(x => [x.id, x.name])]);
    }

    function renderSide(force = false) {
      if (ptzHolding()) return afterPtzHold(() => renderSide(force));
      const r = room();
      // Widgets (WO-104, DEC-030) on top; an open inspector goes above them so it is not pushed out of view.
      const inspector = slot('operate:inspector', inspectorKey(), () => (selected?.kind === 'seat' ? seatPanel(selected.id) : selected?.kind === 'desk' ? deskPanel(selected.id)
        : selected?.kind === 'camera' ? cameraPanel(selected.id)
          : h('p', { class: 'muted small-text side-hint' }, '⚙ next to an item opens its inspector; drag the ⚙ to move the item.')), force);
      const parts = mode === 'operate'
        ? [
          ...(selected ? [inspector, widgetDock.el] : [widgetDock.el, inspector]),
          slot('operate:director', JSON.stringify([director(), r?.director, r?.overview, cameras().map(c => [c.id, c.name, c.automation]), switcher()?.automation, Boolean(switcher()), (store.topic('domain.seats') ?? []).map(x => [x.id, x.name])]), directorPanel, force),
          slot('operate:speakers', JSON.stringify([discussion(), r?.shots]), speakersPanel, force),
        ]
        : [
          slot('edit:selection', JSON.stringify([inspectorKey(), selected ? null : r?.canvas]), selectionPanel, force),
          slot('edit:tray', JSON.stringify([Object.keys(r?.seats ?? {}), Object.keys(r?.cameras ?? {}), Object.keys(r?.desks ?? {}),
            (store.topic('domain.seats') ?? []).map(x => [x.id, x.name, x.hidden]), cameras().map(c => [c.id, c.name]), desks().map(d => [d.seatId, d.deskNumber, d.boothId]),
            store.topic('interpreterBooths')]), trayPanel, force),
        ];
      if (side.children.length !== parts.length || parts.some((el, i) => side.children[i] !== el)) replace(side, parts);
    }

    // ---------------------------------------------------------------- match seats to the connected system (WO-096)
    const matchBanner = h('div', { class: 'match-banner', hidden: true, role: 'status' });
    const planSeatIds = r => [...new Set([...Object.keys(r?.seats ?? {}), ...Object.keys(r?.shots ?? {})])];
    function renderMatchBanner() {
      const r = room();
      const sys = store.topic('domain.seats');
      const missing = r && sys?.length ? unmatchedSeats(planSeatIds(r), sys.map(s => s.id)) : [];
      matchBanner.hidden = !missing.length;
      if (!missing.length) return;
      const p = store.topic('project');
      replace(matchBanner,
        h('span', null, `${missing.length} seat${missing.length === 1 ? '' : 's'} on this plan ${missing.length === 1 ? 'is' : 'are'} not on the connected system`,
          p?.current?.system && p.current.system.key !== p.connected?.key ? ` (the project was made for ${p.current.system.label})` : '', '. '),
        h('button', { type: 'button', class: 'primary small', onclick: openMatchDialog }, 'Match seats…'));
    }

    async function openMatchDialog() {
      const r = room();
      const sys = store.topic('domain.seats') ?? [];
      if (!r || !sys.length) return toast('Connect to a system first: its seats are matched to the plan', 'error');
      const ids = planSeatIds(r);
      if (!ids.length) return toast('No seats on the plan yet', 'info');
      const sysName = id => sys.find(s => s.id === id)?.name;
      const plan = ids.map(id => ({ id, name: r.seatNames?.[id] ?? sysName(id) ?? id }));
      const { map, how } = proposeMatch(plan, sys);
      const p = store.topic('project');
      const relink = p?.connected && p.current?.system?.key !== p.connected.key
        ? h('input', { type: 'checkbox', checked: true, 'aria-label': `Make this the project for ${p.connected.label}` }) : null;
      const HOW = { id: 'same seat', name: 'same name', number: 'same number', order: 'in order' };
      const selects = plan.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map(seat => {
        const sel = h('select', { 'aria-label': `System seat for ${seat.name}` },
          h('option', { value: '' }, '— leave off the plan —'),
          sys.map(s => h('option', { value: s.id, selected: map[seat.id] === s.id }, s.name)));
        return [seat, sel];
      });
      const status = h('p', { class: 'small-text', 'aria-live': 'polite' });
      const apply = h('button', { value: 'ok', class: 'primary' }, 'Apply');
      const check = () => {
        const chosen = selects.map(([, s]) => s.value).filter(Boolean);
        const dup = chosen.length !== new Set(chosen).size;
        status.textContent = dup ? 'Two plan seats point at the same system seat.' : `${chosen.length} of ${plan.length} plan seats matched${plan.length - chosen.length ? `, ${plan.length - chosen.length} leave the plan` : ''}.`;
        status.classList.toggle('error-text', dup);
        apply.disabled = dup;
      };
      for (const [, s] of selects) s.addEventListener('change', check);
      const d = h('dialog', { class: 'confirm match-dialog', 'aria-label': 'Match seats' },
        h('form', { method: 'dialog' },
          h('h2', null, 'Match seats'),
          h('p', { class: 'muted small-text' }, 'Each seat on the plan (with its camera preset) moves to the chosen seat of the connected system. Proposed by name, then by seat number, then in order: check and correct.'),
          h('div', { class: 'table-wrap match-table' }, h('table', { class: 'data' },
            h('thead', null, h('tr', null, ['Plan seat', 'Seat on the system', ''].map(t => h('th', { scope: 'col' }, t)))),
            h('tbody', null, selects.map(([seat, sel]) => h('tr', null,
              h('td', null, h('strong', null, seat.name), seat.name !== seat.id ? h('small', { class: 'sub' }, seat.id) : null),
              h('td', null, sel),
              h('td', null, how[seat.id] ? h('span', { class: 'tag' }, HOW[how[seat.id]]) : null)))))),
          status,
          relink ? h('label', { class: 'check' }, relink, ` Also make "${p.current.name}" the project for ${p.connected.label}`) : null,
          h('div', { class: 'actions' }, h('button', { value: 'cancel', class: 'secondary', formnovalidate: true }, 'Cancel'), apply)));
      document.body.append(d);
      check();
      d.showModal();
      await new Promise(res => d.addEventListener('close', res, { once: true }));
      d.remove();
      if (d.returnValue !== 'ok') return;
      const remap = Object.fromEntries(selects.map(([seat, sel]) => [seat.id, sel.value || null]).filter(([from, to]) => from !== to));
      try {
        if (Object.keys(remap).length) await api.post('/room/remap', { map: remap });
        if (relink?.checked) await api.patch(`/projects/${encodeURIComponent(p.current.id)}`, { system: 'connected' });
        undoStack.length = 0; // seat ids changed: older undo entries point at the old ids
        toast(`Seats matched${relink?.checked ? ` · "${p.current.name}" is now the project for ${p.connected.label}` : ''}`, 'success');
      } catch (err) { toastError(err, 'Match seats: '); }
    }

    function renderAll() { renderToolbar(); renderMeeting(); renderCanvas(); renderSide(true); renderMatchBanner(); }

    const widgetDock = createWidgetDock(store, api); // WO-104
    el.classList.add('room-view');
    el.append(h('h1', { id: 'view-title', class: 'visually-hidden' }, 'Room'), toolbar, matchBanner, h('div', { class: 'room-body' }, stage, side));
    renderAll();
    const routed = /[?&](seat|desk)=/.test(location.hash);
    requestAnimationFrame(() => (routed ? applyRouteSelection() : autoFit ? fit() : applyView()));
    // Another project was opened (WO-057): selections and undo refer to the old project's seats.
    let projectId = store.topic('project')?.current?.id;
    const offProject = store.subscribe(['topic:project'], () => {
      const id = store.topic('project')?.current?.id;
      if (id === projectId) return;
      projectId = id;
      undoStack.length = 0;
      selected = null;
      multi = new Set();
      renderAll();
    });
    const offCompanion = store.subscribe(['topic:devices.companion'], () => renderSide()); // WO-099: inspector section only
    const off = store.subscribe(['topic:room', 'topic:domain.seats', 'topic:domain.discussion', 'topic:domain.participants', 'topic:devices.cameras',
      'topic:devices.switcher', 'topic:director', 'topic:microphoneSensitivity', 'topic:microphoneSensitivityDescription', 'topic:permissions',
      'topic:interpreterSeats', 'topic:interpreterBooths', 'topic:domain.interpreterDesks', 'topic:domain.meeting', 'topic:domain.capabilities', 'topic:interpretationRoutings', 'topic:interpretationLanguages', 'topic:interpretationMetaFunctionStatus', 'connection'], () => {
      renderMeeting();
      renderMatchBanner();
      if (pendingRoute && room()) { applyRouteSelection(); return; }
      renderCanvas();
      renderSide();
    });
    const onHash = () => { if (location.hash.startsWith('#/room')) applyRouteSelection(); };
    window.addEventListener('hashchange', onHash);
    // Keep the view centred when the stage changes size (window resize, side panel, mobile layout).
    const resizeObserver = new ResizeObserver(() => (autoFit ? fit() : applyView()));
    resizeObserver.observe(stage);
    return () => {
      off(); offProject(); offCompanion(); widgetDock.destroy(); resizeObserver.disconnect(); window.removeEventListener('hashchange', onHash);
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur);
    };
  },
};
