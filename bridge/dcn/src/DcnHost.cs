// dcn-bridge request handling on the shared bridge server (bridge/common): connect/call/status/disconnect on the
// DCN-SW API through ApiHost (docs/protocol/dcn-swapi/BRIDGE.md). Requests run one at a time in arrival order on one
// worker thread (the DCN-SW API's thread safety is undocumented), which also builds hello and polls the status.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using BridgeCore;

namespace DcnBridge
{
    public sealed class DcnHost : IBridgeHost
    {
        readonly ApiHost api;
        readonly Log log;
        readonly SerialWorker worker;
        string lastStatus = "";
        Timer statusPoll;

        public event Action<Dictionary<string, object>> Push;
        public string Name => "dcn-bridge";

        public DcnHost(ApiHost api, Log log)
        {
            this.api = api;
            this.log = log;
            worker = new SerialWorker("api worker", log);
            api.ApiEvent += (key, name, args) => Push?.Invoke(new Dictionary<string, object>
            {
                ["type"] = "event", ["api"] = key, ["event"] = name, ["args"] = args, ["time"] = DateTime.UtcNow.ToString("o"),
            });
            api.StatusChanged += () => worker.Post(() => PushStatus(force: true));
        }

        /// <summary>Push status changes even if the API raises no Availability/AuthorizationChange (and to catch flag changes).</summary>
        public void Start() => statusPoll = new Timer(_ => worker.Post(() => PushStatus(force: false)), null, 2000, 2000);

        public void Stop()
        {
            statusPoll?.Dispose();
            worker.Stop();
        }

        void PushStatus(bool force)
        {
            var status = api.Status();
            var text = Json.Write(status);
            if (!force && text == lastStatus) return;
            lastStatus = text;
            Push?.Invoke(new Dictionary<string, object> { ["type"] = "status", ["status"] = status });
        }

        public Dictionary<string, object> BridgeInfo() => new Dictionary<string, object>
        {
            ["apiVersion"] = api.ApiVersion, ["fake"] = api.Fake, ["dllPath"] = api.DllPath,
        };

        // Built on the worker so it never races an Initialize in progress.
        public Task<Dictionary<string, object>> HelloExtras() => worker.Run(() => new Dictionary<string, object>
        {
            ["constants"] = api.Constants(),
            ["status"] = api.Status(),
        });

        public Task<object> Handle(string type, Dictionary<string, object> msg) => worker.Run<object>(() =>
        {
            switch (type)
            {
                case "status": return api.Status();
                case "connect":
                {
                    var server = BridgeServer.Str(msg, "server");
                    var user = BridgeServer.Str(msg, "user");
                    var password = msg.TryGetValue("password", out var pw) ? pw as string ?? "" : "";
                    var roots = msg.TryGetValue("roots", out var r) && r is List<object> list ? list.OfType<string>().ToList() : api.Roots.Keys.ToList();
                    return api.Connect(server, user, password, roots);
                }
                case "disconnect":
                    api.TerminateAll();
                    return new Dictionary<string, object>();
                case "call":
                {
                    var key = BridgeServer.Str(msg, "api");
                    var method = BridgeServer.Str(msg, "method");
                    var args = msg.TryGetValue("args", out var a) ? a as Dictionary<string, object> : null;
                    if (a != null && args == null) throw new BridgeError("BAD_REQUEST", "args must be an object");
                    var result = api.Call(key, method, args ?? new Dictionary<string, object>());
                    log.Debug($"{key}.{method} → {result["returns"]}");
                    return result;
                }
                default: throw new BridgeError("BAD_REQUEST", "unknown type " + (type ?? "(none)"));
            }
        });
    }
}
