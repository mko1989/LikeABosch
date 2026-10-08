// PTZ jog pad shared by Settings → Cameras and the room's camera inspector (WO-040, WO-054).
// Hold a button to move, release to stop; a short tap gives a small nudge. The stop is bound to the *window*, so a
// re-render that removes the button mid-hold can't leave the camera moving.
import { h, toastError } from './dom.js';

let holding = 0;
/** True while a PTZ button is held (views pause re-renders meanwhile). */
export const ptzHolding = () => holding > 0;
const released = new Set(); // callbacks run once when the current hold ends

/** Run `fn` when the current hold ends (or now if nothing is held). */
export function afterPtzHold(fn) { if (holding) released.add(fn); else fn(); }

/**
 * @param {object} opts
 * @param {{ post: Function }} opts.api
 * @param {{ id: string, name: string }} opts.cam
 * @param {boolean} [opts.compact]  smaller buttons, slower default speed (fine adjustments)
 */
export function ptzPad({ api, cam, compact = false }) {
  const move = v => api.post(`/devices/cameras/${encodeURIComponent(cam.id)}/move`, v).catch(toastError);
  const stop = () => api.post(`/devices/cameras/${encodeURIComponent(cam.id)}/stop`, {}).catch(() => {});
  const speedInput = h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: compact ? 0.25 : 0.5, 'aria-label': `${cam.name} speed` });

  const hold = (label, vector, title) => {
    const b = h('button', { type: 'button', class: 'jog', title, 'aria-label': `${title} (${cam.name})` }, label);
    let active = false;
    const end = () => {
      if (!active) return;
      active = false;
      holding = Math.max(0, holding - 1);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
      stop();
      if (!holding) { const fns = [...released]; released.clear(); fns.forEach(fn => fn()); }
    };
    const start = e => {
      e.preventDefault();
      if (active) return;
      active = true;
      holding++;
      const sp = Number(speedInput.value);
      move(Object.fromEntries(Object.entries(vector).map(([k, x]) => [k, x * sp])));
      try { b.setPointerCapture?.(e.pointerId); } catch { /* keyboard / synthetic */ }
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      window.addEventListener('blur', end);
    };
    b.addEventListener('pointerdown', e => { if (e.button === 0) start(e); });
    b.addEventListener('pointerup', end);
    b.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start(e); });
    b.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') end(); });
    return b;
  };

  return h('div', { class: ['ptz', compact && 'compact'] },
    h('div', { class: 'jog-pad', role: 'group', 'aria-label': `${cam.name} pan and tilt` },
      h('span'), hold('▲', { tilt: 1 }, 'Tilt up'), h('span'),
      hold('◀', { pan: -1 }, 'Pan left'), h('button', { type: 'button', class: 'jog stop', onclick: stop, title: 'Stop', 'aria-label': `Stop (${cam.name})` }, '■'), hold('▶', { pan: 1 }, 'Pan right'),
      h('span'), hold('▼', { tilt: -1 }, 'Tilt down'), h('span')),
    h('div', { class: 'zoom-pad' }, hold('＋', { zoom: 1 }, 'Zoom in'), hold('－', { zoom: -1 }, 'Zoom out'),
      h('label', { class: 'field' }, h('span', null, 'Speed'), speedInput)));
}
