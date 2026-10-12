// Client of LikeABosch's quick-actions API (DEC-035): GET /api/quick for the state, the SSE stream /api/quick/events
// for every change (no polling), POST for the actions. Reconnects by itself.
import { EventEmitter } from 'node:events'

/** Events: `status` ('connecting' | 'ok' | 'error' | 'bad_config' | 'disconnected', message), `state` (quick state). */
export class LikeABoschClient extends EventEmitter {
	/** @param {{ host: string, port?: number | string }} config */
	constructor(config) {
		super()
		this.config = config
		this.status = 'disconnected'
		this.message = ''
		/** the quick state (see LikeABosch docs/api/quick.md) */
		this.state = { connected: false, state: 'disconnected', system: null, systemName: null, seats: [], speakers: [], requests: [], latestSpeaker: null, firstRequest: null }
		this.abort = null
		this.closed = false
		this.retry = 0
		this.timer = null
	}

	get baseUrl() { return `http://${this.config.host}:${Number(this.config.port) || 3000}` }

	#status(status, message = '') {
		if (status === this.status && message === this.message) return
		this.status = status
		this.message = message
		this.emit('status', status, message)
	}

	start() {
		this.closed = false
		if (!this.config.host) { this.#status('bad_config', 'Enter the address of the PC running LikeABosch'); return }
		this.#stream()
	}

	async stop() {
		this.closed = true
		clearTimeout(this.timer)
		this.abort?.abort()
		this.#status('disconnected')
	}

	/** Read the SSE stream: each `state` event replaces the state. */
	async #stream() {
		this.#status('connecting')
		const abort = new AbortController()
		this.abort = abort
		try {
			const res = await fetch(`${this.baseUrl}/api/quick/events`, { signal: abort.signal, headers: { accept: 'text/event-stream' } })
			if (res.status === 404) throw Object.assign(new Error('This LikeABosch version has no quick-actions API: update LikeABosch'), { badConfig: true })
			if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
			this.retry = 0
			this.#status('ok')
			const decoder = new TextDecoder()
			let buf = ''
			for await (const chunk of res.body) {
				buf += decoder.decode(chunk, { stream: true })
				let i
				while ((i = buf.indexOf('\n\n')) >= 0) {
					const block = buf.slice(0, i)
					buf = buf.slice(i + 2)
					const event = /^event: (.*)$/m.exec(block)?.[1]
					const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n')
					if (event === 'state' && data) {
						try { this.state = JSON.parse(data); this.emit('state', this.state) } catch { /* ignore a broken event */ }
					}
				}
			}
			throw new Error('LikeABosch closed the stream')
		} catch (err) {
			if (this.closed || abort.signal.aborted) return
			if (err.badConfig) { this.#status('bad_config', err.message); return }
			this.#status('error', `${this.baseUrl}: ${err.cause?.code ?? err.message}`)
			const delay = Math.min(30000, 1000 * 2 ** this.retry++)
			this.timer = setTimeout(() => this.#stream(), delay)
			this.timer.unref?.()
		}
	}

	/**
	 * Any LikeABosch API call → `data` of its envelope; throws with LikeABosch's error message.
	 * @param {string} method @param {string} path e.g. "/api/quick/next" @param {unknown} [body]
	 */
	async request(method, path, body) {
		const res = await fetch(`${this.baseUrl}${path}`, {
			method,
			headers: body === undefined ? {} : { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(15000),
		})
		const json = await res.json().catch(() => null)
		if (!res.ok || json?.ok === false) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
		return json?.data ?? null
	}

	/** A quick action: POST /api/quick/<path>. */
	quick(path) { return this.request('POST', `/api/quick/${path}`) }
}
