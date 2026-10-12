// Module configuration: the system first; the other fields show for the systems that use them.
import { SYSTEMS } from './capabilities.js'

const REST = `$(options:system) == 'wireless' || $(options:system) == 'ccs1000'`

export function configFields() {
	return [
		{
			type: 'dropdown', id: 'system', label: 'System', width: 12, default: 'dicentis',
			choices: Object.entries(SYSTEMS).map(([id, s]) => ({ id, label: s.label })),
		},
		{ type: 'textinput', id: 'host', label: 'Address (IP or host name)', width: 8, default: '' },
		{
			type: 'textinput', id: 'port', label: 'Port (empty = default)', width: 4, default: '',
			tooltip: 'DICENTIS 31416, DICENTIS Wireless / CCS 1000 D 80, DCN-SW meeting data 20000',
		},
		{ type: 'textinput', id: 'username', label: 'User name', width: 6, default: '', isVisibleExpression: `$(options:system) != 'dcn-smd'` },
		{ type: 'textinput', id: 'password', label: 'Password', width: 6, default: '', isVisibleExpression: `$(options:system) != 'dcn-smd'` },
		{
			type: 'checkbox', id: 'override', label: 'Take over the session if this user is logged in elsewhere', width: 12, default: false,
			isVisibleExpression: REST,
		},
		{ type: 'checkbox', id: 'https', label: 'HTTPS', width: 4, default: false, isVisibleExpression: REST },
		{
			type: 'static-text', id: 'help_dicentis', width: 12, label: 'DICENTIS',
			value: 'The DICENTIS server (port 31416, its self-signed certificate is accepted). Use a DICENTIS user with the rights you need (manage meeting for the microphones, system power, master volume, interpretation). Changes arrive as events: no polling.',
			isVisibleExpression: `$(options:system) == 'dicentis'`,
		},
		{
			type: 'static-text', id: 'help_rest', width: 12, label: 'DICENTIS Wireless / CCS 1000 D',
			value: 'The access point (WAP) or control unit (CCSD-CU). Use a user created for Companion: the device allows one session per user, so a user also logged in to the web browser app pushes Companion out (or the other way round with "take over").',
			isVisibleExpression: REST,
		},
		{
			type: 'static-text', id: 'help_smd', width: 12, label: 'DCN Next Generation',
			value: 'Read-only: the DCN-SW server PC (port 20000) streams the meeting data. Add this computer to AllowedClients in the DCN-SW Server.exe.config; the CCU needs the DCN-SWSMD licence. Feedbacks and variables only, no actions.',
			isVisibleExpression: `$(options:system) == 'dcn-smd'`,
		},
	]
}
