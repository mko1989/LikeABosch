// Common base of the system connections: status, the shared state model, reconnect with backoff.
// No Companion dependency, so the connections are tested on their own (test/).
import { EventEmitter } from 'node:events'

/**
 * The model every system fills (ids are strings on every system):
 * @typedef {{ id: string, name: string, person: string, connected: boolean, canPrio: boolean }} Seat
 * @typedef {{ seatId: string, micOn: boolean, priority: boolean }} Speaker
 * @typedef {{ seats: Seat[], speakers: Speaker[], requests: string[], power: 'on' | 'standby' | 'off' | 'poweringOn' | 'poweringOff' | null,
 *   volume: { value: number, min: number, max: number } | null, voting: 'closed' | 'open' | 'hold' | null,
 *   interpreterDesks: { id: string, name: string, state: string }[], info: Record<string, string> }} SystemState
 */
export const emptyState = () => ({ seats: [], speakers: [], requests: [], power: null, volume: null, voting: null, interpreterDesks: [], info: {} })

/** Events: `status` (status: 'connecting' | 'ok' | 'error' | 'bad_config' | 'disconnected', message), `state` (SystemState). */
export class SystemBase extends EventEmitter {
	/** @param {Record<string, any>} config  @param {(level: string, msg: string) => void} [log] */
	constructor(config, log = () => {}) {
		super()
		this.config = config
		this.log = log
		this.status = 'disconnected'
		this.message = ''
		/** @type {SystemState} */
		this.state = emptyState()
		this.closed = false
		this.retry = 0
		this.retryTimer = null
		this.retryMinMs = 1000
		this.retryMaxMs = 30000
	}

	setStatus(status, message = '') {
		if (status === this.status && message === this.message) return
		this.status = status
		this.message = message
		this.emit('status', status, message)
	}

	/** Merge into the state and announce it. */
	update(partial) {
		this.state = { ...this.state, ...partial }
		this.emit('state', this.state)
	}

	/** Start (and keep) the connection. Subclasses implement connect() and disconnect(). */
	start() {
		this.closed = false
		this.#attempt()
	}

	#attempt() {
		clearTimeout(this.retryTimer)
		this.setStatus('connecting')
		this.connect().then(
			() => { this.retry = 0 },
			(err) => this.lost(err),
		)
	}

	/** The connection failed or dropped: try again later unless the config is wrong. */
	lost(err) {
		if (this.closed) return
		if (err?.badConfig) { this.setStatus('bad_config', err.message); return }
		this.setStatus('error', err?.message ?? 'connection lost')
		const delay = Math.min(this.retryMaxMs, this.retryMinMs * 2 ** this.retry)
		this.retry += 1
		clearTimeout(this.retryTimer)
		this.retryTimer = setTimeout(() => this.#attempt(), delay)
		this.retryTimer.unref?.()
	}

	async stop() {
		this.closed = true
		clearTimeout(this.retryTimer)
		await this.disconnect().catch(() => {})
		this.setStatus('disconnected')
	}

	/** Speaker entry of a seat, or undefined. */
	speaker(seatId) { return this.state.speakers.find((s) => s.seatId === String(seatId)) }
	isRequest(seatId) { return this.state.requests.includes(String(seatId)) }

	// Overridden by the systems that support them; the action list only offers what the system has (capabilities.js).
	async connect() { throw new Error('not implemented') }
	async disconnect() {}
}

/** An error that retrying will not fix (wrong user / password, missing host). */
export function badConfig(message) {
	const e = new Error(message)
	e.badConfig = true
	return e
}
