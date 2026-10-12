// Variables: who speaks, who waits, per-seat name / person / microphone state, power, volume, voting.
import { seatMic, varKey } from './model.js'

const SPEAKER_SLOTS = 4

export function variableDefinitions(state) {
	const defs = [
		['connection', 'Connection state'], ['system', 'System'],
		['speakers', 'Number of speakers'], ['requests', 'Number of requests'],
		['speaker_names', 'Speakers (names, comma separated)'], ['request_names', 'Requests (names, comma separated)'],
		['latest_speaker_seat', 'Latest speaker: seat name'], ['latest_speaker_person', 'Latest speaker: person'],
		['latest_speaker_name', 'Latest speaker: person, else seat name'], ['latest_speaker_id', 'Latest speaker: seat id'],
		['first_request_seat', 'First request: seat name'], ['first_request_person', 'First request: person'], ['first_request_name', 'First request: person, else seat name'],
		...Array.from({ length: SPEAKER_SLOTS }, (_, i) => [[`speaker_${i + 1}_seat`, `Speaker ${i + 1}: seat name`], [`speaker_${i + 1}_name`, `Speaker ${i + 1}: person, else seat name`]]).flat(),
		['power', 'System power'], ['master_volume', 'Master volume'], ['voting', 'Voting state'],
		...state.seats.flatMap((s) => [
			[`seat_${varKey(s.id)}_name`, `Seat ${s.name}: name`], [`seat_${varKey(s.id)}_person`, `Seat ${s.name}: person`], [`seat_${varKey(s.id)}_mic`, `Seat ${s.name}: microphone (on, muted, request, off)`],
		]),
	]
	return defs.map(([variableId, name]) => ({ variableId, name }))
}

export function variableValues(state, { latest, connection, system }) {
	const seat = (id) => state.seats.find((s) => s.id === id)
	const name = (id) => { const s = seat(id); return s ? s.person || s.name : id ?? '' }
	const values = {
		connection, system,
		speakers: state.speakers.length, requests: state.requests.length,
		speaker_names: state.speakers.map((s) => name(s.seatId)).join(', '),
		request_names: state.requests.map(name).join(', '),
		latest_speaker_seat: seat(latest)?.name ?? '', latest_speaker_person: seat(latest)?.person ?? '', latest_speaker_name: latest ? name(latest) : '', latest_speaker_id: latest ?? '',
		first_request_seat: seat(state.requests[0])?.name ?? '', first_request_person: seat(state.requests[0])?.person ?? '', first_request_name: state.requests[0] ? name(state.requests[0]) : '',
		power: state.power ?? '', master_volume: state.volume?.value ?? '', voting: state.voting ?? '',
	}
	for (let i = 0; i < SPEAKER_SLOTS; i++) {
		const sp = state.speakers[i]
		values[`speaker_${i + 1}_seat`] = sp ? seat(sp.seatId)?.name ?? sp.seatId : ''
		values[`speaker_${i + 1}_name`] = sp ? name(sp.seatId) : ''
	}
	for (const s of state.seats) {
		values[`seat_${varKey(s.id)}_name`] = s.name
		values[`seat_${varKey(s.id)}_person`] = s.person
		values[`seat_${varKey(s.id)}_mic`] = seatMic(state, s.id)
	}
	return values
}
