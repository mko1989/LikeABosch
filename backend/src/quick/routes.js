// Quick actions for Bitfocus Companion and other control surfaces (WO-117, DEC-035): seat microphones on / off / toggle,
// requests, priority, all off, next speaker, with a compact state and a compact live stream. Works on every system the
// domain layer supports (wired, wireless, CCS 1000 D, DCN). No JSON body needed: a URL is enough for Companion's
// Generic HTTP module.
//   GET  /api/quick                              compact state (connection, seats with mic state, speakers, requests)
//   GET  /api/quick/events                       SSE: `state` (the same compact state) on every change
//   GET  /api/quick/seats/:seat                  one seat
//   POST /api/quick/seats/:seat/mic/:action      on | off | toggle   (on also unmutes a muted speaker; toggle: speaker → off)
//   POST /api/quick/seats/:seat/request/:action  on | off | toggle
//   POST /api/quick/seats/:seat/priority/:action on | off | toggle
//   POST /api/quick/mics/off                     every speaker off (requests stay)
//   POST /api/quick/requests/clear               every request removed
//   POST /api/quick/discussion/clear             speakers and requests
//   POST /api/quick/next                         first request gets the floor
// :seat = the seat id, else the seat name (case-insensitive), else its position (1 = first seat in the list).
import express from 'express';
import { AppError, ok } from '../lib/errors.js';

const SYSTEM_NAME = { wired: 'DICENTIS', wireless: 'DICENTIS Wireless', dcn: 'DCN', 'dcn-smd': 'DCN (meeting data)', ccs1000: 'CCS 1000 D' };
const ACTIONS = new Set(['on', 'off', 'toggle']);

/**
 * @typedef {{ number: number, id: string, name: string, person: string, connected: boolean, mic: 'on' | 'muted' | 'request' | 'off',
 *   priority: boolean, canPrio: boolean, requestPosition: number | null }} QuickSeat
 */

/** Compact state from the domain topics (pure; exported for tests). */
export function quickState({ seats = [], discussion = null, connection = {}, latest = null }) {
  const speakers = discussion?.speakers ?? [];
  const requests = discussion?.requests ?? [];
  const speakerOf = new Map(speakers.map(s => [s.seatId, s]));
  const requestAt = new Map(requests.map((r, i) => [r.seatId, i + 1]));
  /** @type {QuickSeat[]} */
  const list = seats.map((s, i) => {
    const sp = speakerOf.get(s.id);
    return {
      number: i + 1, id: s.id, name: s.name, person: s.person ?? '', connected: Boolean(s.connected),
      mic: sp ? (sp.micState === 'on' ? 'on' : 'muted') : requestAt.has(s.id) ? 'request' : 'off',
      priority: Boolean(sp?.priority), canPrio: Boolean(s.canPrio), requestPosition: requestAt.get(s.id) ?? null,
    };
  });
  const label = s => (s ? { id: s.id, name: s.name, person: s.person } : null);
  const byId = new Map(list.map(s => [s.id, s]));
  return {
    connected: connection.state === 'loggedIn', state: connection.state ?? 'disconnected',
    system: connection.system ?? null, systemName: SYSTEM_NAME[connection.system] ?? connection.system ?? null,
    seats: list,
    speakers: speakers.map(s => s.seatId),
    requests: requests.map(r => r.seatId),
    latestSpeaker: label(byId.get(latest)) ?? null,
    firstRequest: label(byId.get(requests[0]?.seatId)) ?? null,
  };
}

/** Resolve a seat reference: id, else name (case-insensitive), else 1-based position. */
export function findSeat(seats, ref) {
  const key = String(ref ?? '').trim();
  const lower = key.toLowerCase();
  return seats.find(s => s.id === key) ?? seats.find(s => s.name.trim().toLowerCase() === lower)
    ?? (/^\d+$/.test(key) ? seats[Number(key) - 1] : undefined) ?? null;
}

/**
 * @param {object} deps
 * @param {import('../connection/manager.js').ConnectionManager} deps.manager
 * @param {import('../state/cache.js').StateCache} deps.cache
 * @param {ReturnType<import('../domain/actions.js').createDomainActions>} deps.actions
 */
export function createQuickRouter({ manager, cache, actions }) {
  const router = express.Router();
  const { discussion } = actions;

  // Latest speaker: the seat that joined the speakers last (Companion variable "latest speaker").
  let latest = null;
  let previous = new Set();
  const onChange = topic => {
    if (topic !== 'domain.discussion') return;
    const now = (cache.get('domain.discussion')?.data?.speakers ?? []).map(s => s.seatId);
    const added = now.filter(id => !previous.has(id));
    if (added.length) latest = added.at(-1);
    else if (!now.includes(latest)) latest = now.at(-1) ?? null;
    previous = new Set(now);
  };
  cache.on('change', onChange);

  const state = () => quickState({
    seats: cache.get('domain.seats')?.data ?? [], discussion: cache.get('domain.discussion')?.data ?? null,
    connection: manager.status(), latest,
  });
  const seatOf = ref => {
    const st = state();
    if (!st.connected) throw new AppError('NOT_CONNECTED', 'Not connected to a discussion system');
    const seat = findSeat(st.seats, ref);
    if (!seat) throw new AppError('NOT_FOUND', `Seat '${ref}' not found (use the seat id, its name or its number)`);
    return seat;
  };
  const action = req => {
    const a = req.params.action;
    if (!ACTIONS.has(a)) throw new AppError('NOT_FOUND', `Unknown action '${a}': use on, off or toggle`);
    return a;
  };
  const reply = (res, seat, did) => res.json(ok({ seat: seat.id, name: seat.name, did }));

  router.get('/', (_req, res) => res.json(ok(state())));

  router.get('/events', (req, res) => {
    res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.flushHeaders?.();
    let timer = null;
    const send = () => { timer = null; res.write(`event: state\ndata: ${JSON.stringify(state())}\n\n`); };
    const soon = () => { timer ??= setTimeout(send, 30); };
    const onTopic = topic => { if (topic === 'domain.discussion' || topic === 'domain.seats') soon(); };
    cache.on('change', onTopic);
    cache.on('unavailable', onTopic);
    manager.on('status', soon);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    send();
    req.on('close', () => {
      clearTimeout(timer);
      clearInterval(ping);
      cache.off('change', onTopic);
      cache.off('unavailable', onTopic);
      manager.off('status', soon);
    });
  });

  router.get('/seats/:seat', (req, res) => res.json(ok(seatOf(req.params.seat))));

  router.post('/seats/:seat/mic/:action', async (req, res) => {
    const seat = seatOf(req.params.seat);
    const a = action(req);
    const speaking = seat.mic === 'on' || seat.mic === 'muted';
    const turnOn = a === 'on' || (a === 'toggle' && !speaking);
    if (turnOn && !speaking) await discussion.addSpeaker(seat.id);
    if (a === 'on' && seat.mic === 'muted') await discussion.mute(seat.id, false); // a muted speaker (wired Response mode)
    if (!turnOn && speaking) await discussion.removeSpeaker(seat.id);
    reply(res, seat, turnOn ? 'on' : 'off');
  });

  router.post('/seats/:seat/request/:action', async (req, res) => {
    const seat = seatOf(req.params.seat);
    const a = action(req);
    const waiting = seat.mic === 'request';
    const add = a === 'on' || (a === 'toggle' && !waiting);
    if (add && !waiting) await discussion.addRequest(seat.id);
    if (!add && waiting) await discussion.removeRequest(seat.id);
    reply(res, seat, add ? 'request' : 'no request');
  });

  router.post('/seats/:seat/priority/:action', async (req, res) => {
    const seat = seatOf(req.params.seat);
    const a = action(req);
    const on = a === 'on' || (a === 'toggle' && !seat.priority);
    if (on !== seat.priority) await discussion.setPriority(seat.id, on);
    reply(res, seat, on ? 'priority on' : 'priority off');
  });

  /** One write per seat, in order; stops at the first refusal. */
  const each = async (ids, fn) => { for (const id of ids) await fn(id); };

  router.post('/mics/off', async (_req, res) => {
    const st = state();
    if (!st.connected) throw new AppError('NOT_CONNECTED', 'Not connected to a discussion system');
    await each(st.speakers, id => discussion.removeSpeaker(id));
    res.json(ok({ off: st.speakers.length }));
  });

  router.post('/requests/clear', async (_req, res) => {
    const st = state();
    if (!st.connected) throw new AppError('NOT_CONNECTED', 'Not connected to a discussion system');
    await each(st.requests, id => discussion.removeRequest(id));
    res.json(ok({ removed: st.requests.length }));
  });

  router.post('/discussion/clear', async (_req, res) => {
    const st = state();
    if (!st.connected) throw new AppError('NOT_CONNECTED', 'Not connected to a discussion system');
    try {
      await discussion.clear();
    } catch (err) {
      if (err.code !== 'NOT_SUPPORTED') throw err;
      // Systems without one "clear" (wired): every speaker and request on its own.
      await each(st.speakers, id => discussion.removeSpeaker(id));
      await each(st.requests, id => discussion.removeRequest(id));
    }
    res.json(ok({ speakers: st.speakers.length, requests: st.requests.length }));
  });

  router.post('/next', async (_req, res) => {
    const st = state();
    if (!st.connected) throw new AppError('NOT_CONNECTED', 'Not connected to a discussion system');
    const first = st.requests[0];
    if (!first) throw new AppError('VALIDATION', 'Nobody is waiting');
    await discussion.addSpeaker(first);
    res.json(ok({ seat: first }));
  });

  router.close = () => cache.off('change', onChange);
  return router;
}
