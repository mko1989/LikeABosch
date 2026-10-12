// The four system connections against LikeABosch's protocol mocks (the LikeABosch repository next to this module:
// ../../mock). Run: npm test
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createSystem, SYSTEMS } from '../src/capabilities.js'
import { createMockWiredServer } from '../../../mock/wired/server.js'
import { createMockWirelessServer } from '../../../mock/wireless/server.js'
import { createMockSmdServer } from '../../../mock/dcn-smd/server.js'

/** Wait until the system's state satisfies a predicate. */
const until = (sys, pred, ms = 4000) => new Promise((resolve, reject) => {
	const check = () => { if (pred(sys.state)) { sys.off('state', check); clearTimeout(t); resolve(sys.state) } }
	const t = setTimeout(() => { sys.off('state', check); reject(new Error(`condition not reached; state: ${JSON.stringify({ speakers: sys.state.speakers, requests: sys.state.requests, power: sys.state.power })}`)) }, ms)
	sys.on('state', check)
	check()
})
const started = (sys) => new Promise((resolve, reject) => {
	sys.on('status', (s, m) => { if (s === 'ok') resolve(); if (s === 'bad_config') reject(new Error(m)) })
	sys.start()
})
const mic = (st, id) => st.speakers.find((s) => s.seatId === id)

test('capability table: every system names its actions; the stream has none', () => {
	assert.ok(SYSTEMS.dicentis.actions.includes('master_volume'))
	assert.ok(!SYSTEMS.dicentis.actions.includes('seat_priority'))
	assert.ok(SYSTEMS.ccs1000.actions.includes('mic_sensitivity'))
	assert.ok(!SYSTEMS.ccs1000.actions.includes('voting'))
	assert.deepEqual(SYSTEMS['dcn-smd'].actions, [])
})

describe('DICENTIS (Conference Protocol)', () => {
	let mock, sys
	before(async () => {
		mock = await createMockWiredServer()
		sys = createSystem({ system: 'dicentis', host: '127.0.0.1', port: mock.port, username: 'admin', password: 'admin' })
		await started(sys)
	})
	after(async () => { await sys.stop(); await mock.close() })

	test('seats, power and volume after login (events registered, no polling)', async () => {
		await until(sys, (s) => s.seats.length === 20 && s.power === 'on' && s.volume)
		assert.equal(sys.state.seats[0].name, 'Chairman')
		await sys.discussionClear()
		await until(sys, (s) => !s.speakers.length && !s.requests.length)
	})

	test('mic on / off follow the discussion list events', async () => {
		await sys.micOn('seat-3')
		assert.ok(mic(await until(sys, (s) => mic(s, 'seat-3')), 'seat-3').micOn)
		await sys.micOff('seat-3')
		await until(sys, (s) => !mic(s, 'seat-3'))
	})

	test('full speaker list: the 5th becomes a request, is promoted when the others go; requests clear', async () => {
		for (const n of [2, 4, 5, 6, 7]) await sys.micOn(`seat-${n}`) // 4 speakers max: the 5th becomes a request
		await until(sys, (s) => s.speakers.length === 4 && s.requests[0] === 'seat-7')
		await sys.micsOff() // the server promotes the waiting seat when places free up
		await until(sys, (s) => s.speakers.length === 1 && s.speakers[0].seatId === 'seat-7' && !s.requests.length)
		await sys.micsOff()
		await until(sys, (s) => !s.speakers.length)
		for (const n of [2, 3, 4, 5, 6]) await sys.micOn(`seat-${n}`)
		await until(sys, (s) => s.requests[0] === 'seat-6')
		await sys.requestsClear()
		await until(sys, (s) => !s.requests.length && s.speakers.length === 4)
		await sys.discussionClear()
		await until(sys, (s) => !s.speakers.length)
	})

	test('a change made at a seat arrives as an event', async () => {
		mock.fire?.('discussionListChanged') // nothing changed: no state change expected, but no error either
		mock.state.discussion.push({ seatId: 'seat-9', speakerType: 'isRequest', microphoneState: 'off', screenLine: '', isFirst: true })
		mock.fire('discussionListChanged')
		await until(sys, (s) => s.requests.includes('seat-9'))
		await sys.requestsClear()
	})

	test('master volume within the range', async () => {
		await sys.volume(12)
		await until(sys, (s) => s.volume.value === 12)
		await sys.volume(999)
		await until(sys, (s) => s.volume.value === s.volume.max)
	})

	test('wrong password → bad_config, no retry loop', async () => {
		const bad = createSystem({ system: 'dicentis', host: '127.0.0.1', port: mock.port, username: 'admin', password: 'nope' })
		await assert.rejects(started(bad), /login failed/)
		assert.equal(bad.status, 'bad_config')
		await bad.stop()
	})
})

for (const variant of ['wireless', 'ccs1000']) {
	describe(`${variant} (REST)`, () => {
		let mock, sys
		before(async () => {
			mock = await createMockWirelessServer({ longPollMs: 2000, variant: variant === 'ccs1000' ? 'ccs1000' : 'wap' })
			sys = createSystem({ system: variant, host: '127.0.0.1', port: mock.port, username: 'admin', password: 'admin' })
			await started(sys)
		})
		after(async () => { await sys.stop(); await mock.close() })

		test('seats and power after login', async () => {
			const st = await until(sys, (s) => s.seats.length === 20 && s.power === 'on')
			assert.equal(st.seats[0].canPrio, true)
		})

		test('mic on / off, request, next, priority', async () => {
			await sys.micOn('3')
			await until(sys, (s) => mic(s, '3'))
			await sys.micOff('3')
			await until(sys, (s) => !mic(s, '3'))
			await sys.requestOn('7')
			await until(sys, (s) => s.requests.includes('7'))
			await sys.next()
			await until(sys, (s) => mic(s, '7') && !s.requests.includes('7'))
			await sys.priority('1', true)
			await until(sys, (s) => mic(s, '1')?.priority)
			await sys.priority('1', false)
			await until(sys, (s) => !mic(s, '1'))
			await sys.discussionClear()
			await until(sys, (s) => !s.speakers.length)
		})

		test('a seat pressing its button arrives through the long-poll', async () => {
			mock.requestToSpeak(9)
			await until(sys, (s) => s.requests.includes('9'))
			await sys.requestsClear()
			await until(sys, (s) => !s.requests.length)
		})

		test('power standby and on', async () => {
			await sys.power('standby')
			await until(sys, (s) => s.power === 'standby')
			await sys.power('on')
			await until(sys, (s) => s.power === 'on')
		})

		if (variant === 'ccs1000') {
			test('CCS 1000 D: microphone sensitivity in dB, reset; no power off', async () => {
				await sys.sensitivity('4', 3)
				assert.equal(mock.state.sensitivity.get(4), 9)
				await sys.resetSensitivities()
				assert.equal(mock.state.sensitivity.get(4), 6)
				await assert.rejects(sys.power('off'), /not possible/)
			})
		} else {
			test('Wireless: voting state', async () => {
				await sys.votingState('open')
				await until(sys, (s) => s.voting === 'open')
				await sys.votingState('closed')
				await until(sys, (s) => s.voting === 'closed')
			})
		}

		test('session expired on the device → logs in again by itself', async () => {
			mock.expireSessions()
			await sys.micOn('5')
			await until(sys, (s) => mic(s, '5'))
			await sys.micOff('5')
		})
	})
}

describe('DCN NG meeting data (read-only stream)', () => {
	let mock, sys
	before(async () => {
		mock = await createMockSmdServer({ seats: 8 })
		sys = createSystem({ system: 'dcn-smd', host: '127.0.0.1', port: mock.port })
		await started(sys)
	})
	after(async () => { await sys.stop(); await mock.close() })

	test('seats with participants, live speakers and requests from the stream', async () => {
		const st = await until(sys, (s) => s.seats.length === 8)
		assert.equal(st.seats[0].canPrio, true)
		assert.ok(st.seats.some((s) => s.person))
		mock.micOn(3)
		await until(sys, (s) => mic(s, '3'))
		mock.requestToSpeak(4)
		await until(sys, (s) => s.requests.includes('4'))
		mock.micOff(3)
		await until(sys, (s) => !mic(s, '3'))
	})
})
