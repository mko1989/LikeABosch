// DCN Next Generation, read-only, through DCN-SW Streaming Meeting Data (DCN-SWSMD): the DCN-SW server pushes every
// change as frames [Int32 topic][Int32 length][XML] on TCP port 20000. No login: the DCN-SW server accepts clients by IP
// address (AllowedClients in its Server.exe.config) and needs DCN-SWSMD in the CCU licence. There is no snapshot request,
// so the picture fills as activities arrive (the server replays its queue to a new client).
// The parser (smd/frames.js, xml.js, state.js) is LikeABosch's (WO-066), copied unchanged.
import net from 'node:net'
import { SystemBase, badConfig } from './base.js'
import { FrameDecoder } from './smd/frames.js'
import { parseXml } from './smd/xml.js'
import { SmdState } from './smd/state.js'

const personName = (p) => (p ? [p.title, p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') : '')

export class DcnSmdSystem extends SystemBase {
	constructor(config, log) {
		super(config, log)
		this.socket = null
		this.smd = new SmdState()
	}

	connect() {
		const { host, port = 20000 } = this.config
		if (!host) return Promise.reject(badConfig('Enter the address of the DCN-SW server PC'))
		return new Promise((resolve, reject) => {
			const socket = net.connect({ host, port })
			this.socket = socket
			socket.setKeepAlive(true, 10000)
			const decoder = new FrameDecoder()
			let opened = false
			const timer = setTimeout(() => socket.destroy(new Error('no connection within 10 s')), 10000)
			socket.once('connect', () => {
				clearTimeout(timer)
				opened = true
				this.setStatus('ok')
				resolve()
			})
			socket.on('data', (chunk) => {
				let frames
				try { frames = decoder.push(chunk) } catch (err) { socket.destroy(err); return } // out of sync: reconnect
				let changed = false
				for (const f of frames) {
					try { const c = this.smd.apply(parseXml(f.text), { topicName: f.topicName }); if (['seats', 'participants', 'discussion', 'interpretation'].some((k) => c?.has?.(k))) changed = true } catch (err) { this.log('debug', `DCN-SWSMD: ${err.message}`) }
				}
				if (changed) this.#publish()
			})
			socket.on('error', (err) => { clearTimeout(timer); if (!opened) reject(err) })
			socket.on('close', () => {
				if (this.socket !== socket) return
				this.socket = null
				if (opened) this.lost(new Error('DCN-SWSMD stream closed'))
			})
		})
	}

	async disconnect() {
		const s = this.socket
		this.socket = null
		s?.destroy()
	}

	#publish() {
		const seats = this.smd.view('seats')
		const people = new Map(this.smd.view('participants').map((p) => [p.id, p]))
		const deskSeats = new Set(this.smd.view('interpretation').desks.map((d) => d.seatId))
		const personAt = (s) => people.get(s.participantId) ?? [...people.values()].find((p) => p.seatId === s.id) ?? null
		const d = this.smd.view('discussion')
		const prio = new Set(d.priority ?? [])
		const listed = new Set((d.active ?? []).map((e) => e.seatId))
		const seatOf = (e) => String(e.seatId ?? people.get(e.participantId)?.seatId ?? `participant-${e.participantId}`)
		this.update({
			seats: seats.filter((s) => s.seatType !== 'Interpreter' && !deskSeats.has(s.id)).map((s) => ({
				id: String(s.id), name: s.name || `Seat ${s.id}`, person: personName(personAt(s)), connected: true, canPrio: s.seatType === 'Chairman',
			})),
			speakers: [
				...[...prio].filter((id) => !listed.has(id)).map((id) => ({ seatId: String(id), micOn: true, priority: true })),
				...[...(d.active ?? []), ...(d.activeResponses ?? [])].map((e) => ({ seatId: seatOf(e), micOn: true, priority: prio.has(e.seatId) })),
			],
			requests: [...(d.requests ?? []), ...(d.responses ?? [])].map(seatOf),
		})
	}
}
