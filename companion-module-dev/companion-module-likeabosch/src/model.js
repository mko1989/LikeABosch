// Pure helpers on LikeABosch's quick state (seats already carry their microphone state).

/** "Seat 3 (Anna Bos)" */
export const seatLabel = (s) => (s.person ? `${s.name} (${s.person})` : s.name)
export const seatChoices = (state) => state.seats.map((s) => ({ id: s.id, label: seatLabel(s) }))
/** Same rules as the quick-actions API: id, else name (case-insensitive), else 1-based position. */
export function findSeat(seats, ref) {
	const key = String(ref ?? '').trim()
	const lower = key.toLowerCase()
	return seats.find((s) => s.id === key) ?? seats.find((s) => s.name.trim().toLowerCase() === lower)
		?? (/^\d+$/.test(key) ? seats[Number(key) - 1] : undefined) ?? null
}
/** A Companion variable id part from a seat id ("seat-3" → "seat_3"). */
export const varKey = (id) => String(id).replace(/[^A-Za-z0-9_]/g, '_')
export const seatSignature = (state) => JSON.stringify(state.seats.map((s) => [s.id, s.name, s.person]))
