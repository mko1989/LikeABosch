// DICENTIS-only features over the DCNM API (DEC-029): follows the connection manager's dicentis-bridge client, fetches
// what the features need (areas, active meeting, room audio, seats, languages, desks), keeps normalised `dicentis.*`
// topics current from the API's events, and runs the feature actions (routes.js).
//   dicentis.status           { state, meetingId, features: { audio, languages }, reason }
//   dicentis.audio            room gains / equalisers / selection settings + capabilities (WO-081)
//   dicentis.vu               level readings while leased (POST /api/dicentis/audio/vu)
//   dicentis.seatAudio        per seat Dante out + headroom (WO-081)
//   dicentis.languages        system languages (WO-102)
//   dicentis.meetingLanguages { meetingId, languages, can… } (WO-102)
//   dicentis.desks            interpreter desk outputs (WO-102)
import { createLogger } from '../lib/logger.js';
import { AppError } from '../lib/errors.js';
import { audioFromDcnm, seatAudioFromDcnm, gainSetting, equalizerSetting, selectionSetting, seatDanteUpdate } from './audio.js';
import { languagesFromDcnm, meetingLanguagesFromDcnm, desksFromDcnm, languageInfo, meetingLanguageUpdate, orderNumbers, deskUpdate } from './languages.js';

export const DICENTIS_TOPICS = ['dicentis.audio', 'dicentis.vu', 'dicentis.seatAudio', 'dicentis.languages', 'dicentis.meetingLanguages', 'dicentis.desks'];
const VU_LEASE_MS = 30_000;

export class DicentisFeatures {
  /**
   * @param {object} deps
   * @param {import('../state/cache.js').StateCache} deps.cache
   * @param {import('../connection/manager.js').ConnectionManager} deps.manager
   * @param {ReturnType<createLogger>} [deps.log]
   */
  constructor({ cache, manager, log }) {
    this.cache = cache;
    this.manager = manager;
    this.log = log ?? createLogger({ name: 'dicentis' });
    /** @type {import('../dcnm/client.js').DcnmClient | null} */
    this.client = null;
    this.areas = [];
    this.meetingId = null;
    this.raw = { audio: null, seats: [], languages: [], meetingLanguages: [], desks: [] };
    this.vu = { on: false, until: 0, timer: null };
    this.loading = Promise.resolve();
    this.onEvent = e => this.#event(e);
    this.onLoggedIn = () => { this.loading = this.refresh().catch(err => this.log.warn(`DICENTIS features: ${err.message}`)); };
    this.onState = state => { if (state !== 'loggedIn') this.#unavailable(`dicentis-bridge ${state}`); this.#status(); };
    this.onStatus = () => this.#status();
    manager.on('status', () => this.#follow());
    this.#follow();
  }

  /** Attach to the manager's current dicentis-bridge client (it is replaced on every connect). */
  #follow() {
    const c = this.manager.dcnmClient ?? null;
    if (c === this.client) return;
    if (this.client) {
      for (const [ev, fn] of [['event', this.onEvent], ['loggedIn', this.onLoggedIn], ['state', this.onState], ['status', this.onStatus]]) this.client.off(ev, fn);
    }
    this.client = c;
    this.#stopVu();
    this.meetingId = null;
    if (!c) { this.#unavailable('The full DICENTIS API is not enabled (dicentis-bridge, DEC-021)'); this.#status(); return; }
    for (const [ev, fn] of [['event', this.onEvent], ['loggedIn', this.onLoggedIn], ['state', this.onState], ['status', this.onStatus]]) c.on(ev, fn);
    if (c.state === 'loggedIn') this.onLoggedIn();
    else this.#unavailable(`dicentis-bridge ${c.state}`);
    this.#status();
  }

  /** Resolves when the fetch after the latest login is done (tests). */
  idle() { return this.loading; }

  #props(api) { return this.client?.bridgeStatus?.interfaces?.[api] ?? {}; }

  features() {
    const up = this.client?.state === 'loggedIn';
    const room = this.#props('RoomAudioControl');
    const interp = this.#props('ConfigInterpretation');
    const lang = this.#props('ConfigLanguage');
    return {
      audio: up && Boolean(room.CanControlSystemAudio || room.CanConfigureSystemAudio),
      languages: up && Boolean(interp.CanConfigureInterpretationLanguages || lang.CanConfigureLanguages),
    };
  }

  #status() {
    const c = this.client;
    this.cache.set('dicentis.status', {
      state: c?.state ?? 'off', meetingId: this.meetingId, features: this.features(),
      reason: !c ? 'The full DICENTIS API is not enabled' : c.state !== 'loggedIn' ? `dicentis-bridge ${c.state}${c.lastError ? `: ${c.lastError.message}` : ''}` : null,
    });
    if (this.raw.audio) this.#publishAudio();
    this.#publishMeetingLanguages();
  }

  #unavailable(reason) {
    for (const t of DICENTIS_TOPICS) this.cache.markUnavailable(t, reason);
  }

  async #call(api, method, args = {}) {
    if (this.client?.state !== 'loggedIn') throw new AppError('NOT_CONNECTED', 'The full DICENTIS API is not connected (dicentis-bridge)');
    return this.client.call(api, method, args);
  }

  /** Everything the features show; each part on its own so one unsupported interface does not hide the others. */
  async refresh() {
    const part = async (name, fn) => { try { await fn(); } catch (err) { this.log.warn(`DICENTIS ${name}: ${err.message}`); } };
    await part('areas', async () => { this.areas = (await this.#call('ConfigSite', 'GetAreasAsync')) ?? []; });
    await part('meeting', () => this.#call('ControlMeeting', 'RequestActiveMeetingStatusAsync'));
    await part('audio', () => this.#call('RoomAudioControl', 'RequestAudioSettingsAsync'));
    await part('seats', () => this.#loadSeats());
    await part('languages', () => this.#loadLanguages());
    // the meeting id arrives as an event; give it a moment before loading the meeting's languages
    for (let i = 0; i < 20 && !this.meetingId; i += 1) await new Promise(r => setTimeout(r, 25));
    await part('meeting languages', () => this.#loadMeeting());
    this.#status();
  }

  async #loadSeats() {
    const lists = await Promise.all(this.areas.map(a => this.#call('ConfigArea', 'GetSeatsAsync', { areaId: a.Id })));
    this.raw.seats = lists.flat().filter(Boolean);
    this.cache.set('dicentis.seatAudio', seatAudioFromDcnm(this.raw.seats));
  }

  async #loadLanguages() {
    this.raw.languages = (await this.#call('ConfigLanguage', 'GetLanguagesAsync')) ?? [];
    this.cache.set('dicentis.languages', languagesFromDcnm(this.raw.languages));
  }

  async #loadMeeting() {
    if (!this.meetingId) {
      this.cache.markUnavailable('dicentis.meetingLanguages', 'No active meeting');
      this.cache.markUnavailable('dicentis.desks', 'No active meeting');
      return;
    }
    const [langs, desks] = await Promise.all([
      this.#call('ConfigInterpretation', 'GetMeetingLanguagesAsync', { meetingId: this.meetingId }),
      this.#call('ConfigInterpretation', 'RetrieveMeetingDesksAsync', { meetingId: this.meetingId }),
    ]);
    this.raw.meetingLanguages = langs ?? [];
    this.raw.desks = desks ?? [];
    this.#publishMeetingLanguages();
    const names = new Map(this.raw.seats.map(s => [s.Id, s.Name]));
    this.cache.set('dicentis.desks', desksFromDcnm(this.raw.desks, names));
  }

  #publishMeetingLanguages() {
    if (!this.meetingId || this.client?.state !== 'loggedIn') return;
    const interp = this.#props('ConfigInterpretation');
    this.cache.set('dicentis.meetingLanguages', {
      meetingId: this.meetingId, languages: meetingLanguagesFromDcnm(this.raw.meetingLanguages),
      canConfigure: Boolean(interp.CanConfigureInterpretationLanguages), canDante: Boolean(interp.CanConfigureDanteLanguageChannels),
      canDesks: Boolean(interp.CanConfigureDesksAndBooths), canSystemLanguages: Boolean(this.#props('ConfigLanguage').CanConfigureLanguages),
    });
  }

  #publishAudio() {
    const room = this.#props('RoomAudioControl');
    this.cache.set('dicentis.audio', {
      ...audioFromDcnm(this.raw.audio), routing: this.raw.routing ?? null,
      canControl: Boolean(room.CanControlSystemAudio), canConfigure: Boolean(room.CanConfigureSystemAudio),
    });
  }

  #event({ api, event, args }) {
    const p = args && typeof args === 'object' && 'Parameter' in args ? args.Parameter : undefined;
    const key = `${api}.${event}`;
    const later = (name, fn) => fn().catch(err => this.log.warn(`DICENTIS ${name}: ${err.message}`));
    switch (key) {
      case 'RoomAudioControl.AudioSettingsChanged': this.raw.audio = p; this.#publishAudio(); return;
      case 'RoomAudioControl.RoomAudioRoutingStateChanged': this.raw.routing = Boolean(p); if (this.raw.audio) this.#publishAudio(); return;
      case 'RoomAudioControl.VUMeterReadingsChanged': if (this.vu.on) this.cache.set('dicentis.vu', { readings: p?.ReadingsDictionary ?? {}, at: Date.now() }); return;
      case 'ControlMeeting.ActiveMeetingStatusChanged': {
        const id = p?.MeetingId ?? null;
        if (id === this.meetingId) return;
        this.meetingId = id;
        this.#status();
        if (this.client?.state === 'loggedIn') later('meeting languages', () => this.#loadMeeting());
        return;
      }
      case 'ConfigArea.SeatsUpdated': case 'ConfigArea.SeatsCreated': case 'ConfigArea.SeatsDeleted':
        later('seats', () => this.#loadSeats()); return;
      case 'ConfigLanguage.LanguageCreated': case 'ConfigLanguage.LanguageUpdated': case 'ConfigLanguage.LanguageDeleted':
        later('languages', () => this.#loadLanguages()); return;
      default:
        if (api === 'ConfigInterpretation' && /^MeetingLanguage|^MeetingDeskInfoChanged$/.test(event)) later('meeting languages', () => this.#loadMeeting());
        if (event === 'CapabilitiesChanged') this.#status();
    }
  }

  // ------------------------------------------------------------------ actions: audio (WO-081)
  #audio() {
    const a = this.cache.get('dicentis.audio')?.data;
    if (!a) throw new AppError('NOT_CONNECTED', 'DICENTIS room audio is not available');
    return a;
  }
  async gain(body) { return this.#call('RoomAudioControl', 'AdjustAudioGainSettingsAsync', { audioGainSetting: gainSetting(body, this.#audio()) }); }
  async equalizer(body) { return this.#call('RoomAudioControl', 'AdjustAudioEqualizerSettingsAsync', { equalizerSettings: equalizerSetting(body, this.#audio()) }); }
  async selection(body) { return this.#call('RoomAudioControl', 'AdjustAudioSelectionSettingsAsync', { audioSelectionSetting: selectionSetting(body, this.#audio()) }); }
  async seatDante(body) {
    const seatInfos = seatDanteUpdate(body, this.raw.seats);
    const r = await this.#call('ConfigArea', 'UpdateSeatsAsync', { seatInfos });
    await this.#loadSeats();
    return r;
  }

  /** VU readings run while someone looks at them: each call extends a 30 s lease; off stops at once. */
  async vuLease(on) {
    if (!on) { await this.#stopVu(); return { on: false }; }
    this.vu.until = Date.now() + VU_LEASE_MS;
    if (!this.vu.on) {
      await this.#call('RoomAudioControl', 'RequestVUMeterReadingsAsync');
      this.vu.on = true;
    }
    clearTimeout(this.vu.timer);
    this.vu.timer = setTimeout(() => this.#stopVu(), VU_LEASE_MS);
    this.vu.timer.unref?.();
    return { on: true, until: new Date(this.vu.until).toISOString() };
  }

  async #stopVu() {
    clearTimeout(this.vu.timer);
    const was = this.vu.on;
    this.vu.on = false;
    this.cache.markUnavailable('dicentis.vu', 'Level meters off');
    if (was && this.client?.state === 'loggedIn') await this.client.call('RoomAudioControl', 'CancelVUMeterReadingsAsync').catch(() => {});
  }

  // ------------------------------------------------------------------ actions: languages (WO-102)
  #meeting() {
    if (!this.meetingId) throw new AppError('NOT_SUPPORTED', 'No active meeting: languages belong to the active meeting');
    return this.meetingId;
  }
  #rawLanguage(id) {
    const l = this.raw.languages.find(x => x.LanguageId === id);
    if (!l) throw new AppError('VALIDATION', `Unknown language '${id}'`);
    return l;
  }
  async createLanguage(body) {
    const id = await this.#call('ConfigLanguage', 'CreateLanguageAsync', { languageInfo: languageInfo(body) });
    await this.#loadLanguages();
    return { id };
  }
  async updateLanguage(body) {
    const l = this.#rawLanguage(body?.id);
    if (!l.UserDefined) throw new AppError('VALIDATION', 'Only languages added here (user-defined) can be changed');
    const r = await this.#call('ConfigLanguage', 'UpdateLanguageAsync', { languageInfo: languageInfo(body, l) });
    await this.#loadLanguages();
    return r;
  }
  async deleteLanguage(body) {
    const l = this.#rawLanguage(body?.id);
    if (!l.UserDefined) throw new AppError('VALIDATION', 'Built-in languages cannot be deleted');
    if (this.raw.meetingLanguages.some(m => m.LanguageId === l.LanguageId)) throw new AppError('VALIDATION', 'Remove the language from the meeting first');
    const r = await this.#call('ConfigLanguage', 'DeleteLanguageAsync', { languageId: l.LanguageId });
    await this.#loadLanguages();
    return r;
  }
  async addMeetingLanguage(body) {
    const meetingId = this.#meeting();
    const l = this.#rawLanguage(body?.languageId);
    if (this.raw.meetingLanguages.some(m => m.LanguageId === l.LanguageId)) throw new AppError('VALIDATION', `${l.EnLabel} is already a language of the meeting`);
    const r = await this.#call('ConfigInterpretation', 'CreateMeetingLanguageAsync', {
      meetingLanguageInfo: { MeetingId: meetingId, LanguageId: l.LanguageId, LanguageSourceType: 'Dicentis', OutputToDante: Boolean(body.danteOut), OrderNumber: this.raw.meetingLanguages.length + 1 },
    });
    await this.#loadMeeting();
    return r;
  }
  async removeMeetingLanguage(body) {
    const meetingId = this.#meeting();
    const m = this.raw.meetingLanguages.find(x => x.LanguageId === body?.languageId);
    if (!m) throw new AppError('VALIDATION', `Language '${body?.languageId}' is not a language of the meeting`);
    const r = await this.#call('ConfigInterpretation', 'DeleteMeetingLanguageAsync', { meetingId, orderId: m.OrderNumber });
    await this.#loadMeeting();
    return r;
  }
  async orderMeetingLanguages(body) {
    const meetingId = this.#meeting();
    const r = await this.#call('ConfigInterpretation', 'ChangeMeetingLanguagesOrderAsync', { meetingId, meetingLanguageIds: orderNumbers(body?.languageIds, this.raw.meetingLanguages) });
    await this.#loadMeeting();
    return r;
  }
  async updateMeetingLanguage(body) {
    this.#meeting();
    const info = meetingLanguageUpdate(body ?? {}, this.raw.meetingLanguages.find(x => x.LanguageId === body?.languageId));
    const r = await this.#call('ConfigInterpretation', 'UpdateMeetingLanguageAsync', { meetingLanguageInfo: info });
    await this.#loadMeeting();
    return r;
  }
  async updateDesk(body) {
    this.#meeting();
    const info = deskUpdate(body ?? {}, this.raw.desks.find(d => d.SeatId === body?.seatId), this.raw.meetingLanguages.map(m => m.LanguageId));
    const r = await this.#call('ConfigInterpretation', 'UpdateMeetingDeskInfoAsync', { meetingDeskInfo: info });
    await this.#loadMeeting();
    return r;
  }

  close() { clearTimeout(this.vu.timer); }
}
