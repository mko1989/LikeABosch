// DCN event bridge (WO-060, DEC-005/017): keeps the dcn* topics in the state cache in sync with the DCN-SW API.
// After login (and after every authorization change): fetch every topic (stage 0, then the meeting/session dependent
// stage 1). On an event: refetch the topics from DCN_EVENT_TOPICS (coalesced), update the event-derived topics.
import { createLogger } from '../lib/logger.js';
import { DCN_EVENT_DATA_TOPICS, DCN_EVENT_TOPICS, DCN_TOPICS, DCN_VOTING_CALLS, DCN_VOTING_EVENTS } from './topics.js';

const READ_METHOD = /^(Retrieve|Get|Read)/;

export class DcnEventBridge {
  /**
   * @param {object} deps
   * @param {import('../state/cache.js').StateCache} deps.cache
   * @param {ReturnType<createLogger>} [deps.log]
   * @param {number} [deps.coalesceMs]
   */
  constructor({ cache, log, coalesceMs = 50 }) {
    this.cache = cache;
    this.log = log ?? createLogger({ name: 'dcn-events' });
    this.coalesceMs = coalesceMs;
    /** @type {import('./client.js').DcnClient | null} */
    this.client = null;
    this.byTopic = new Map(DCN_TOPICS.map(t => [t.topic, t]));
    this.queue = new Set();
    this.timer = null;
    this.flushing = Promise.resolve();
    this.allowedKey = '';
    this.onLoggedIn = () => this.#run(() => this.resync());
    this.onEvent = e => this.#handleEvent(e);
    this.onStatus = status => this.#handleStatus(status);
  }

  get topicNames() { return [...this.byTopic.keys(), 'dcnBridge', 'dcnVoting', ...Object.values(DCN_EVENT_DATA_TOPICS)]; }

  /** @param {import('./client.js').DcnClient} client */
  attach(client) {
    this.detach();
    this.client = client;
    client.on('loggedIn', this.onLoggedIn);
    client.on('event', this.onEvent);
    client.on('status', this.onStatus);
    if (client.state === 'loggedIn') this.onLoggedIn();
  }

  detach() {
    if (!this.client) return;
    this.client.off('loggedIn', this.onLoggedIn);
    this.client.off('event', this.onEvent);
    this.client.off('status', this.onStatus);
    this.client = null;
    clearTimeout(this.timer);
    this.timer = null;
    this.queue.clear();
  }

  /** Wait until queued refreshes are done (tests, shutdown). */
  async idle() {
    while (this.timer || this.queue.size) await new Promise(r => setTimeout(r, this.coalesceMs));
    await this.flushing;
  }

  /** Full sync of every topic. */
  async resync() {
    const client = this.client;
    if (!client) return;
    this.#publishBridge();
    this.allowedKey = allowedKey(client.bridgeStatus);
    await Promise.all(DCN_TOPICS.filter(t => t.stage === 0).map(t => this.refreshTopic(t.topic)));
    await Promise.all(DCN_TOPICS.filter(t => t.stage === 1).map(t => this.refreshTopic(t.topic)));
    // Voting state: DCN has no getter. Seed it from the active voting id; events take over from here.
    if (!this.cache.get('dcnVoting')) {
      const votingId = this.cache.get('dcnActiveVoting')?.data?.votingId ?? null;
      this.cache.set('dcnVoting', { state: votingId ? 'opened' : 'closed', votingId, outcome: null, since: null });
    }
    this.log.info(`synchronised ${DCN_TOPICS.length} DCN topics (${DCN_TOPICS.filter(t => this.cache.unavailable.has(t.topic)).length} unavailable)`);
  }

  /** @param {string} topic */
  async refreshTopic(topic) {
    const client = this.client;
    const def = this.byTopic.get(topic);
    if (!client || !def) return;
    const args = def.args ? def.args(this.#context()) : {};
    if (args === null) {
      this.cache.set(topic, def.inactive);
      return;
    }
    try {
      const out = await client.request(def.call, args);
      if (this.client !== client) return;
      this.cache.set(topic, def.map(out));
      if (topic === 'dcnActiveVoting') this.#syncVotingId();
    } catch (err) {
      if (this.client !== client || err.code === 'NOT_CONNECTED') return; // reconnect will resync
      if (err.extra?.apiError === 'NOT_ACTIVE' && def.inactive !== undefined) {
        this.cache.set(topic, def.inactive);
        if (topic === 'dcnActiveVoting') this.#syncVotingId();
        return;
      }
      const reason = err.extra?.apiError === 'NO_AUTHORIZATION' ? 'DCN-SW user or licence does not allow this (NO_AUTHORIZATION)'
        : err.extra?.apiError === 'NOT_ACTIVE' ? 'no meeting is running'
          : err.message;
      this.log.debug(`refresh ${topic} via ${def.call} failed: ${err.message}`);
      this.cache.markUnavailable(topic, reason);
    }
  }

  /**
   * Called after a successful write through the passthrough or the domain layer: refresh what it may have changed,
   * in case DCN-SW does not send events to the client that caused the change.
   * @param {string} key full method key
   * @param {Record<string, unknown>} [args] the call's arguments (voting id of Select/StartVotingById)
   */
  operationSucceeded(key, args = {}) {
    const method = key.slice(key.lastIndexOf('.') + 1);
    if (READ_METHOD.test(method)) return undefined;
    if (DCN_VOTING_CALLS[key]) this.#applyVoting(DCN_VOTING_CALLS[key], null, typeof args.votingId === 'number' ? args.votingId : undefined);
    if (key.startsWith('control.MeetingApi.')) this.queue.add('*resync');
    const api = key.slice(0, key.lastIndexOf('.'));
    for (const t of DCN_TOPICS) if (t.call.startsWith(`${api}.`)) this.queue.add(t.topic);
    if (api === 'config.DelegateApi') ['dcnRegisteredDelegates', 'dcnSeatAssignments', 'dcnActiveMeetingDelegates'].forEach(t => this.queue.add(t));
    if (api === 'config.VoteApi') this.queue.add('dcnSessionVotings');
    this.#schedule();
    return this.idle();
  }

  #context() {
    return {
      meetingId: this.cache.get('dcnActiveMeeting')?.data?.meetingId || null,
      sessionId: this.cache.get('dcnActiveSession')?.data?.sessionId || null,
      defaultArea: this.client?.constants?.['SEAT_ASSIGNMENT.DEFAULT_AREA'] ?? 0,
    };
  }

  #handleEvent({ api, event, args, time }) {
    const key = `${api}.${event}`;
    const dataTopic = DCN_EVENT_DATA_TOPICS[key];
    if (dataTopic) this.cache.set(dataTopic, { ...(args ?? {}), receivedAt: time });
    // VoteControlEventArgs carries ConfigId (ControlEventArgs, from the DLLs, WO-068): taken as the voting id when it is set.
    const votingId = typeof args?.ConfigId === 'number' && args.ConfigId > 0 ? args.ConfigId : undefined;
    if (api === 'control.VoteApi' && DCN_VOTING_EVENTS[event]) this.#applyVoting(event, time, votingId);
    const topics = DCN_EVENT_TOPICS[key];
    if (!topics && !dataTopic && !DCN_VOTING_EVENTS[event]) this.log.debug(`event ${key} not mapped to a topic`);
    for (const t of topics ?? []) this.queue.add(t);
    this.#schedule();
  }

  /** @param {string} event @param {string | null} time @param {number} [votingId] known from the call or event */
  #applyVoting(event, time, votingId) {
    const prev = this.cache.get('dcnVoting')?.data ?? { state: 'closed', votingId: null, outcome: null, since: null };
    const next = { ...prev, ...DCN_VOTING_EVENTS[event] };
    if (event === 'VotingStart' || event === 'VotingSelect') next.since = time ?? new Date().toISOString();
    if (votingId !== undefined) next.votingId = votingId;
    else if (event === 'VotingStart' && prev.state !== 'ready') next.votingId = null; // e.g. ad-hoc: id follows from dcnActiveVoting
    this.cache.set('dcnVoting', next);
    this.queue.add('dcnActiveVoting');
    this.queue.add('dcnSessionVotings');
  }

  /** The voting id of dcnVoting follows the active voting (set by Select/Start, cleared after Stop). */
  #syncVotingId() {
    const active = this.cache.get('dcnActiveVoting')?.data?.votingId ?? null;
    const v = this.cache.get('dcnVoting')?.data;
    if (v && active !== null && v.votingId !== active) this.cache.set('dcnVoting', { ...v, votingId: active });
  }

  #handleStatus(status) {
    this.#publishBridge();
    // Vendor example: after an AuthorizationChange, re-check what is allowed and resync.
    const key = allowedKey(status);
    if (this.client?.state === 'loggedIn' && key !== this.allowedKey) {
      this.allowedKey = key;
      this.queue.add('*resync');
      this.#schedule();
    }
  }

  #publishBridge() {
    const c = this.client;
    if (!c) return;
    this.cache.set('dcnBridge', { bridge: c.bridgeInfo, status: c.bridgeStatus, constants: c.constants });
  }

  #schedule() {
    if (!this.queue.size || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.#run(() => this.#flush());
    }, this.coalesceMs);
  }

  async #flush() {
    const topics = [...this.queue];
    this.queue.clear();
    if (topics.includes('*resync')) return this.resync();
    // Stage-1 topics depend on the active meeting/session: refresh those ids first if they are queued.
    const byStage = s => topics.filter(t => this.byTopic.get(t)?.stage === s);
    await Promise.all(byStage(0).map(t => this.refreshTopic(t)));
    await Promise.all(byStage(1).map(t => this.refreshTopic(t)));
    return undefined;
  }

  #run(task) {
    this.flushing = this.flushing.then(task).catch(err => this.log.warn(`DCN sync failed: ${err.message}`));
    return this.flushing;
  }
}

const allowedKey = status => JSON.stringify([status?.control?.allowed ?? {}, status?.config?.allowed ?? {}]);
