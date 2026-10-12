// Domain actions shared by the domain routes (DEC-010) and the quick-actions API for Bitfocus Companion (DEC-035):
// `run()` dispatches to the connected system's implementation; the discussion actions are the system-specific writes.
import { AppError } from '../lib/errors.js';
import { capabilities } from './mappers.js';

const SYSTEM_LABEL = { wired: 'DICENTIS', wireless: 'DICENTIS Wireless', dcn: 'DCN', 'dcn-smd': 'DCN', ccs1000: 'CCS 1000 D' };

/**
 * @param {object} deps
 * @param {import('../connection/manager.js').ConnectionManager} deps.manager
 * @param {import('../state/cache.js').StateCache} deps.cache
 * @param {import('../wireless/poller.js').WirelessPoller} deps.poller
 * @param {import('../dcn/events.js').DcnEventBridge} [deps.dcnEvents]
 */
export function createDomainActions({ manager, cache, poller, dcnEvents }) {
  const notSupported = what => new AppError('NOT_SUPPORTED', `${what} is not supported by the connected ${SYSTEM_LABEL[manager.system] ?? manager.system} system`);
  const features = () => capabilities(manager.system).features;
  const wirelessId = id => {
    if (!/^\d+$/.test(id)) throw new AppError('VALIDATION', `Wireless seat ids are integers (got "${id}")`);
    return Number(id);
  };
  const dcnSeat = id => {
    if (!/^\d+$/.test(id)) throw new AppError('VALIDATION', `DCN seat ids are integers (got "${id}")`);
    return { participantId: 0, seatId: Number(id) };
  };
  /**
   * One DCN-SW API call, then refresh what it changed (DCN may not echo events to the caller).
   * `args` is a function so DCN-only validation (integer seat ids) runs only when a DCN system is connected.
   */
  const dcnCall = (key, args = () => ({})) => async c => {
    const a = args();
    await c.request(key, a);
    await dcnEvents?.operationSucceeded(key, a);
  };

  /**
   * Run the system-specific implementation.
   * @param {{ wired?: Function | null, wireless?: Function | null, dcn?: Function | null, ccs1000?: Function | null }} impl
   */
  async function run(impl) {
    const { wired, wireless, dcn } = impl;
    const ccs = 'ccs1000' in impl ? impl.ccs1000 : wireless;
    const w = manager.wiredClient;
    const wl = manager.wirelessClient;
    const cc = manager.ccs1000Client;
    const d = manager.dcnClient;
    if (manager.dcnSmdClient) {
      throw new AppError('NOT_SUPPORTED', 'The DCN meeting data stream (DCN-SWSMD) is read-only: LikeABosch can follow the meeting but not operate it');
    }
    if (d?.state === 'loggedIn') {
      if (!dcn) throw notSupported('This action');
      await dcn(d);
    } else if (w?.state === 'loggedIn') {
      if (!wired) throw notSupported('This action');
      await wired(w);
    } else if (wl?.state === 'loggedIn') {
      if (!wireless) throw notSupported('This action');
      await wireless(wl);
      await poller.refreshAll(); // no events on wireless: refresh so SSE carries the result right away
    } else if (cc?.state === 'loggedIn') {
      if (!ccs) throw notSupported('This action');
      await ccs(cc);
      await poller.refreshAll();
    } else {
      throw new AppError('NOT_CONNECTED', 'Not connected to a DICENTIS system');
    }
  }

  // ---------------------------------------------------------------- discussion
  const discussion = {
    /** Add to the speakers / give the floor. */
    addSpeaker: seatId => run({
      wired: c => c.request('AddSeatToSpeakers', { seatId }),
      wireless: c => c.request('POST', '/speakers', { body: [wirelessId(seatId)] }),
      dcn: dcnCall('control.DiscussionApi.SpeakNow', () => dcnSeat(seatId)),
    }),
    /** Remove from the speakers (incl. a wireless priority call). */
    removeSpeaker: seatId => run({
      wired: c => c.request('RemoveSeatFromDiscussionList', { seatId }),
      wireless: c => {
        const prio = cache.get('wirelessSpeakers')?.data?.find(e => String(e.id) === seatId && e.prioOn);
        return c.request('DELETE', `${prio ? '/priority' : '/speakers'}/${wirelessId(seatId)}`);
      },
      dcn: dcnCall('control.DiscussionApi.StopSpeaking', () => dcnSeat(seatId)),
    }),
    addRequest: seatId => run({
      wireless: c => c.request('POST', '/waiting-list', { body: [wirelessId(seatId)] }).catch(err => {
        // The WAP answers a bare 500 when its discussion mode (Override, Voice, PTT) has no waiting list (WO-075).
        if (err.extra?.status === 500) {
          throw new AppError('UPSTREAM_ERROR', 'The WAP refused the request: the waiting list is only available in discussion mode "Open" (WAP web UI → Prepare)', err.extra);
        }
        throw err;
      }),
      dcn: dcnCall('control.DiscussionApi.AppendRequestToSpeak', () => dcnSeat(seatId)),
    }),
    removeRequest: seatId => run({
      wired: c => c.request('RemoveSeatFromDiscussionList', { seatId }),
      wireless: c => c.request('DELETE', `/waiting-list/${wirelessId(seatId)}`),
      dcn: c => {
        const respond = cache.get('dcnRequestsToRespond')?.data?.some(p => String(p.SeatId) === seatId);
        return dcnCall(`control.DiscussionApi.${respond ? 'RemoveRequestToRespond' : 'RemoveRequestToSpeak'}`, () => dcnSeat(seatId))(c);
      },
    }),
    /** Microphone mute / unmute of a speaker (wired, Response mode). */
    mute: (seatId, muted) => run({ wired: c => c.request(muted ? 'DeactivateMicrophone' : 'ActivateMicrophone', { seatId }) }),
    speechTime: (seatId, op) => run({ wired: c => c.request(op, { seatId }) }),
    /** Speakers + requests cleared (wireless: priority calls stay, mic off). */
    clear: () => run({ wireless: c => c.request('DELETE', '/speakers'), dcn: dcnCall('control.DiscussionApi.CancelAll') }),
    setPriority: (seatId, on) => run({
      wireless: c => (on ? c.request('POST', '/priority', { body: [wirelessId(seatId)] }) : c.request('DELETE', `/priority/${wirelessId(seatId)}`)),
      dcn: dcnCall('control.DiscussionApi.SetChairmanPriority', () => ({ ...dcnSeat(seatId), priorityStatus: on })),
    }),
  };

  return { run, notSupported, features, wirelessId, dcnSeat, dcnCall, discussion };
}
