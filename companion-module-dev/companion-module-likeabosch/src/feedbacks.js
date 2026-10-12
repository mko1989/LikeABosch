import { combineRgb } from '@companion-module/base'
import { findSeat, seatChoices } from './model.js'

export const RED = combineRgb(204, 0, 0)
export const GREEN = combineRgb(0, 153, 51)
export const AMBER = combineRgb(230, 140, 0)
export const WHITE = combineRgb(255, 255, 255)
export const BLACK = combineRgb(0, 0, 0)

/** @param {{ client: import('./client.js').LikeABoschClient }} self */
export function feedbackDefinitions(self) {
	const c = self.client
	const seats = seatChoices(c.state)
	const seatOption = { type: 'dropdown', id: 'seat', label: 'Seat', default: seats[0]?.id ?? '', choices: seats, allowCustom: true }
	const seatOf = (o) => findSeat(c.state.seats, o.seat)
	return {
		seat_mic: {
			type: 'boolean', name: 'Seat: microphone state', defaultStyle: { bgcolor: RED, color: WHITE },
			options: [seatOption, {
				type: 'dropdown', id: 'state', label: 'State', default: 'speaking',
				choices: [{ id: 'speaking', label: 'Speaking (on or muted)' }, { id: 'on', label: 'Microphone on' }, { id: 'muted', label: 'Muted speaker' }, { id: 'request', label: 'Waiting' }, { id: 'off', label: 'Off' }],
			}],
			callback: ({ options }) => {
				const s = seatOf(options)
				if (!s) return false
				return options.state === 'speaking' ? s.mic === 'on' || s.mic === 'muted' : s.mic === options.state
			},
		},
		seat_priority: {
			type: 'boolean', name: 'Seat: chairman priority active', defaultStyle: { bgcolor: AMBER, color: BLACK }, options: [seatOption],
			callback: ({ options }) => Boolean(seatOf(options)?.priority),
		},
		any_speaker: { type: 'boolean', name: 'Somebody is speaking', defaultStyle: { bgcolor: RED, color: WHITE }, options: [], callback: () => c.state.speakers.length > 0 },
		any_request: { type: 'boolean', name: 'Somebody is waiting to speak', defaultStyle: { bgcolor: AMBER, color: BLACK }, options: [], callback: () => c.state.requests.length > 0 },
		system_connected: {
			type: 'boolean', name: 'LikeABosch is connected to the Bosch system', defaultStyle: { bgcolor: GREEN, color: WHITE }, options: [],
			callback: () => Boolean(c.state.connected),
		},
	}
}
