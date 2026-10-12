// Feedbacks: light a button while a seat speaks / waits / has priority, by power, voting or interpreter state.
import { combineRgb } from '@companion-module/base'
import { systemOf } from './capabilities.js'
import { findSeat, seatChoices, seatMic } from './model.js'

export const RED = combineRgb(204, 0, 0)
export const GREEN = combineRgb(0, 153, 51)
export const AMBER = combineRgb(230, 140, 0)
export const WHITE = combineRgb(255, 255, 255)
export const BLACK = combineRgb(0, 0, 0)

/** @param {{ system: any, config: any }} self */
export function feedbackDefinitions(self) {
	const sys = self.system
	const caps = systemOf(self.config)
	const state = sys?.state ?? { seats: [], speakers: [], requests: [], interpreterDesks: [] }
	const seats = seatChoices(state)
	const seatOption = { type: 'dropdown', id: 'seat', label: 'Seat', default: seats[0]?.id ?? '', choices: seats, allowCustom: true }
	const seatOf = (o) => findSeat(sys?.state.seats ?? [], o.seat)
	const out = {
		seat_mic: {
			type: 'boolean',
			name: 'Seat: microphone state',
			description: 'True while the seat is in the chosen state',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [seatOption, {
				type: 'dropdown', id: 'state', label: 'State', default: 'speaking',
				choices: [
					{ id: 'speaking', label: 'Speaking (microphone on or muted)' }, { id: 'on', label: 'Microphone on' }, { id: 'muted', label: 'Muted speaker' },
					{ id: 'request', label: 'Waiting (request to speak)' }, { id: 'off', label: 'Off' },
				],
			}],
			callback: ({ options }) => {
				const seat = seatOf(options)
				if (!seat) return false
				const m = seatMic(sys.state, seat.id)
				return options.state === 'speaking' ? m === 'on' || m === 'muted' : m === options.state
			},
		},
		seat_priority: {
			type: 'boolean', name: 'Seat: chairman priority active', defaultStyle: { bgcolor: AMBER, color: BLACK }, options: [seatOption],
			callback: ({ options }) => { const seat = seatOf(options); return Boolean(seat && sys.state.speakers.find((s) => s.seatId === seat.id)?.priority) },
		},
		any_speaker: {
			type: 'boolean', name: 'Somebody is speaking', defaultStyle: { bgcolor: RED, color: WHITE }, options: [],
			callback: () => Boolean(sys?.state.speakers.length),
		},
		any_request: {
			type: 'boolean', name: 'Somebody is waiting to speak', defaultStyle: { bgcolor: AMBER, color: BLACK }, options: [],
			callback: () => Boolean(sys?.state.requests.length),
		},
	}
	if (caps.power.length) {
		out.power = {
			type: 'boolean', name: 'System power', defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [{ type: 'dropdown', id: 'state', label: 'Power is', default: 'on', choices: caps.power.map((p) => ({ id: p, label: p })) }],
			callback: ({ options }) => sys?.state.power === options.state,
		}
	}
	if (caps.actions.includes('voting')) {
		out.voting = {
			type: 'boolean', name: 'Voting state', defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [{ type: 'dropdown', id: 'state', label: 'Voting is', default: 'open', choices: ['open', 'hold', 'closed'].map((v) => ({ id: v, label: v })) }],
			callback: ({ options }) => sys?.state.voting === options.state,
		}
	}
	if (caps.actions.includes('interpretation')) {
		out.interpretation = {
			type: 'boolean', name: 'Interpreter desk: microphone on', defaultStyle: { bgcolor: RED, color: WHITE },
			options: [{ type: 'dropdown', id: 'desk', label: 'Interpreter desk', default: state.interpreterDesks[0]?.id ?? '', choices: state.interpreterDesks.map((d) => ({ id: d.id, label: d.name })), allowCustom: true }],
			callback: ({ options }) => (sys?.state.interpreterDesks.find((d) => d.id === options.desk)?.state ?? 'off') !== 'off',
		}
	}
	return out
}
