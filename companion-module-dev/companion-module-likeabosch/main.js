// LikeABosch for Bitfocus Companion: buttons for the Bosch system LikeABosch is connected to, through its quick-actions
// API (DEC-035) with live feedback from its SSE stream; plus the camera director and LikeABosch's bridge APIs.
import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import { LikeABoschClient } from './src/client.js'
import { configFields } from './src/config.js'
import { actionDefinitions } from './src/actions.js'
import { feedbackDefinitions } from './src/feedbacks.js'
import { variableDefinitions, variableValues } from './src/variables.js'
import { presetDefinitions } from './src/presets.js'
import { seatSignature } from './src/model.js'

const STATUS = {
	connecting: InstanceStatus.Connecting, ok: InstanceStatus.Ok, error: InstanceStatus.ConnectionFailure,
	bad_config: InstanceStatus.BadConfig, disconnected: InstanceStatus.Disconnected,
}

class LikeABoschInstance extends InstanceBase {
	async init(config) { this.config = config; this.#start() }
	async configUpdated(config) { await this.#stop(); this.config = config; this.#start() }
	async destroy() { await this.#stop() }
	getConfigFields() { return configFields() }

	#start() {
		this.signature = null
		this.client = new LikeABoschClient({ host: this.config.host, port: this.config.port })
		this.client.on('status', (status, message) => {
			const offline = status === 'ok' && !this.client.state.connected
			this.updateStatus(offline ? InstanceStatus.UnknownWarning : STATUS[status] ?? InstanceStatus.UnknownWarning,
				offline ? 'LikeABosch runs but is not connected to a Bosch system' : message || null)
			this.#values()
		})
		this.client.on('state', (state) => {
			if (this.client.status === 'ok') {
				this.updateStatus(state.connected ? InstanceStatus.Ok : InstanceStatus.UnknownWarning, state.connected ? null : `LikeABosch: ${state.systemName ?? 'system'} ${state.state}`)
			}
			if (seatSignature(state) !== this.signature) this.#definitions()
			this.#values()
			this.checkFeedbacks()
		})
		this.#definitions()
		this.client.start()
	}

	async #stop() {
		const c = this.client
		this.client = null
		if (c) { c.removeAllListeners(); await c.stop() }
	}

	#definitions() {
		this.signature = seatSignature(this.client.state)
		this.setActionDefinitions(actionDefinitions(this))
		this.setFeedbackDefinitions(feedbackDefinitions(this))
		this.setVariableDefinitions(variableDefinitions(this.client.state))
		this.setPresetDefinitions(presetDefinitions(this.client.state, this.label))
	}

	#values() {
		if (this.client) this.setVariableValues(variableValues(this.client.state, this.client.status))
	}
}

runEntrypoint(LikeABoschInstance, [])
