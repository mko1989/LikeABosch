export function configFields() {
	return [
		{
			type: 'static-text', id: 'info', width: 12, label: 'LikeABosch',
			value: 'Controls the Bosch system LikeABosch is connected to (DICENTIS, DICENTIS Wireless, CCS 1000 D, DCN), including what LikeABosch reaches through its Windows bridges. On another PC than LikeABosch, turn on "LAN access" in the LikeABosch launcher.',
		},
		{ type: 'textinput', id: 'host', label: 'LikeABosch address', width: 8, default: '127.0.0.1' },
		{ type: 'number', id: 'port', label: 'Web port', width: 4, default: 3000, min: 1, max: 65535 },
	]
}
