// Pure decision logic of the camera director (WO-039, DEC-012 §4). No I/O: unit-tested directly.

/**
 * Update the activation order from the current speaker list.
 * Only speakers with the microphone **on** count as active; new ones are appended (most recent last).
 * @param {string[]} order       previous activation order (seat ids)
 * @param {{ seatId: string, micState: string }[]} speakers
 * @returns {string[]}
 */
export function updateOrder(order, speakers) {
  const active = new Set(speakers.filter(s => s.micState === 'on').map(s => s.seatId));
  const kept = order.filter(id => active.has(id));
  for (const s of speakers) if (s.micState === 'on' && !kept.includes(s.seatId)) kept.push(s.seatId);
  return kept;
}

/**
 * Which seat should be on camera: priority speakers override (most recent priority), else the last activated
 * mic; null when nobody is speaking (→ overview).
 * @param {string[]} order
 * @param {{ seatId: string, micState: string, priority?: boolean }[]} speakers
 */
export function targetSeat(order, speakers) {
  const prio = new Set(speakers.filter(s => s.priority && s.micState === 'on').map(s => s.seatId));
  const prioOrdered = order.filter(id => prio.has(id));
  if (prioOrdered.length) return prioOrdered.at(-1);
  return order.at(-1) ?? null;
}

/**
 * The shot for a seat (or the overview when the seat has none / nobody speaks).
 * @returns {{ seatId: string | null, cameraId: string, preset: number | string, overview: boolean } | null}
 */
export function shotFor(seatId, room) {
  const s = seatId ? room.shots?.[seatId] : null;
  if (s) return { seatId, cameraId: s.cameraId, preset: s.preset, overview: false };
  if (room.overview) return { seatId, cameraId: room.overview.cameraId, preset: room.overview.preset, overview: true };
  return null;
}

/**
 * The room as the automatic director sees it (DEC-015): shots and the overview on cameras whose automation is off
 * are left out, so such seats fall back to the overview like seats without a shot.
 * @param {{ shots?: Record<string, {cameraId: string, preset: any}>, overview?: {cameraId: string, preset: any} | null }} room
 * @param {(cameraId: string) => boolean} usable
 */
export function automaticRoom(room, usable) {
  const shots = Object.fromEntries(Object.entries(room.shots ?? {}).filter(([, s]) => usable(s.cameraId)));
  return { ...room, shots, overview: room.overview && usable(room.overview.cameraId) ? room.overview : null };
}

/**
 * Plan the steps to put `target` on program.
 * @param {object} p
 * @param {{ cameraId: string, preset: any }} p.target
 * @param {string | null} p.onAirCamera       camera currently on program (null = unknown/other source)
 * @param {Record<string, any>} p.cameraPreset camera → preset it was last sent to
 * @param {{ cameraId: string, preset: any } | null} p.overview
 * @param {'safe' | 'live'} p.strategy
 * @param {boolean} [p.cuts]  false = switcher automation off (DEC-015): only move cameras, never the on-air one in safe mode
 * @returns {{ step: 'recall' | 'cut' | 'wait', cameraId: string, preset?: any }[]}
 */
export function plan({ target, onAirCamera, cameraPreset, overview, strategy, cuts = true }) {
  const needsMove = cameraPreset[target.cameraId] !== target.preset;
  if (!cuts) {
    if (!needsMove || (strategy === 'safe' && onAirCamera === target.cameraId)) return [];
    return [{ step: 'recall', cameraId: target.cameraId, preset: target.preset }];
  }
  const steps = [];
  if (!needsMove) {
    if (onAirCamera !== target.cameraId) steps.push({ step: 'cut', cameraId: target.cameraId });
    return steps;
  }
  const targetLive = onAirCamera === target.cameraId;
  if (strategy === 'safe' && targetLive && overview && overview.cameraId !== target.cameraId) {
    // Never move the camera on program: go to the overview camera first (recall its preset if it isn't there).
    if (cameraPreset[overview.cameraId] !== overview.preset) {
      steps.push({ step: 'recall', cameraId: overview.cameraId, preset: overview.preset }, { step: 'wait', cameraId: overview.cameraId });
    }
    steps.push({ step: 'cut', cameraId: overview.cameraId });
  }
  steps.push({ step: 'recall', cameraId: target.cameraId, preset: target.preset });
  if (strategy === 'safe' && (targetLive || onAirCamera !== target.cameraId)) steps.push({ step: 'wait', cameraId: target.cameraId });
  if (onAirCamera !== target.cameraId || (strategy === 'safe' && targetLive && overview && overview.cameraId !== target.cameraId)) {
    steps.push({ step: 'cut', cameraId: target.cameraId });
  }
  return steps;
}
