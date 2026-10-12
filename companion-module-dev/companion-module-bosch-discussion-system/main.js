// Bosch discussion systems for Bitfocus Companion: DICENTIS, DICENTIS Wireless, CCS 1000 D and DCN NG meeting data,
// over their network APIs (no bridge). The connection classes live in src/systems; this file only glues them to
// Companion: status, definitions (rebuilt when the seat list changes), variables, feedbacks.
import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import { createSystem, systemOf } from './src/capabilities.js'
import { configFields } from './src/config.js'
import { actionDefinitions } from './src/actions.js'
import { feedbackDefinitions } from './src/feedbacks.js'
import { variableDefinitions, variableValues } from './src/variables.js'
import { presetDefinitions } from './src/presets.js'
import { LatestSpeaker, seatSignature } from './src/model.js'
import { UpgradeScripts } from './src/upgrades.js'

const STATUS = {
	connecting: InstanceStatus.Connecting, ok: InstanceStatus.Ok, error: InstanceStatus.ConnectionFailure,
	bad_config: InstanceStatus.BadConfig, disconnected: InstanceStatus.Disconnected,
}

class BoschDiscussionSystemInstance extends InstanceBase {
	async init(config) {
		this.config = config
		this.#start()
	}

	async configUpdated(config) {
		await this.#stop()
		this.config = config
		this.#start()
	}

	async destroy() {
		await this.#stop()
	}

	getConfigFields() {
		return configFields()
	}

	#start() {
		this.latest = new LatestSpeaker()
		this.signature = null
		this.system = createSystem(this.config, (level, msg) => this.log(level, msg))
		this.system.on('status', (status, message) => {
			this.updateStatus(STATUS[status] ?? InstanceStatus.UnknownWarning, message || null)
			this.#values()
		})
		this.system.on('state', () => this.#changed())
		this.#definitions()
		this.system.start()
	}

	async #stop() {
		clearTimeout(this.timer)
		const sys = this.system
		this.system = null
		if (sys) { sys.removeAllListeners(); await sys.stop() }
	}

	/** State changes come in bursts (one per refreshed resource): handle them together. */
	#changed() {
		if (this.timer) return
		this.timer = setTimeout(() => {
			this.timer = null
			if (!this.system) return
			this.latest.update(this.system.state)
			if (seatSignature(this.system.state) !== this.signature) this.#definitions()
			this.#values()
			this.checkFeedbacks()
		}, 30)
	}

	#definitions() {
		const state = this.system.state
		this.signature = seatSignature(state)
		this.setActionDefinitions(actionDefinitions(this))
		this.setFeedbackDefinitions(feedbackDefinitions(this))
		this.setVariableDefinitions(variableDefinitions(state))
		this.setPresetDefinitions(presetDefinitions(state, systemOf(this.config), this.label))
	}

	#values() {
		if (!this.system) return
		this.setVariableValues(variableValues(this.system.state, {
			latest: this.latest.id, connection: this.system.status, system: systemOf(this.config).label,
		}))
	}
}

runEntrypoint(BoschDiscussionSystemInstance, UpgradeScripts)
