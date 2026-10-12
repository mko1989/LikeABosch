// DICENTIS Wireless (WAP, REST API 1.7) and CCS 1000 D (CCSD-CU, REST API 1.8): the same REST dialect. What LikeABosch
// learned on a real WAP (firmware 1.73):
// - the session id comes as cookie `sid` (and in the login body); send it as header `Bosch-Sid` and as cookie
//   (the swagger's header name `sid` is refused);
// - one session per user: a second login answers 409 unless `override` is sent (it takes the session over);
// - `?isPolling=true` holds a GET until that resource changes or ~50 s pass: live data without hammering the device;
//   one long-poll per path and session; with many requests in flight the WAP parks one, so keep the number small;
// - a 401 later means the session expired: log in again once.
// CCS 1000 D: no participants and no voting; power on / standby only; microphone sensitivity per seat (0..15 = −6…+9 dB).
import { SystemBase, badConfig } from './base.js'

const POWER = ['on', 'standby', 'off']
const VOTING = ['closed', 'open', 'hold']

export class RestSystem extends SystemBase {
	/** @param {{ variant: 'wireless' | 'ccs1000' }} config */
	constructor(config, log) {
		super(config, log)
		this.variant = config.variant === 'ccs1000' ? 'ccs1000' : 'wireless'
		this.product = this.variant === 'ccs1000' ? 'CCS 1000 D' : 'DICENTIS Wireless'
		this.sid = null
		this.generation = 0
		this.aborts = new Set()
		this.raw = { seats: [], speakers: [], waiting: [] }
		this.loginPromise = null
	}

	get baseUrl() {
		const { host, port, https } = this.config
		return `${https ? 'https' : 'http'}://${host}:${port || (https ? 443 : 80)}/api`
	}

	/** Paths kept live with long-polls. */
	get livePaths() {
		return ['/seats', '/speakers', '/waiting-list', '/system/status', ...(this.variant === 'wireless' ? ['/voting/state'] : [])]
	}

	async connect() {
		if (!this.config.host) throw badConfig(`Enter the ${this.product} address`)
		await this.#login()
		const info = await this.request('GET', '/system-info').catch(() => null)
		if (info) this.update({ info: { name: info.Hostname ?? '', type: info['System Type'] ?? '', firmware: info.Versions?.Firmware ?? '' } })
		await Promise.all(this.livePaths.map((p) => this.#fetch(p)))
		this.setStatus('ok')
		const generation = ++this.generation
		this.livePaths.forEach((p, i) => setTimeout(() => this.#loop(p, generation), 150 * i).unref?.())
	}

	async disconnect() {
		this.generation += 1
		for (const a of this.aborts) a.abort()
		this.aborts.clear()
		if (this.sid) await this.request('POST', '/logout', undefined, { timeoutMs: 2000, noRelogin: true }).catch(() => {})
		this.sid = null
	}

	async #login() {
		const { username, password, override } = this.config
		const res = await fetch(`${this.baseUrl}/login`, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ username: username ?? '', password: password ?? '', ...(override ? { override: true } : {}) }),
			// The WAP answers a login only after the previous session's long-polls ended (~48 s).
			signal: AbortSignal.timeout(60000),
		})
		if (res.status === 401) throw badConfig(`${this.product} login failed for user '${username}'`)
		if (res.status === 409) throw badConfig(`User '${username}' is already logged in elsewhere: use another user or enable "Take over the session"`)
		if (!res.ok) throw new Error(`${this.product} login: HTTP ${res.status}`)
		const cookie = res.headers.getSetCookie?.().find((c) => c.startsWith('sid=')) ?? res.headers.get('set-cookie') ?? ''
		const body = await res.json().catch(() => null)
		const sid = /sid=([^;,\s]+)/.exec(cookie)?.[1] ?? (typeof body?.sid === 'string' ? body.sid : undefined)
		if (!sid) throw new Error('The login answer had no session id')
		this.sid = sid
	}

	/**
	 * One REST call → parsed JSON or null.
	 * @param {string} method @param {string} path without /api @param {unknown} [body]
	 * @param {{ timeoutMs?: number, poll?: boolean, noRelogin?: boolean, signal?: AbortSignal }} [opts]
	 */
	async request(method, path, body, { timeoutMs = 10000, poll = false, noRelogin = false, signal } = {}) {
		for (let relogged = false; ;) {
			if (!this.sid) throw new Error(`Not connected to ${this.product}`)
			const url = `${this.baseUrl}${path}${poll ? '?isPolling=true' : ''}`
			const timeout = AbortSignal.timeout(timeoutMs)
			const res = await fetch(url, {
				method,
				headers: { 'bosch-sid': this.sid, cookie: `sid=${this.sid}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
			})
			if (res.status === 401 && !relogged && !noRelogin) {
				relogged = true
				this.loginPromise ??= this.#login().finally(() => { this.loginPromise = null })
				await this.loginPromise
				continue
			}
			const text = await res.text()
			if (!res.ok) {
				let detail = text
				try { const j = JSON.parse(text); detail = j?.error?.details ?? j?.error?.description ?? text } catch { /* plain text */ }
				throw new Error(`${method} ${path}: HTTP ${res.status} ${detail}`.trim())
			}
			return text ? JSON.parse(text) : null
		}
	}

	/** Long-poll loop of one path: answered at once on a change, else after ~50 s; then the next one. */
	async #loop(path, generation) {
		while (generation === this.generation && !this.closed) {
			const abort = new AbortController()
			this.aborts.add(abort)
			const started = Date.now()
			try {
				const data = await this.request('GET', path, undefined, { poll: true, timeoutMs: 65000, signal: abort.signal })
				if (generation !== this.generation) return
				this.#take(path, data)
				const wait = 250 - (Date.now() - started) // never hammer the device when answers come back at once
				if (wait > 0) await new Promise((r) => setTimeout(r, wait))
			} catch (err) {
				if (generation !== this.generation || this.closed) return
				if (err.name === 'TimeoutError') continue // held past our timeout: just poll again
				this.generation += 1 // stop the other loops; reconnect starts them again
				this.sid = null
				this.lost(err)
				return
			} finally {
				this.aborts.delete(abort)
			}
		}
	}

	async #fetch(path) {
		const data = await this.request('GET', path).catch((err) => { this.log('debug', `${path}: ${err.message}`); return undefined })
		if (data !== undefined) this.#take(path, data)
	}

	/** After an own write: fetch the paths it changed right away, not waiting for the long-poll. */
	async #after(...paths) { await Promise.all(paths.map((p) => this.#fetch(p))) }

	#take(path, data) {
		switch (path) {
			case '/seats': this.raw.seats = Array.isArray(data) ? data : []; break
			case '/speakers': this.raw.speakers = Array.isArray(data) ? data : []; break
			case '/waiting-list': this.raw.waiting = Array.isArray(data) ? data : []; break
			case '/system/status': this.update({ power: POWER[data?.state] ?? null }); return
			case '/voting/state': this.update({ voting: VOTING[data?.state] ?? null }); return
			default: return
		}
		const people = new Map([...this.raw.speakers, ...this.raw.waiting].filter((e) => e.name && e.name !== e.seatName).map((e) => [String(e.id), e.name]))
		this.update({
			seats: this.raw.seats.map((s) => ({ id: String(s.id), name: s.name, person: people.get(String(s.id)) ?? '', connected: Boolean(s.connected), canPrio: Boolean(s.prio) })),
			speakers: this.raw.speakers.map((e) => ({ seatId: String(e.id), micOn: e.micOn !== false, priority: Boolean(e.prioOn) })),
			requests: this.raw.waiting.map((e) => String(e.id)),
		})
	}

	// ------------------------------------------------------------------ actions
	#id(seatId) {
		const n = Number(seatId)
		if (!Number.isInteger(n)) throw new Error(`${this.product} seat ids are numbers (got "${seatId}")`)
		return n
	}
	async micOn(seatId) { await this.request('POST', '/speakers', [this.#id(seatId)]); await this.#after('/speakers', '/waiting-list') }
	async micOff(seatId) {
		const prio = this.speaker(seatId)?.priority
		await this.request('DELETE', `${prio ? '/priority' : '/speakers'}/${this.#id(seatId)}`)
		await this.#after('/speakers')
	}
	async requestOn(seatId) { await this.request('POST', '/waiting-list', [this.#id(seatId)]); await this.#after('/waiting-list') }
	async requestOff(seatId) { await this.request('DELETE', `/waiting-list/${this.#id(seatId)}`); await this.#after('/waiting-list') }
	async priority(seatId, on) {
		if (on) await this.request('POST', '/priority', [this.#id(seatId)])
		else await this.request('DELETE', `/priority/${this.#id(seatId)}`)
		await this.#after('/speakers')
	}
	/** The first waiting seat gets the floor (named explicitly: the swagger requires the seat list). */
	async next() { const first = this.state.requests[0]; if (first) await this.micOn(first) }
	async micsOff() { for (const s of [...this.state.speakers]) await this.micOff(s.seatId) }
	async requestsClear() { await this.request('DELETE', '/waiting-list'); await this.#after('/waiting-list') }
	/** Speakers and waiting list (priority calls stay, microphone off). */
	async discussionClear() { await this.request('DELETE', '/speakers'); await this.#after('/speakers', '/waiting-list') }
	async power(state) {
		const i = POWER.indexOf(state)
		if (i < 0 || (this.variant === 'ccs1000' && state === 'off')) throw new Error(`${this.product}: power ${state} is not possible`)
		await this.request('PUT', '/system/status', { state: i })
		await this.#after('/system/status')
	}
	async votingState(state) {
		await this.request('PUT', '/voting/state', { state: VOTING.indexOf(state) })
		await this.#after('/voting/state')
	}
	/** CCS 1000 D: dB −6…+9 → step 0..15. */
	sensitivity(seatId, db) { return this.request('PUT', `/seats/microphonesensitivity/${this.#id(seatId)}`, { sensitivity: Math.round(Math.min(9, Math.max(-6, db)) + 6) }) }
	resetSensitivities() { return this.request('POST', '/seats/resetmicrophonesensitivities') }
}
