// The systems this module talks to and what each one can do. The action, feedback and preset lists are built from
// this table, so Companion offers only what the configured system supports.
import { DicentisSystem } from './systems/dicentis.js'
import { RestSystem } from './systems/rest.js'
import { DcnSmdSystem } from './systems/dcn-smd.js'

export const SYSTEMS = {
	dicentis: {
		label: 'DICENTIS (wired, Conference Protocol)',
		defaultPort: 31416,
		login: true,
		actions: ['seat_mic', 'seat_mute', 'seat_request', 'next_speaker', 'mics_off', 'requests_clear', 'discussion_clear', 'power', 'master_volume', 'interpretation'],
		requestModes: ['off'], // requests are made at the seat; LikeABosch / the Conference Protocol can only remove them
		power: ['on', 'off'],
	},
	wireless: {
		label: 'DICENTIS Wireless (WAP, REST)',
		defaultPort: 80,
		login: true,
		actions: ['seat_mic', 'seat_request', 'seat_priority', 'next_speaker', 'mics_off', 'requests_clear', 'discussion_clear', 'power', 'voting'],
		requestModes: ['toggle', 'on', 'off'],
		power: ['on', 'standby', 'off'],
	},
	ccs1000: {
		label: 'CCS 1000 D (CCSD-CU, REST)',
		defaultPort: 80,
		login: true,
		actions: ['seat_mic', 'seat_request', 'seat_priority', 'next_speaker', 'mics_off', 'requests_clear', 'discussion_clear', 'power', 'mic_sensitivity', 'mic_sensitivity_reset'],
		requestModes: ['toggle', 'on', 'off'],
		power: ['on', 'standby'],
	},
	'dcn-smd': {
		label: 'DCN Next Generation (meeting data stream, read-only)',
		defaultPort: 20000,
		login: false,
		actions: [], // the stream is read-only: feedbacks and variables only
		requestModes: [],
		power: [],
	},
}

export const systemOf = (config) => SYSTEMS[config?.system] ?? SYSTEMS.dicentis

/** The connection object for a module config. */
export function createSystem(config, log) {
	const c = { ...config, port: Number(config.port) || systemOf(config).defaultPort }
	switch (config.system) {
		case 'wireless': return new RestSystem({ ...c, variant: 'wireless' }, log)
		case 'ccs1000': return new RestSystem({ ...c, variant: 'ccs1000' }, log)
		case 'dcn-smd': return new DcnSmdSystem(c, log)
		default: return new DicentisSystem(c, log)
	}
}
