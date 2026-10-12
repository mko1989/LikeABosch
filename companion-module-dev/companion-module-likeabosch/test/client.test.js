// The module's client and actions against a real LikeABosch backend (from the repository two folders up) connected
// to a simulated wired DICENTIS with the full API (linked mock dicentis-bridge): quick actions, live state over SSE,
// the camera director, the DICENTIS API passthrough, reconnect.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { start } from '../../../backend/src/server.js'
import { loadConfig } from '../../../backend/src/config.js'
import { LikeABoschClient } from '../src/client.js'
import { actionDefinitions } from '../src/actions.js'
import { feedbackDefinitions } from '../src/feedbacks.js'
import { variableDefinitions, variableValues } from '../src/variables.js'
import { presetDefinitions } from '../src/presets.js'

let backend, dataDir, client
const self = { logs: [], log(level, msg) { this.logs.push([level, msg]) }, parseVariablesInString: async (t) => t }
const until = (pred, ms = 6000) => new Promise((resolve, reject) => {
	const check = () => { if (pred(client.state)) { client.off('state', check); clearTimeout(t); resolve(client.state) } }
	const t = setTimeout(() => { client.off('state', check); reject(new Error(`not reached: ${JSON.stringify({ c: client.state.connected, sp: client.state.speakers, rq: client.state.requests })}`)) }, ms)
	client.on('state', check)
	check()
})

before(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'lab-companion-'))
	backend = await start(loadConfig({ PORT: '0', LOG_LEVEL: 'silent', DATA_DIR: dataDir, DICENTIS_AUTOCONNECT: 'false' }))
	const api = (m, p, b) => fetch(`${backend.url}/api${p}`, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })
	await api('PUT', '/connection/settings', { simulators: [{ id: 'sim-c', name: 'Hall', type: 'wired', seats: 10 }], simulate: 'sim-c' })
	await api('POST', '/connection/connect', {})
	const port = new URL(backend.url).port
	client = new LikeABoschClient({ host: '127.0.0.1', port })
	self.client = client
	client.start()
	await until((s) => s.connected && s.seats.length === 10)
})
after(async () => { await client?.stop(); await backend?.close(); rmSync(dataDir, { recursive: true, force: true }) })

test('live state over SSE: system, seats', () => {
	assert.equal(client.status, 'ok')
	assert.equal(client.state.system, 'wired')
	assert.equal(client.state.seats[0].name, 'Chairman')
})

test('seat microphone toggle by id, name and number; feedbacks and variables follow', async () => {
	const a = actionDefinitions(self)
	const f = feedbackDefinitions(self)
	await a.discussion_clear.callback({ options: {} })
	await until((s) => !s.speakers.length)
	await a.seat_mic.callback({ options: { seat: 'seat-3', mode: 'toggle' } })
	await until((s) => s.speakers.includes('seat-3'))
	assert.equal(f.seat_mic.callback({ options: { seat: 'seat-3', state: 'speaking' } }), true)
	assert.equal(f.any_speaker.callback(), true)
	await a.seat_mic.callback({ options: { seat: 'Seat 4', mode: 'on' } })
	await a.seat_mic.callback({ options: { seat: '5', mode: 'on' } })
	await until((s) => s.speakers.includes('seat-4') && s.speakers.includes('seat-5'))
	const v = variableValues(client.state, client.status)
	assert.equal(v.speakers, 3)
	assert.equal(v.latest_speaker_id, 'seat-5')
	assert.equal(v.seat_seat_3_mic, 'on')
	await a.mics_off.callback({ options: {} })
	await until((s) => !s.speakers.length)
	assert.deepEqual(self.logs, [])
})

test('errors from LikeABosch are logged with its message (wired has no "add request")', async () => {
	await actionDefinitions(self).seat_request.callback({ options: { seat: 'seat-2', mode: 'on' } })
	assert.match(self.logs.at(-1)[1], /not supported/i)
})

test('cameras: automation toggle and overview through the director', async () => {
	const a = actionDefinitions(self)
	const before = (await client.request('GET', '/api/director')).enabled
	await a.camera_automation.callback({ options: { mode: 'toggle' } })
	assert.equal((await client.request('GET', '/api/director')).enabled, !before)
	await a.camera_automation.callback({ options: { mode: 'toggle' } })
	await a.camera_shot.callback({ options: { seat: '' } })
})

test('bridge API: a DICENTIS API call through LikeABosch\'s dicentis-bridge', async () => {
	const n = self.logs.length
	await actionDefinitions(self).dicentis_api.callback({ options: { api: 'ControlMeeting', method: 'RequestActiveMeetingStatusAsync', args: '{}' } })
	assert.equal(self.logs.length, n, JSON.stringify(self.logs.slice(n)))
	await actionDefinitions(self).dicentis_api.callback({ options: { api: 'ControlMeeting', method: 'Nope', args: '{}' } })
	assert.equal(self.logs.length, n + 1)
})

test('definitions: variables per seat, presets per seat', () => {
	assert.ok(variableDefinitions(client.state).some((d) => d.variableId === 'seat_seat_10_mic'))
	const p = presetDefinitions(client.state, 'lab')
	assert.equal(Object.keys(p).filter((k) => k.startsWith('seat_')).length, 10)
})

test('reconnects after LikeABosch was away', async () => {
	const port = new URL(backend.url).port
	const c2 = new LikeABoschClient({ host: '127.0.0.1', port: 1 }) // nothing listens on port 1
	const errored = new Promise((r) => c2.on('status', (s) => { if (s === 'error') r() }))
	c2.start()
	await errored
	await c2.stop()
	assert.ok(port)
})
