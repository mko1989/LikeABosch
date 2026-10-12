// Actions: seat microphones etc. through the quick-actions API (DEC-035), the camera director, and raw calls into
// LikeABosch's bridge APIs (dicentis-bridge: full DICENTIS API; dcn-bridge: DCN-SW API) and any other endpoint.
import { seatChoices } from './model.js'

const MODE = [{ id: 'toggle', label: 'Toggle' }, { id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]
const json = (text, what) => {
	if (text === undefined || String(text).trim() === '') return undefined
	try { return JSON.parse(text) } catch (err) { throw new Error(`${what} is not valid JSON: ${err.message}`) }
}

/** @param {{ client: import('./client.js').LikeABoschClient, log: (level: string, msg: string) => void }} self */
export function actionDefinitions(self) {
	const c = self.client
	const seats = seatChoices(c.state)
	const seatOption = {
		type: 'dropdown', id: 'seat', label: 'Seat', default: seats[0]?.id ?? '', choices: seats, allowCustom: true,
		tooltip: 'Pick a seat, or type a seat id, a seat name or a seat number (1 = first seat)',
	}
	const run = async (what, fn) => { try { await fn() } catch (err) { self.log('error', `${what}: ${err.message}`) } }
	const seatAction = (name, kind) => ({
		name, options: [seatOption, { type: 'dropdown', id: 'mode', label: 'Do', default: 'toggle', choices: MODE }],
		callback: ({ options }) => run(name, () => c.quick(`seats/${encodeURIComponent(String(options.seat).trim())}/${kind}/${options.mode}`)),
	})
	return {
		seat_mic: seatAction('Seat: microphone', 'mic'),
		seat_request: seatAction('Seat: request to speak', 'request'),
		seat_priority: seatAction('Seat: chairman priority', 'priority'),
		next_speaker: { name: 'Next speaker (first request gets the floor)', options: [], callback: () => run('Next speaker', () => c.quick('next')) },
		mics_off: { name: 'All microphones off (requests stay)', options: [], callback: () => run('All off', () => c.quick('mics/off')) },
		requests_clear: { name: 'Clear all requests', options: [], callback: () => run('Clear requests', () => c.quick('requests/clear')) },
		discussion_clear: { name: 'Clear the discussion', options: [], callback: () => run('Clear', () => c.quick('discussion/clear')) },
		camera_shot: {
			name: 'Cameras: show a seat / the overview',
			options: [{ ...seatOption, label: 'Seat (empty = overview)', default: '' }],
			callback: ({ options }) => run('Camera shot', () => c.request('POST', '/api/director/shot', { seatId: String(options.seat ?? '').trim() || null })),
		},
		camera_automation: {
			name: 'Cameras: automation on / off',
			options: [{ type: 'dropdown', id: 'mode', label: 'Do', default: 'toggle', choices: MODE }],
			callback: ({ options }) => run('Camera automation', async () => {
				const enabled = options.mode === 'toggle' ? !(await c.request('GET', '/api/director'))?.enabled : options.mode === 'on'
				await c.request('PUT', '/api/room/director', { enabled })
			}),
		},
		dicentis_api: {
			name: 'DICENTIS API call (via the dicentis-bridge)',
			description: 'A DCNM API method through LikeABosch\'s dicentis-bridge, e.g. interface ControlVoting, method …Async, arguments as JSON',
			options: [
				{ type: 'textinput', id: 'api', label: 'Interface (e.g. ControlMeeting)', default: '' },
				{ type: 'textinput', id: 'method', label: 'Method (e.g. RequestActiveMeetingStatusAsync)', default: '' },
				{ type: 'textinput', id: 'args', label: 'Arguments (JSON object)', default: '{}', useVariables: true },
			],
			callback: ({ options }) => run('DICENTIS API', async () => {
				const args = json(await self.parseVariablesInString(options.args), 'Arguments') ?? {}
				await c.request('POST', `/api/dcnm/ops/${encodeURIComponent(options.api)}/${encodeURIComponent(options.method)}`, args)
			}),
		},
		dcn_api: {
			name: 'DCN-SW API call (via the dcn-bridge)',
			description: 'A DCN-SW API method through LikeABosch\'s dcn-bridge, e.g. control.DiscussionApi / SpeakNow { "participantId": 0, "seatId": 3 }',
			options: [
				{ type: 'textinput', id: 'api', label: 'API (e.g. control.DiscussionApi)', default: '' },
				{ type: 'textinput', id: 'method', label: 'Method (e.g. SpeakNow)', default: '' },
				{ type: 'textinput', id: 'args', label: 'Arguments (JSON object)', default: '{}', useVariables: true },
			],
			callback: ({ options }) => run('DCN-SW API', async () => {
				const args = json(await self.parseVariablesInString(options.args), 'Arguments') ?? {}
				await c.request('POST', `/api/dcn/ops/${encodeURIComponent(options.api)}/${encodeURIComponent(options.method)}`, args)
			}),
		},
		api_request: {
			name: 'LikeABosch API request (any endpoint)',
			options: [
				{ type: 'dropdown', id: 'method', label: 'Method', default: 'POST', choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ id: m, label: m })) },
				{ type: 'textinput', id: 'path', label: 'Path (e.g. /api/domain/power)', default: '/api/', useVariables: true },
				{ type: 'textinput', id: 'body', label: 'Body (JSON, optional)', default: '', useVariables: true },
			],
			callback: ({ options }) => run('API request', async () => {
				const path = await self.parseVariablesInString(options.path)
				await c.request(options.method, path.startsWith('/') ? path : `/${path}`, json(await self.parseVariablesInString(options.body), 'Body'))
			}),
		},
	}
}
