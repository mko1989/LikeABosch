// dicentis-bridge entry point (WO-078, DEC-021). Usage: see README.md / --help.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using BridgeCore;

namespace DicentisBridge
{
    public static class Program
    {
        const string Help = @"dicentis-bridge: LikeABosch bridge to the Bosch DICENTIS DCNM API (docs/protocol/dcnm-api/BRIDGE.md)

  --listen <address>   default 127.0.0.1            (env DICENTIS_BRIDGE_LISTEN); 0.0.0.0 to serve other PCs
  --port <port>        default 9481                 (env DICENTIS_BRIDGE_PORT)
  --token <secret>     optional: only clients with this token are accepted (env DICENTIS_BRIDGE_TOKEN); default none (DEC-019)
  --dll-dir <folder>   DICENTIS installation folder (with Bosch.Dcnm.Interfaces.Api.dll), in quotes if it contains spaces;
                       default: next to dicentis-bridge.exe, else C:\Program Files\Bosch\DICENTIS (env DICENTIS_BRIDGE_DLL_DIR)
  --config <file>      JSON file with the same keys (listen, port, token, dllDir, verbose); default dicentis-bridge.config.json next to the exe
  --fake               serve a built-in stub of the documented API instead of the Bosch DLLs (protocol tests)
  --selftest           load the DLLs, list what reflection finds, compare with api.json, exit
  --verbose            log every call";

        static readonly HashSet<string> Flags = new HashSet<string> { "fake", "selftest", "verbose", "help" };
        static readonly HashSet<string> PathKeys = new HashSet<string> { "dllDir", "config" };

        public static int Main(string[] argv)
        {
            var log = new Log();
            try
            {
                var opt = Options.Parse(argv, "dicentis-bridge.config.json", Flags, PathKeys);
                if (opt.ContainsKey("help")) { Console.WriteLine(Help); return 0; }
                log.Verbose = opt.ContainsKey("verbose");
                var spec = LoadSpec();
                var other = spec == null ? null : ((Dictionary<string, object>)spec["otherInterfaces"]).Keys.ToList();
                var host = opt.ContainsKey("fake")
                    ? DcnmHost.LoadFake(log, other)
                    : DcnmHost.LoadReal(Options.Get(opt, "dllDir", "DICENTIS_BRIDGE_DLL_DIR", null) ?? DcnmHost.FindDllDir(log), log, other);
                if (opt.ContainsKey("selftest")) return SelfTest(host, spec);

                var token = Options.Get(opt, "token", "DICENTIS_BRIDGE_TOKEN", null) ?? "";
                var port = int.Parse(Options.Get(opt, "port", "DICENTIS_BRIDGE_PORT", "9481"));
                var listen = IPAddress.Parse(Options.Get(opt, "listen", "DICENTIS_BRIDGE_LISTEN", "127.0.0.1"));

                var server = new BridgeServer(host, listen, port, token, log);
                server.Start();
                if (token.Length == 0 && !IPAddress.IsLoopback(listen))
                    log.Warn($"no token: every client that reaches port {server.Port} can control the DICENTIS system (--token to restrict)");
                Console.WriteLine($"READY port={server.Port}"); // machine-readable line for the launcher and the tests
                var stop = new ManualResetEvent(false);
                Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Set(); };
                AppDomain.CurrentDomain.ProcessExit += (_, _) => stop.Set();
                stop.WaitOne();
                log.Info("shutting down");
                server.Stop();
                host.Shutdown();
                return 0;
            }
            catch (Exception ex)
            {
                log.Error(ex.Message);
                if (log.Verbose) log.Error(ex.ToString());
                return 1;
            }
        }

        /// <summary>api.json (copied next to the exe by the build), or null.</summary>
        static Dictionary<string, object> LoadSpec()
        {
            var file = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "api.json");
            return File.Exists(file) ? (Dictionary<string, object>)Json.Parse(File.ReadAllText(file)) : null;
        }

        /// <summary>Print what reflection finds and compare it with api.json.</summary>
        static int SelfTest(DcnmHost host, Dictionary<string, object> spec)
        {
            Console.WriteLine($"DICENTIS API {(host.Fake ? "FAKE" : host.DllPath)} version {host.ApiVersion}, {(Environment.Is64BitProcess ? "64" : "32")}-bit process, working directory {Environment.CurrentDirectory}");
            foreach (var w in host.Warnings) Console.WriteLine("WARNING " + w);
            foreach (var i in host.Interfaces.Values)
                Console.WriteLine($"  {i.Key}: {i.Interface.Name} ({i.Source}), {i.Methods.Values.Sum(l => l.Count)} methods, {i.Events.Count} events, {i.Properties.Count} properties");
            var constants = host.Constants();
            Console.WriteLine($"constants: {constants.Count}");
            if (spec == null) { Console.WriteLine("api.json not found next to the exe: no comparison"); return 0; }

            var problems = 0;
            var byInterface = ((Dictionary<string, object>)spec["interfaces"]).Values.Concat(((Dictionary<string, object>)spec["otherInterfaces"]).Values)
                .Cast<Dictionary<string, object>>().ToDictionary(i => (string)i["interface"]);
            // Members of the interface and of the interfaces it inherits (IDeviceApi : IApi).
            IEnumerable<Dictionary<string, object>> Members(Dictionary<string, object> iface, string kind) =>
                ((List<object>)iface[kind]).Cast<Dictionary<string, object>>()
                    .Concat(((List<object>)iface["inherits"]).Cast<string>().Where(byInterface.ContainsKey).SelectMany(b => Members(byInterface[b], kind)));
            void Compare(string key, Dictionary<string, object> iface, bool documentedProperty)
            {
                var name = (string)iface["interface"];
                var found = host.Interfaces.Values.FirstOrDefault(i => i.Interface.Name == name);
                if (found == null) { Console.WriteLine($"MISSING interface {name} ({(documentedProperty ? "property " + key : "no documented property")})"); problems++; return; }
                if (documentedProperty && found.Key != key) Console.WriteLine($"NOTE {name}: documented as property {key}, found as {found.Key} ({found.Source})");
                if (!documentedProperty) Console.WriteLine($"FOUND {name} as {found.Key} ({found.Source})");
                foreach (Dictionary<string, object> m in (List<object>)iface["methods"])
                {
                    var mname = (string)m["name"];
                    var expected = ((List<object>)m["params"]).Cast<Dictionary<string, object>>().Select(p => (string)p["name"]).ToArray();
                    if (!found.Methods.TryGetValue(mname, out var overloads)) { Console.WriteLine($"MISSING method {found.Key}.{mname}"); problems++; continue; }
                    if (!overloads.Any(o => o.GetParameters().Where(p => p.Name != "onFinish").Select(p => p.Name).SequenceEqual(expected)))
                    {
                        Console.WriteLine($"PARAMS {found.Key}.{mname}({string.Join(", ", expected)}): DLL has {string.Join(" | ", overloads.Select(o => "(" + string.Join(", ", o.GetParameters().Select(p => p.Name)) + ")"))}");
                        problems++;
                    }
                }
                var specMethods = new HashSet<string>(Members(iface, "methods").Select(m => (string)m["name"]));
                foreach (var extra in found.Methods.Keys.Where(n => !specMethods.Contains(n))) Console.WriteLine($"EXTRA method {found.Key}.{extra} (not in the 7.0 docs)");
                var specEvents = new HashSet<string>(Members(iface, "events").Select(e => (string)e["name"]));
                foreach (var e in specEvents.Where(n => found.Events.All(x => x.Name != n))) { Console.WriteLine($"MISSING event {found.Key}.{e}"); problems++; }
                foreach (var e in found.Events.Where(x => !specEvents.Contains(x.Name))) Console.WriteLine($"EXTRA event {found.Key}.{e.Name}");
                var specProps = new HashSet<string>(Members(iface, "properties").Select(p => (string)p["name"]));
                foreach (var p in specProps.Where(n => !found.Properties.ContainsKey(n))) { Console.WriteLine($"MISSING property {found.Key}.{p}"); problems++; }
            }
            foreach (var kv in (Dictionary<string, object>)spec["interfaces"]) Compare(kv.Key, (Dictionary<string, object>)kv.Value, true);
            foreach (var kv in (Dictionary<string, object>)spec["otherInterfaces"])
            {
                if (kv.Key == "IPluginInstance") continue; // only exists as a RegisterPluginAsync result (handle)
                var name = (string)((Dictionary<string, object>)kv.Value)["interface"];
                if (host.Interfaces.Values.Any(i => i.Interface.Name == name)) Compare(kv.Key, (Dictionary<string, object>)kv.Value, false);
                else Console.WriteLine($"NOT REACHABLE {name}: no property and no object implements it (its members cannot be called)");
            }
            problems += host.Warnings.Count;
            Console.WriteLine(problems == 0 ? "SELFTEST OK: the DLLs match api.json" : $"SELFTEST: {problems} problem(s) (differences to api.json and warnings above)");
            return problems == 0 ? 0 : 3;
        }
    }
}
