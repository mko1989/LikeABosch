// Domain actions (WO-017, DEC-010): system-independent writes, translated to the connected system.
// All return the standard envelope; data is null. Live results arrive via the `domain.*` topics (SSE).
//   POST   /api/domain/discussion/speakers            { seatId }   add / give the floor
//   DELETE /api/domain/discussion/speakers/:seatId                 remove from speakers (incl. priority call)
//   POST   /api/domain/discussion/requests            { seatId }   put on the request list (wireless)
//   DELETE /api/domain/discussion/requests/:seatId                 remove a request
//   POST   /api/domain/discussion/speakers/:seatId/mute | unmute   (wired, Response mode)
//   POST   /api/domain/discussion/speakers/:seatId/time/:action    increase | decrease | reset speech time (wired 6.50)
//   DELETE /api/domain/discussion                                  clear speakers + requests (wireless)
//   POST   /api/domain/discussion/priority/:seatId | DELETE …     priority call on/off (wireless)
//   PUT    /api/domain/power                          { state: on | off | standby }
//   POST   /api/domain/voting/:action                 open | hold | resume | close | abort | accept | reject
//   PUT    /api/domain/voting/parameters              { subject?, mode? } (wireless)
//   POST   /api/domain/meeting/start                  { meetingId }  wired: activate + open; dcn: meeting + its first session (WO-072)
//   POST   /api/domain/meeting/stop                                  wired: close; dcn: session + meeting
//   POST   /api/domain/participants                   { name, seatId?, nfc? } → { id }   (DEC-023, wireless)
//   PUT    /api/domain/participants/:id               { name?, seatId?, nfc? }  seatId null = no seat
//   DELETE /api/domain/participants/:id
//   PUT    /api/domain/seats/:seatId/participant      { participantId | null }  frees the seat from its holder first
//   GET    /api/domain/participants/export.xlsx       workbook: Participants + Seats (WO-085, every system)
//   POST   /api/domain/participants/import?apply=0|1&remove=0|1   raw .xlsx / .csv body → { plan, result? }
// DCN (WO-062): seat ids are DCN seat numbers; calls go to control.DiscussionApi / control.VoteApi with participantId 0.
import express from 'express';
import { AppError, ok } from '../lib/errors.js';
import { capabilities } from './mappers.js';
import { applyImport, exportSheets, planImport } from './participants-io.js';
import { readTable, writeXlsx } from '../lib/xlsx.js';

const WIRED_VOTING = { open: 'OpenVoting', hold: 'HoldVoting', resume: 'ResumeVoting', close: 'CloseVoting', abort: 'AbortVoting', accept: 'AcceptVoting', reject: 'RejectVoting' };
const WIRELESS_VOTING = { open: 1, hold: 2, resume: 1, close: 0 };
const WIRELESS_POWER = { on: 0, standby: 1, off: 2 };
const DCN_VOTING = { hold: 'control.VoteApi.HoldVoting', resume: 'control.VoteApi.ContinueVoting', close: 'control.VoteApi.StopVoting' };

/**
 * @param {object} deps
 * @param {import('../connection/manager.js').ConnectionManager} deps.manager
 * @param {import('../state/cache.js').StateCache} deps.cache
 * @param {import('../wireless/poller.js').WirelessPoller} deps.poller
 * @param {import('../dcn/events.js').DcnEventBridge} [deps.dcnEvents]
 */
export function createDomainRouter({ manager, cache, poller, dcnEvents }) {
  const router = express.Router();

  const notSupported = what => new AppError('NOT_SUPPORTED', `${what} is not supported by the connected ${manager.system} system`);
  const features = () => capabilities(manager.system).features;
  const seatParam = req => {
    const id = req.params.seatId ?? req.body?.seatId;
    if (typeof id !== 'string' && typeof id !== 'number') throw new AppError('VALIDATION', 'seatId is required');
    return String(id);
  };
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

  /** Run the system-specific implementation. */
  async function run({ wired, wireless, dcn }) {
    const w = manager.wiredClient;
    const wl = manager.wirelessClient;
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
    } else {
      throw new AppError('NOT_CONNECTED', 'Not connected to a DICENTIS system');
    }
  }
  const done = res => res.json(ok(null));

  router.get('/capabilities', (_req, res) => res.json(ok(cache.get('domain.capabilities')?.data ?? null)));

  router.post('/discussion/speakers', async (req, res) => {
    const seatId = seatParam(req);
    await run({
      wired: c => c.request('AddSeatToSpeakers', { seatId }),
      wireless: c => c.request('POST', '/speakers', { body: [wirelessId(seatId)] }),
      dcn: dcnCall('control.DiscussionApi.SpeakNow', () => dcnSeat(seatId)),
    });
    done(res);
  });

  router.delete('/discussion/speakers/:seatId', async (req, res) => {
    const seatId = seatParam(req);
    await run({
      wired: c => c.request('RemoveSeatFromDiscussionList', { seatId }),
      wireless: c => {
        const prio = cache.get('wirelessSpeakers')?.data?.find(e => String(e.id) === seatId && e.prioOn);
        return c.request('DELETE', `${prio ? '/priority' : '/speakers'}/${wirelessId(seatId)}`);
      },
      dcn: dcnCall('control.DiscussionApi.StopSpeaking', () => dcnSeat(seatId)),
    });
    done(res);
  });

  router.post('/discussion/requests', async (req, res) => {
    const seatId = seatParam(req);
    await run({
      wireless: c => c.request('POST', '/waiting-list', { body: [wirelessId(seatId)] }).catch(err => {
        // The WAP answers a bare 500 when its discussion mode (Override, Voice, PTT) has no waiting list (WO-075).
        if (err.extra?.status === 500) {
          throw new AppError('UPSTREAM_ERROR', 'The WAP refused the request: the waiting list is only available in discussion mode "Open" (WAP web UI → Prepare)', err.extra);
        }
        throw err;
      }),
      dcn: dcnCall('control.DiscussionApi.AppendRequestToSpeak', () => dcnSeat(seatId)),
    });
    done(res);
  });

  router.delete('/discussion/requests/:seatId', async (req, res) => {
    const seatId = seatParam(req);
    await run({
      wired: c => c.request('RemoveSeatFromDiscussionList', { seatId }),
      wireless: c => c.request('DELETE', `/waiting-list/${wirelessId(seatId)}`),
      dcn: c => {
        const respond = cache.get('dcnRequestsToRespond')?.data?.some(p => String(p.SeatId) === seatId);
        return dcnCall(`control.DiscussionApi.${respond ? 'RemoveRequestToRespond' : 'RemoveRequestToSpeak'}`, () => dcnSeat(seatId))(c);
      },
    });
    done(res);
  });

  for (const [action, op] of [['mute', 'DeactivateMicrophone'], ['unmute', 'ActivateMicrophone']]) {
    router.post(`/discussion/speakers/:seatId/${action}`, async (req, res) => {
      const seatId = seatParam(req);
      await run({ wired: c => c.request(op, { seatId }) });
      done(res);
    });
  }

  // Speech time of a speaker (DICENTIS 6.50: Increase/Decrease/ResetSpeechTime).
  const SPEECH_TIME = { increase: 'IncreaseSpeechTime', decrease: 'DecreaseSpeechTime', reset: 'ResetSpeechTime' };
  router.post('/discussion/speakers/:seatId/time/:action', async (req, res) => {
    const seatId = seatParam(req);
    const opName = SPEECH_TIME[req.params.action];
    if (!opName) throw new AppError('NOT_FOUND', `Unknown speech time action '${req.params.action}'`);
    await run({ wired: c => c.request(opName, { seatId }) });
    done(res);
  });

  router.delete('/discussion', async (_req, res) => {
    await run({ wireless: c => c.request('DELETE', '/speakers'), dcn: dcnCall('control.DiscussionApi.CancelAll') });
    done(res);
  });

  router.post('/discussion/priority/:seatId', async (req, res) => {
    const seatId = seatParam(req);
    await run({
      wireless: c => c.request('POST', '/priority', { body: [wirelessId(seatId)] }),
      dcn: dcnCall('control.DiscussionApi.SetChairmanPriority', () => ({ ...dcnSeat(seatId), priorityStatus: true })),
    });
    done(res);
  });

  router.delete('/discussion/priority/:seatId', async (req, res) => {
    const seatId = seatParam(req);
    await run({
      wireless: c => c.request('DELETE', `/priority/${wirelessId(seatId)}`),
      dcn: dcnCall('control.DiscussionApi.SetChairmanPriority', () => ({ ...dcnSeat(seatId), priorityStatus: false })),
    });
    done(res);
  });

  router.put('/power', async (req, res) => {
    const state = req.body?.state;
    if (!['on', 'off', 'standby'].includes(state)) throw new AppError('VALIDATION', 'state must be on, off or standby');
    await run({
      wired: state === 'standby' ? null : c => c.request('SetSystemPowerMode', { powerMode: state === 'on' ? 'poweredOn' : 'poweredOff' }),
      wireless: c => c.request('PUT', '/system/status', { body: { state: WIRELESS_POWER[state] } }),
    });
    done(res);
  });

  router.post('/voting/:action', async (req, res) => {
    const { action } = req.params;
    if (!(action in WIRED_VOTING)) throw new AppError('NOT_FOUND', `Unknown voting action '${action}'`);
    await run({
      wired: c => c.request(WIRED_VOTING[action]),
      wireless: action in WIRELESS_VOTING ? c => c.request('PUT', '/voting/state', { body: { state: WIRELESS_VOTING[action] } }) : null,
      dcn: action === 'open' ? c => {
        // DCN starts a voting by id: the selected one (VotingSelect) or the active one.
        const votingId = cache.get('dcnVoting')?.data?.votingId ?? cache.get('dcnActiveVoting')?.data?.votingId;
        if (!votingId) throw new AppError('VALIDATION', 'No voting selected: select one from the voting script first');
        return dcnCall('control.VoteApi.StartVotingById', () => ({ votingId }))(c);
      } : DCN_VOTING[action] ? dcnCall(DCN_VOTING[action]) : null,
    });
    done(res);
  });

  router.put('/voting/parameters', async (req, res) => {
    if (!features().votingParameters) throw notSupported('Voting parameters');
    const { subject, mode } = req.body ?? {};
    const body = {};
    if (subject !== undefined) body.subject = String(subject);
    if (mode !== undefined) {
      if (!Number.isInteger(mode) || mode < 0 || mode > 5) throw new AppError('VALIDATION', 'mode must be 0..5');
      body.mode = mode;
    }
    await run({ wireless: c => c.request('PUT', '/voting', { body }) });
    done(res);
  });

  // ---------------------------------------------------------------- meeting (Room top bar, WO-072)
  const activeWired = () => (cache.get('meetings')?.data?.meetings ?? []).find(m => ['activated', 'opened', 'closed'].includes(m.state)) ?? null;

  router.post('/meeting/start', async (req, res) => {
    const meetingId = req.body?.meetingId;
    if (typeof meetingId !== 'string' && typeof meetingId !== 'number') throw new AppError('VALIDATION', 'meetingId is required');
    await run({
      wired: async c => {
        const target = (cache.get('meetings')?.data?.meetings ?? []).find(m => m.meetingId === String(meetingId));
        if (!target) throw new AppError('VALIDATION', `Meeting '${meetingId}' does not exist`);
        const other = activeWired();
        if (other && other.meetingId !== target.meetingId) throw new AppError('VALIDATION', `"${other.title}" is active: stop it first`);
        if (!other) await c.request('ActivateMeeting', { meetingId: target.meetingId });
        await c.request('OpenMeeting'); // no effect when activation already opened it (autoOpenOnActivate)
      },
      dcn: async c => {
        const id = Number(meetingId);
        if (!Number.isInteger(id)) throw new AppError('VALIDATION', `DCN meeting ids are integers (got "${meetingId}")`);
        const activeId = cache.get('dcnActiveMeeting')?.data?.meetingId ?? null;
        if (activeId && activeId !== id) throw new AppError('VALIDATION', `Meeting ${activeId} is running: stop it first`);
        if (!activeId) await c.request('control.MeetingApi.StartMeetingById', { meetingId: id });
        // Its first session too (user decision, WO-072): the voting script belongs to a session.
        if (!cache.get('dcnActiveSession')?.data?.sessionId) {
          const out = await c.request('config.MeetingApi.RetrieveMeetingSessions', { meetingId: id });
          const first = out?.sessionIds?.[0];
          if (first) await c.request('control.MeetingApi.StartSessionById', { sessionId: first });
        }
        await dcnEvents?.operationSucceeded('control.MeetingApi.StartMeetingById', { meetingId: id });
      },
    });
    done(res);
  });

  router.post('/meeting/stop', async (_req, res) => {
    await run({
      wired: async c => {
        if (!activeWired()) throw new AppError('VALIDATION', 'No meeting is active');
        await c.request('CloseMeeting'); // real 6.50: closing also deactivates it (WO-032)
      },
      dcn: async c => {
        const meetingId = cache.get('dcnActiveMeeting')?.data?.meetingId ?? null;
        if (!meetingId) throw new AppError('VALIDATION', 'No meeting is running');
        const sessionId = cache.get('dcnActiveSession')?.data?.sessionId ?? null;
        if (sessionId) await c.request('control.MeetingApi.StopSessionById', { sessionId });
        await c.request('control.MeetingApi.StopMeetingById', { meetingId });
        await dcnEvents?.operationSucceeded('control.MeetingApi.StopMeetingById', { meetingId });
      },
    });
    done(res);
  });

  // ---------------------------------------------------------------- participants (WO-084, DEC-023)
  // Wireless: the WAP database (POST/PUT/DELETE /participants). The WAP refuses a seat another participant holds
  // (400 "Seat already assigned", WO-075), so giving someone a seat first takes it from its holder.
  const noWiredEditing = () => {
    throw new AppError('NOT_SUPPORTED', 'The Conference Protocol can only read participants; editing them needs the DICENTIS .NET API (dicentis-bridge, planned in WO-081)');
  };
  const wirelessPeople = () => cache.get('wirelessParticipants')?.data ?? [];
  const participantParam = id => {
    if (!/^\d+$/.test(String(id))) throw new AppError('VALIDATION', `Wireless participant ids are integers (got "${id}")`);
    const pid = Number(id);
    if (!wirelessPeople().some(p => p.id === pid)) throw new AppError('NOT_FOUND', `Participant ${id} does not exist`);
    return pid;
  };
  /** Domain seat id (string | null) → WAP seat id (-1 = none). */
  const wirelessSeat = seatId => (seatId === null || seatId === '' ? -1 : wirelessId(String(seatId)));
  const freeSeat = async (c, seat, except = null) => {
    const holder = seat >= 0 ? wirelessPeople().find(p => p.seatId === seat && p.id !== except) : null;
    if (holder) await c.request('PUT', `/participants/${holder.id}`, { body: { seatId: -1 } });
  };
  /** Validated participant fields from a request body; `full` = create (name required). */
  function participantBody(body, full) {
    const out = {};
    if (full || body?.name !== undefined) {
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!name) throw new AppError('VALIDATION', 'name is required');
      out.name = name;
    }
    if (body?.seatId !== undefined) out.seatId = body.seatId === null ? null : String(body.seatId);
    if (body?.nfc !== undefined) out.nfc = body.nfc === null ? '' : String(body.nfc).trim();
    return out;
  }

  router.post('/participants', async (req, res) => {
    const p = participantBody(req.body, true);
    let id = null;
    await run({
      wired: noWiredEditing,
      wireless: async c => {
        const seat = wirelessSeat(p.seatId ?? null);
        await freeSeat(c, seat);
        const out = await c.request('POST', '/participants', { body: { name: p.name, seatId: seat, nfc: p.nfc ?? '' } });
        id = out?.id != null ? String(out.id) : null;
      },
    });
    res.json(ok({ id }));
  });

  router.put('/participants/:id', async (req, res) => {
    const p = participantBody(req.body, false);
    await run({
      wired: noWiredEditing,
      wireless: async c => {
        const pid = participantParam(req.params.id);
        const body = { ...p };
        if (p.seatId !== undefined) {
          body.seatId = wirelessSeat(p.seatId);
          await freeSeat(c, body.seatId, pid);
        }
        await c.request('PUT', `/participants/${pid}`, { body });
      },
    });
    done(res);
  });

  router.delete('/participants/:id', async (req, res) => {
    await run({
      wired: noWiredEditing,
      wireless: c => c.request('DELETE', `/participants/${participantParam(req.params.id)}`),
    });
    done(res);
  });

  router.put('/seats/:seatId/participant', async (req, res) => {
    const seatId = seatParam(req);
    const participantId = req.body?.participantId ?? null;
    if (participantId !== null && typeof participantId !== 'string' && typeof participantId !== 'number') throw new AppError('VALIDATION', 'participantId must be an id or null');
    await run({
      wired: noWiredEditing,
      wireless: async c => {
        const seat = wirelessId(seatId);
        const pid = participantId === null ? null : participantParam(participantId);
        await freeSeat(c, seat, pid);
        if (pid !== null) await c.request('PUT', `/participants/${pid}`, { body: { seatId: seat } });
      },
    });
    done(res);
  });

  // ---------------------------------------------------------------- import / export (WO-085, DEC-023)
  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const currentPeople = () => {
    const participants = cache.get('domain.participants')?.data;
    const seats = cache.get('domain.seats')?.data;
    if (!participants || !seats) throw new AppError('NOT_CONNECTED', 'No participant data from the connected system');
    return { participants, seats };
  };

  router.get('/participants/export.xlsx', (_req, res) => {
    const sheets = exportSheets({ ...currentPeople(), placements: cache.get('room')?.data?.seats ?? {}, nfc: manager.system === 'wireless' });
    const day = new Date().toISOString().slice(0, 10);
    res.set({ 'content-type': XLSX_TYPE, 'content-disposition': `attachment; filename="participants-${day}.xlsx"`, 'cache-control': 'no-store' });
    res.send(writeXlsx(sheets));
  });

  router.post('/participants/import', express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) throw new AppError('VALIDATION', 'Send the .xlsx or .csv file as the request body');
    let sheets;
    try { sheets = readTable(buf); } catch (err) { throw new AppError('VALIDATION', `Cannot read the file: ${err.message}`); }
    const wirelessSystem = manager.system === 'wireless';
    const plan = planImport(sheets, { ...currentPeople(), remove: req.query.remove === '1', maxName: wirelessSystem ? 32 : Infinity });
    if (req.query.apply !== '1') return res.json(ok({ plan }));
    if (plan.errors.length) throw new AppError('VALIDATION', 'The file has errors: fix them and import again', { details: plan.errors.map(e => `${e.line ? `row ${e.line}: ` : ''}${e.message}`) });
    let result = null;
    await run({
      wired: noWiredEditing,
      wireless: async c => {
        const body = f => ({ ...f, ...(f.seatId !== undefined ? { seatId: wirelessSeat(f.seatId) } : {}) });
        result = await applyImport(plan, {
          create: p => c.request('POST', '/participants', { body: body(p) }),
          update: (id, f) => c.request('PUT', `/participants/${Number(id)}`, { body: body(f) }),
          remove: id => c.request('DELETE', `/participants/${Number(id)}`),
        });
      },
    });
    if (result?.error) {
      throw new AppError('UPSTREAM_ERROR', `Import stopped after ${result.done} of ${result.total} changes (${result.error.step}): ${result.error.message}`);
    }
    res.json(ok({ plan, result }));
  });

  return router;
}
