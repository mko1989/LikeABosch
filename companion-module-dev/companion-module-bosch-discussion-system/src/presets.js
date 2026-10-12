// Presets: ready-made Companion buttons for the seats, the discussion, power, voting, volume and interpreter desks.
// Only the actions the configured system offers are used (src/capabilities.js); display-only buttons need no action.
import { RED, GREEN, AMBER, WHITE, BLACK } from './feedbacks.js'
import { varKey } from './model.js'

const MAX_SEATS = 200
const POWER_LABEL = { on: 'Power on', standby: 'Power standby', off: 'Power off' }

/** An action call inside a button step. */
const act = (actionId, options = {}) => ({ actionId, options })

/** A boolean feedback with the colours it lights the button in. */
const lit = (feedbackId, options, bgcolor, color = WHITE) => ({ feedbackId, options, style: { bgcolor, color } })

/** A button: its down-press actions (none makes it display-only) and its feedbacks. */
const button = (category, name, text, down = [], feedbacks = [], color = WHITE, bgcolor = BLACK) => ({
	type: 'button',
	category,
	name,
	style: { text, size: 'auto', color, bgcolor },
	steps: [{ down, up: [] }],
	feedbacks,
})

/**
 * @param {{ seats: { id: string, name: string, person: string }[], interpreterDesks: { id: string, name: string }[] }} state
 * @param {{ actions: string[], power: string[] }} caps  one entry of SYSTEMS (src/capabilities.js)
 * @param {string} label  the instance label, used in the variable references
 * @returns {import('@companion-module/base').CompanionPresetDefinitions}
 */
export function presetDefinitions(state, caps, label) {
	const has = (action) => caps.actions.includes(action)
	const v = (name) => `$(${label}:${name})`
	const presets = {}
	/** A preset id not used yet (stable: the same seat list gives the same ids). */
	const uniqueId = (base) => {
		let id = base
		for (let n = 2; id in presets; n++) id = `${base}_${n}`
		return id
	}

	// Seats: one button per seat, lit by its microphone state.
	for (const seat of state.seats.slice(0, MAX_SEATS)) {
		const id = uniqueId(`seat_${varKey(seat.id)}`)
		presets[id] = button(
			'Seats', seat.name, `$(${label}:seat_${varKey(seat.id)}_name)`,
			has('seat_mic') ? [act('seat_mic', { seat: seat.id, mode: 'toggle' })] : [],
			[
				lit('seat_mic', { seat: seat.id, state: 'on' }, RED),
				lit('seat_mic', { seat: seat.id, state: 'muted' }, AMBER, BLACK),
				lit('seat_mic', { seat: seat.id, state: 'request' }, GREEN),
			],
		)
	}

	// Discussion: the actions that every system with the action offers, and the speaker displays.
	const discussion = [['next_speaker', 'Next speaker'], ['mics_off', 'All mics off'], ['requests_clear', 'Clear requests'], ['discussion_clear', 'Clear discussion']]
	for (const [action, name] of discussion) {
		if (has(action)) presets[action] = button('Discussion', name, name, [act(action)])
	}
	presets.latest_speaker = button('Discussion', 'Latest speaker', v('latest_speaker_name'), [], [lit('any_speaker', {}, RED)])
	presets.speakers_count = button('Discussion', 'Speakers / requests', `Speak ${v('speakers')}\nWait ${v('requests')}`)

	// System: power, voting, volume and the CCS 1000 D sensitivity reset.
	for (const power of caps.power) {
		const name = POWER_LABEL[power] ?? `Power ${power}`
		presets[`power_${power}`] = button('System', name, name, [act('power', { state: power })], [lit('power', { state: power }, GREEN)])
	}
	if (has('voting')) {
		for (const [state, name] of [['open', 'Voting open'], ['hold', 'Voting hold'], ['closed', 'Voting close']]) {
			presets[`voting_${state}`] = button('System', name, name, [act('voting', { state })], [lit('voting', { state }, GREEN)])
		}
	}
	if (has('master_volume')) {
		presets.volume_up = button('System', 'Volume up', 'Volume up', [act('master_volume', { mode: 'up', value: 1 })])
		presets.volume_down = button('System', 'Volume down', 'Volume down', [act('master_volume', { mode: 'down', value: 1 })])
		presets.volume_display = button('System', 'Master volume', v('master_volume'))
	}
	if (has('mic_sensitivity_reset')) {
		presets.mic_sensitivity_reset = button('System', 'Sensitivity reset', 'Sensitivity reset', [act('mic_sensitivity_reset')])
	}

	// Interpretation: per interpreter desk, its microphone on output A and off.
	if (has('interpretation')) {
		for (const desk of state.interpreterDesks) {
			const base = `interp_${varKey(desk.id)}`
			presets[uniqueId(`${base}_on`)] = button('Interpretation', `${desk.name} A on`, `${desk.name} A on`,
				[act('interpretation', { desk: desk.id, state: 'activeOnOutputA' })], [lit('interpretation', { desk: desk.id }, RED)])
			presets[uniqueId(`${base}_off`)] = button('Interpretation', `${desk.name} off`, `${desk.name} off`,
				[act('interpretation', { desk: desk.id, state: 'off' })])
		}
	}
	return presets
}
