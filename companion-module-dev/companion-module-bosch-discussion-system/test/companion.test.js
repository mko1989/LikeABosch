// The Companion layer without Companion: action / feedback / variable definitions per system, with a fake system.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionDefinitions } from '../src/actions.js'
import { feedbackDefinitions } from '../src/feedbacks.js'
import { variableDefinitions, variableValues } from '../src/variables.js'
import { findSeat, seatMic, LatestSpeaker, varKey } from '../src/model.js'
import { SYSTEMS } from '../src/capabilities.js'
import { configFields } from '../src/config.js'

/** A system stand-in that records calls. */
function fakeSystem(state = {}) {
	const calls = []
	const record = (name) => async (...args) => { calls.push([name, ...args]) }
	return {
		calls,
		state: {
			seats: [{ id: 'seat-1', name: 'Chairman', person: 'Anna Bos', connected: true, canPrio: true }, { id: 'seat-2', name: 'Seat 2', person: '', connected: true, canPrio: false }, { id: 'seat-3', name: 'Seat 3', person: 'Ben', connected: true, canPrio: false }],
			speakers: [{ seatId: 'seat-2', micOn: true, priority: false }, { seatId: 'seat-3', micOn: false, priority: false }],
			requests: ['seat-1'], power: 'on', volume: { value: 10, min: 0, max: 20 }, voting: null, interpreterDesks: [], info: {},
			...state,
		},
		micOn: record('micOn'), micOff: record('micOff'), mute: record('mute'), requestOn: record('requestOn'), requestOff: record('requestOff'),
		priority: record('priority'), next: record('next'), micsOff: record('micsOff'), requestsClear: record('requestsClear'), discussionClear: record('discussionClear'),
		power: record('power'), volume: record('volume'), votingState: record('votingState'), sensitivity: record('sensitivity'), resetSensitivities: record('resetSensitivities'),
		interpretation: record('interpretation'),
	}
}
const instance = (system, config) => ({ system: system ? fakeSystem() : null, config, logs: [], log(level, msg) { this.logs.push([level, msg]) } })

test('model: mic state, seat references (id / name / number), latest speaker, variable keys', () => {
	const st = fakeSystem().state
	assert.equal(seatMic(st, 'seat-2'), 'on')
	assert.equal(seatMic(st, 'seat-3'), 'muted')
	assert.equal(seatMic(st, 'seat-1'), 'request')
	assert.equal(seatMic(st, 'seat-9'), 'off')
	assert.equal(findSeat(st.seats, 'seat-3').id, 'seat-3')
	assert.equal(findSeat(st.seats, 'chairman').id, 'seat-1')
	assert.equal(findSeat(st.seats, '2').id, 'seat-2')
	assert.equal(findSeat(st.seats, 'nobody'), null)
	const latest = new LatestSpeaker()
	assert.equal(latest.update({ speakers: [{ seatId: 'a' }] }), 'a')
	assert.equal(latest.update({ speakers: [{ seatId: 'a' }, { seatId: 'b' }] }), 'b')
	assert.equal(latest.update({ speakers: [{ seatId: 'a' }] }), 'a')
	assert.equal(latest.update({ speakers: [] }), null)
	assert.equal(varKey('seat-3'), 'seat_3')
})

test('the action list follows the configured system', () => {
	for (const [system, caps] of Object.entries(SYSTEMS)) {
		const ids = Object.keys(actionDefinitions(instance(true, { system })))
		assert.deepEqual(ids.sort(), [...caps.actions].sort(), system)
	}
	assert.deepEqual(Object.keys(actionDefinitions(instance(false, { system: 'dcn-smd' }))), [])
	const opts = actionDefinitions(instance(true, { system: 'dicentis' })).seat_request.options[1].choices.map((c) => c.id)
	assert.deepEqual(opts, ['off'], 'DICENTIS: requests can only be removed')
})

test('seat_mic: toggle / on / off from the current state; on unmutes a muted speaker; unknown seat is logged', async () => {
	const self = instance(true, { system: 'dicentis' })
	const a = actionDefinitions(self).seat_mic
	await a.callback({ options: { seat: 'seat-2', mode: 'toggle' } }) // speaking → off
	await a.callback({ options: { seat: 'Chairman', mode: 'toggle' } }) // waiting → on
	await a.callback({ options: { seat: '3', mode: 'on' } }) // muted → on (unmute)
	await a.callback({ options: { seat: 'seat-2', mode: 'on' } }) // already on → nothing
	await a.callback({ options: { seat: 'nobody', mode: 'on' } })
	assert.deepEqual(self.system.calls, [['micOff', 'seat-2'], ['micOn', 'seat-1'], ['micOn', 'seat-3']])
	assert.match(self.logs.at(-1)[1], /not found/)
})

test('request, priority, mute, power, volume, sensitivity actions call the system', async () => {
	const w = instance(true, { system: 'wireless' })
	const aw = actionDefinitions(w)
	await aw.seat_request.callback({ options: { seat: 'seat-1', mode: 'toggle' } }) // waiting → remove
	await aw.seat_request.callback({ options: { seat: 'seat-2', mode: 'on' } })
	await aw.seat_priority.callback({ options: { seat: 'seat-1', mode: 'toggle' } })
	await aw.power.callback({ options: { state: 'standby' } })
	await aw.voting.callback({ options: { state: 'open' } })
	assert.deepEqual(w.system.calls, [['requestOff', 'seat-1'], ['requestOn', 'seat-2'], ['priority', 'seat-1', true], ['power', 'standby'], ['votingState', 'open']])

	const d = instance(true, { system: 'dicentis' })
	const ad = actionDefinitions(d)
	await ad.seat_mute.callback({ options: { seat: 'seat-2', mode: 'toggle' } })
	await ad.master_volume.callback({ options: { mode: 'up', value: 2 } })
	assert.deepEqual(d.system.calls, [['mute', 'seat-2', true], ['volume', 12]])

	const c = instance(true, { system: 'ccs1000' })
	await actionDefinitions(c).mic_sensitivity.callback({ options: { seat: 'seat-3', db: 4 } })
	assert.deepEqual(c.system.calls, [['sensitivity', 'seat-3', 4]])
})

test('a failing system call is logged, not thrown', async () => {
	const self = instance(true, { system: 'wireless' })
	self.system.next = async () => { throw new Error('HTTP 400 nobody waiting') }
	await actionDefinitions(self).next_speaker.callback({ options: {} })
	assert.deepEqual(self.logs.at(-1), ['error', 'Next speaker: HTTP 400 nobody waiting'])
})

test('feedbacks: seat states, priority, power; per system', () => {
	const self = instance(true, { system: 'wireless' })
	self.system.state.speakers[0].priority = true
	const f = feedbackDefinitions(self)
	const mic = (seat, state) => f.seat_mic.callback({ options: { seat, state } })
	assert.equal(mic('seat-2', 'on'), true)
	assert.equal(mic('seat-3', 'speaking'), true)
	assert.equal(mic('seat-3', 'muted'), true)
	assert.equal(mic('Chairman', 'request'), true)
	assert.equal(mic('seat-2', 'off'), false)
	assert.equal(f.seat_priority.callback({ options: { seat: 'seat-2' } }), true)
	assert.equal(f.power.callback({ options: { state: 'on' } }), true)
	assert.ok(f.voting)
	assert.ok(!feedbackDefinitions(instance(true, { system: 'dcn-smd' })).power, 'no power in the stream')
})

test('variables: definitions per seat, values for speakers, requests, latest speaker', () => {
	const st = fakeSystem().state
	const ids = variableDefinitions(st).map((v) => v.variableId)
	assert.ok(ids.includes('seat_seat_1_mic') && ids.includes('latest_speaker_name') && ids.includes('speaker_4_name'))
	const v = variableValues(st, { latest: 'seat-3', connection: 'ok', system: 'DICENTIS' })
	assert.equal(v.speakers, 2)
	assert.equal(v.speaker_names, 'Seat 2, Ben')
	assert.equal(v.request_names, 'Anna Bos')
	assert.equal(v.latest_speaker_name, 'Ben')
	assert.equal(v.first_request_seat, 'Chairman')
	assert.equal(v.seat_seat_3_mic, 'muted')
	assert.equal(v.master_volume, 10)
})

test('config: the system dropdown lists the four systems; login fields hidden for the stream', () => {
	const fields = configFields()
	assert.deepEqual(fields[0].choices.map((c) => c.id), ['dicentis', 'wireless', 'ccs1000', 'dcn-smd'])
	assert.match(fields.find((f) => f.id === 'username').isVisibleExpression, /dcn-smd/)
})
