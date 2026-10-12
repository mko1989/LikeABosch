// DICENTIS (wired) over the Conference Protocol: JSON over secure WebSocket, wss://<host>:31416/Dicentis/API, subprotocol
// DICENTIS_1_0. What LikeABosch learned on real servers (6.50 / 7.0): log in, register the events, fetch once; every
// event is announced once and re-armed by fetching with its Get operation, so there is no polling at all.
// Requests carry a messageId (never 0); events arrive with messageId 0 and operation "event".
import WebSocket from 'ws'
import { SystemBase, badConfig } from './base.js'

/** event → the Get operation that refreshes it (and re-arms the event) */
const EVENTS = {
	seatsChanged: 'GetSeats',
	discussionListChanged: 'GetDiscussionList',
	masterVolumeChanged: 'GetMasterVolume',
	masterVolumeRangeChanged: 'GetMasterVolumeRange',
	systemPowerModeChanged: 'GetSystemPowerMode',
	interpreterSeatsChanged: 'GetInterpreterSeats',
	interpretationRoutingsChanged: 'GetInterpretationRoutings',
}
const SPEAKING = new Set(['isSpeaker', 'isPrioritySpeaker', 'isResponder', 'isImportant'])
const WAITING = new Set(['isRequest', 'isResponseRequest'])
const POWER = { poweredOn: 'on', poweredOff: 'off', poweringOn: 'poweringOn', poweringOff: 'poweringOff' }

export class DicentisSystem extends SystemBase {
	constructor(config, log) {
		super(config, log)
		this.ws = null
		this.nextId = 1
		this.pending = new Map()
		this.raw = { seats: [], discussion: [], interpreterSeats: [], routings: [] }
	}

	connect() {
		const { host, port = 31416, username, password } = this.config
		if (!host) return Promise.reject(badConfig('Enter the DICENTIS server address'))
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(`wss://${host}:${port}/Dicentis/API`, 'DICENTIS_1_0', { rejectUnauthorized: false, handshakeTimeout: 10000 })
			this.ws = ws
			let opened = false
			ws.on('open', async () => {
				opened = true
				try {
					const res = await this.request('Login', { user: username ?? '', password: password ?? '' })
					if (!res.loggedIn) throw badConfig(`DICENTIS login failed for user '${username}'`)
					await this.#registerEvents()
					await Promise.all(Object.values(EVENTS).map((op) => this.#refresh(op)))
					this.setStatus('ok')
					resolve()
				} catch (err) {
					reject(err)
					ws.terminate()
				}
			})
			ws.on('message', (data) => this.#message(data))
			ws.on('error', (err) => { if (!opened) reject(err) })
			ws.on('close', () => {
				if (this.ws !== ws) return
				this.ws = null
				for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('connection closed')) }
				this.pending.clear()
				if (opened && this.status === 'ok') this.lost(new Error('connection to the DICENTIS server lost'))
			})
		})
	}

	async disconnect() {
		const ws = this.ws
		this.ws = null
		ws?.close()
	}

	/** One Conference Protocol operation → its response parameters. */
	request(operation, parameters = {}, timeoutMs = 10000) {
		const ws = this.ws
		if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected to the DICENTIS server'))
		const messageId = this.nextId
		this.nextId = this.nextId >= 2 ** 31 - 1 ? 1 : this.nextId + 1
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => { this.pending.delete(messageId); reject(new Error(`${operation} timed out`)) }, timeoutMs)
			this.pending.set(messageId, { resolve, reject, timer, operation })
			ws.send(JSON.stringify({ messageId, operation, parameters }))
		})
	}

	#message(data) {
		let msg
		try { msg = JSON.parse(data.toString()) } catch { return }
		if (msg.messageId === 0 && msg.operation === 'event') {
			for (const event of msg.parameters?.events ?? []) {
				const op = EVENTS[event] ?? EVENTS[event.charAt(0).toLowerCase() + event.slice(1)] // servers send "DiscussionListChanged"
				if (op) this.#refresh(op).catch(() => this.request('RegisterEvents', { events: [event] }).catch(() => {}))
			}
			return
		}
		const p = this.pending.get(msg.messageId)
		if (!p) return
		this.pending.delete(msg.messageId)
		clearTimeout(p.timer)
		if (msg.operation === 'error') p.reject(new Error(`${p.operation}: ${msg.parameters?.message ?? 'error'}`))
		else p.resolve(msg.parameters ?? {})
	}

	/** One registration per event: an event the user may not see (permission) or the server lacks must not stop the rest. */
	async #registerEvents() {
		for (const event of Object.keys(EVENTS)) {
			await this.request('RegisterEvents', { events: [event] }).catch((err) => this.log('debug', `event ${event}: ${err.message}`))
		}
	}

	async #refresh(op) {
		const r = await this.request(op).catch((err) => { this.log('debug', `${op}: ${err.message}`); return null })
		if (!r) return
		switch (op) {
			case 'GetSeats': this.raw.seats = r.seats ?? []; break
			case 'GetDiscussionList': this.raw.discussion = r.discussionList ?? []; break
			case 'GetMasterVolume': this.update({ volume: { min: 0, max: 20, ...this.state.volume, value: r.volume } }); return
			case 'GetMasterVolumeRange': this.update({ volume: { value: 0, ...this.state.volume, min: r.range?.minimumVolume ?? 0, max: r.range?.maximumVolume ?? 20 } }); return
			case 'GetSystemPowerMode': this.update({ power: POWER[r.powerMode] ?? null }); return
			case 'GetInterpreterSeats': this.raw.interpreterSeats = r.seats ?? []; break
			case 'GetInterpretationRoutings': this.raw.routings = r.routings ?? []; break
		}
		this.#publish()
	}

	#publish() {
		const seats = this.raw.seats.map((s) => ({
			id: s.seatId, name: s.seatName || s.seatId, person: s.screenLine && s.screenLine !== s.seatName ? s.screenLine : '',
			connected: String(s.status).toLowerCase() !== 'disconnected', canPrio: Boolean(s.canPrio),
		}))
		const list = this.raw.discussion
		const routing = new Map(this.raw.routings.map((r) => [r.seatId, r.microphoneState]))
		this.update({
			seats,
			speakers: list.filter((e) => SPEAKING.has(e.speakerType)).map((e) => ({ seatId: e.seatId, micOn: e.microphoneState === 'on', priority: e.speakerType === 'isPrioritySpeaker' })),
			requests: list.filter((e) => WAITING.has(e.speakerType)).map((e) => e.seatId),
			interpreterDesks: this.raw.interpreterSeats.map((d) => ({ id: d.seatId, name: `Booth desk ${d.deskNumber}`, state: routing.get(d.seatId) ?? 'off' })),
		})
	}

	// ------------------------------------------------------------------ actions
	micOn(seatId) {
		const sp = this.speaker(seatId)
		if (sp && !sp.micOn) return this.request('ActivateMicrophone', { seatId })
		return this.request('AddSeatToSpeakers', { seatId })
	}
	micOff(seatId) { return this.request('RemoveSeatFromDiscussionList', { seatId }) }
	requestOff(seatId) { return this.request('RemoveSeatFromDiscussionList', { seatId }) }
	mute(seatId, muted) { return this.request(muted ? 'DeactivateMicrophone' : 'ActivateMicrophone', { seatId }) }
	async next() {
		const first = this.state.requests[0]
		if (first) await this.request('AddSeatToSpeakers', { seatId: first })
	}
	/** No single "clear" in the Conference Protocol: every speaker / request on its own. */
	async micsOff() { for (const s of [...this.state.speakers]) await this.micOff(s.seatId) }
	async requestsClear() { for (const id of [...this.state.requests]) await this.requestOff(id) }
	async discussionClear() { await this.micsOff(); await this.requestsClear() }
	power(state) { return this.request('SetSystemPowerMode', { powerMode: state === 'on' ? 'poweredOn' : 'poweredOff' }) }
	volume(value) {
		const v = this.state.volume
		return this.request('SetMasterVolume', { volume: v ? Math.min(v.max, Math.max(v.min, value)) : value })
	}
	interpretation(seatId, microphoneState) { return this.request('GrantInterpretation', { seatId, microphoneState }) }
}
