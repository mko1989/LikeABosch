import { varKey } from './model.js'

const SLOTS = 4

export function variableDefinitions(state) {
	return [
		['connection', 'Connection to LikeABosch'], ['system', 'Bosch system'], ['system_state', 'Bosch system connection state'],
		['speakers', 'Number of speakers'], ['requests', 'Number of requests'],
		['speaker_names', 'Speakers (names, comma separated)'], ['request_names', 'Requests (names, comma separated)'],
		['latest_speaker_seat', 'Latest speaker: seat name'], ['latest_speaker_person', 'Latest speaker: person'], ['latest_speaker_name', 'Latest speaker: person, else seat name'], ['latest_speaker_id', 'Latest speaker: seat id'],
		['first_request_seat', 'First request: seat name'], ['first_request_person', 'First request: person'], ['first_request_name', 'First request: person, else seat name'],
		...Array.from({ length: SLOTS }, (_, i) => [[`speaker_${i + 1}_seat`, `Speaker ${i + 1}: seat name`], [`speaker_${i + 1}_name`, `Speaker ${i + 1}: person, else seat name`]]).flat(),
		...state.seats.flatMap((s) => [[`seat_${varKey(s.id)}_name`, `Seat ${s.name}: name`], [`seat_${varKey(s.id)}_person`, `Seat ${s.name}: person`], [`seat_${varKey(s.id)}_mic`, `Seat ${s.name}: microphone (on, muted, request, off)`]]),
	].map(([variableId, name]) => ({ variableId, name }))
}

export function variableValues(state, connection) {
	const byId = new Map(state.seats.map((s) => [s.id, s]))
	const name = (id) => { const s = byId.get(id); return s ? s.person || s.name : id ?? '' }
	const v = {
		connection, system: state.systemName ?? '', system_state: state.state ?? '',
		speakers: state.speakers.length, requests: state.requests.length,
		speaker_names: state.speakers.map(name).join(', '), request_names: state.requests.map(name).join(', '),
		latest_speaker_seat: state.latestSpeaker?.name ?? '', latest_speaker_person: state.latestSpeaker?.person ?? '',
		latest_speaker_name: state.latestSpeaker ? state.latestSpeaker.person || state.latestSpeaker.name : '', latest_speaker_id: state.latestSpeaker?.id ?? '',
		first_request_seat: state.firstRequest?.name ?? '', first_request_person: state.firstRequest?.person ?? '',
		first_request_name: state.firstRequest ? state.firstRequest.person || state.firstRequest.name : '',
	}
	for (let i = 0; i < SLOTS; i++) {
		const id = state.speakers[i]
		v[`speaker_${i + 1}_seat`] = id ? byId.get(id)?.name ?? id : ''
		v[`speaker_${i + 1}_name`] = id ? name(id) : ''
	}
	for (const s of state.seats) {
		v[`seat_${varKey(s.id)}_name`] = s.name
		v[`seat_${varKey(s.id)}_person`] = s.person
		v[`seat_${varKey(s.id)}_mic`] = s.mic
	}
	return v
}
