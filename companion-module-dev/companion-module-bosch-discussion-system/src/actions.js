// Actions, built from the capability table: only what the configured system supports is offered.
import { systemOf } from './capabilities.js'
import { findSeat, seatChoices, seatMic } from './model.js'

const MODE = (choices) => ({ type: 'dropdown', id: 'mode', label: 'Do', default: choices[0]?.[0] ?? '', choices: choices.map(([id, label]) => ({ id, label })) })

/**
 * @param {{ system: any, config: any, log: (level: string, msg: string) => void }} self  the module instance
 */
export function actionDefinitions(self) {
	const sys = self.system
	const caps = systemOf(self.config)
	const state = sys?.state ?? { seats: [], speakers: [], requests: [], interpreterDesks: [], volume: null }
	const seats = seatChoices(state)
	const seatOption = {
		type: 'dropdown', id: 'seat', label: 'Seat', default: seats[0]?.id ?? '', choices: seats, allowCustom: true,
		tooltip: 'Pick a seat, or type a seat id, a seat name or a seat number (1 = first seat)',
	}
	/** The seat an action names; logs and returns null when there is none. */
	const seatOf = (options) => {
		const seat = findSeat(sys.state.seats, options.seat)
		if (!seat) self.log('warn', `Seat "${options.seat}" not found`)
		return seat
	}
	/** Run a system call; errors go to the log (Companion shows them there). */
	const run = async (what, fn) => {
		try { await fn() } catch (err) { self.log('error', `${what}: ${err.message}`) }
	}

	const all = {
		seat_mic: {
			name: 'Seat: microphone',
			options: [seatOption, MODE([['toggle', 'Toggle'], ['on', 'On'], ['off', 'Off']])],
			callback: ({ options }) => run('Microphone', async () => {
				const seat = seatOf(options)
				if (!seat) return
				const m = seatMic(sys.state, seat.id)
				const speaking = m === 'on' || m === 'muted'
				const on = options.mode === 'on' || (options.mode === 'toggle' && !speaking)
				if (on && m !== 'on') await sys.micOn(seat.id) // also unmutes a muted speaker (DICENTIS)
				if (!on && speaking) await sys.micOff(seat.id)
			}),
		},
		seat_mute: {
			name: 'Seat: mute / unmute a speaker (DICENTIS response mode)',
			options: [seatOption, MODE([['toggle', 'Toggle'], ['mute', 'Mute'], ['unmute', 'Unmute']])],
			callback: ({ options }) => run('Mute', async () => {
				const seat = seatOf(options)
				if (!seat) return
				const m = seatMic(sys.state, seat.id)
				if (m !== 'on' && m !== 'muted') return
				const mute = options.mode === 'mute' || (options.mode === 'toggle' && m === 'on')
				await sys.mute(seat.id, mute)
			}),
		},
		seat_request: {
			name: 'Seat: request to speak',
			options: [seatOption, MODE(caps.requestModes.map((m) => [m, { toggle: 'Toggle', on: 'Add', off: 'Remove' }[m]]))],
			callback: ({ options }) => run('Request', async () => {
				const seat = seatOf(options)
				if (!seat) return
				const waiting = seatMic(sys.state, seat.id) === 'request'
				const add = options.mode === 'on' || (options.mode === 'toggle' && !waiting)
				if (add && !waiting) await sys.requestOn(seat.id)
				if (!add && waiting) await sys.requestOff(seat.id)
			}),
		},
		seat_priority: {
			name: 'Seat: chairman priority',
			options: [seatOption, MODE([['toggle', 'Toggle'], ['on', 'On'], ['off', 'Off']])],
			callback: ({ options }) => run('Priority', async () => {
				const seat = seatOf(options)
				if (!seat) return
				const now = Boolean(sys.state.speakers.find((s) => s.seatId === seat.id)?.priority)
				const on = options.mode === 'on' || (options.mode === 'toggle' && !now)
				if (on !== now) await sys.priority(seat.id, on)
			}),
		},
		next_speaker: { name: 'Next speaker (first request gets the floor)', options: [], callback: () => run('Next speaker', () => sys.next()) },
		mics_off: { name: 'All microphones off (requests stay)', options: [], callback: () => run('All off', () => sys.micsOff()) },
		requests_clear: { name: 'Clear all requests', options: [], callback: () => run('Clear requests', () => sys.requestsClear()) },
		discussion_clear: { name: 'Clear the discussion (speakers and requests)', options: [], callback: () => run('Clear', () => sys.discussionClear()) },
		power: {
			name: 'System power',
			options: [{ type: 'dropdown', id: 'state', label: 'Power', default: caps.power[0], choices: caps.power.map((p) => ({ id: p, label: { on: 'On', standby: 'Standby', off: 'Off' }[p] })) }],
			callback: ({ options }) => run('Power', () => sys.power(options.state)),
		},
		master_volume: {
			name: 'Master volume',
			options: [
				MODE([['set', 'Set to'], ['up', 'Up by'], ['down', 'Down by']]),
				{ type: 'number', id: 'value', label: 'Value', default: 1, min: 0, max: 100, step: 0.5 },
			],
			callback: ({ options }) => run('Master volume', () => {
				const now = sys.state.volume?.value ?? 0
				const v = Number(options.value) || 0
				return sys.volume(options.mode === 'set' ? v : options.mode === 'up' ? now + v : now - v)
			}),
		},
		voting: {
			name: 'Voting: open / hold / close',
			options: [{ type: 'dropdown', id: 'state', label: 'Voting', default: 'open', choices: [{ id: 'open', label: 'Open' }, { id: 'hold', label: 'Hold' }, { id: 'closed', label: 'Close' }] }],
			callback: ({ options }) => run('Voting', () => sys.votingState(options.state)),
		},
		mic_sensitivity: {
			name: 'Seat: microphone sensitivity (CCS 1000 D)',
			options: [seatOption, { type: 'number', id: 'db', label: 'Sensitivity (dB, −6 … +9; 0 = default)', default: 0, min: -6, max: 9, step: 1 }],
			callback: ({ options }) => run('Sensitivity', async () => { const seat = seatOf(options); if (seat) await sys.sensitivity(seat.id, Number(options.db)) }),
		},
		mic_sensitivity_reset: { name: 'All microphone sensitivities back to 0 dB (CCS 1000 D)', options: [], callback: () => run('Sensitivity reset', () => sys.resetSensitivities()) },
		interpretation: {
			name: 'Interpreter desk: microphone',
			options: [
				{ type: 'dropdown', id: 'desk', label: 'Interpreter desk', default: state.interpreterDesks[0]?.id ?? '', choices: state.interpreterDesks.map((d) => ({ id: d.id, label: d.name })), allowCustom: true },
				{ type: 'dropdown', id: 'state', label: 'Microphone', default: 'off', choices: [{ id: 'off', label: 'Off' }, { id: 'activeOnOutputA', label: 'On, output A' }, { id: 'activeOnOutputB', label: 'On, output B' }, { id: 'activeOnOutputC', label: 'On, output C' }] },
			],
			callback: ({ options }) => run('Interpretation', () => sys.interpretation(options.desk, options.state)),
		},
	}
	return Object.fromEntries(caps.actions.filter((id) => all[id]).map((id) => [id, all[id]]))
}
