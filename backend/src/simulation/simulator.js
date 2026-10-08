// Simulated DICENTIS systems (WO-095, DEC-026): the mocks used by the tests, started inside the backend on 127.0.0.1,
// so a room, cameras and participants can be prepared without hardware. A profile = { id, name, type, seats }.
import { randomBytes } from 'node:crypto';
import { createMockWiredServer } from '../../../mock/wired/server.js';
import { createMockWirelessServer } from '../../../mock/wireless/server.js';
import { createMockDcnBridge } from '../../../mock/dcn/server.js';
import { createMockSmdServer } from '../../../mock/dcn-smd/server.js';
import { createLinkedDcnmBridge } from '../../../mock/dcnm/wired-link.js';

export const SIM_TYPES = ['wired', 'wireless', 'dcn', 'dcn-smd'];
export const MAX_SIM_SEATS = 500;

/** @typedef {{ id: string, name: string, type: 'wired' | 'wireless' | 'dcn' | 'dcn-smd', seats: number, fullApi?: boolean }} SimProfile */

/** Wired: also simulate the full DICENTIS API (dicentis-bridge) unless switched off (WO-101, DEC-029 §4). */
export const simFullApi = p => p.type === 'wired' && p.fullApi !== false;

/** @param {unknown} p */
export function validProfile(p) {
  return Boolean(p) && typeof p === 'object' && typeof p.id === 'string' && /^[a-z0-9-]{1,40}$/.test(p.id)
    && typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 80
    && SIM_TYPES.includes(p.type) && Number.isInteger(p.seats) && p.seats >= 1 && p.seats <= MAX_SIM_SEATS
    && (p.fullApi === undefined || typeof p.fullApi === 'boolean');
}

export const newProfileId = () => `sim-${randomBytes(4).toString('hex')}`;

/**
 * Start a simulated system. Returns the connection settings to use instead of the configured ones, and close().
 * @param {SimProfile} profile
 * @returns {Promise<{ settings: Record<string, unknown>, close: () => Promise<void> }>}
 */
export async function startSimulator(profile) {
  const user = 'admin';
  const password = 'admin';
  const base = { host: '127.0.0.1', user, password, system: profile.type };
  if (profile.type === 'wired') {
    const mock = await createMockWiredServer({ seatCount: profile.seats, roomName: profile.name, users: { [user]: password } });
    const dcnm = simFullApi(profile) ? await createLinkedDcnmBridge(mock, { users: { [user]: password } }) : null;
    const full = dcnm ? { dcnmBridge: true, dcnmHost: '127.0.0.1', dcnmPort: dcnm.port, dcnmDevice: 'LikeABosch', dcnmServer: '', bridgeToken: '' } : { dcnmBridge: false };
    return { settings: { ...base, port: mock.port, tlsInsecure: true, ...full }, close: async () => { await dcnm?.close(); await mock.close(); } };
  }
  if (profile.type === 'wireless') {
    const mock = await createMockWirelessServer({ seatCount: profile.seats, hostname: profile.name, users: { [user]: password }, longPollMs: 20_000 });
    return { settings: { ...base, port: mock.port }, close: () => mock.close() };
  }
  if (profile.type === 'dcn') {
    const mock = await createMockDcnBridge({ seats: profile.seats, users: { [user]: password }, authDelayMs: 10 });
    return { settings: { ...base, port: mock.port, bridgeToken: mock.token, smdStream: false }, close: () => mock.close() };
  }
  const mock = await createMockSmdServer({ seats: profile.seats });
  return { settings: { ...base, port: mock.port, user: '' }, close: () => mock.close() };
}
