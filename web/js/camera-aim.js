// Camera aim and coverage on the room plan (WO-103): which seat a camera shows (its last recalled preset, WO-054),
// the angle its head turns to, and one colour per camera for the seats that have a preset on it. Pure: no DOM.

/** Distinct hues that read on the light and the dark plan background. */
export const CAMERA_COLORS = ['#2f80ed', '#f2994a', '#27ae60', '#d63384', '#8e5bd8', '#0fa3b1', '#c0392b', '#7cb518'];

/**
 * Colour per camera, by its position in the configured camera list (stable while cameras are only added at the end).
 * @param {{ id: string }[]} cameras
 * @returns {Map<string, string>}
 */
export function cameraColors(cameras) {
  return new Map(cameras.map((c, i) => [c.id, CAMERA_COLORS[i % CAMERA_COLORS.length]]));
}

/** Angle in (-180, 180]. */
export function normalize(deg) {
  const d = ((deg % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/** Direction from one plan point to another in degrees (0 = +x, clockwise on screen because y grows downwards). */
export function bearing(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
}

/**
 * Head rotation relative to the camera's placed rotation so that it points at `target` (0 = home direction).
 * @param {{ x: number, y: number, rotation?: number }} cam
 * @param {{ x: number, y: number } | null} target
 */
export function relativeAim(cam, target) {
  if (!target || (target.x === cam.x && target.y === cam.y)) return 0;
  return normalize(bearing(cam, target) - (cam.rotation ?? 0));
}

/** The angle to animate to from `prev` that ends on `target` (mod 360) with the shortest turn. */
export function turnTo(prev, target) {
  return prev + normalize(target - prev);
}

/**
 * The seat a camera currently shows: a seat whose shot is (this camera, current preset). Several seats can share a
 * preset; the director's target seat wins, then the first one.
 * @param {{ id: string, currentPreset?: { preset: number | string } | null }} cam
 * @param {Record<string, { cameraId: string, preset: number | string }>} shots seat id → shot
 * @param {string | null} [preferSeatId]
 * @returns {string | null}
 */
export function aimedSeat(cam, shots, preferSeatId = null) {
  const preset = cam.currentPreset?.preset;
  if (preset === undefined || preset === null) return null;
  const match = id => shots[id]?.cameraId === cam.id && String(shots[id].preset) === String(preset);
  if (preferSeatId && match(preferSeatId)) return preferSeatId;
  return Object.keys(shots ?? {}).find(match) ?? null;
}
