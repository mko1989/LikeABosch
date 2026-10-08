// Mock DICENTIS Wireless (WAP) REST API v1.7 (WO-014, DEC-006). Semantics follow a real DCNM-WAP, firmware 1.73
// (WO-075, findings in docs/protocol/wireless-rest/README.md "Observed behaviour").
// Run: npm run mock:wireless   (env MOCK_PORT, default 8080; user admin / password admin) → http://127.0.0.1:8080/api
// Long-poll (`?isPolling=true`): held until the resource changes or `longPollMs` (WAP: ~50 s) passes, then answered
// with the current data.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadWirelessSpec, validateSchema } from '../../backend/src/wireless/spec.js';

const NAMES = ['Anna de Vries', 'Bart Jansen', 'Chloe Bakker', 'Dirk Visser', 'Eva Smit', 'Femke Meijer', 'Gerrit de Boer', 'Hanna Mulder',
  'Ivo de Groot', 'Julia Bos', 'Kees Vos', 'Lotte Peters', 'Maarten Hendriks', 'Noor van Leeuwen', 'Olaf Dekker', 'Pim Brouwer'];
/** voting mode → answer names (VotingParameters.mode description) */
const MODE_ANSWERS = [
  ['for', 'against'], ['for', 'against', 'abstain'], ['for', 'against', 'abstain', 'dnpv'],
  ['yes', 'no'], ['yes', 'no', 'abstain'], ['yes', 'no', 'abstain', 'dnpv'],
];

const REASON = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 500: 'Internal Server Error', 501: 'Not Implemented' };
/** The WAP's "no participant" id in speaker / waiting-list entries. */
const NO_PARTICIPANT = 65535;
/** Discussion modes (undocumented GET/PUT /discuss): the waiting list only exists in Open. */
const DISCUSS_OPEN = 0;
/** Allowed voting state changes on the WAP: closed→open, open→hold, hold→open, open/hold→closed. */
const VOTING_TRANSITIONS = new Set(['0>1', '1>2', '2>1', '1>0', '2>0']);
const NFC_FORMAT = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){3,9}$/;

class HttpError extends Error {
  /** @param {number} status @param {string} [details] omitted for the WAP's bare 404/500 bodies */
  constructor(status, details) { super(details ?? REASON[status]); this.status = status; this.details = details; }
}

function createState({ seatCount = 20 } = {}) {
  return {
    seats: Array.from({ length: seatCount }, (_, i) => ({
      id: i + 1, name: i === 0 ? 'Chairman' : `Seat ${i + 1}`, prio: i === 0, dual: false, identification: true, voting: true,
      connected: i < 18, selected: false, cameraId: -1, cameraPrepos: -1, batterySerialNo: `BAT${String(1000 + i)}`,
      batteryStatus: 14 - (i % 7), batteryCharges: 20 + i, rangeTest: 1, signalStatus: -50 - (i % 20), signalLevel: 2,
      // Fields the real WAP sends that are not in the swagger.
      unitId: 500 + i, unitType: 6, unitProps: 6929, hasDisplay: true, extra_seat: false,
    })),
    participants: NAMES.map((name, i) => ({ id: i + 1, name, seatId: i < seatCount ? i + 1 : -1, nfc: `04:A1:B2:C3:D4:${String(10 + i).padStart(2, '0')}` })),
    nextParticipantId: NAMES.length + 1,
    speakers: [],
    waiting: [],
    /** Undocumented `/discuss` settings (subset of the WAP's body). The real default seen was Override (1). */
    discuss: {
      mode: DISCUSS_OPEN, maxOpenMics: 4, waitingListSize: 20, autoShift: false, allowCancelRTS: true, showFirstInWaitingList: true,
      showPossibleToSpeak: true, participantMicOff: true, priorityToneAudible: true, priorityOption: 0, ambient: true, autoMicOff: false,
    },
    /**
     * More undocumented WAP web UI endpoints (DEC-024, WO-076). Field names from the web UI code (fw 1.73); the values
     * are plausible defaults, not recorded from the real WAP (it went offline before they were read).
     */
    audio: { master: 12, pa: 12, lsp: 12, lineIn1: 8, lineOut1: 11, routingOption: 0, testTone: 0, lspOffWhenMicOn: true, attenuate: false, afsMode: 0 },
    equalizer: [63, 250, 1000, 4000, 12000].map((frequency, id) => ({ id, frequency, gain: 0, enabled: true })),
    seatsStatus: { isConfigurationModeOn: false, isSubscriptionModeOn: false, subscriptionStatus: '' },
    rangeTest: { running: false, results: [] },
    systemSettings: { showCompanyLogo: false },
    upgrades: [['DCNM-WAP', '1.73.2081'], ['DCNM-WD', '1.73.2075'], ['DCNM-WDE', '1.73.2075']]
      .map(([deviceType, version], i) => ({ deviceID: i + 1, deviceType, deviceName: deviceType, version, state: 1 })),
    /** last file received on /upgrades/file: { field, filename, size, type } */
    upload: null,
    settings: { identification_mode: 0 },
    system: { state: 0 },
    /** seat ids connected before standby, reconnected on power on */
    standbySeats: null,
    voting: { individuals: false, resultsSettings: { individuals: false, interimResultsMode: 1 }, hundredPercentMode: 2, mode: 4, subject: '' },
    votingState: 0,
    /** mode/subject of the current (or last) round: parameters changed while open only apply to the next round */
    round: { mode: 4, subject: '' },
    votes: new Map(), // seatId → answer name
    /** resource → change counter, for long-polling */
    versions: { seats: 0, speakers: 0, waiting: 0, participants: 0, settings: 0, system: 0, voting: 0, discuss: 0, audio: 0, equalizer: 0, seatsStatus: 0, rangeTest: 0, systemSettings: 0, upgrades: 0 },
  };
}

/**
 * @param {object} [options]
 * @param {number} [options.port]
 * @param {string} [options.host]
 * @param {Record<string, string>} [options.users]  username → password
 * @param {number} [options.longPollMs]
 * @param {number} [options.seatCount]  simulation (WO-095): number of seats
 * @param {string} [options.hostname]   simulation: the host name the WAP reports
 */
export async function createMockWirelessServer({ port = 0, host = '127.0.0.1', users = { admin: 'admin' }, longPollMs = 50_000, seatCount = 20, hostname = 'mock-wap.local' } = {}) {
  const spec = loadWirelessSpec();
  const state = createState({ seatCount });
  state.hostname = hostname; // simulation (WO-095): the name the WAP reports
  /** sid → username */
  const sessions = new Map();
  /** waiting long-poll requests: { resource, version, resolve } */
  const waiters = new Set();
  let nextLoginId = 1;

  const changed = (...resources) => {
    for (const r of resources) state.versions[r] += 1;
    for (const w of [...waiters]) if (resources.includes(w.resource)) { waiters.delete(w); w.resolve(); }
  };

  const seat = id => state.seats.find(s => s.id === Number(id)) ?? (() => { throw new HttpError(400, 'Invalid seat id'); })();
  /** A seat in a request body: must exist and be connected (WAP: 400 "Invalid seat id N" otherwise). */
  const liveSeat = id => {
    const s = state.seats.find(x => x.id === id);
    if (!s || !s.connected) throw new HttpError(400, `Invalid seat id ${id}`);
    return s;
  };
  const seatIds = (body, { allowEmpty = false } = {}) => {
    if (body === undefined && allowEmpty) return [];
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) return null; // object: accepted, no effect
    if (!Array.isArray(body)) throw new HttpError(400, 'Invalid request body type');
    return body;
  };
  // With identification off the WAP shows the seat, not the participant (WO-075).
  const identified = () => state.settings.identification_mode !== 3;
  const participantAt = seatId => (identified() ? state.participants.find(p => p.seatId === seatId) : undefined);
  const spkEntry = (s, extra = {}) => ({
    id: s.id, participantId: participantAt(s.id)?.id ?? NO_PARTICIPANT, name: participantAt(s.id)?.name ?? s.name, seatName: s.name,
    prio: s.prio, micOn: true, prioOn: false, ...extra,
  });
  const rtsEntry = s => ({ id: s.id, participantId: participantAt(s.id)?.id ?? NO_PARTICIPANT, name: participantAt(s.id)?.name ?? s.name, seatName: s.name });
  const answers = () => MODE_ANSWERS[state.round.mode] ?? MODE_ANSWERS[4];
  const outOfRange = field => new HttpError(400, `Value out of range for field '${field}'`);
  const inRange = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
  /** Add a speaker; a full list drops its oldest non-priority speaker (WAP, Open mode). */
  function addSpeaker(s) {
    if (state.speakers.some(e => e.id === s.id)) return;
    const normal = state.speakers.filter(e => !e.prioOn);
    if (normal.length >= state.discuss.maxOpenMics) state.speakers = state.speakers.filter(e => e !== normal[0]);
    state.speakers.push(spkEntry(s));
    state.waiting = state.waiting.filter(e => e.id !== s.id);
  }

  function results() {
    // The WAP always reports present, the answers of the round and notVoted, plus an individuals array.
    const counts = new Map([['present', 0], ...answers().map(a => [a, 0]), ['notVoted', 0]]);
    for (const a of state.votes.values()) counts.set(a, (counts.get(a) ?? 0) + 1);
    if (state.votingState !== 0 || state.votes.size) {
      const voters = state.seats.filter(s => s.connected && s.voting).length;
      counts.set('present', voters);
      counts.set('notVoted', Math.max(0, voters - state.votes.size));
    }
    const individualsOn = state.voting.resultsSettings.individuals;
    return {
      state: state.votingState,
      results: [...counts].map(([name, value]) => ({ name, value })),
      mode: state.round.mode,
      subject: state.round.subject,
      individuals: individualsOn ? [...state.votes].map(([seatId, result]) => ({ ...rtsEntry(seat(seatId)), result })) : [],
    };
  }

  /** route id → { resource (for long-poll), handler(req) → body | undefined } */
  const handlers = {
    'POST /logout': { handler: req => { sessions.delete(req.sid); } },
    'GET /system-info': {
      handler: () => ({
        'System Type': 'DICENTIS Wireless', 'Device Type': 'DCNM-WAP (mock)', Hostname: state.hostname,
        Networks: { Ethernet: { eth0: { IP: host, MAC: '00:1B:EB:00:00:01', 'Subnet mask': '255.255.255.0', 'Default gateway': '' } } },
        Versions: { Firmware: '3.10.0-mock', Api: ['1.7'] },
      }),
    },
    'GET /seats': { resource: 'seats', handler: () => state.seats.map(seatView) },
    'GET /seats/{seat_id}': { resource: 'seats', handler: req => seatView(seat(req.pathParams.seat_id)) },
    'GET /speakers/available': {
      resource: 'speakers',
      handler: () => state.seats.filter(s => s.connected && !state.speakers.some(e => e.id === s.id)).map(s => spkEntry(s, { micOn: false })),
    },
    'GET /speakers': { resource: 'speakers', handler: () => state.speakers },
    'POST /speakers': {
      handler: req => {
        const ids = seatIds(req.body, { allowEmpty: true });
        if (!ids) return;
        if (!ids.length) {
          // No body or [] = "shift": the first waiter gets the floor.
          const first = state.waiting[0];
          if (!first) throw new HttpError(400, 'No waiter to shift');
          addSpeaker(seat(first.id));
        } else {
          const list = ids.map(liveSeat);
          for (const s of list) addSpeaker(s);
        }
        changed('speakers', 'waiting');
      },
    },
    'DELETE /speakers': {
      handler: () => {
        // Priority calls stay, with the microphone off (path description).
        state.speakers = state.speakers.filter(e => e.prioOn).map(e => ({ ...e, micOn: false }));
        state.waiting = [];
        changed('speakers', 'waiting');
      },
    },
    'DELETE /speakers/{seat_id}': {
      handler: req => {
        const id = seat(req.pathParams.seat_id).id;
        const entry = state.speakers.find(e => e.id === id && !e.prioOn);
        if (!entry) throw new HttpError(400, 'Speaker not found in speakers list');
        state.speakers = state.speakers.filter(e => e !== entry);
        changed('speakers');
      },
    },
    'GET /waiting-list/available': {
      resource: 'waiting',
      handler: () => state.seats.filter(s => s.connected && !state.waiting.some(e => e.id === s.id) && !state.speakers.some(e => e.id === s.id)).map(rtsEntry),
    },
    'GET /waiting-list': { resource: 'waiting', handler: () => state.waiting },
    'POST /waiting-list': {
      handler: req => {
        const list = (seatIds(req.body) ?? []).map(liveSeat);
        // The WAP answers a bare 500 when the discussion mode has no waiting list (Override, Voice, PTT).
        if (list.length && state.discuss.mode !== DISCUSS_OPEN) throw new HttpError(500);
        for (const s of list) {
          if (state.waiting.length >= state.discuss.waitingListSize) break;
          if (!state.waiting.some(e => e.id === s.id) && !state.speakers.some(e => e.id === s.id)) state.waiting.push(rtsEntry(s));
        }
        changed('waiting');
      },
    },
    'DELETE /waiting-list': { handler: () => { state.waiting = []; changed('waiting'); } },
    'DELETE /waiting-list/{seat_id}': {
      handler: req => {
        const id = seat(req.pathParams.seat_id).id;
        if (!state.waiting.some(e => e.id === id)) throw new HttpError(400, 'Waiter not found in waiting list');
        state.waiting = state.waiting.filter(e => e.id !== id);
        changed('waiting');
      },
    },
    'POST /priority': {
      handler: req => {
        for (const id of seatIds(req.body) ?? []) {
          const s = liveSeat(id);
          if (!s.prio) throw new HttpError(400, 'Seat is not a chairman seat');
          const existing = state.speakers.find(e => e.id === s.id);
          if (existing) Object.assign(existing, { prioOn: true, micOn: true });
          else state.speakers.unshift(spkEntry(s, { prioOn: true }));
        }
        changed('speakers');
      },
    },
    'DELETE /priority/{seat_id}': {
      handler: req => {
        const s = seat(req.pathParams.seat_id);
        if (!s.prio) throw new HttpError(400, 'Seat is not a chairman seat');
        const entry = state.speakers.find(e => e.id === s.id && e.prioOn);
        if (!entry) throw new HttpError(400, 'Speaker not found in speakers list');
        state.speakers = state.speakers.filter(e => e !== entry);
        changed('speakers');
      },
    },
    'GET /participants': { resource: 'participants', handler: () => state.participants },
    'POST /participants': {
      handler: req => {
        const p = req.body ?? {};
        // The WAP checks the fields in this order and wants all three (seatId -1 / nfc "" = none).
        for (const f of ['nfc', 'seatId', 'name']) if (!(f in p)) throw new HttpError(400, `Missing field '${f}'`);
        checkParticipant(p, null);
        const id = state.nextParticipantId++;
        state.participants.push({ id, name: p.name, seatId: p.seatId, nfc: p.nfc });
        changed('participants');
        return { id };
      },
    },
    'DELETE /participants': { handler: () => { state.participants = []; changed('participants'); } },
    'GET /participants/settings': { resource: 'settings', handler: () => state.settings },
    'PUT /participants/settings': {
      handler: req => {
        const mode = req.body?.identification_mode;
        if (mode === undefined) return;
        if (!inRange(mode, 3)) throw outOfRange('identification_mode');
        if (mode !== 3 && !state.participants.length) throw new HttpError(400, 'Cannot set this identification mode without participants.');
        state.settings = { identification_mode: mode };
        changed('settings', 'speakers', 'waiting');
      },
    },
    'GET /participants/{participant_id}': { resource: 'participants', handler: req => participant(req.pathParams.participant_id, 'Invalid participant id') },
    'PUT /participants/{participant_id}': {
      handler: req => {
        const p = participant(req.pathParams.participant_id);
        const body = req.body ?? {};
        checkParticipant(body, p);
        for (const f of ['name', 'seatId', 'nfc']) if (body[f] !== undefined) p[f] = body[f];
        changed('participants');
      },
    },
    'DELETE /participants/{participant_id}': {
      handler: req => {
        const p = participant(req.pathParams.participant_id);
        state.participants = state.participants.filter(x => x !== p);
        changed('participants');
      },
    },
    'GET /system/status': { resource: 'system', handler: () => state.system },
    'PUT /system/status': {
      handler: req => {
        const next = req.body?.state;
        if (next === undefined) return {};
        if (!inRange(next, 2)) throw outOfRange('state');
        const prev = state.system.state;
        if (prev === 0 && next !== 0) {
          // Standby / off: every seat drops off at once and the lists empty.
          state.standbySeats = state.seats.filter(s => s.connected).map(s => s.id);
          for (const s of state.seats) s.connected = false;
          state.speakers = [];
          state.waiting = [];
        } else if (prev !== 0 && next === 0 && state.standbySeats) {
          for (const s of state.seats) s.connected = state.standbySeats.includes(s.id);
          state.standbySeats = null;
        }
        state.system = { state: next };
        changed('system', 'seats', 'speakers', 'waiting');
        return {};
      },
    },
    'GET /voting': { resource: 'voting', handler: () => state.voting },
    'PUT /voting': {
      handler: req => {
        const b = req.body ?? {};
        const next = structuredClone(state.voting);
        if ('individuals' in b && b.resultsSettings) {
          throw new HttpError(400, "Using deprecated and new results settings at the same time. Please use either 'individuals' or 'resultsSettings'!");
        }
        if (b.mode !== undefined) { if (!inRange(b.mode, 5)) throw outOfRange('mode'); next.mode = b.mode; }
        if (b.subject !== undefined) { if (b.subject.length > 141) throw outOfRange('subject'); next.subject = b.subject; }
        if (b.hundredPercentMode !== undefined) { if (!inRange(b.hundredPercentMode, 2)) throw outOfRange('hundredPercentMode'); next.hundredPercentMode = b.hundredPercentMode; }
        if (b.individuals !== undefined) {
          // Deprecated root flag (API < 1.5): toggles resultsSettings like the old behaviour.
          next.resultsSettings = b.individuals ? { individuals: true, interimResultsMode: 0 } : { individuals: false, interimResultsMode: 1 };
        }
        if (b.resultsSettings) Object.assign(next.resultsSettings, b.resultsSettings);
        if (next.resultsSettings.interimResultsMode === 0 && !next.resultsSettings.individuals) {
          throw new HttpError(400, 'Combination of settings for interim results and individuals incorrect');
        }
        if (next.resultsSettings.individuals && (!state.participants.length || !identified())) {
          throw new HttpError(400, 'Cannot gather individual results without participants or identification');
        }
        next.individuals = next.resultsSettings.individuals;
        // Accepted while a voting is open too; the open round keeps its mode and subject (state.round).
        state.voting = next;
        changed('voting');
      },
    },
    'GET /voting/state': { resource: 'voting', handler: () => ({ state: state.votingState }) },
    'PUT /voting/state': {
      handler: req => {
        const next = req.body?.state;
        if (next === undefined) return;
        if (!inRange(next, 2)) throw outOfRange('state');
        if (!VOTING_TRANSITIONS.has(`${state.votingState}>${next}`)) {
          throw new HttpError(400, `Cannot change state from ${state.votingState} to ${next}`);
        }
        if (next === 1 && state.votingState === 0) {
          // A new round: snapshot the parameters, clear the votes.
          state.votes.clear();
          state.round = { mode: state.voting.mode, subject: state.voting.subject };
        }
        state.votingState = next;
        changed('voting');
      },
    },
    'GET /voting/results': { resource: 'voting', handler: () => results() },
  };

  function participant(id, message = 'Unknown participant id') {
    return state.participants.find(p => p.id === Number(id)) ?? (() => { throw new HttpError(400, message); })();
  }

  /** Validation of a participant body as the WAP does it (WO-075). `self` = the participant being edited. */
  function checkParticipant(p, self) {
    if (p.name !== undefined && (typeof p.name !== 'string' || !p.name || [...p.name].length > 32)) throw outOfRange('name');
    if (p.seatId !== undefined && p.seatId !== -1) {
      if (!state.seats.some(s => s.id === p.seatId)) throw new HttpError(400, 'Unknown seat id');
      if (state.participants.some(x => x !== self && x.seatId === p.seatId)) throw new HttpError(400, 'Seat already assigned');
    }
    if (p.nfc !== undefined && p.nfc !== '') {
      if (!NFC_FORMAT.test(p.nfc)) throw new HttpError(400, 'NFC id has incorrect formatting');
      if (state.participants.some(x => x !== self && x.nfc.toLowerCase() === p.nfc.toLowerCase())) throw new HttpError(400, 'NFC already assigned');
    }
  }

  /** Seat as the WAP shows it: battery/signal values are null while the seat is not connected. */
  function seatView(s) {
    return s.connected ? s : { ...s, batteryStatus: null, batteryCharges: null, signalStatus: null, signalLevel: null, batterySerialNo: '' };
  }

  /** Undocumented endpoints (docs/protocol/wireless-rest/undocumented.json, DEC-024): the WAP web UI's own API. */
  const UPGRADE_STEPS = [3, 4, 5, 6]; // downloading, programming, rebooting, done
  const extraHandlers = {
    'GET /audio': { resource: 'audio', handler: () => state.audio },
    'PUT /audio': {
      handler: req => {
        const b = req.body ?? {};
        for (const [k, v] of Object.entries(b)) {
          if (!(k in state.audio)) throw new HttpError(400, `Unknown field '${k}'`);
          if (typeof state.audio[k] === 'number' && (!Number.isInteger(v) || v < 0 || v > 31)) throw outOfRange(k);
        }
        Object.assign(state.audio, b);
        changed('audio');
      },
    },
    'GET /audio/master': { resource: 'audio', handler: () => ({ master: state.audio.master }) },
    'PUT /audio/master': {
      handler: req => {
        if (!inRange(req.body.master, 24)) throw outOfRange('master');
        state.audio.master = req.body.master;
        changed('audio');
      },
    },
    'GET /audio/equalizer/delegate-loudspeaker': { resource: 'equalizer', handler: () => state.equalizer },
    'PUT /audio/equalizer/delegate-loudspeaker': {
      handler: req => {
        for (const band of req.body) {
          const b = state.equalizer.find(x => x.id === band.id);
          if (!b) throw new HttpError(400, 'Unknown band');
          if (band.gain !== undefined && (typeof band.gain !== 'number' || band.gain < -12 || band.gain > 12)) throw outOfRange('gain');
          Object.assign(b, band);
        }
        changed('equalizer');
      },
    },
    'GET /audio/equalizer/delegate-loudspeaker/coefficients': { resource: 'equalizer', handler: () => state.equalizer.map(b => ({ id: b.id, a: [1, 0, 0], b: [1 + b.gain / 100, 0, 0] })) },
    'GET /seats/status': { resource: 'seatsStatus', handler: () => state.seatsStatus },
    'PUT /seats/status': {
      handler: req => {
        for (const k of ['isConfigurationModeOn', 'isSubscriptionModeOn']) if (typeof req.body?.[k] === 'boolean') state.seatsStatus[k] = req.body[k];
        changed('seatsStatus');
      },
    },
    'PUT /seats/deinit': {
      handler: req => {
        if (req.body.deinit !== true) return;
        for (const x of state.seats) x.connected = false; // seats must subscribe again
        state.speakers = []; state.waiting = [];
        changed('seats', 'speakers', 'waiting');
      },
    },
    'PUT /seats/remove': {
      handler: req => {
        if (req.body.remove !== true) return;
        state.seats = state.seats.filter(x => x.connected);
        for (const p of state.participants) if (!state.seats.some(x => x.id === p.seatId)) p.seatId = -1;
        changed('seats', 'participants');
      },
    },
    'GET /seats/range-test': { resource: 'rangeTest', handler: () => state.rangeTest },
    'POST /seats/range-test': {
      handler: () => {
        state.rangeTest = { running: true, results: [] };
        changed('rangeTest');
        setTimeout(() => {
          state.rangeTest = { running: false, results: state.seats.filter(x => x.connected).map(x => ({ id: x.id, name: x.name, rangeTest: 1 })) };
          changed('rangeTest');
        }, 300).unref();
      },
    },
    'PUT /seats/{seat_id}': {
      handler: req => {
        const target = seat(req.pathParams.seat_id);
        const b = req.body ?? {};
        if (b.name !== undefined && (typeof b.name !== 'string' || !b.name || Buffer.byteLength(b.name) > 32)) throw outOfRange('name');
        for (const k of ['prio', 'dual', 'identification', 'voting']) if (b[k] !== undefined && typeof b[k] !== 'boolean') throw outOfRange(k);
        for (const k of ['name', 'prio', 'dual', 'identification', 'voting', 'cameraId', 'cameraPrepos']) if (b[k] !== undefined) target[k] = b[k];
        changed('seats');
      },
    },
    'PUT /seats/{seat_id}/selected': {
      handler: req => {
        const target = seat(req.pathParams.seat_id);
        for (const x of state.seats) x.selected = false;
        target.selected = Boolean(req.body.selected);
        changed('seats');
      },
    },
    'GET /system/settings': { resource: 'systemSettings', handler: () => state.systemSettings },
    'PUT /system/settings': {
      handler: req => {
        if (req.body?.showCompanyLogo !== undefined) state.systemSettings.showCompanyLogo = Boolean(req.body.showCompanyLogo);
        changed('systemSettings');
      },
    },
    'GET /upgrades': { resource: 'upgrades', handler: () => state.upgrades },
    'POST /upgrades': {
      handler: req => {
        if (!state.upload) throw new HttpError(400, 'No file uploaded');
        const ids = req.body;
        const devices = state.upgrades.filter(d => ids.includes(d.deviceID));
        if (!devices.length) throw new HttpError(400, 'No devices selected');
        UPGRADE_STEPS.forEach((st, i) => setTimeout(() => { for (const d of devices) d.state = st; changed('upgrades'); }, 100 * (i + 1)).unref());
        return devices.map(d => ({ deviceID: d.deviceID }));
      },
    },
    'GET /discuss': { resource: 'discuss', handler: () => state.discuss },
    'PUT /discuss': {
      handler: req => {
        const b = req.body ?? {};
        if (b.mode !== undefined && !inRange(b.mode, 3)) throw outOfRange('mode');
        Object.assign(state.discuss, b);
        if (state.discuss.mode !== DISCUSS_OPEN) state.waiting = [];
        changed('discuss', 'waiting');
        return {};
      },
    },
  };

  const app = express();
  // Firmware / seat display image upload (undocumented, like the web UI's FileUploader): multipart field "firmware".
  app.post(`${spec.basePath}/upgrades/file`, express.raw({ type: () => true, limit: '64mb' }), (req, res) => {
    const sid = req.get('bosch-sid') ?? /(?:^|;\s*)sid=([^;]+)/.exec(req.get('cookie') ?? '')?.[1];
    if (!sid || !sessions.has(sid)) return res.status(401).end();
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.get('content-type') ?? '');
    if (!boundary) return res.status(400).json({ error: { code: 400, description: 'Bad Request', details: 'multipart/form-data expected' } });
    const text = req.body.toString('latin1');
    const head = /Content-Disposition:[^\r\n]*?\bname="([^"]+)"(?:;\s*filename="([^"]*)")?[^]*?\r\n\r\n/i.exec(text);
    if (!head) return res.status(400).end();
    const start = head.index + head[0].length;
    const end = text.indexOf(`\r\n--${boundary[1] ?? boundary[2]}`, start);
    state.upload = { field: head[1], filename: head[2] ?? '', size: (end < 0 ? text.length : end) - start, type: /\.png$/i.test(head[2] ?? '') ? 'DCNM-WDE' : null };
    res.status(200).end();
  });
  app.use(express.json({ type: () => true, limit: '1mb', strict: false })); // the WAP is strict about Content-Type only for login
  const api = express.Router();

  api.post('/login', (req, res) => {
    if (!req.is('application/json')) throw new HttpError(400, 'Content-Type must be application/json');
    const { username, password, override } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') throw new HttpError(401, 'username and password are required');
    if (users[username] !== password) throw new HttpError(401, 'Invalid username or password');
    const existing = [...sessions].find(([, u]) => u === username);
    if (existing && !override) throw new HttpError(409, `User ${username} is already logged in`);
    if (existing) sessions.delete(existing[0]);
    const sid = randomBytes(16).toString('hex');
    sessions.set(sid, username);
    res.setHeader('Set-Cookie', `sid=${sid}; Path=/`);
    res.json({ id: nextLoginId++, sid });
  });

  api.use(async (req, res) => {
    // The WAP takes the cookie or the `Bosch-Sid` header. The swagger's header `sid` is NOT accepted (401), like the WAP.
    const sid = req.get('bosch-sid') ?? /(?:^|;\s*)sid=([^;]+)/.exec(req.get('cookie') ?? '')?.[1];
    if (!sid || !sessions.has(sid)) return res.status(401).end(); // the WAP's 401 for a dead session has no body
    req.sid = sid;
    if (req.get('content-length') === '0') req.body = undefined; // body-parser turns an empty body into {}
    const found = spec.match(req.method, req.path);
    if (!found) throw new HttpError(404);
    const { op, params } = found;
    // Non-numeric ids do not match the WAP's routes.
    if (Object.values(params).some(v => !/^-?\d+$/.test(v))) throw new HttpError(404);
    req.pathParams = params;
    // The WAP accepts a JSON object where a seat array is expected (200, no effect): handlers treat it as a no-op.
    const objectForArray = op.bodySchema?.type === 'array' && req.body !== null && typeof req.body === 'object' && !Array.isArray(req.body);
    if (op.bodySchema && req.body !== undefined && !objectForArray) {
      const problems = validateSchema(op.bodySchema, req.body);
      if (problems.length) throw new HttpError(400, Array.isArray(req.body) || op.bodySchema.type !== 'array' ? problems.join('; ') : 'Invalid request body type');
    }
    const route = handlers[op.id] ?? extraHandlers[op.id];
    if (!route) throw new HttpError(501, `${op.id} not implemented in mock`);
    if (route.resource && req.query.isPolling === 'true') {
      // The WAP holds one long-poll per path and session: a new one releases the previous one at once (WO-075).
      for (const w of [...waiters]) if (w.sid === req.sid && w.path === req.path) { waiters.delete(w); w.resolve(); }
      await new Promise(resolve => {
        const w = { resource: route.resource, sid: req.sid, path: req.path, resolve };
        waiters.add(w);
        const t = setTimeout(() => { waiters.delete(w); resolve(); }, longPollMs);
        t.unref();
        req.on('close', () => { waiters.delete(w); clearTimeout(t); resolve(); });
      });
    }
    const body = route.handler(req);
    if (body === undefined) res.status(200).end();
    else res.json(body);
  });

  app.use(spec.basePath, api);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status ?? (err.type === 'entity.parse.failed' ? 400 : 500);
    const details = err instanceof HttpError ? err.details : err.message;
    res.status(status).json({ error: { code: status, description: REASON[status] ?? 'Error', ...(details ? { details } : {}) } });
  });

  const server = app.listen(port, host);
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const actualPort = server.address().port;

  return {
    port: actualPort,
    url: `http://${host}:${actualPort}${spec.basePath}`,
    state,
    get sessionCount() { return sessions.size; },
    /** Test helper: set the (undocumented) discussion settings, e.g. `{ mode: 1 }` for Override. */
    setDiscuss(settings) { Object.assign(state.discuss, settings); changed('discuss'); },
    /** Test helper: a delegate presses request-to-speak. */
    requestToSpeak(seatId) {
      const s = seat(seatId);
      if (!state.waiting.some(e => e.id === s.id) && !state.speakers.some(e => e.id === s.id)) state.waiting.push(rtsEntry(s));
      changed('waiting');
    },
    /** Test helper: a delegate votes (answer name, e.g. 'yes'). */
    castVote(seatId, answer) {
      if (state.votingState !== 1) throw new Error('Voting is not open');
      state.votes.set(Number(seatId), answer);
      changed('voting');
    },
    /** Test helper: invalidate all sessions (simulates WAP restart / session expiry). */
    expireSessions() { sessions.clear(); },
    async close() {
      for (const w of waiters) w.resolve();
      waiters.clear();
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(() => resolve()));
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const mock = await createMockWirelessServer({ port: Number(process.env.MOCK_PORT ?? 8080), host: process.env.MOCK_HOST ?? '127.0.0.1' });
  console.log(`[mock:wireless] listening on ${mock.url} (user admin / password admin)`);
  process.on('SIGINT', async () => { await mock.close(); process.exit(0); });
}
