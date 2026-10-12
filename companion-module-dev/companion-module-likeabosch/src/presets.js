// Presets: a button per seat (microphone toggle, lit by its state), the discussion, cameras, displays.
import { RED, GREEN, AMBER, WHITE, BLACK } from './feedbacks.js'
import { varKey } from './model.js'

const MAX_SEATS = 200
const act = (actionId, options = {}) => ({ actionId, options })
const lit = (feedbackId, options, bgcolor, color = WHITE) => ({ feedbackId, options, style: { bgcolor, color } })
const button = (category, name, text, down = [], feedbacks = []) => ({
	type: 'button', category, name, style: { text, size: 'auto', color: WHITE, bgcolor: BLACK }, steps: [{ down, up: [] }], feedbacks,
})

/** @param {{ seats: { id: string, name: string }[] }} state  @param {string} label instance label for variables */
export function presetDefinitions(state, label) {
	const v = (name) => `$(${label}:${name})`
	const presets = {}
	for (const seat of state.seats.slice(0, MAX_SEATS)) {
		let id = `seat_${varKey(seat.id)}`
		for (let n = 2; id in presets; n++) id = `seat_${varKey(seat.id)}_${n}`
		presets[id] = button('Seats', seat.name, v(`seat_${varKey(seat.id)}_name`), [act('seat_mic', { seat: seat.id, mode: 'toggle' })], [
			lit('seat_mic', { seat: seat.id, state: 'on' }, RED),
			lit('seat_mic', { seat: seat.id, state: 'muted' }, AMBER, BLACK),
			lit('seat_mic', { seat: seat.id, state: 'request' }, GREEN),
		])
	}
	for (const [action, name] of [['next_speaker', 'Next speaker'], ['mics_off', 'All mics off'], ['requests_clear', 'Clear requests'], ['discussion_clear', 'Clear discussion']]) {
		presets[action] = button('Discussion', name, name, [act(action)], action === 'next_speaker' ? [lit('any_request', {}, GREEN)] : [])
	}
	presets.latest_speaker = button('Discussion', 'Latest speaker', v('latest_speaker_name'), [], [lit('any_speaker', {}, RED)])
	presets.counts = button('Discussion', 'Speakers / requests', `Speak ${v('speakers')}\nWait ${v('requests')}`)
	presets.camera_overview = button('Cameras', 'Overview', 'Overview', [act('camera_shot', { seat: '' })])
	presets.camera_automation = button('Cameras', 'Camera automation', 'Auto cams', [act('camera_automation', { mode: 'toggle' })])
	presets.system = button('System', 'Bosch system', v('system'), [], [lit('system_connected', {}, GREEN)])
	return presets
}
