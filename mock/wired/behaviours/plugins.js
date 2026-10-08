// Plugin registry, events and commands (WO-032). Queues are drained by GetPluginEventData / GetPluginCommands,
// like on the real 6.50 server. SendPluginCommand resolves only when the plugin owner answers via SetPluginCommandResult.
let correlation = 0;

const registry = state => (state.plugins ??= {
  plugins: new Map(),        // name → { name, interface, commands, events, owner }
  subscriptions: [],         // { conn, pluginName, eventName }
  eventQueues: new Map(),    // conn → [events]
  commandQueues: new Map(),  // owner conn → [commands]
  pending: new Map(),        // correlationId → resolve
});

const plugin = (ctx, name) => registry(ctx.state).plugins.get(name) ?? ctx.fail(`Unable to perform the operation: plugin '${name}' is not registered`);

export default {
  GetPlugins: ({ state }) => ({ plugins: [...registry(state).plugins.keys()] }),
  GetPlugin: (ctx, { pluginName }) => {
    const p = plugin(ctx, pluginName);
    return {
      pluginDescriptionResponse: {
        name: p.name, interface: p.interface, description: null,
        commands: p.commands.map(c => ({ name: c.name, description: null, requestSchema: null, responseSchema: null })),
        events: p.events.map(e => ({ name: e.name, description: null, eventSchema: null })),
      },
    };
  },
  RegisterPlugin: (ctx, { pluginName, pluginInterface = '', pluginCommands = [], pluginEvents = [] }) => {
    if (!pluginName) ctx.fail('pluginName is required');
    registry(ctx.state).plugins.set(pluginName, { name: pluginName, interface: pluginInterface, commands: pluginCommands, events: pluginEvents, owner: ctx.conn });
    ctx.fire('pluginsChanged');
    return {};
  },
  UnRegisterPlugin: (ctx, { pluginName }) => {
    plugin(ctx, pluginName);
    const r = registry(ctx.state);
    r.plugins.delete(pluginName);
    r.subscriptions = r.subscriptions.filter(s => s.pluginName !== pluginName);
    ctx.fire('pluginsChanged');
    return {};
  },
  SubscribePluginEvent: (ctx, { pluginName, eventName }) => {
    plugin(ctx, pluginName);
    registry(ctx.state).subscriptions.push({ conn: ctx.conn, pluginName, eventName });
    return {};
  },
  UnSubscribePluginEvent: (ctx, { pluginName, eventName }) => {
    const r = registry(ctx.state);
    r.subscriptions = r.subscriptions.filter(s => !(s.conn === ctx.conn && s.pluginName === pluginName && s.eventName === eventName));
    return {};
  },
  SendPluginEvent: (ctx, { pluginName, event, parameters = '' }) => {
    plugin(ctx, pluginName);
    const r = registry(ctx.state);
    for (const sub of r.subscriptions.filter(s => s.pluginName === pluginName && s.eventName === event)) {
      r.eventQueues.set(sub.conn, [...(r.eventQueues.get(sub.conn) ?? []), { pluginName, event, parameters }]);
      ctx.fireTo(sub.conn, 'pluginEventAvailable');
    }
    return {};
  },
  GetPluginEventData: ctx => {
    const r = registry(ctx.state);
    const items = r.eventQueues.get(ctx.conn) ?? [];
    r.eventQueues.delete(ctx.conn);
    return { pluginEventsData: items };
  },
  SendPluginCommand: (ctx, { pluginName, command, parameters = '' }) => {
    const p = plugin(ctx, pluginName);
    const r = registry(ctx.state);
    const correlationId = `corr-${++correlation}`;
    r.commandQueues.set(p.owner, [...(r.commandQueues.get(p.owner) ?? []), { correlationId, pluginCommand: { pluginName, command, parameters } }]); // real 6.50 shape
    ctx.fireTo(p.owner, 'pluginCommandAvailable');
    return new Promise((resolve, reject) => {
      r.pending.set(correlationId, result => resolve({ response: result }));
      setTimeout(() => { if (r.pending.delete(correlationId)) reject(new Error(`Unable to perform the operation: no result for ${command}`)); }, 30_000).unref();
    });
  },
  GetPluginCommands: ctx => {
    const r = registry(ctx.state);
    const items = r.commandQueues.get(ctx.conn) ?? [];
    r.commandQueues.delete(ctx.conn);
    return { pluginCommands: items };
  },
  SetPluginCommandResult: (ctx, { correlationId, result = '' }) => {
    const r = registry(ctx.state);
    const resolve = r.pending.get(correlationId) ?? ctx.fail(`Unknown correlationId '${correlationId}'`);
    r.pending.delete(correlationId);
    resolve(result);
    return {};
  },
};
