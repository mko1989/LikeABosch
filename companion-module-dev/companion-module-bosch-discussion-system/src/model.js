// Pure helpers on the common state (no Companion dependency; tested in test/companion.test.js).

/** Microphone state of a seat: 'on' | 'muted' | 'request' | 'off'. */
export function seatMic(state, seatId) {
	const id = String(seatId)
	const sp = state.speakers.find((s) => s.seatId === id)
	if (sp) return sp.micOn ? 'on' : 'muted'
	return state.requests.includes(id) ? 'request' : 'off'
}

/**
 * A seat from what a button says: the seat id, else the seat name (case-insensitive), else its position (1 = first).
 * Same rules as LikeABosch's quick-actions API (DEC-035), so buttons read the same in both modules.
 */
export function findSeat(seats, ref) {
	const key = String(ref ?? '').trim()
	const lower = key.toLowerCase()
	return seats.find((s) => s.id === key) ?? seats.find((s) => s.name.trim().toLowerCase() === lower)
		?? (/^\d+$/.test(key) ? seats[Number(key) - 1] : undefined) ?? null
}

/** "Seat 3 (Anna Bos)" */
export const seatLabel = (s) => (s.person ? `${s.name} (${s.person})` : s.name)

/** Seat dropdown choices. */
export const seatChoices = (state) => state.seats.map((s) => ({ id: s.id, label: seatLabel(s) }))

/** A Companion variable id part from a seat id ("seat-3" → "seat_3"). */
export const varKey = (id) => String(id).replace(/[^A-Za-z0-9_]/g, '_')

/** Seat list signature: when it changes, the action / feedback / preset / variable definitions are rebuilt. */
export const seatSignature = (state) => JSON.stringify([state.seats.map((s) => [s.id, s.name, s.person]), state.interpreterDesks.map((d) => d.id)])

/** Keeps the seat that started speaking last ("latest speaker"). */
export class LatestSpeaker {
	constructor() { this.id = null; this.previous = new Set() }
	update(state) {
		const now = state.speakers.map((s) => s.seatId)
		const added = now.filter((id) => !this.previous.has(id))
		if (added.length) this.id = added.at(-1)
		else if (!now.includes(this.id)) this.id = now.at(-1) ?? null
		this.previous = new Set(now)
		return this.id
	}
}
