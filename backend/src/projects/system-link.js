// Projects follow the connected DICENTIS system (DEC-025, WO-093): when the main connection reaches a system, the
// project of that system is opened (or created). A system is identified by type + host + port; its label is the room
// name (wired) / WAP host name (wireless) when the system reports one within a few seconds, else type + host.
const TYPE_LABEL = { wired: 'DICENTIS', wireless: 'DICENTIS Wireless', dcn: 'DCN', 'dcn-smd': 'DCN' };

/**
 * Identity of a system: type + host + port; a simulated system (DEC-026) by its profile id, so its projects stay its
 * own whatever port the simulator gets.
 * @param {{ system: string, host: string, port?: number | null, simulated?: { id: string } | null }} s
 */
export const systemKey = s => (s.simulated ? `sim:${s.simulated.id}` : `${s.system}:${String(s.host ?? '').toLowerCase()}:${s.port ?? ''}`);

/** The name the system reports about itself, if any (raw topics in the cache). */
function reportedName(cache, system) {
  if (system === 'wireless') return cache.get('wirelessSystemInfo')?.data?.Hostname ?? null;
  if (system === 'wired') return cache.get('roomName')?.data?.roomName ?? null;
  return null;
}

/**
 * @param {object} deps
 * @param {import('../connection/manager.js').ConnectionManager} deps.manager
 * @param {import('./manager.js').ProjectManager} deps.projects
 * @param {import('../state/cache.js').StateCache} deps.cache
 * @param {any} deps.log
 * @param {number} [deps.nameWaitMs]  how long to wait for the system's own name
 */
export function linkProjectsToSystem({ manager, projects, cache, log, nameWaitMs = 3000 }) {
  let handled = null; // key of the system handled last: a reconnect to the same system changes nothing
  async function onStatus(status) {
    if (status.state !== 'loggedIn' || !status.host) return;
    const key = systemKey(status);
    if (key === handled) return;
    handled = key;
    if (!status.simulated) for (const end = Date.now() + nameWaitMs; !reportedName(cache, status.system) && Date.now() < end;) await new Promise(r => setTimeout(r, 100));
    if (handled !== key) return; // switched again meanwhile
    const label = status.simulated ? `${status.simulated.name} (simulated)`
      : reportedName(cache, status.system) || `${TYPE_LABEL[status.system] ?? status.system} ${status.host}`;
    try {
      const res = await projects.useSystem({ key, label, type: status.system, host: status.simulated ? null : status.host, port: status.simulated ? null : status.port ?? null, ...(status.simulated ? { simulated: true } : {}) });
      if (res.action !== 'kept') log.info(`connected to ${label}: project ${res.action}`);
    } catch (err) { log.warn(`project for ${label}: ${err.message}`); }
  }
  manager.on('status', onStatus);
  onStatus(manager.status()); // connected before the projects were loaded
  return () => manager.off('status', onStatus);
}

/**
 * The open project remembers the connected system's names of its placed seats (WO-096), so a project made on one
 * system (e.g. a simulation) can be matched to another system's seats by name. Only while the open project belongs to
 * the connected system; debounced.
 * @param {{ cache: import('../state/cache.js').StateCache, room: import('../room/store.js').RoomStore, projects: import('./manager.js').ProjectManager, log: any }} deps
 */
export function recordSeatNames({ cache, room, projects, log, delayMs = 500 }) {
  let timer = null;
  const run = () => {
    timer = null;
    const d = projects.describe();
    if (!d.current?.system || d.current.system.key !== d.connected?.key) return;
    const seats = cache.get('domain.seats')?.data;
    const r = room.get();
    if (!Array.isArray(seats) || !r) return;
    const names = Object.fromEntries(seats.filter(s => r.seats[s.id] || r.shots[s.id]).map(s => [s.id, s.name]));
    if (Object.keys(names).length) room.setSeatNames(names).catch(err => log.warn(`seat names: ${err.message}`));
  };
  const onChange = topic => { if ((topic === 'domain.seats' || topic === 'room') && !timer) timer = setTimeout(run, delayMs); };
  cache.on('change', onChange);
  return () => { cache.off('change', onChange); clearTimeout(timer); };
}
