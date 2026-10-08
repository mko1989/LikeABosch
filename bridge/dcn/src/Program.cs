// dcn-bridge entry point (WO-061, DEC-017). Usage: see README.md / --help.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using BridgeCore;

namespace DcnBridge
{
    public static class Program
    {
        const string Help = @"dcn-bridge: LikeABosch bridge to the Bosch DCN-SW API (docs/protocol/dcn-swapi/BRIDGE.md)

  --listen <address>   default 0.0.0.0              (env DCN_BRIDGE_LISTEN)
  --port <port>        default 9480                 (env DCN_BRIDGE_PORT)
  --token <secret>     optional: only clients with this token are accepted (env DCN_BRIDGE_TOKEN); default none (DEC-019)
  --dll-dir <folder>   DCN-SW installation folder (with Bosch.Dcn.Ecpc.Client.Api.*.dll), in quotes if it contains spaces;
                       default: next to dcn-bridge.exe, else C:\Program Files (x86)\Bosch\Digital Congress Network\DCN-SW
                       (env DCN_BRIDGE_DLL_DIR)
  --config <file>      JSON file with the same keys (listen, port, token, dllDir, verbose); default dcn-bridge.config.json next to the exe
  --fake               serve a built-in stub of the documented API instead of the Bosch DLLs (protocol tests)
  --selftest           load the DLLs, list what reflection finds, compare with api.json, exit
  --verbose            log every call";

        public static int Main(string[] argv)
        {
            var log = new Log();
            try
            {
                var opt = Options.Parse(argv, "dcn-bridge.config.json", Flags, PathKeys);
                if (opt.ContainsKey("help")) { Console.WriteLine(Help); return 0; }
                log.Verbose = opt.ContainsKey("verbose");
                var fake = opt.ContainsKey("fake");
                var host = fake ? ApiHost.LoadFake(log) : ApiHost.LoadReal(Options.Get(opt, "dllDir", "DCN_BRIDGE_DLL_DIR", null) ?? ApiHost.FindDllDir(log), log);
                if (opt.ContainsKey("selftest")) return SelfTest(host);

                var token = Options.Get(opt, "token", "DCN_BRIDGE_TOKEN", null) ?? "";
                var port = int.Parse(Options.Get(opt, "port", "DCN_BRIDGE_PORT", "9480"));
                var listen = IPAddress.Parse(Options.Get(opt, "listen", "DCN_BRIDGE_LISTEN", "0.0.0.0"));
                if (opt.TryGetValue("initTimeout", out var it)) host.InitTimeout = TimeSpan.FromSeconds(double.Parse(it));

                var dcn = new DcnHost(host, log);
                var server = new BridgeServer(dcn, listen, port, token, log);
                server.Start();
                dcn.Start();
                if (token.Length == 0) log.Warn($"no token: every client that reaches port {server.Port} can control the DCN system (--token to restrict)");
                Console.WriteLine($"READY port={server.Port}"); // machine-readable line for scripts/bridge-dcn-test.mjs
                var stop = new ManualResetEvent(false);
                Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Set(); };
                AppDomain.CurrentDomain.ProcessExit += (_, _) => stop.Set();
                stop.WaitOne();
                log.Info("shutting down");
                server.Stop();
                dcn.Stop();
                host.TerminateAll();
                return 0;
            }
            catch (Exception ex)
            {
                log.Error(ex.Message);
                if (log.Verbose) log.Error(ex.ToString());
                return 1;
            }
        }

        static readonly HashSet<string> Flags = new HashSet<string> { "fake", "selftest", "verbose", "help" };
        static readonly HashSet<string> PathKeys = new HashSet<string> { "dllDir", "config" };

        /// <summary>Print what reflection finds and compare it with api.json (copied next to the exe).</summary>
        static int SelfTest(ApiHost host)
        {
            Console.WriteLine($"DCN-SW API {(host.Fake ? "FAKE" : host.DllPath)} version {host.ApiVersion}, {(Environment.Is64BitProcess ? "64" : "32")}-bit process, working directory {Environment.CurrentDirectory}");
            foreach (var w in host.Warnings) Console.WriteLine("WARNING " + w);
            foreach (var root in host.Roots.Values)
            {
                Console.WriteLine($"root {root.Group}: {root.Interface.FullName} ({root.Flags.Count} flags: {string.Join(", ", root.Flags.Select(f => f.Name))})");
                foreach (var sub in root.Subs.Values)
                    Console.WriteLine($"  {sub.Key}: {sub.Interface.Name}, {sub.Methods.Count} methods, {sub.Events.Count} events, flags {string.Join(", ", sub.Flags.Select(f => f.Name))}");
            }
            Console.WriteLine("constants:");
            foreach (var kv in host.Constants()) Console.WriteLine($"  {kv.Key} = {Json.Write(kv.Value)}");

            var specFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "api.json");
            if (!File.Exists(specFile)) { Console.WriteLine("api.json not found next to the exe: no comparison"); return 0; }
            var spec = (Dictionary<string, object>)Json.Parse(File.ReadAllText(specFile));
            var problems = 0;
            var interfaces = (Dictionary<string, object>)spec["interfaces"];
            foreach (var kv in interfaces)
            {
                var iface = (Dictionary<string, object>)kv.Value;
                if (!host.Interfaces.TryGetValue(kv.Key, out var sub)) { Console.WriteLine($"MISSING interface {kv.Key}"); problems++; continue; }
                foreach (Dictionary<string, object> m in (List<object>)iface["methods"])
                {
                    var name = (string)m["name"];
                    if (!sub.Methods.TryGetValue(name, out var mi)) { Console.WriteLine($"MISSING method {kv.Key}.{name}"); problems++; continue; }
                    var expected = ((List<object>)m["params"]).Cast<Dictionary<string, object>>().Select(p => (string)p["name"]).ToArray();
                    var actual = mi.GetParameters().Select(p => p.Name).ToArray();
                    if (!expected.SequenceEqual(actual)) { Console.WriteLine($"PARAMS {kv.Key}.{name}: spec ({string.Join(", ", expected)}) vs DLL ({string.Join(", ", actual)})"); problems++; }
                }
                var specMethods = new HashSet<string>(((List<object>)iface["methods"]).Cast<Dictionary<string, object>>().Select(m => (string)m["name"]));
                foreach (var extra in sub.Methods.Keys.Where(n => !specMethods.Contains(n))) Console.WriteLine($"EXTRA method {kv.Key}.{extra} (not in the 4.70 docs)");
                var specEvents = new HashSet<string>(((List<object>)iface["events"]).Cast<Dictionary<string, object>>().Select(e => (string)e["name"]));
                foreach (var e in specEvents.Where(n => !sub.Events.Any(x => x.Name == n))) { Console.WriteLine($"MISSING event {kv.Key}.{e}"); problems++; }
                foreach (var e in sub.Events.Where(x => !specEvents.Contains(x.Name))) Console.WriteLine($"EXTRA event {kv.Key}.{e.Name}");
            }
            problems += host.Warnings.Count;
            Console.WriteLine(problems == 0 ? "SELFTEST OK: the DLLs match api.json" : $"SELFTEST: {problems} problem(s) (differences to api.json and warnings above)");
            return problems == 0 ? 0 : 3;
        }
    }
}
